export type LlmProviderId = "deepseek" | "gemini";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  temperature: number;
  systemPrompt: string;
}

export interface LlmClient {
  complete(messages: ChatMessage[], options: ChatOptions): Promise<string>;
}

export interface LlmCredentials {
  provider: LlmProviderId;
  deepseekApiKey: string;
  geminiApiKey: string;
}

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const GEMINI_MODEL = "gemini-1.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function deepSeekComplete(
  messages: ChatMessage[],
  apiKey: string,
  options: ChatOptions
): Promise<string> {
  const systemFromMessages = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const bodyMessages = messages.filter((m) => m.role !== "system");
  const system =
    [options.systemPrompt?.trim(), systemFromMessages].filter(Boolean).join("\n\n") ||
    undefined;

  const payload: Record<string, unknown> = {
    model: "deepseek-chat",
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      ...bodyMessages.map((m) => ({ role: m.role, content: m.content })),
    ],
    temperature: options.temperature,
  };

  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `DeepSeek HTTP ${res.status}`);
  }
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("DeepSeek: empty response");
  return text;
}

async function geminiComplete(
  messages: ChatMessage[],
  apiKey: string,
  options: ChatOptions
): Promise<string> {
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

  const url = `${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`;
  const body: Record<string, unknown> = {
    contents,
    generationConfig: { temperature: options.temperature },
  };
  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as {
    error?: { message?: string };
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Gemini HTTP ${res.status}`);
  }
  const parts = data.candidates?.[0]?.content?.parts;
  const text = parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("Gemini: empty response");
  return text;
}

export function createLlmClient(creds: LlmCredentials): LlmClient {
  if (creds.provider === "deepseek") {
    return {
      complete(messages, options) {
        const key = creds.deepseekApiKey.trim();
        if (!key) return Promise.reject(new Error("DeepSeek API key is empty"));
        return deepSeekComplete(messages, key, options);
      },
    };
  }
  return {
    complete(messages, options) {
      const key = creds.geminiApiKey.trim();
      if (!key) return Promise.reject(new Error("Gemini API key is empty"));
      return geminiComplete(messages, key, options);
    },
  };
}
