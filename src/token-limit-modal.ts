import { App, Modal } from "obsidian";

export type TokenLimitChoice = "truncate" | "clear" | "cancel";

export function openTokenLimitModal(
  app: App,
  estimated: number,
  limit: number
): Promise<TokenLimitChoice> {
  return new Promise((resolve) => {
    const modal = new TokenLimitModal(app, estimated, limit, resolve);
    modal.open();
  });
}

class TokenLimitModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly estimated: number,
    private readonly limit: number,
    private readonly finish: (c: TokenLimitChoice) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Context Limit Reached");
    contentEl.createEl("p", {
      text: `The current conversation is about ${this.estimated} tokens (estimated), which would exceed the model limit of ${this.limit} tokens. What would you like to do?`,
    });
    const row = contentEl.createDiv({ cls: "ai-chat-token-modal-buttons" });
    row.createEl("button", { text: "Truncate Old Messages (Continue)", cls: "mod-cta" }).addEventListener(
      "click",
      () => this.resolve("truncate")
    );
    row.createEl("button", { text: "Clear Session (New Start)", cls: "mod-warning" }).addEventListener(
      "click",
      () => this.resolve("clear")
    );
    row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.resolve("cancel"));
  }

  private resolve(choice: TokenLimitChoice): void {
    if (this.settled) return;
    this.settled = true;
    this.finish(choice);
    this.close();
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.finish("cancel");
    }
    super.onClose();
  }
}
