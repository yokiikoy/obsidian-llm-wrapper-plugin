# ARCHIVED — 参照用スナップショットのみ

本ファイルは **Phase A 以前のコンサル用 SPEC コピー**を保管したものである。現行の挙動は [`docs/SPEC.md`](../SPEC.md) を正とする。ストリーミング・Wikilink コンテキスト等の後続実装は本アーカイブに反映されていない。

---

# Obsidian AI Chat — 実装仕様書（コンサル用コピー）

本書はリポジトリ内ソースの動作を実装に忠実に記述する。要件定義書と差があれば実装を正とする。

- プラグイン ID: `obsidian-ai-chat`（ファイル: `manifest.json`）
- バージョン: `manifest.json` の `version`（例: `0.1.0`）
- 主要ソース: `src/main.ts`, `src/view.ts`, `src/settings.ts`, `src/core/llm.ts`

---

## 1. 目的とスコープ

Obsidian 内で LLM とチャットし、会話内容を Vault 内の Markdown ノート末尾へ追記する。外部ブラウザは利用量確認用 URL を開く程度。

明示的にやらないこと（現行実装）:

- ストリーミング、ツール呼び出し、マルチモーダル
- 自動リトライ、タイムアウト・キャンセル
- ノート手編集をチャット履歴へ反映（単方向: プラグイン → ノートのみ）
- ノートログからチャット UI を自動復元
- モデル名のユーザー設定（コード内定数）

---

## 2. 配布物とビルド

| ファイル | 役割 |
|----------|------|
| manifest.json | Obsidian メタデータ |
| main.js | esbuild で src/main.ts からバンドル |
| styles.css | View 用スタイル |

`npm run build` で main.js を生成。`.gitignore` により main.js は既定で Git 管理外。

---

## 3. プラグインライフサイクル

### 3.1 onload（main.ts）

1. loadSettings()
2. AIChatSettingTab 登録
3. VIEW_TYPE `obsidian-ai-chat-view` で AIChatView 登録
4. コマンド open-ai-chat（表示名 Open AI Chat）
5. リボン message-circle（Open AI Chat）

### 3.2 onunload

detachLeavesOfType(VIEW_TYPE)

### 3.3 activateView()

既存リーフがなければ getRightLeaf(false) に setViewState。revealLeaf。

---

## 4. 設定（永続化）

保存: saveData/loadData（Vault 内プラグインデータ、平文）。

| キー | 型 | 既定 | 説明 |
|------|-----|------|------|
| provider | deepseek \| gemini | deepseek | プロバイダ |
| deepseekApiKey | string | "" | 空なら送信エラー |
| geminiApiKey | string | "" | 同上 |
| systemPrompt | string | You are a helpful assistant inside Obsidian. | 各リクエストで LLM へ |
| temperature | number | 0.7 | 0〜2、刻み 0.05 |

---

## 5. LLM 層（src/core/llm.ts）

### 5.1 抽象

LlmClient.complete(messages, options) → Promise<string>（非ストリーミング）
ChatMessage: role system|user|assistant, content string
ChatOptions: temperature, systemPrompt

### 5.2 DeepSeek

POST https://api.deepseek.com/chat/completions
Bearer 認証、モデル deepseek-chat（固定）
system は messages 内と systemPrompt をマージして先頭 1 本

### 5.3 Gemini

POST …/models/gemini-1.5-flash:generateContent?key=…（固定）
systemInstruction に system 相当をマージ
user/model 変換、連続同一 role は parts マージ
generationConfig は temperature のみ

### 5.4 ファクトリ

createLlmClient — キー空は reject

### 5.5 スライディング・ウィンドウ

DEFAULT_MAX_API_HISTORY_MESSAGES = 10（user+assistant 合計最大 10 件を API に送る）
limitChatMessagesForApiWindow: 末尾 max 件、先頭の連続 assistant を削る
system は配列に含めず options.systemPrompt でマージ（従来どおり）
View の messages とノート追記は全履歴のまま

---

## 6. カスタム View（src/view.ts）

VIEW_TYPE: obsidian-ai-chat-view、表示 AI Chat、アイコン message-circle

DOM: Target 行、履歴、textarea、Send / Clear session / Usage、Waiting for model…

状態: messages[]（UI・メモリ）、lockedTarget（TFile）、inFlight

### 6.5 ロック

未ロックで Send → getActiveFile 必須。存在確認後 TFile を lockedTarget に。
Clear session で解除。

### 6.6 選択コンテキスト

アクティブファイルが lockedTarget と同一 path のときのみ MarkdownView の選択をユーザーターンに連結。

### 6.7 onSend（原子性）

1. fullTurns = toApiMessages() + 今ターン user
2. apiPayload = limitChatMessagesForApiWindow(fullTurns, 10)
3. setLoading(true)
4. complete → reply
5. await appendToLockedNote(userContent, reply) 成功時のみ続行
6. messages に push ×2、appendRenderedMessage ×2、入力クリア
7. 失敗: Notice、messages/UI は増やさない、入力保持
8. finally setLoading(false)

### 6.8 ノート追記

formatNoteBlock: 先頭必ず \n\n + ### User / ### Assistant ブロックを vault.append

### 6.10 Usage

provider に応じ DeepSeek または Gemini の公式利用量ページを window.open

---

## 7. 排他

inFlight 中は Send 無視。複数 View は独立状態。

---

## 8. 永続性

設定は保存。messages/lockedTarget はメモリ。ノート追記はファイルに残る。再起動で messages 復元なし。

---

## 9. エラー

主に Notice("AI Chat: …")

---

## 10. スタイル

styles.css: ai-chat-root 等、Obsidian CSS 変数依存

---

## 11. 既知の制限

API は最大 10 メッセージウィンドウ。長文・累積でトークン上限あり得る。
API キー平文。fetch にタイムアウト・リトライなし。
ノート追記成功後に MarkdownRenderer が失敗するとノートのみ先行の可能性。

---

## 12. ドキュメント変更履歴

- 2026-04-06 初版
- 2026-04-06 スライディング・ウィンドウ、onSend 原子性、formatNoteBlock 先頭改行、コンサル用要約本ファイル追加
