import { App, PluginSettingTab, Setting } from "obsidian";
import type AIChatPlugin from "./main";
import type { LlmProviderId } from "./core/llm";

export interface AIChatSettings {
  provider: LlmProviderId;
  deepseekApiKey: string;
  geminiApiKey: string;
  systemPrompt: string;
  temperature: number;
  /** When false (default), no vault reads for [[wikilink]] context. */
  enableWikilinkContextResolution: boolean;
}

export const DEFAULT_SETTINGS: AIChatSettings = {
  provider: "deepseek",
  deepseekApiKey: "",
  geminiApiKey: "",
  systemPrompt: "You are a helpful assistant inside Obsidian.",
  temperature: 0.7,
  enableWikilinkContextResolution: false,
};

export class AIChatSettingTab extends PluginSettingTab {
  plugin: AIChatPlugin;

  constructor(app: App, plugin: AIChatPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Obsidian AI Chat" });

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Provider used for chat completions.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("deepseek", "DeepSeek")
          .addOption("gemini", "Gemini")
          .setValue(this.plugin.settings.provider)
          .onChange(async (value) => {
            this.plugin.settings.provider = value as LlmProviderId;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("DeepSeek API key")
      .setDesc("Stored locally in this vault’s plugin data.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("sk-…");
        text.setValue(this.plugin.settings.deepseekApiKey);
        text.onChange(async (v) => {
          this.plugin.settings.deepseekApiKey = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Gemini API key")
      .setDesc("Google AI Studio API key.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("API key");
        text.setValue(this.plugin.settings.geminiApiKey);
        text.onChange(async (v) => {
          this.plugin.settings.geminiApiKey = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("System prompt")
      .setDesc("System / instruction text sent with each completion.")
      .addTextArea((area) => {
        area.inputEl.rows = 6;
        area.setValue(this.plugin.settings.systemPrompt);
        area.onChange(async (v) => {
          this.plugin.settings.systemPrompt = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Temperature")
      .setDesc("Sampling temperature (0 = more deterministic).")
      .addSlider((slider) =>
        slider
          .setLimits(0, 2, 0.05)
          .setValue(this.plugin.settings.temperature)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.temperature = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Enable wikilink context resolution")
      .setDesc(
        "When on, [[links]] in your message (depth 1 only) are resolved via the vault and appended to the prompt. When off, no extra file reads."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableWikilinkContextResolution)
          .onChange(async (v) => {
            this.plugin.settings.enableWikilinkContextResolution = v;
            await this.plugin.saveSettings();
          })
      );
  }
}
