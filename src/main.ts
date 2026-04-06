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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
