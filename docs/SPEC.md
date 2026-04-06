# Obsidian AI Chat — 実装仕様書

本書は **リポジトリ内のソースコードが実際にどう動くか** を、実装に忠実に記述する。要件定義書（別紙）との差分があれば、**実装を正**とする。

- **プラグイン ID:** `obsidian-ai-chat`（[`manifest.json`](../manifest.json)）
- **バージョン:** `manifest.json` の `version` に従う（本書作成時点の例: `0.1.0`）
- **主要ソース:** [`src/main.ts`](../src/main.ts), [`src/view.ts`](../src/view.ts), [`src/settings.ts`](../src/settings.ts), [`src/core/llm.ts`](../src/core/llm.ts)

---

## 1. 目的とスコープ

Obsidian 内で LLM とチャットし、**会話内容を Vault 内の Markdown ノート末尾へ追記**する。外部ブラウザへの依存は、利用量確認用 URL を開く程度に留める。

**明示的にやらないこと（現行実装）:**

- ツール呼び出し、画像等マルチモーダル
- 通信失敗時の自動リトライ、明示的なタイムアウト（`AbortController` によるユーザー中止は実装済み）
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

- `LlmClient.stream(messages, options, onChunk, signal): Promise<StreamResult>` — **SSE ストリーミング**。`onChunk(textChunk, reasoningChunk)` で増分を通知（reasoning が無いプロバイダでは第 2 引数は空）。`signal` が `abort()` されると読み取りを打ち切り、`AbortError` 相当で拒否。
- `StreamResult`: `content`（連結済み本文）、`reasoning`（連結済み、無ければ空）、`usage`（`promptTokens` / `completionTokens`、取得不可時は `0`）。
- `ChatMessage`: `role` は `system` | `user` | `assistant`、`content` はプレーンテキスト。
- `ChatOptions`: `temperature`, `systemPrompt`。
- `isAbortError(e)` — `DOMException` / `Error` の `name === "AbortError"` を判定（View でサイレント中止に使用）。

### 5.2 DeepSeek

- **HTTP:** `POST https://api.deepseek.com/chat/completions`
- **認証:** `Authorization: Bearer <apiKey>`
- **モデル（固定）:** `deepseek-chat`
- **ストリーム:** `stream: true`、かつ **`stream_options: { include_usage: true }`**（終端チャンクの `usage` 取得用。プラン ADR 0001 と一致）。
- **SSE:** `data: {json}` 行をパース。`choices[0].delta.content` → `textChunk`、`delta.reasoning_content` があれば → `reasoningChunk`。終端のルート `usage` を `StreamResult.usage` に。
- **メッセージ整形:** `messages` 内の `system` は集約し、設定の `systemPrompt` と連結して **単一の `system` メッセージ** として先頭に置く（両方空なら system 行なし）。残りは `user` / `assistant` を API の `messages` にそのまま並べる。
- **エラー:** 非 2xx はレスポンス JSON の `error.message` があればそれを `Error` に、なければ `DeepSeek HTTP <status>`。ストリーム完了後に本文・reasoning がともに空なら `DeepSeek: empty response`。

### 5.3 Gemini

- **HTTP:** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=<apiKey>`（**モデル名は固定**、**SSE**）
- **system:** 設定 `systemPrompt` と、入力 `messages` 内の `system` を連結し、`systemInstruction.parts[0].text` に渡す（空なら省略）。
- **会話:** `system` を除き、`user` → `user`、`assistant` → `model`。**連続同一 role は `parts` をマージ**。
- **generationConfig:** `{ temperature }` のみ。
- **SSE:** イベント JSON の `candidates[0].content.parts` テキストを累積し、増分のみ `onChunk` に渡す。`usageMetadata` を `StreamResult.usage` に。
- **エラー:** 非 2xx は `error.message` または `Gemini HTTP <status>`。ストリーム完了後にテキスト空なら `Gemini: empty response`。

### 5.4 ファクトリ

`createLlmClient(creds)` — `provider` に応じてキー未設定時は `reject`（空キー）。

### 5.5 API 送信用スライディング・ウィンドウ（`limitChatMessagesForApiWindow`）

- **目的:** 会話が長いときの API コスト・遅延・コンテキスト上限への対策。`messages` 配列の **末尾だけ** を API に渡す。
- **定数:** `DEFAULT_MAX_API_HISTORY_MESSAGES = 10`（`user` / `assistant` を合わせて最大 10 件）。
- **挙動:** `messages.length > maxCount` のとき `messages.slice(-maxCount)`。先頭が連続する `assistant` なら先頭から落とし、**ウィンドウがアシスタントの途中から始まらない**ようにする。
- **システムプロンプト:** `ChatMessage[]` には含めない。`ChatOptions.systemPrompt` により LLM 層が従来どおり先頭相当の指示としてマージする（DeepSeek は `system` メッセージ、Gemini は `systemInstruction`）。
- **メモリ・ノート:** View の `messages` とノートへの追記は **全履歴**のまま。制限は **API ペイロードのみ**。

---

## 6. カスタム View（[`src/view.ts`](../src/view.ts)）

### 6.1 識別子

- `VIEW_TYPE`: `"obsidian-ai-chat-view"`
- タイトル表示: **AI Chat**
- アイコン: `message-circle`

### 6.2 DOM 構成（上から順）

1. **Target 行**（`ai-chat-target`）— 固定ラベル `Target:` + パスまたは未ロック説明。
2. **履歴**（`ai-chat-history`）— メッセージごとにロール見出し + 本文（確定済みは `MarkdownRenderer.render`、ストリーム中のアシスタントのみプレーンテキスト → 完了後に再描画）。
3. **入力**（`textarea.ai-chat-input`）— 複数行。
4. **ツールバー:** **Send**（`mod-cta`）、**Stop**（`mod-warning`、送信中のみ表示）、**Clear session**、**Usage**、読み込み文言 `Waiting for model…`（`ai-chat-loading`）。

### 6.3 状態（インスタンスフィールド）

| 名前 | 意味 |
|------|------|
| `messages` | UI/API 用の履歴。`{ role: "user"\|"assistant", content: string }[]`（assistant は **本文のみ**、API 再送信用）。**ノート手編集では更新されない** |
| `lockedTarget` | 追記先 `TFile`。未ロック時の Send で、API 呼び出し前にアクティブノートから代入（§6.5） |
| `inFlight` | 送信中フラグ。`true` 時は重複送信不可 |
| `abortController` | 当該リクエスト用。Stop（および Clear 中の中止）で `abort()` |
| `pendingStreamRows` | ストリーム確定前に追加した user/assistant の DOM 行。abort またはエラーで削除 |

`MarkdownRenderer` 用に `Component` を `onOpen` で `load()`、`onClose` で `unload()`。

### 6.4 履歴の描画

- **差分追記:** 確定済みメッセージは `appendRenderedMessage` で末尾に追加。全消去後の再描画は `renderAllMessages`（起動時・Clear 後）。
- **ストリーミング中のアシスタント行:** `MarkdownRenderer` は使わず、`textContent` で本文（および reasoning がある場合は別要素）を累積表示。完了後に `buildAssistantMarkdown`（reasoning は `<details>`）を **初めて** `MarkdownRenderer.render` し、プレーン層を隠して Markdown 層を表示（[`styles.css`](../styles.css) の `.ai-chat-md-stack` 等）。
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

1. `fullTurns` = 既存 `messages` を `ChatMessage[]` に写したもの + 今ターンの `{ role: "user", content: userContent }`。
2. `apiPayload` = `limitChatMessagesForApiWindow(fullTurns, DEFAULT_MAX_API_HISTORY_MESSAGES)`。
3. ユーザー行を履歴に描画（`MarkdownRenderer`）。アシスタント用プレースホルダ行を追加し `pendingStreamRows` に保持。
4. `setLoading(true)` — Send を隠し Stop を表示、`Waiting for model…`。
5. `AbortController` を生成し `createLlmClient` → `stream(apiPayload, options, onChunk, signal)` を `await`。チャンクごとにアシスタント行のプレーンテキストを更新（`MarkdownRenderer` は呼ばない）。
6. **正常完了時:** 累積 `StreamResult` で `MarkdownRenderer` を実行し、**`await appendToLockedNote(userContent, result.content)`**（ノートには **本文のみ**、reasoning は含めない）。
7. **追記成功後のみ:** `messages` に user → assistant（`result.content`）を `push`、usage 行（`ai-chat-usage-meta`）を表示、入力クリア、`pendingStreamRows` をクリア。
8. **中止（`AbortError`）:** `Notice` なし。`pendingStreamRows` を DOM から削除。ノート・`messages` は変更しない。入力は保持。
9. **その他の失敗:** `Notice` にエラー文。`pendingStreamRows` を削除。**入力はクリアしない**。
10. `finally`: `setLoading(false)`、`abortController` を null。

**原子性:** ノート追記に失敗した場合、UI 上の履歴は当ターンを増やさない（ファイルとパネルの不整合を避ける）。ストリームは完了していても追記失敗なら `messages` に載せない。

### 6.8 Stop / Clear との関係

- **Stop:** 進行中の `stream` を `AbortController.abort()` で打ち切る（§6.7 の中止パス）。
- **Clear session:** 進行中なら先に `abort()`。仮行を削除し、`messages` と `lockedTarget` をリセット。

### 6.9 ノート追記フォーマット（`formatNoteBlock`）

`leadingSep = "\n\n"` と本文 `### User\n\n…` を連結し、**追記ブロック先頭は必ず 2 改行**で既存本文と視覚的に分離する。全体を `vault.append` する。

```markdown

### User

{userContent}

### Assistant

{assistantContent}

```

`userContent` には選択範囲付きの本文が入りうる。

### 6.10 Clear session

- 送信中なら中止。`messages = []`, `lockedTarget = null`, ラベル更新、履歴 DOM を全再描画。

### 6.11 Usage

- `window.open` で **設定の `provider`** に応じた URL を新規タブ（`noopener,noreferrer`）。
  - DeepSeek: `https://platform.deepseek.com/usage`
  - Gemini: `https://aistudio.google.com/app/plan_information`

---

## 7. 排他・同時実行

- 送信中（`inFlight`）は **Send 無視**。**Stop** は有効。
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

- 通常は `Notice("AI Chat: ...")`。
- **ユーザー中止（`AbortError`）** は Notice を出さない。
- LLM の `throw` メッセージがそのまま表示されることが多い。

---

## 10. スタイル（[`styles.css`](../styles.css)）

主要クラス: `ai-chat-root`, `ai-chat-history`, `ai-chat-msg`, `ai-chat-msg-role`, `ai-chat-input-row`, `ai-chat-input`, `ai-chat-toolbar`, `ai-chat-loading`, `ai-chat-target`、ストリーミング用 `ai-chat-md-stack`, `ai-chat-plain-layer`, `ai-chat-md-layer`, `ai-chat-reason-plain`, `ai-chat-usage-meta`。Obsidian CSS 変数（`--background-modifier-border` 等）に依存。

---

## 11. 既知の制限・リスク（仕様としての注記）

- **コンテキスト長:** API にはスライディング・ウィンドウ（最大 10 メッセージ）のみ送信。それでも長文ターンや累積でトークン上限に達し得る。
- **秘密情報:** API キーは設定 JSON に平文。
- **ネットワーク:** `fetch` の自動タイムアウト・自動リトライは未実装。**ユーザー中止**（Stop）は `AbortSignal` で実装済み。
- **usage:** プロバイダが報告しない場合は `0` とし、UI は「(not reported)」表示。
- **同一 role の system:** DeepSeek 側は複数 system をマージ。Gemini は `systemInstruction` 1 本にマージ。
- **ノート追記成功後の UI 描画:** `appendRenderedMessage`（`MarkdownRenderer`）が例外を出した場合、ノートには書き込み済みで UI が一部未更新となる余地あり（追記失敗時の UI 先行はしない）。

---

## 12. 変更履歴（ドキュメント）

| 日付 | 内容 | コミット（任意・大きな変更時） |
|------|------|--------------------------------|
| 2026-04-06 | 初版: 現行実装に基づき記述 | `41c62d1b…`（初期コミット） |
| 2026-04-06 | 追記: API スライディング・ウィンドウ、`onSend` のノート先行成功後のみ UI 更新、`formatNoteBlock` 先頭 `\n\n` 明示 | `97ac5f8b…` |
| 2026-04-06 | yokii-dev-workflow 遵守用: `docs/RECORDS.md`、`docs/decisions/`（ADR 0001）、`DISCUSSION.md`、`EVAL.md` | （本変更のコミット SHA を追記） |
| 2026-04-06 | Phase A: `LlmClient.stream`（DeepSeek/Gemini SSE）、Stop / `AbortController`、プレーン→Markdown 確定描画、追記成功後のみ `messages` 確定、usage 行 | `00eb3f85bb4beceaedf5e034a2d5b33850c48043` |

記録運用は [`docs/RECORDS.md`](RECORDS.md) を参照。
