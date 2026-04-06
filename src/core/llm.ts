export type LlmProviderId = "deepseek" | "gemini";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  temperature: number;
  systemPrompt: string;
  enableWebSearch?: boolean;
}

export type ChunkCallback = (textChunk: string, reasoningChunk: string) => void;

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface StreamResult {
  content: string;
  reasoning: string;
  usage: TokenUsage;
}

export interface LlmClient {
  stream(
    messages: ChatMessage[],
    options: ChatOptions,
    onChunk: ChunkCallback,
    signal: AbortSignal
  ): Promise<StreamResult>;
}

/** DeepSeek API `model` field ([docs](https://api-docs.deepseek.com/)). */
export type DeepseekModelId = "deepseek-chat" | "deepseek-reasoner";

/** Gemini model id for `streamGenerateContent` path segment. */
export type GeminiModelId = "gemini-2.5-flash" | "gemini-3.1-pro-preview";

export interface LlmCredentials {
  provider: LlmProviderId;
  deepseekApiKey: string;
  geminiApiKey: string;
  /** Defaults to `deepseek-chat` when omitted. */
  deepseekModel?: DeepseekModelId;
  /** Defaults to `gemini-2.5-flash` when omitted. */
  geminiModel?: GeminiModelId;
}

/**
 * Max `user` / `assistant` messages per API request (sliding window on the payload only).
 * System instructions use `ChatOptions.systemPrompt` and are not part of this array.
 * @deprecated Prefer token-based trimming via {@link estimatePromptTokens} / {@link trimLeadingAssistantRun}; kept for tests and callers that still cap by count.
 */
export const DEFAULT_MAX_API_HISTORY_MESSAGES = 10;

/** Conservative input token budgets (prompt-side safety margin vs raw API max). */
export const GEMINI_INPUT_TOKEN_LIMIT_SAFE = 800_000;
export const DEEPSEEK_INPUT_TOKEN_LIMIT_SAFE = 100_000;

export function getInputTokenLimitForProvider(provider: LlmProviderId): number {
  return provider === "gemini" ? GEMINI_INPUT_TOKEN_LIMIT_SAFE : DEEPSEEK_INPUT_TOKEN_LIMIT_SAFE;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length * 1.1);
}

/**
 * Rough prompt-token estimate aligned with how system + body text are assembled for both providers.
 */
export function estimatePromptTokens(
  messages: ChatMessage[],
  options: ChatOptions,
  _provider: LlmProviderId
): number {
  const systemFromMessages = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const systemText =
    [options.systemPrompt?.trim(), systemFromMessages].filter(Boolean).join("\n\n") || "";
  const bodyMessages = messages.filter((m) => m.role !== "system");
  let total = 0;
  if (systemText) total += estimateTokens(systemText);
  for (const m of bodyMessages) {
    total += estimateTokens(m.content);
  }
  return total;
}

/**
 * Drops a leading run of `assistant` messages so the payload does not start mid-turn.
 */
export function trimLeadingAssistantRun(messages: ChatMessage[]): ChatMessage[] {
  let start = 0;
  while (start < messages.length && messages[start].role === "assistant") {
    start += 1;
  }
  return messages.slice(start);
}

/**
 * Keeps the last `maxCount` chat messages for the API. Trims a leading `assistant` run so
 * the window does not start mid-turn when possible. Does not inject `system` (handled in options).
 */
export function limitChatMessagesForApiWindow(
  messages: ChatMessage[],
  maxCount: number = DEFAULT_MAX_API_HISTORY_MESSAGES
): ChatMessage[] {
  if (maxCount < 1) return [];
  if (messages.length <= maxCount) return messages.slice();
  const sliced = messages.slice(-maxCount);
  return trimLeadingAssistantRun(sliced);
}

export function isAbortError(e: unknown): boolean {
  if (e === null || typeof e !== "object") return false;
  const name = (e as { name?: unknown }).name;
  return name === "AbortError";
}

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

function geminiStreamUrl(modelId: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent`;
}

type DeepSeekDelta = {
  content?: string;
  reasoning_content?: string;
};

type DeepSeekSseJson = {
  error?: { message?: string };
  choices?: { delta?: DeepSeekDelta; finish_reason?: string | null }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

function buildDeepSeekPayload(
  messages: ChatMessage[],
  options: ChatOptions,
  modelId: string
): Record<string, unknown> {
  const systemFromMessages = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const bodyMessages = messages.filter((m) => m.role !== "system");
  const system =
    [options.systemPrompt?.trim(), systemFromMessages].filter(Boolean).join("\n\n") ||
    undefined;

  return {
    model: modelId,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      ...bodyMessages.map((m) => ({ role: m.role, content: m.content })),
    ],
    temperature: options.temperature,
    stream: true,
    stream_options: { include_usage: true },
  };
}

async function deepSeekStream(
  messages: ChatMessage[],
  apiKey: string,
  modelId: string,
  options: ChatOptions,
  onChunk: ChunkCallback,
  signal: AbortSignal
): Promise<StreamResult> {
  const payload = buildDeepSeekPayload(messages, options, modelId);
  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(errBody.error?.message ?? `DeepSeek HTTP ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("DeepSeek: no response body");

  const decoder = new TextDecoder();
  let lineBuffer = "";
  let content = "";
  let reasoning = "";
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };

  const processLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const dataStr = trimmed.slice(5).trim();
    if (dataStr === "[DONE]") return;
    let json: DeepSeekSseJson;
    try {
      json = JSON.parse(dataStr) as DeepSeekSseJson;
    } catch {
      return;
    }
    if (json.error?.message) throw new Error(json.error.message);
    const delta = json.choices?.[0]?.delta;
    if (delta) {
      const tc = delta.content ?? "";
      const rc = delta.reasoning_content ?? "";
      if (tc || rc) {
        content += tc;
        reasoning += rc;
        onChunk(tc, rc);
      }
    }
    if (json.usage) {
      usage = {
        promptTokens: json.usage.prompt_tokens ?? 0,
        completionTokens: json.usage.completion_tokens ?? 0,
      };
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        processLine(line);
      }
    }
    if (lineBuffer.trim()) {
      for (const line of lineBuffer.split("\n")) {
        processLine(line);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!content && !reasoning) {
    if (usage.promptTokens > 0 || usage.completionTokens > 0) {
      return { content: "", reasoning: "", usage };
    }
    throw new Error("DeepSeek: empty stream");
  }
  return { content, reasoning, usage };
}

function buildGeminiBody(
  messages: ChatMessage[],
  options: ChatOptions
): Record<string, unknown> {
  const systemFromMessages = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const systemText =
    [options.systemPrompt?.trim(), systemFromMessages].filter(Boolean).join("\n\n") ||
    undefined;

  const contents: { role: string; parts: { text: string }[] }[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const role = m.role === "assistant" ? "model" : "user";
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push({ text: m.content });
    } else {
      contents.push({ role, parts: [{ text: m.content }] });
    }
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { temperature: options.temperature },
  };
  if (options.enableWebSearch) {
    body.tools = [{ google_search: {} }];
  }
  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }
  return body;
}

type GeminiSseJson = {
  error?: { message?: string };
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

async function geminiStream(
  messages: ChatMessage[],
  apiKey: string,
  modelId: string,
  options: ChatOptions,
  onChunk: ChunkCallback,
  signal: AbortSignal
): Promise<StreamResult> {
  const url = `${geminiStreamUrl(modelId)}?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const body = buildGeminiBody(messages, options);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(errBody.error?.message ?? `Gemini HTTP ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("Gemini: no response body");

  const decoder = new TextDecoder();
  let lineBuffer = "";
  let content = "";
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };

  let textAggregate = "";

  const processLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const dataStr = trimmed.slice(5).trim();
    if (!dataStr || dataStr === "[DONE]") return;
    let json: GeminiSseJson;
    try {
      json = JSON.parse(dataStr) as GeminiSseJson;
    } catch {
      return;
    }
    if (json.error?.message) throw new Error(json.error.message);
    const parts = json.candidates?.[0]?.content?.parts;
    if (parts?.length) {
      const piece = parts.map((p) => p.text ?? "").join("");
      if (!piece) return;
      // Cumulative full-text (growing prefix) vs pure delta chunks: empty aggregate is a special case because
      // in JS any string starts with "", which would swallow the first delta incorrectly.
      let delta: string;
      if (textAggregate.length === 0) {
        delta = piece;
        textAggregate = piece;
      } else if (piece.startsWith(textAggregate)) {
        delta = piece.slice(textAggregate.length);
        textAggregate = piece;
      } else {
        delta = piece;
        textAggregate += piece;
      }
      if (delta) {
        content += delta;
        onChunk(delta, "");
      }
    }
    const um = json.usageMetadata;
    if (um) {
      const prompt = um.promptTokenCount ?? 0;
      const completion =
        um.candidatesTokenCount ??
        Math.max(0, (um.totalTokenCount ?? 0) - prompt);
      usage = { promptTokens: prompt, completionTokens: completion };
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        processLine(line);
      }
    }
    if (lineBuffer.trim()) {
      for (const line of lineBuffer.split("\n")) {
        processLine(line);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!content) {
    throw new Error("Gemini: empty stream");
  }
  return { content, reasoning: "", usage };
}

export function createLlmClient(creds: LlmCredentials): LlmClient {
  if (creds.provider === "deepseek") {
    return {
      stream(messages, options, onChunk, signal) {
        const key = creds.deepseekApiKey.trim();
        if (!key) return Promise.reject(new Error("DeepSeek API key is empty"));
        const modelId = creds.deepseekModel ?? "deepseek-chat";
        return deepSeekStream(messages, key, modelId, options, onChunk, signal);
      },
    };
  }
  return {
    stream(messages, options, onChunk, signal) {
      const key = creds.geminiApiKey.trim();
      if (!key) return Promise.reject(new Error("Gemini API key is empty"));
      const modelId = creds.geminiModel ?? "gemini-2.5-flash";
      return geminiStream(messages, key, modelId, options, onChunk, signal);
    },
  };
}
