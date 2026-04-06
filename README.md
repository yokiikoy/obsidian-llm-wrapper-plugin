# Obsidian AI Chat

**LLM chat inside Obsidian** with **Markdown session logging** to a vault note. Supports **DeepSeek** and **Google Gemini**, **streaming** replies, **Stop** (abort), optional **wikilink context** (depth‑1), and usage metadata after each turn.

- **Plugin ID:** `obsidian-ai-chat`（Community Plugins での識別子）
- **Version:** `manifest.json` の `version`（現行 **1.2.0**）
- **GitHub:** [yokiikoy/obsidian-llm-wrapper-plugin](https://github.com/yokiikoy/obsidian-llm-wrapper-plugin)（リポジトリ名とプラグイン ID は別）

---

## 機能（概要）


| 項目           | 内容                                                                            |
| ------------ | ----------------------------------------------------------------------------- |
| プロバイダ        | **DeepSeek**（`deepseek-chat`）/ **Gemini**（`gemini-2.5-flash`、ストリーム API）       |
| ストリーミング      | 応答を逐次表示。完了後に Markdown として再描画                                                  |
| 中止           | **Stop** で `AbortController` によりリクエスト中止（ユーザー中止時は Notice なし）                   |
| メタデータ        | 完了時に prompt / completion トークン数を表示（取得できない場合は注記）                                |
| ノート追記        | ロックしたノート末尾へ `### User` / `### Assistant` 形式で追記。**追記成功後のみ**会話履歴（`messages`）を更新 |
| エディタ選択       | ロックノートを開いた状態で選択範囲があると、ユーザーターンにコンテキストとして付与                                     |
| Wikilink（任意） | 設定でオン時のみ、メッセージ内の `[[リンク]]` を **深さ 1** で解決し本文をプロンプトに連結（上限・切り捨てあり）              |
| API 履歴       | 送信ペイロードは **トークン上限内**で組み立て、`trimLeadingAssistantRun` で先頭の連続 `assistant` を除去（**件数 10 のサイレント切り捨ては廃止**）。UI とノートはターン単位で全履歴を保持 |


詳細な挙動は [`docs/SPEC.md`](docs/SPEC.md) を正とする。

---

## 動作要件

- **Obsidian** `1.5.0` 以上（`manifest.json` の `minAppVersion`）
- 利用する API の **有効な API キー**（設定画面に保存。Vault 内プラグインデータに **平文** で保存されます）

---

## インストール

### リリースから（推奨・配布用 ZIP がある場合）

1. [Releases](https://github.com/yokiikoy/obsidian-llm-wrapper-plugin/releases) から最新を取得
2. Vault の `**.obsidian/plugins/`** 以下に、フォルダ名 `**obsidian-ai-chat**`（プラグイン ID と一致）で展開
3. Obsidian の **設定 → コミュニティプラグイン** で有効化

※ リポジトリに `main.js` をコミットしていない場合は、次の「ソースからビルド」が必要です。

### ソースからビルド

```bash
git clone https://github.com/yokiikoy/obsidian-llm-wrapper-plugin.git
cd obsidian-llm-wrapper-plugin
npm install
npm run build
```

生成された `**main.js**`（と `**manifest.json**`, `**styles.css**`）を、Vault の  
`**.obsidian/plugins/obsidian-ai-chat/**` に置き、プラグインを有効化します。

開発時は `npm run dev` でウォッチビルドできます（`[esbuild.config.mjs](esbuild.config.mjs)`）。

---

## 使い方（かんたん）

1. コマンドパレットまたはリボンから **Open AI Chat** でビューを開く
2. 追記先にしたいノートをアクティブにしてから **Send**（初回でターゲットがロックされる）
3. **Clear session** でロックとメモリ上の履歴をリセット
4. **Usage** から各プロバイダの利用量ページを開く

---

## 設定項目


| 設定                                 | 説明                                               |
| ---------------------------------- | ------------------------------------------------ |
| Model                              | `deepseek` / `gemini`                            |
| API keys                           | 各プロバイダ用（空のままでは送信時にエラー）                           |
| System prompt / Temperature        | 毎リクエストに渡す指示とサンプリング温度                             |
| Enable wikilink context resolution | オフ（既定）では Vault の追加読み込みなし。オンで `[[...]]` を深さ 1 で展開 |


---

## ドキュメント・開発運用


| 文書                                   | 内容                                                      |
| ------------------------------------ | ------------------------------------------------------- |
| `[docs/SPEC.md](docs/SPEC.md)`       | 実装仕様（動作の正）                                              |
| `[docs/AGENT_HANDOFF.md](docs/AGENT_HANDOFF.md)` | 次エージェント向け短い引き継ぎ（ソース地図） |
| `[docs/TEST_SPEC.md](docs/TEST_SPEC.md)` | Vitest 単体テストの意図 |
| `[docs/GITFLOW.md](docs/GITFLOW.md)` | ブランチ運用（`main` / `develop` / feature / release / hotfix） |
| `[docs/decisions/](docs/decisions/)` | ADR（意思決定の記録）                                            |
| `[DISCUSSION.md](DISCUSSION.md)`     | 議論・経緯のメモ                                                |
| `[docs/RECORDS.md](docs/RECORDS.md)` | ワークフロー対応表                                               |


型チェック:

```bash
npx tsc --noEmit
```

### GitNexus（コードインデックス・MCP）

[GitNexus](https://www.npmjs.com/package/gitnexus) でリポジトリをローカル索引し、Cursor などから **MCP** 経由で依存・呼び出し・影響範囲を問い合わせできます。


| 項目 | 内容 |
|------|------|
| インストール | `npm install -g gitnexus@latest` を推奨。`npx` は `~/.npm/_npx` で `ENOTEMPTY` が出やすい（依存が多いため） |
| 初回 / 更新 | リポジトリルートで `gitnexus analyze . --skip-agents-md`（または `npx -y gitnexus@latest analyze …`） |
| 生成物 | `.gitnexus/`（`.gitignore` で除外・コミット不要） |
| Cursor MCP | リポジトリの [`.cursor/mcp.json`](.cursor/mcp.json) は `command: "gitnexus"`。**GUI 起動の Cursor が nvm の PATH を見ない**ときは `~/.cursor/mcp.json` で `command` を `which gitnexus` の**フルパス**にするか、`sudo ln -s "$(which gitnexus)" /usr/local/bin/gitnexus` などで固定パスに置く |
| ライセンス | GitNexus は [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)。商用は別途確認 |


---

## プライバシー・セキュリティ

- メッセージと API キーは **外部 LLM プロバイダ**に送信されます。  
- API キーは **ローカルのプラグインデータ**に保存されます（暗号化はしていません）。  
- **Wikilink コンテキスト**をオンにしたときだけ、リンク先ノートの読み込みが発生します。

---

## ライセンス

未設定です。配布方針に合わせて `LICENSE` を追加してください。

---

## 作者

`manifest.json` の `author` は空です。GitHub: [@yokiikoy](https://github.com/yokiikoy)