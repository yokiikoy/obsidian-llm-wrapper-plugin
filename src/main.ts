import { Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, AIChatSettingTab, type AIChatSettings } from "./settings";
import { AIChatView, VIEW_TYPE } from "./view";

export default class AIChatPlugin extends Plugin {
  settings: AIChatSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new AIChatSettingTab(this.app, this));

    this.registerView(VIEW_TYPE, (leaf) => new AIChatView(leaf, this));

    this.addCommand({
      id: "open-ai-chat",
      name: "Open AI Chat",
      callback: () => void this.activateView(),
    });

    this.addRibbonIcon("message-circle", "Open AI Chat", () => {
      void this.activateView();
    });
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<AIChatSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
    let migrated = false;
    // 旧保存データは GeminiModelId 以外の文字列の可能性があるため string として扱う
    const loadedGemini = loaded?.geminiModel as string | undefined;
    if (
      typeof loadedGemini === "string" &&
      loadedGemini !== "gemini-2.5-flash" &&
      loadedGemini !== "gemini-3.1-pro-preview"
    ) {
      this.settings.geminiModel = loadedGemini.includes("pro")
        ? "gemini-3.1-pro-preview"
        : "gemini-2.5-flash";
      migrated = true;
    }
    if (migrated) {
      await this.saveData(this.settings);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (leaf) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    if (leaf) workspace.revealLeaf(leaf);
  }
}
