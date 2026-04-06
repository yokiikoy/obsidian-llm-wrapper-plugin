import { App, Modal } from "obsidian";

/**
 * Confirms Web Search usage before send. Uses Obsidian Modal instead of `window.confirm`
 * for reliable behavior on mobile (e.g. Android) WebViews.
 */
export function openWebSearchConfirmModal(app: App): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new WebSearchConfirmModal(app, resolve);
    modal.open();
  });
}

class WebSearchConfirmModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly finish: (ok: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Web Search");
    contentEl.createEl("p", {
      text: "Web Search is enabled. The model may call Google Search for this request.",
    });
    const row = contentEl.createDiv({ cls: "ai-chat-websearch-modal-buttons" });
    row.createEl("button", { text: "Continue", cls: "mod-cta" }).addEventListener("click", () =>
      this.resolve(true)
    );
    row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.resolve(false));
  }

  private resolve(ok: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.finish(ok);
    this.close();
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.finish(false);
    }
    super.onClose();
  }
}
