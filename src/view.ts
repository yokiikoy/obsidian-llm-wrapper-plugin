import {
  App,
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
  buildAssistantMarkdown,
  ChatSession,
  type ChatSessionDelegate,
  type VaultAdapter,
} from "./core/chat-session";
import type { StreamResult } from "./core/llm";
import {
  buildWikilinkContextAppendix,
  wikilinkContextOptionsFromSettings,
} from "./core/wikilink-context";
import { openTokenLimitModal } from "./token-limit-modal";

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

function createVaultAdapter(app: App): VaultAdapter {
  return {
    resolveFile(path: string): TFile | null {
      const abs = app.vault.getAbstractFileByPath(path);
      return abs instanceof TFile ? abs : null;
    },
    async appendToFile(file: TFile, content: string): Promise<void> {
      await app.vault.append(file, content);
    },
    async buildWikilinkContext(
      rawPrompt: string,
      sourcePath: string,
      enabled: boolean
    ): Promise<string> {
      return buildWikilinkContextAppendix(
        app,
        rawPrompt,
        sourcePath,
        wikilinkContextOptionsFromSettings(enabled)
      );
    },
  };
}

export class AIChatView extends ItemView implements ChatSessionDelegate {
  plugin: AIChatPlugin;
  private mdRoot: Component;
  private session!: ChatSession;
  private historyEl!: HTMLDivElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private clearBtn!: HTMLButtonElement;
  private usageBtn!: HTMLButtonElement;
  private loadFromNoteBtn!: HTMLButtonElement;
  private modelSelectEl!: HTMLSelectElement;
  private loadingEl!: HTMLSpanElement;
  private targetEl!: HTMLSpanElement;
  private targetSelectEl!: HTMLSelectElement;
  private tokenEstimateEl!: HTMLSpanElement;
  private tokenEstimateDebounce: ReturnType<typeof setTimeout> | undefined;

  /** Rows created for an in-flight stream; removed on abort/error before commit. */
  private pendingStreamRows: {
    userWrap: HTMLElement;
    asstWrap: HTMLElement;
    plainLayer: HTMLDivElement;
    reasonPlain: HTMLDivElement;
    mdLayer: HTMLDivElement;
    usageMeta: HTMLDivElement;
  } | null = null;

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
    this.session = new ChatSession(createVaultAdapter(this.app), this, () => this.plugin.settings);

    const root = this.contentEl.createDiv({ cls: "ai-chat-root" });

    const targetBlock = root.createDiv({ cls: "ai-chat-target" });
    const pickRow = targetBlock.createDiv({ cls: "ai-chat-target-pick-row" });
    pickRow.createSpan({ text: "Note: ", cls: "ai-chat-target-pick-label" });
    this.targetSelectEl = pickRow.createEl("select", { cls: "ai-chat-target-select" });
    this.populateTargetSelectOptions();
    this.targetSelectEl.addEventListener("change", () => this.refreshTargetLabel());
    const detailRow = targetBlock.createDiv({ cls: "ai-chat-target-detail" });
    this.targetEl = detailRow.createSpan();
    const tokenRow = targetBlock.createDiv({ cls: "ai-chat-token-estimate" });
    this.tokenEstimateEl = tokenRow.createSpan();

    this.historyEl = root.createDiv({ cls: "ai-chat-history" });

    const inputRow = root.createDiv({ cls: "ai-chat-input-row" });
    this.inputEl = inputRow.createEl("textarea", { cls: "ai-chat-input" });
    this.registerDomEvent(this.inputEl, "input", () => this.scheduleTokenEstimate(), {
      passive: true,
    });

    const toolbar = root.createDiv({ cls: "ai-chat-toolbar" });
    const modelRow = toolbar.createDiv({ cls: "ai-chat-model-row" });
    modelRow.createSpan({ text: "API model: ", cls: "ai-chat-target-pick-label" });
    this.modelSelectEl = modelRow.createEl("select", { cls: "ai-chat-model-select" });
    this.syncModelToolbar();
    this.modelSelectEl.addEventListener("change", () => void this.onModelToolbarChange());
    this.loadFromNoteBtn = toolbar.createEl("button", {
      text: "Load note",
      attr: { title: "Load ### User / ### Assistant history from the locked note" },
    });
    this.loadFromNoteBtn.addEventListener("click", () => void this.onLoadNoteHistory());

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
    this.session?.stop();
    this.mdRoot.unload();
    this.contentEl.empty();
  }

  private sourcePath(): string {
    return this.session.lockedTarget?.path ?? "";
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
    this.targetSelectEl.disabled = this.session.lockedTarget !== null;
  }

  private refreshTargetLabel(): void {
    if (this.session.lockedTarget) {
      this.targetEl.setText(this.session.lockedTarget.path);
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
    for (const m of this.session.messages) {
      if (m.role === "user" || m.role === "assistant") {
        await this.appendRenderedMessage({ role: m.role, content: m.content });
      }
    }
    this.refreshTokenEstimate();
  }

  /** Estimated prompt tokens: session history + system, and current input draft when non-empty (wikilink appendix not included). */
  private refreshTokenEstimate(): void {
    if (!this.tokenEstimateEl) return;
    const raw = this.inputEl?.value?.trim() ?? "";
    const { estimate: n, limit } = this.session.estimateCurrentTokens(raw);
    const draftHint = raw ? " (incl. draft input)" : "";
    this.tokenEstimateEl.setText(
      `Estimated prompt: ~${n.toLocaleString()} / ${limit.toLocaleString()} tokens${draftHint}`
    );
  }

  private scheduleTokenEstimate(): void {
    if (this.tokenEstimateDebounce !== undefined) {
      clearTimeout(this.tokenEstimateDebounce);
    }
    this.tokenEstimateDebounce = setTimeout(() => {
      this.tokenEstimateDebounce = undefined;
      this.refreshTokenEstimate();
    }, 200);
  }

  private removePendingStreamRows(): void {
    if (!this.pendingStreamRows) return;
    this.pendingStreamRows.userWrap.remove();
    this.pendingStreamRows.asstWrap.remove();
    this.pendingStreamRows = null;
  }

  private onStop(): void {
    this.session.stop();
  }

  private onClearSession(): void {
    this.removePendingStreamRows();
    this.session.clearSession();
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

  private syncModelToolbar(): void {
    const p = this.plugin.settings.provider;
    const sel = this.modelSelectEl;
    sel.empty();
    if (p === "deepseek") {
      sel.createEl("option", { value: "deepseek-chat", text: "deepseek-chat" });
      sel.createEl("option", { value: "deepseek-reasoner", text: "deepseek-reasoner" });
      sel.value = this.plugin.settings.deepseekModel;
    } else {
      sel.createEl("option", { value: "gemini-1.5-flash", text: "gemini-1.5-flash" });
      sel.createEl("option", { value: "gemini-1.5-pro", text: "gemini-1.5-pro" });
      sel.value = this.plugin.settings.geminiModel;
    }
  }

  private async onModelToolbarChange(): Promise<void> {
    const v = this.modelSelectEl.value;
    if (this.plugin.settings.provider === "deepseek") {
      this.plugin.settings.deepseekModel = v as typeof this.plugin.settings.deepseekModel;
    } else {
      this.plugin.settings.geminiModel = v as typeof this.plugin.settings.geminiModel;
    }
    await this.plugin.saveSettings();
  }

  private async onLoadNoteHistory(): Promise<void> {
    const t = this.session.lockedTarget;
    if (!t) {
      new Notice("AI Chat: lock a note first (send once to lock the target).");
      return;
    }
    let text: string;
    try {
      text = await this.app.vault.read(t);
    } catch (e) {
      new Notice(`AI Chat: could not read note: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const result = this.session.hydrateFromNoteMarkdown(text);
    if (!result.ok) {
      new Notice(`AI Chat: ${result.reason}`);
      return;
    }
    new Notice("AI Chat: loaded conversation from the locked note.");
  }

  private getSelectionContext(): string {
    const active = this.app.workspace.getActiveFile();
    if (!this.session.lockedTarget || !active || active.path !== this.session.lockedTarget.path) {
      return "";
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.editor) return "";
    return view.editor.getSelection().trim();
  }

  private setLoading(loading: boolean): void {
    this.sendBtn.style.display = loading ? "none" : "";
    this.stopBtn.style.display = loading ? "" : "none";
    this.sendBtn.disabled = loading;
    this.loadingEl.setText(loading ? "Waiting for model…" : "");
  }

  private async onSend(): Promise<void> {
    if (this.session.inFlight) return;
    const rawInput = this.inputEl.value.trim();
    if (!rawInput) return;

    if (!this.session.lockedTarget) {
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
      this.session.lockTarget(next);
      this.syncTargetSelectEnabled();
      this.refreshTargetLabel();
    }

    const selection = this.getSelectionContext();
    await this.session.send(rawInput, selection);
  }

  // --- ChatSessionDelegate ---

  async onSendStarting(userContent: string): Promise<void> {
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

    this.pendingStreamRows = {
      userWrap,
      asstWrap,
      plainLayer,
      reasonPlain,
      mdLayer,
      usageMeta,
    };
  }

  onStreamChunk(textChunk: string, reasoningChunk: string): void {
    const p = this.pendingStreamRows;
    if (!p) return;
    const showR = this.plugin.settings.showReasoningInChat;
    const rc = showR ? reasoningChunk : "";
    if (textChunk) {
      const prev = p.plainLayer.textContent ?? "";
      p.plainLayer.textContent = prev + textChunk;
    }
    if (rc) {
      const prevR = p.reasonPlain.textContent ?? "";
      p.reasonPlain.textContent = prevR + rc;
      p.reasonPlain.style.display = "";
    }
    this.scrollHistoryToBottom();
  }

  async onStreamFinished(result: StreamResult): Promise<void> {
    const p = this.pendingStreamRows;
    if (!p) return;
    const showR = this.plugin.settings.showReasoningInChat;
    const mdSource = buildAssistantMarkdown(result.content, showR ? result.reasoning : "");
    p.plainLayer.style.display = "none";
    p.reasonPlain.style.display = "none";
    p.mdLayer.style.display = "block";
    await MarkdownRenderer.render(
      this.app,
      mdSource,
      p.mdLayer,
      this.sourcePath(),
      this.mdRoot
    );
  }

  onTurnComplete(_userContent: string, result: StreamResult): void {
    const p = this.pendingStreamRows;
    if (!p) return;
    const u = result.usage;
    p.usageMeta.setText(
      u.promptTokens || u.completionTokens
        ? `Tokens · prompt ${u.promptTokens} · completion ${u.completionTokens}`
        : "Tokens · (not reported)"
    );
    p.usageMeta.style.display = "block";
    this.inputEl.value = "";
    this.pendingStreamRows = null;
  }

  onTurnRolledBack(): void {
    this.removePendingStreamRows();
  }

  onLoadingChanged(loading: boolean): void {
    this.setLoading(loading);
    if (!loading) {
      this.refreshTokenEstimate();
    }
  }

  onMessagesChanged(): void {
    void this.renderAllMessages();
  }

  onSessionCleared(): void {
    // Session state cleared; caller (onClearSession) updates select + full re-render.
  }

  promptTokenLimitChoice(estimated: number, limit: number) {
    return openTokenLimitModal(this.app, estimated, limit);
  }

  showNotice(message: string): void {
    new Notice(message);
  }
}
