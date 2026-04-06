# Obsidian AI Chat — 実装仕様書

本書は **リポジトリ内のソースコードが実際にどう動くか** を、実装に忠実に記述する。要件定義書（別紙）との差分があれば、**実装を正**とする。

- **プラグイン ID:** `obsidian-ai-chat`（[`manifest.json`](../manifest.json)）
- **バージョン:** `manifest.json` の `version` に従う（本書作成時点の例: `0.1.0`）
- **主要ソース:** [`src/main.ts`](../src/main.ts), [`src/view.ts`](../src/view.ts), [`src/settings.ts`](../src/settings.ts), [`src/core/llm.ts`](../src/core/llm.ts)

---

## 1. 目的とスコープ

Obsidian 内で LLM とチャットし、**会話内容を Vault 内の Markdown ノート末尾へ追記**する。外部ブラウザへの依存は、利用量確認用 URL を開く程度に留める。

**明示的にやらないこと（現行実装）:**

- ストリーミング応答、ツール呼び出し、画像等マルチモーダル
- 通信失敗時の自動リトライ、タイムアウト・キャンセル制御
- ノート側の手編集をチャット履歴へ反映（**単方向: プラグイン → ノートのみ**）
- ノート上の過去ログからチャット UI 状態を自動復元
- モデル名のユーザー設定（コード内定数）

---

## 2. 配布物とビルド

| ファイル | 役割 |
|----------|------|
| `manifest.json` | Obsidian が読むメタデータ |
| `main.js` | エントリ（esbuild で `src/main.ts` からバンドル） |
| `styles.css` | View 用スタイル |

`package.json` の `npm run build` で `main.js` を生成する。[`.gitignore`](../.gitignore) により **`main.js` は既定で Git 管理外**（クローン後にビルドが必要）。

---

## 3. プラグインライフサイクル

### 3.1 `onload`（[`main.ts`](../src/main.ts)）

1. `loadSettings()` — `loadData()` の結果を `DEFAULT_SETTINGS` にマージ。
2. 設定タブ [`AIChatSettingTab`](../src/settings.ts) を登録。
3. カスタム View を `VIEW_TYPE = "obsidian-ai-chat-view"` で登録。ファクトリ: `(leaf) => new AIChatView(leaf, this)`。
4. コマンド `open-ai-chat`（表示名 **Open AI Chat**）— コールバックで `activateView()`。
5. リボンアイコン `message-circle`、ツールチップ **Open AI Chat** — 同上。

### 3.2 `onunload`

- `detachLeavesOfType(VIEW_TYPE)` — 当該 View のリーフを取り外す。

### 3.3 `activateView()`

1. 既存の `getLeavesOfType(VIEW_TYPE)[0]` があればそれを使う。
2. なければ `workspace.getRightLeaf(false)` を取得し、`setViewState({ type: VIEW_TYPE, active: true })` を `await`。
3. リーフがあれば `revealLeaf`。

**挙動メモ:** 右サイドバー用リーフが取得できない環境では View が開かない可能性がある（Obsidian のワークスペース構成依存）。

---

## 4. 設定（永続化）

### 4.1 保存場所

Obsidian 標準のプラグインデータ（`saveData` / `loadData`）。Vault 内のプラグインデータ領域に JSON として保存される（**平文**）。

### 4.2 スキーマ（[`AIChatSettings`](../src/settings.ts)）

| キー | 型 | 既定値 | 説明 |
|------|-----|--------|------|
| `provider` | `"deepseek" \| "gemini"` | `"deepseek"` | 使用プロバイダ |
| `deepseekApiKey` | string | `""` | DeepSeek 用（空なら送信時エラー） |
| `geminiApiKey` | string | `""` | Gemini 用（空なら送信時エラー） |
| `systemPrompt` | string | `You are a helpful assistant inside Obsidian.` | システム指示。各リクエストで LLM 層に渡る |
| `temperature` | number | `0.7` | 0〜2、スライダー刻み 0.05 |

設定 UI は英語ラベル（Model, DeepSeek API key, …）。API キー入力は `type="password"`。変更は即 `saveSettings()`。

---

## 5. LLM 層（[`src/core/llm.ts`](../src/core/llm.ts)）

### 5.1 抽象

- `LlmClient.complete(messages, options): Promise<string>` — **非ストリーミング**で本文文字列のみ返す。
- `ChatMessage`: `role` は `system` | `user` | `assistant`、`content` はプレーンテキスト。
- `ChatOptions`: `temperature`, `systemPrompt`。

### 5.2 DeepSeek

- **HTTP:** `POST https://api.deepseek.com/chat/completions`
- **認証:** `Authorization: Bearer <apiKey>`
- **モデル（固定）:** `deepseek-chat`
- **メッセージ整形:**
  - `messages` 内の `system` は集約し、設定の `systemPrompt` と連結して **単一の `system` メッセージ** として先頭に置く（両方空なら system 行なし）。
  - 残りは `user` / `assistant` を API の `messages` にそのまま並べる。
- **エラー:** 非 2xx はレスポンス JSON の `error.message` があればそれを `Error` に、なければ `DeepSeek HTTP <status>`。本文空は `DeepSeek: empty response`。

### 5.3 Gemini

- **HTTP:** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=<apiKey>`（**モデル名は固定**）
- **system:** 設定 `systemPrompt` と、入力 `messages` 内の `system` を連結し、`systemInstruction.parts[0].text` に渡す（空なら省略）。
- **会話:** `system` を除き、`user` → `user`、`assistant` → `model`。**連続同一 role は `parts` をマージ**。
- **generationConfig:** `{ temperature }` のみ。
- **エラー:** 非 2xx は `error.message` または `Gemini HTTP <status>`。結合テキスト空は `Gemini: empty response`。

### 5.4 ファクトリ

`createLlmClient(creds)` — `provider` に応じてキー未設定時は `reject`（空キー）。

---

## 6. カスタム View（[`src/view.ts`](../src/view.ts)）

### 6.1 識別子

- `VIEW_TYPE`: `"obsidian-ai-chat-view"`
- タイトル表示: **AI Chat**
- アイコン: `message-circle`

### 6.2 DOM 構成（上から順）

1. **Target 行**（`ai-chat-target`）— 固定ラベル `Target:` + パスまたは未ロック説明。
2. **履歴**（`ai-chat-history`）— メッセージごとにロール見出し + `MarkdownRenderer.render` 済み本文。
3. **入力**（`textarea.ai-chat-input`）— 複数行。
4. **ツールバー:** **Send**（`mod-cta`）、**Clear session**、**Usage**、読み込み文言 `Waiting for model…`（`ai-chat-loading`）。

### 6.3 状態（インスタンスフィールド）

| 名前 | 意味 |
|------|------|
| `messages` | UI/API 用の履歴。`{ role: "user"\|"assistant", content: string }[]`。**ノート手編集では更新されない** |
| `lockedTarget` | 追記先 `TFile`。初回送信成功処理の直前相当で確定（後述） |
| `inFlight` | 送信中フラグ。`true` 時は重複送信不可 |

`MarkdownRenderer` 用に `Component` を `onOpen` で `load()`、`onClose` で `unload()`。

### 6.4 履歴の描画

- **差分追記:** 新規メッセージは `appendRenderedMessage` でコンテナ末尾に追加。全消去後の再描画は `renderAllMessages`（起動時・Clear 後）。
- **ソースパス:** `MarkdownRenderer` の `sourcePath` 引数は **`lockedTarget.path`**。未ロック時は `""`。

### 6.5 ターゲットノートのロック

1. **未ロック**で Send が押されたとき、`workspace.getActiveFile()` が **なければ** Notice して中断（メッセージ: `open a note and focus it...`）。
2. あればそのファイルを `lockedTarget` に代入し、ラベル更新。
3. その後 **`vault.getAbstractFileByPath(lockedTarget.path)`** で存在確認。`TFile` でなければ Notice（`locked note is missing...`）して中断。成功時は参照を最新の `TFile` に更新。

**ロック解除:** **Clear session** のみ（`messages` 空、`lockedTarget` null）。

### 6.6 エディタ選択範囲（コンテキスト）

`getSelectionContext()`:

- `workspace.getActiveFile()` が **存在し**、かつ **`lockedTarget` と同一 `path`** のときのみ有効。
- `MarkdownView` を取得し `editor.getSelection().trim()`。それ以外は `""`。

`buildUserTurnBody(rawInput, selection)`:

- 選択なし: `rawInput` のみ。
- あり: `rawInput` + 区切り + `**Selection from note:**` + 選択テキスト（Markdown 断片として連結）。

### 6.7 送信フロー（`onSend`）

前提チェック後のコア順序:

1. `setLoading(true)` — Send 無効、`Waiting for model…`。
2. `apiPayload` = 既存 `messages` を `ChatMessage[]` に写したもの + 今ターンの `{ role: "user", content: userContent }`。
3. `createLlmClient` → `complete(apiPayload, { temperature, systemPrompt })`。
4. **成功時:**
   - `messages` に user → assistant を順に `push`。
   - 各々 `appendRenderedMessage`。
   - `appendToLockedNote(userContent, reply)` — 存在再検証のうえ `vault.append`。
   - 入力欄を空にする。
5. **失敗時:** `Notice` にエラー文。**入力欄はクリアしない**（成功時のみクリア）。
6. `finally`: `setLoading(false)`。

**API と UI の順序:** 応答取得後に UI 履歴へ追加し、その後ノート追記。ノート追記で例外が出た場合、UI 上には既に当ターンが表示されている（二重運用の非原子性あり）。

### 6.8 ノート追記フォーマット（`formatNoteBlock`）

以下を **そのまま文字列連結**（先頭に改行 2 つ）して `vault.append`:

```markdown

### User

{userContent}

### Assistant

{assistantContent}

```

`userContent` には選択範囲付きの本文が入りうる。

### 6.9 Clear session

- `messages = []`, `lockedTarget = null`, ラベル更新、履歴 DOM を全再描画。

### 6.10 Usage

- `window.open` で **設定の `provider`** に応じた URL を新規タブ（`noopener,noreferrer`）。
  - DeepSeek: `https://platform.deepseek.com/usage`
  - Gemini: `https://aistudio.google.com/app/plan_information`

---

## 7. 排他・同時実行

- 送信中（`inFlight`）は **Send 無視**。
- 複数 View インスタンスは **登録上は可能**だが、通常はリーフ 1 つ運用想定。各インスタンスは **独立した `messages` / `lockedTarget`** を持つ。

---

## 8. セッション寿命と永続性

| 状態 | 永続 |
|------|------|
| 設定 | Vault プラグインデータに保存 |
| `messages` / `lockedTarget` | メモリのみ。View を閉じる・Obsidian 終了で失われる |
| ノート追記 | ファイルとして残る |

**再オープン時:** 過去のノートログを読み込んで `messages` を復元する処理は **ない**。

---

## 9. エラーとユーザーへのフィードバック

- ほぼ全て `Notice("AI Chat: ...")`。
- LLM の `throw` メッセージがそのまま表示されることが多い。

---

## 10. スタイル（[`styles.css`](../styles.css)）

主要クラス: `ai-chat-root`, `ai-chat-history`, `ai-chat-msg`, `ai-chat-msg-role`, `ai-chat-input-row`, `ai-chat-input`, `ai-chat-toolbar`, `ai-chat-loading`, `ai-chat-target`。Obsidian CSS 変数（`--background-modifier-border` 等）に依存。

---

## 11. 既知の制限・リスク（仕様としての注記）

- **コンテキスト長:** 毎回フル履歴を API に送るため、長い会話でトークン上限・コスト・遅延が増大。
- **秘密情報:** API キーは設定 JSON に平文。
- **ネットワーク:** `fetch` のタイムアウト・リトライ・キャンセル未実装。
- **同一 role の system:** DeepSeek 側は複数 system をマージ。Gemini は `systemInstruction` 1 本にマージ。
- **追記と UI の整合:** ノート追記失敗時に UI だけ先行更新済みとなりうる。

---

## 12. 変更履歴（ドキュメント）

| 日付 | 内容 |
|------|------|
| 2026-04-06 | 初版: 現行実装に基づき記述 |
