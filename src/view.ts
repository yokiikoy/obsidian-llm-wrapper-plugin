import {
  Component,
  ItemView,
  type KeymapEventListener,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  Scope,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import type AIChatPlugin from "./main";
import {
  createLlmClient,
  DEFAULT_MAX_API_HISTORY_MESSAGES,
  isAbortError,
  limitChatMessagesForApiWindow,
  type ChatMessage,
} from "./core/llm";
import {
  buildWikilinkContextAppendix,
  wikilinkContextOptionsFromSettings,
} from "./core/wikilink-context";

export const VIEW_TYPE = "obsidian-ai-chat-view";

const USAGE_URLS = {
  deepseek: "https://platform.deepseek.com/usage",
  gemini: "https://aistudio.google.com/app/plan_information",
} as const;

/** Cap dropdown options to avoid DOM freeze on huge vaults; sorted by `mtime` desc. */
const TARGET_SELECT_MAX_FILES = 50;

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
  private stopBtn!: HTMLButtonElement;
  private clearBtn!: HTMLButtonElement;
  private usageBtn!: HTMLButtonElement;
  private loadingEl!: HTMLSpanElement;
  private targetEl!: HTMLSpanElement;
  private targetSelectEl!: HTMLSelectElement;

  /** In-memory transcript; not synced from manual note edits (MVP). */
  messages: UiMessage[] = [];
  /** Locked target note for the session; set on first send. */
  lockedTarget: TFile | null = null;
  private inFlight = false;
  private abortController: AbortController | null = null;
  /** Rows created for an in-flight stream; removed on abort/error before commit. */
  private pendingStreamRows: { userWrap: HTMLElement; asstWrap: HTMLElement } | null =
    null;

  constructor(leaf: WorkspaceLeaf, plugin: AIChatPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.mdRoot = new Component();
    this.scope = new Scope(this.app.scope);
    const sendFromKeymap: KeymapEventListener = (evt) => {
      if (evt.isComposing) return;
      if (!this.inputEl || document.activeElement !== this.inputEl) return;
      void this.onSend();
      return false;
    };
    this.scope.register(["Mod"], "Enter", sendFromKeymap);
    this.scope.register(["Mod"], "NumpadEnter", sendFromKeymap);
    this.scope.register(["Ctrl"], "Enter", sendFromKeymap);
    this.scope.register(["Ctrl"], "NumpadEnter", sendFromKeymap);
    this.scope.register(["Meta"], "Enter", sendFromKeymap);
    this.scope.register(["Meta"], "NumpadEnter", sendFromKeymap);
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

    const targetBlock = root.createDiv({ cls: "ai-chat-target" });
    const pickRow = targetBlock.createDiv({ cls: "ai-chat-target-pick-row" });
    pickRow.createSpan({ text: "Note: ", cls: "ai-chat-target-pick-label" });
    this.targetSelectEl = pickRow.createEl("select", { cls: "ai-chat-target-select" });
    this.populateTargetSelectOptions();
    this.targetSelectEl.addEventListener("change", () => this.refreshTargetLabel());
    const detailRow = targetBlock.createDiv({ cls: "ai-chat-target-detail" });
    this.targetEl = detailRow.createSpan();

    this.historyEl = root.createDiv({ cls: "ai-chat-history" });

    const inputRow = root.createDiv({ cls: "ai-chat-input-row" });
    this.inputEl = inputRow.createEl("textarea", { cls: "ai-chat-input" });

    const toolbar = root.createDiv({ cls: "ai-chat-toolbar" });
    this.sendBtn = toolbar.createEl("button", { text: "Send", cls: "mod-cta" });
    this.stopBtn = toolbar.createEl("button", { text: "Stop", cls: "mod-warning" });
    this.stopBtn.style.display = "none";
    this.clearBtn = toolbar.createEl("button", { text: "Clear session" });
    this.usageBtn = toolbar.createEl("button", { text: "Usage" });
    this.loadingEl = toolbar.createSpan({ cls: "ai-chat-loading", text: "" });

    this.sendBtn.addEventListener("click", () => void this.onSend());
    this.stopBtn.addEventListener("click", () => this.onStop());
    this.clearBtn.addEventListener("click", () => this.onClearSession());
    this.usageBtn.addEventListener("click", () => this.onUsage());

    this.syncTargetSelectEnabled();
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

  /** Recent markdown files only (`mtime` desc) — keeps the target `<select>` responsive. */
  private topMarkdownFilesByMtime(limit: number): TFile[] {
    const files = this.app.vault.getMarkdownFiles().slice();
    files.sort((a, b) => b.stat.mtime - a.stat.mtime);
    return files.slice(0, limit);
  }

  private populateTargetSelectOptions(): void {
    const sel = this.targetSelectEl;
    const keep = sel.value;
    sel.empty();
    sel.createEl("option", { value: "", text: "Active note (on send)" });
    for (const f of this.topMarkdownFilesByMtime(TARGET_SELECT_MAX_FILES)) {
      sel.createEl("option", { value: f.path, text: f.path });
    }
    if (keep && Array.from(sel.options).some((o) => o.value === keep)) {
      sel.value = keep;
    }
  }

  private syncTargetSelectEnabled(): void {
    this.targetSelectEl.disabled = this.lockedTarget !== null;
  }

  private refreshTargetLabel(): void {
    if (this.lockedTarget) {
      this.targetEl.setText(this.lockedTarget.path);
      return;
    }
    const picked = this.targetSelectEl?.value ?? "";
    if (!picked) {
      this.targetEl.setText("Next send locks: active note (or pick a file above)");
    } else {
      this.targetEl.setText(`Next send locks: ${picked}`);
    }
  }

  private async appendRenderedMessage(msg: UiMessage): Promise<void> {
    const wrap = this.historyEl.createDiv({
      cls: `ai-chat-msg ai-chat-msg-${msg.role}`,
    });
    wrap.createDiv({ cls: "ai-chat-msg-role", text: msg.role });
    const inner = wrap.createDiv({ cls: "ai-chat-msg-bubble-inner" });
    await MarkdownRenderer.render(
      this.app,
      msg.content,
      inner,
      this.sourcePath(),
      this.mdRoot
    );
    this.scrollHistoryToBottom();
  }

  private scrollHistoryToBottom(): void {
    this.historyEl.scrollTop = this.historyEl.scrollHeight;
  }

  private async renderAllMessages(): Promise<void> {
    this.historyEl.empty();
    for (const m of this.messages) {
      await this.appendRenderedMessage(m);
    }
  }

  private removePendingStreamRows(): void {
    if (!this.pendingStreamRows) return;
    this.pendingStreamRows.userWrap.remove();
    this.pendingStreamRows.asstWrap.remove();
    this.pendingStreamRows = null;
  }

  private onStop(): void {
    this.abortController?.abort();
  }

  private onClearSession(): void {
    if (this.inFlight) {
      this.abortController?.abort();
    }
    this.removePendingStreamRows();
    this.messages = [];
    this.lockedTarget = null;
    this.targetSelectEl.value = "";
    this.populateTargetSelectOptions();
    this.syncTargetSelectEnabled();
    this.refreshTargetLabel();
    void this.renderAllMessages();
  }

  private onUsage(): void {
    const url = USAGE_URLS[this.plugin.settings.provider];
    window.open(url, "_blank", "noopener,noreferrer");
  }

  private resolveLockedFile(): TFile | null {
    if (!this.lockedTarget) return null;
    const abs = this.app.vault.getAbstractFileByPath(this.lockedTarget.path);
    return abs instanceof TFile ? abs : null;
  }

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
    this.sendBtn.style.display = loading ? "none" : "";
    this.stopBtn.style.display = loading ? "" : "none";
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

  private buildAssistantMarkdown(content: string, reasoning: string): string {
    if (reasoning.trim()) {
      return `<details>\n<summary>Reasoning</summary>\n\n${reasoning}\n\n</details>\n\n${content}`;
    }
    return content;
  }

  private async onSend(): Promise<void> {
    if (this.inFlight) return;
    const rawInput = this.inputEl.value.trim();
    if (!rawInput) return;

    if (!this.lockedTarget) {
      const picked = this.targetSelectEl.value;
      let next: TFile | null = null;
      if (!picked) {
        const active = this.app.workspace.getActiveFile();
        if (!active) {
          new Notice(
            "AI Chat: open a note and focus it, or pick a file in the list, then send."
          );
          return;
        }
        next = active;
      } else {
        const abs = this.app.vault.getAbstractFileByPath(picked);
        if (!(abs instanceof TFile)) {
          new Notice(
            "AI Chat: selected note is missing. Pick another file or use Active note."
          );
          return;
        }
        next = abs;
      }
      this.lockedTarget = next;
      this.syncTargetSelectEnabled();
      this.refreshTargetLabel();
    }

    const file = this.resolveLockedFile();
    if (!file) {
      new Notice("AI Chat: locked note is missing. Clear session or restore the file.");
      return;
    }
    this.lockedTarget = file;

    const selection = this.getSelectionContext();
    const baseUserTurn = this.buildUserTurnBody(rawInput, selection);
    const wikilinkAppendix = await buildWikilinkContextAppendix(
      this.app,
      rawInput,
      file.path,
      wikilinkContextOptionsFromSettings(this.plugin.settings.enableWikilinkContextResolution)
    );
    const userContent = wikilinkAppendix ? `${baseUserTurn}${wikilinkAppendix}` : baseUserTurn;

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

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const userWrap = this.historyEl.createDiv({ cls: "ai-chat-msg ai-chat-msg-user" });
    userWrap.createDiv({ cls: "ai-chat-msg-role", text: "user" });
    const userBubble = userWrap.createDiv({ cls: "ai-chat-msg-bubble-inner" });
    await MarkdownRenderer.render(
      this.app,
      userContent,
      userBubble,
      this.sourcePath(),
      this.mdRoot
    );

    const asstWrap = this.historyEl.createDiv({ cls: "ai-chat-msg ai-chat-msg-assistant" });
    asstWrap.createDiv({ cls: "ai-chat-msg-role", text: "assistant" });
    const asstBubble = asstWrap.createDiv({ cls: "ai-chat-msg-bubble-inner" });
    const stack = asstBubble.createDiv({ cls: "ai-chat-md-stack" });
    const reasonPlain = stack.createDiv({ cls: "ai-chat-reason-plain" });
    reasonPlain.style.display = "none";
    const plainLayer = stack.createDiv({ cls: "ai-chat-plain-layer" });
    const mdLayer = stack.createDiv({ cls: "ai-chat-md-layer" });
    mdLayer.style.display = "none";

    const usageMeta = asstWrap.createDiv({ cls: "ai-chat-usage-meta" });
    usageMeta.style.display = "none";

    this.pendingStreamRows = { userWrap, asstWrap };

    let accText = "";
    let accReason = "";

    this.setLoading(true);
    try {
      const result = await client.stream(
        apiPayload,
        {
          temperature: this.plugin.settings.temperature,
          systemPrompt: this.plugin.settings.systemPrompt,
        },
        (textChunk, reasoningChunk) => {
          if (textChunk) {
            accText += textChunk;
            plainLayer.textContent = accText;
          }
          if (reasoningChunk) {
            accReason += reasoningChunk;
            reasonPlain.textContent = accReason;
            reasonPlain.style.display = "";
          }
          this.scrollHistoryToBottom();
        },
        signal
      );

      const mdSource = this.buildAssistantMarkdown(result.content, result.reasoning);
      plainLayer.style.display = "none";
      reasonPlain.style.display = "none";
      mdLayer.style.display = "block";
      await MarkdownRenderer.render(
        this.app,
        mdSource,
        mdLayer,
        this.sourcePath(),
        this.mdRoot
      );

      try {
        await this.appendToLockedNote(userContent, result.content);
      } catch (appendErr) {
        this.removePendingStreamRows();
        throw appendErr;
      }

      this.messages.push({ role: "user", content: userContent });
      this.messages.push({ role: "assistant", content: result.content });

      const u = result.usage;
      usageMeta.setText(
        u.promptTokens || u.completionTokens
          ? `Tokens · prompt ${u.promptTokens} · completion ${u.completionTokens}`
          : "Tokens · (not reported)"
      );
      usageMeta.style.display = "block";

      this.inputEl.value = "";
      this.pendingStreamRows = null;
    } catch (e) {
      if (!isAbortError(e)) {
        const msg = e instanceof Error ? e.message : String(e);
        new Notice(`AI Chat: ${msg}`);
      }
      this.removePendingStreamRows();
    } finally {
      this.setLoading(false);
      this.abortController = null;
    }
  }
}
