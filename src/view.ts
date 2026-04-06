import {
  Component,
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import type AIChatPlugin from "./main";
import {
  createLlmClient,
  DEFAULT_MAX_API_HISTORY_MESSAGES,
  limitChatMessagesForApiWindow,
  type ChatMessage,
} from "./core/llm";

export const VIEW_TYPE = "obsidian-ai-chat-view";

const USAGE_URLS = {
  deepseek: "https://platform.deepseek.com/usage",
  gemini: "https://aistudio.google.com/app/plan_information",
} as const;

export interface UiMessage {
  role: "user" | "assistant";
  content: string;
}

export class AIChatView extends ItemView {
  plugin: AIChatPlugin;
  private mdRoot: Component;
  private historyEl!: HTMLDivElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private clearBtn!: HTMLButtonElement;
  private usageBtn!: HTMLButtonElement;
  private loadingEl!: HTMLSpanElement;
  private targetEl!: HTMLSpanElement;

  /** In-memory transcript; not synced from manual note edits (MVP). */
  messages: UiMessage[] = [];
  /** Locked target note for the session; set on first send. */
  lockedTarget: TFile | null = null;
  private inFlight = false;

  constructor(leaf: WorkspaceLeaf, plugin: AIChatPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.mdRoot = new Component();
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "AI Chat";
  }

  getIcon(): string {
    return "message-circle";
  }

  async onOpen(): Promise<void> {
    this.mdRoot.load();
    const root = this.contentEl.createDiv({ cls: "ai-chat-root" });

    const targetRow = root.createDiv({ cls: "ai-chat-target" });
    targetRow.setText("Target: ");
    this.targetEl = targetRow.createSpan();

    this.historyEl = root.createDiv({ cls: "ai-chat-history" });

    const inputRow = root.createDiv({ cls: "ai-chat-input-row" });
    this.inputEl = inputRow.createEl("textarea", { cls: "ai-chat-input" });

    const toolbar = root.createDiv({ cls: "ai-chat-toolbar" });
    this.sendBtn = toolbar.createEl("button", { text: "Send", cls: "mod-cta" });
    this.clearBtn = toolbar.createEl("button", { text: "Clear session" });
    this.usageBtn = toolbar.createEl("button", { text: "Usage" });
    this.loadingEl = toolbar.createSpan({ cls: "ai-chat-loading", text: "" });

    this.sendBtn.addEventListener("click", () => void this.onSend());
    this.clearBtn.addEventListener("click", () => this.onClearSession());
    this.usageBtn.addEventListener("click", () => this.onUsage());

    this.refreshTargetLabel();
    await this.renderAllMessages();
  }

  async onClose(): Promise<void> {
    this.mdRoot.unload();
    this.contentEl.empty();
  }

  private sourcePath(): string {
    return this.lockedTarget?.path ?? "";
  }

  private refreshTargetLabel(): void {
    this.targetEl.setText(
      this.lockedTarget ? this.lockedTarget.path : "(not locked — send locks active note)"
    );
  }

  private async appendRenderedMessage(msg: UiMessage): Promise<void> {
    const wrap = this.historyEl.createDiv({ cls: "ai-chat-msg" });
    wrap.createDiv({ cls: "ai-chat-msg-role", text: msg.role });
    const body = wrap.createDiv();
    await MarkdownRenderer.render(
      this.app,
      msg.content,
      body,
      this.sourcePath(),
      this.mdRoot
    );
    this.historyEl.scrollTop = this.historyEl.scrollHeight;
  }

  private async renderAllMessages(): Promise<void> {
    this.historyEl.empty();
    for (const m of this.messages) {
      await this.appendRenderedMessage(m);
    }
  }

  private onClearSession(): void {
    this.messages = [];
    this.lockedTarget = null;
    this.refreshTargetLabel();
    void this.renderAllMessages();
  }

  private onUsage(): void {
    const url = USAGE_URLS[this.plugin.settings.provider];
    window.open(url, "_blank", "noopener,noreferrer");
  }

  /** Resolve locked file if it still exists; otherwise null. */
  private resolveLockedFile(): TFile | null {
    if (!this.lockedTarget) return null;
    const abs = this.app.vault.getAbstractFileByPath(this.lockedTarget.path);
    return abs instanceof TFile ? abs : null;
  }

  /**
   * Selection from the editor only when the active note is the locked target
   * (prevents leaking context from unrelated notes).
   */
  private getSelectionContext(): string {
    const active = this.app.workspace.getActiveFile();
    if (!this.lockedTarget || !active || active.path !== this.lockedTarget.path) {
      return "";
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.editor) return "";
    return view.editor.getSelection().trim();
  }

  private buildUserTurnBody(rawInput: string, selection: string): string {
    if (!selection) return rawInput;
    return `${rawInput}\n\n---\n\n**Selection from note:**\n\n${selection}`;
  }

  private toApiMessages(): ChatMessage[] {
    return this.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  private setLoading(loading: boolean): void {
    this.inFlight = loading;
    this.sendBtn.disabled = loading;
    this.loadingEl.setText(loading ? "Waiting for model…" : "");
  }

  private formatNoteBlock(userContent: string, assistantContent: string): string {
    const leadingSep = "\n\n";
    const body = `### User\n\n${userContent}\n\n### Assistant\n\n${assistantContent}\n`;
    return `${leadingSep}${body}`;
  }

  private async appendToLockedNote(userContent: string, assistantContent: string): Promise<void> {
    const file = this.resolveLockedFile();
    if (!file) {
      throw new Error("Target note no longer exists; cannot append.");
    }
    const block = this.formatNoteBlock(userContent, assistantContent);
    await this.app.vault.append(file, block);
  }

  private async onSend(): Promise<void> {
    if (this.inFlight) return;
    const rawInput = this.inputEl.value.trim();
    if (!rawInput) return;

    if (!this.lockedTarget) {
      const active = this.app.workspace.getActiveFile();
      if (!active) {
        new Notice("AI Chat: open a note and focus it, then send to lock it as the target.");
        return;
      }
      this.lockedTarget = active;
      this.refreshTargetLabel();
    }

    const file = this.resolveLockedFile();
    if (!file) {
      new Notice("AI Chat: locked note is missing. Clear session or restore the file.");
      return;
    }
    this.lockedTarget = file;

    const selection = this.getSelectionContext();
    const userContent = this.buildUserTurnBody(rawInput, selection);

    const client = createLlmClient({
      provider: this.plugin.settings.provider,
      deepseekApiKey: this.plugin.settings.deepseekApiKey,
      geminiApiKey: this.plugin.settings.geminiApiKey,
    });

    const fullTurns: ChatMessage[] = [
      ...this.toApiMessages(),
      { role: "user", content: userContent },
    ];
    const apiPayload = limitChatMessagesForApiWindow(
      fullTurns,
      DEFAULT_MAX_API_HISTORY_MESSAGES
    );

    this.setLoading(true);
    try {
      const reply = await client.complete(apiPayload, {
        temperature: this.plugin.settings.temperature,
        systemPrompt: this.plugin.settings.systemPrompt,
      });

      await this.appendToLockedNote(userContent, reply);

      this.messages.push({ role: "user", content: userContent });
      await this.appendRenderedMessage(this.messages[this.messages.length - 1]);

      this.messages.push({ role: "assistant", content: reply });
      await this.appendRenderedMessage(this.messages[this.messages.length - 1]);

      this.inputEl.value = "";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`AI Chat: ${msg}`);
    } finally {
      this.setLoading(false);
    }
  }
}
