import type { TFile } from "obsidian";
import type { AIChatSettings } from "../settings";
import type { TokenLimitChoice } from "../token-limit-modal";
import {
  createLlmClient,
  estimatePromptTokens,
  getInputTokenLimitForProvider,
  isAbortError,
  trimLeadingAssistantRun,
  type ChatMessage,
  type ChatOptions,
  type LlmClient,
  type LlmCredentials,
  type LlmProviderId,
  type StreamResult,
} from "./llm";
import { parseNoteConversation } from "./note-conversation-parser";
import { fetchUrlsAppendix } from "./url-fetch";

export type CreateLlmClientFn = (creds: LlmCredentials) => LlmClient;

export interface VaultAdapter {
  resolveFile(path: string): TFile | null;
  appendToFile(file: TFile, content: string): Promise<void>;
  buildWikilinkContext(
    rawPrompt: string,
    sourcePath: string,
    enabled: boolean
  ): Promise<string>;
}

/**
 * UI updates from ChatSession. `onStreamFinished` runs after the LLM stream completes and
 * before the vault append (same order as the pre-refactor view).
 */
export interface ChatSessionDelegate {
  onSendStarting(userContent: string, userAt: string): void | Promise<void>;
  onStreamChunk(textChunk: string, reasoningChunk: string): void;
  /** Render assistant markdown (after stream, before vault append). */
  onStreamFinished(result: StreamResult): Promise<void>;
  /** After append + session messages updated: usage line, clear input, clear pending rows. */
  onTurnComplete(userContent: string, result: StreamResult, assistantAt: string): void;
  onTurnRolledBack(): void;
  onLoadingChanged(loading: boolean): void;
  onMessagesChanged(): void;
  /**
   * Fired after `ChatSession` clears in-memory state. Today only `AIChatView.onClearSession`
   * calls `clearSession` and updates the DOM itself; if another caller invokes `clearSession`
   * later, that path must refresh target UI and history to match.
   */
  onSessionCleared(): void;
  promptTokenLimitChoice(estimated: number, limit: number): Promise<TokenLimitChoice>;
  showNotice(message: string): void;
}

function buildUserTurnBody(rawInput: string, selection: string): string {
  if (!selection) return rawInput;
  return `${rawInput}\n\n---\n\n**Selection from note:**\n\n${selection}`;
}

function formatNoteBlock(
  userContent: string,
  assistantContent: string,
  userAt: string,
  assistantAt: string
): string {
  const leadingSep = "\n\n";
  const u = `<!-- ai-chat-at:${userAt} -->`;
  const a = `<!-- ai-chat-at:${assistantAt} -->`;
  const body = `### User\n\n${u}\n\n${userContent}\n\n### Assistant\n\n${a}\n\n${assistantContent}\n`;
  return `${leadingSep}${body}`;
}

/** Formats assistant reply for MarkdownRenderer (optional reasoning block). */
export function buildAssistantMarkdown(content: string, reasoning: string): string {
  if (reasoning.trim()) {
    return `<details>\n<summary>Reasoning</summary>\n\n${reasoning}\n\n</details>\n\n${content}`;
  }
  return content;
}

export class ChatSession {
  private _messages: ChatMessage[] = [];
  private _lockedTarget: TFile | null = null;
  private _inFlight = false;
  private abortController: AbortController | null = null;

  constructor(
    private readonly vault: VaultAdapter,
    private readonly delegate: ChatSessionDelegate,
    private readonly getSettings: () => AIChatSettings,
    private readonly createClient: CreateLlmClientFn = createLlmClient
  ) {}

  get messages(): ReadonlyArray<ChatMessage> {
    return this._messages;
  }

  get lockedTarget(): TFile | null {
    return this._lockedTarget;
  }

  get inFlight(): boolean {
    return this._inFlight;
  }

  lockTarget(file: TFile): void {
    this._lockedTarget = file;
  }

  estimateCurrentTokens(draftInput?: string): { estimate: number; limit: number } {
    const settings = this.getSettings();
    const provider = settings.provider as LlmProviderId;
    const opts: ChatOptions = {
      temperature: settings.temperature,
      systemPrompt: settings.systemPrompt,
    };
    let msgs: ChatMessage[] = this.toApiMessages();
    const raw = draftInput?.trim() ?? "";
    if (raw) {
      msgs = [...msgs, { role: "user", content: raw }];
    }
    return {
      estimate: estimatePromptTokens(msgs, opts, provider),
      limit: getInputTokenLimitForProvider(provider),
    };
  }

  stop(): void {
    this.abortController?.abort();
  }

  clearSession(): void {
    if (this._inFlight) {
      this.abortController?.abort();
    }
    this._messages = [];
    this._lockedTarget = null;
    this.delegate.onSessionCleared();
  }

  /**
   * Replaces in-memory messages from a note body using `### User` / `### Assistant` blocks.
   * Refuses if estimated prompt tokens exceed the provider safe limit (ADR 0002).
   */
  hydrateFromNoteMarkdown(markdown: string): { ok: true } | { ok: false; reason: string } {
    if (this._inFlight) {
      return { ok: false, reason: "Cannot load note while sending." };
    }
    const parsed = parseNoteConversation(markdown);
    const settings = this.getSettings();
    const provider = settings.provider as LlmProviderId;
    const chatOptions = this.chatOptions();
    const est = estimatePromptTokens(parsed, chatOptions, provider);
    const limit = getInputTokenLimitForProvider(provider);
    if (est > limit) {
      return {
        ok: false,
        reason: `Estimated prompt ~${est.toLocaleString()} tokens exceeds safe limit ${limit.toLocaleString()}.`,
      };
    }
    this._messages = parsed.filter((m) => m.role === "user" || m.role === "assistant");
    this.delegate.onMessagesChanged();
    return { ok: true };
  }

  private resolveLockedFile(): TFile | null {
    if (!this._lockedTarget) return null;
    return this.vault.resolveFile(this._lockedTarget.path);
  }

  private toApiMessages(): ChatMessage[] {
    return this._messages.map((m) => ({ role: m.role, content: m.content }));
  }

  private chatOptions(): ChatOptions {
    const s = this.getSettings();
    return {
      temperature: s.temperature,
      systemPrompt: s.systemPrompt,
      enableWebSearch: s.provider === "gemini" && s.enableWebSearch,
    };
  }

  async send(rawInput: string, selectionContext: string): Promise<void> {
    if (this._inFlight) return;

    const file = this.resolveLockedFile();
    if (!file) {
      this.delegate.showNotice("AI Chat: locked note is missing. Clear session or restore the file.");
      return;
    }
    this._lockedTarget = file;

    const settings = this.getSettings();
    const urlAppendix = settings.enableUrlFetch
      ? await fetchUrlsAppendix(rawInput, (msg) => this.delegate.showNotice(msg))
      : "";
    const rawForTurn = urlAppendix ? `${rawInput}${urlAppendix}` : rawInput;
    const baseUserTurn = buildUserTurnBody(rawForTurn, selectionContext);
    const wikilinkAppendix = await this.vault.buildWikilinkContext(
      rawInput,
      file.path,
      settings.enableWikilinkContextResolution
    );
    const userContent = wikilinkAppendix ? `${baseUserTurn}${wikilinkAppendix}` : baseUserTurn;

    const client = this.createClient({
      provider: settings.provider,
      deepseekApiKey: settings.deepseekApiKey,
      geminiApiKey: settings.geminiApiKey,
      deepseekModel: settings.deepseekModel,
      geminiModel: settings.geminiModel,
    });

    const provider = settings.provider as LlmProviderId;
    const chatOptions = this.chatOptions();
    const tokenLimit = getInputTokenLimitForProvider(provider);

    let fullTurns: ChatMessage[] = [
      ...this.toApiMessages(),
      { role: "user", content: userContent },
    ];

    for (;;) {
      let est = estimatePromptTokens(fullTurns, chatOptions, provider);
      if (est <= tokenLimit) {
        const apiPayload = trimLeadingAssistantRun(fullTurns);
        if (apiPayload.length === 0) {
          this.delegate.showNotice("AI Chat: no valid messages to send after trimming.");
          return;
        }
        await this.dispatchStream(userContent, apiPayload, chatOptions, client);
        return;
      }

      const choice = await this.delegate.promptTokenLimitChoice(est, tokenLimit);
      if (choice === "cancel") return;

      if (choice === "clear") {
        this._messages = [];
        this.delegate.onMessagesChanged();
        fullTurns = [{ role: "user", content: userContent }];
        est = estimatePromptTokens(fullTurns, chatOptions, provider);
        if (est > tokenLimit) {
          this.delegate.showNotice("AI Chat: message is still too long. Shorten your input.");
          return;
        }
        continue;
      }

      let candidate = fullTurns.slice();
      while (
        candidate.length > 1 &&
        estimatePromptTokens(candidate, chatOptions, provider) > tokenLimit
      ) {
        candidate.shift();
      }
      if (estimatePromptTokens(candidate, chatOptions, provider) > tokenLimit) {
        this.delegate.showNotice("AI Chat: message is still too long. Shorten your input.");
        return;
      }
      const dropped = fullTurns.length - candidate.length;
      this._messages = this._messages.slice(dropped);
      this.delegate.onMessagesChanged();
      fullTurns = candidate;
    }
  }

  private async dispatchStream(
    userContent: string,
    apiPayload: ChatMessage[],
    chatOptions: ChatOptions,
    client: LlmClient
  ): Promise<void> {
    this._inFlight = true;
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const userAt = new Date().toISOString();
    await Promise.resolve(this.delegate.onSendStarting(userContent, userAt));
    this.delegate.onLoadingChanged(true);

    try {
      const result = await client.stream(
        apiPayload,
        chatOptions,
        (textChunk, reasoningChunk) => {
          this.delegate.onStreamChunk(textChunk, reasoningChunk);
        },
        signal
      );

      await this.delegate.onStreamFinished(result);

      const file = this.resolveLockedFile();
      if (!file) {
        throw new Error("Target note no longer exists; cannot append.");
      }
      const assistantAt = new Date().toISOString();
      const block = formatNoteBlock(userContent, result.content, userAt, assistantAt);
      await this.vault.appendToFile(file, block);

      this._messages.push({ role: "user", content: userContent, createdAt: userAt });
      this._messages.push({ role: "assistant", content: result.content, createdAt: assistantAt });

      this.delegate.onTurnComplete(userContent, result, assistantAt);
    } catch (e) {
      if (!isAbortError(e)) {
        const msg = e instanceof Error ? e.message : String(e);
        this.delegate.showNotice(`AI Chat: ${msg}`);
      }
      this.delegate.onTurnRolledBack();
    } finally {
      this._inFlight = false;
      this.delegate.onLoadingChanged(false);
      this.abortController = null;
    }
  }
}
