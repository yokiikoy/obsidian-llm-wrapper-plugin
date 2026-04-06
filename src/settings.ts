import { App, PluginSettingTab, Setting } from "obsidian";
import type AIChatPlugin from "./main";
import type { DeepseekModelId, GeminiModelId, LlmProviderId } from "./core/llm";

export interface AIChatSettings {
  provider: LlmProviderId;
  deepseekApiKey: string;
  geminiApiKey: string;
  /** DeepSeek `model` API field. */
  deepseekModel: DeepseekModelId;
  /** Gemini model id in the stream endpoint. */
  geminiModel: GeminiModelId;
  systemPrompt: string;
  temperature: number;
  /** When false (default), no vault reads for [[wikilink]] context. */
  enableWikilinkContextResolution: boolean;
  /** When true (default), stream reasoning into the chat UI; never written to the vault note. */
  showReasoningInChat: boolean;
}

export const DEFAULT_SETTINGS: AIChatSettings = {
  provider: "deepseek",
  deepseekApiKey: "",
  geminiApiKey: "",
  deepseekModel: "deepseek-chat",
  geminiModel: "gemini-1.5-flash",
  systemPrompt: "You are a helpful assistant inside Obsidian.",
  temperature: 0.7,
  enableWikilinkContextResolution: false,
  showReasoningInChat: true,
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
      .setName("DeepSeek model")
      .setDesc("API model id for DeepSeek requests.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("deepseek-chat", "deepseek-chat")
          .addOption("deepseek-reasoner", "deepseek-reasoner")
          .setValue(this.plugin.settings.deepseekModel)
          .onChange(async (value) => {
            this.plugin.settings.deepseekModel = value as DeepseekModelId;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Gemini model")
      .setDesc("Model name in the Google AI stream endpoint.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("gemini-1.5-flash", "gemini-1.5-flash")
          .addOption("gemini-1.5-pro", "gemini-1.5-pro")
          .setValue(this.plugin.settings.geminiModel)
          .onChange(async (value) => {
            this.plugin.settings.geminiModel = value as GeminiModelId;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show reasoning in chat")
      .setDesc(
        "When on, models that emit chain-of-thought show it in the chat (collapsible). Never written to the vault note."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showReasoningInChat).onChange(async (v) => {
          this.plugin.settings.showReasoningInChat = v;
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
