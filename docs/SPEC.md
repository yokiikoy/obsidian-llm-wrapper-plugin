# Obsidian AI Chat — 実装仕様書

本書は **リポジトリ内のソースコードが実際にどう動くか** を、実装に忠実に記述する。要件定義書（別紙）との差分があれば、**実装を正**とする。

- **プラグイン ID:** `obsidian-ai-chat`（[`manifest.json`](../manifest.json)）
- **バージョン:** `manifest.json` の `version` に従う（現行: `1.2.0`）
- **主要ソース:** [`src/main.ts`](../src/main.ts), [`src/view.ts`](../src/view.ts), [`src/core/chat-session.ts`](../src/core/chat-session.ts), [`src/token-limit-modal.ts`](../src/token-limit-modal.ts), [`src/settings.ts`](../src/settings.ts), [`src/core/llm.ts`](../src/core/llm.ts)

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
| `enableWikilinkContextResolution` | boolean | `false` | オン時のみ `[[wikilink]]` を深さ 1 で解決しユーザーターンに連結（§6.6.1） |

設定 UI は英語ラベル（Model, DeepSeek API key, …）。API キー入力は `type="password"`。変更は即 `saveSettings()`。

---

## 5. LLM 層（[`src/core/llm.ts`](../src/core/llm.ts)）

### 5.1 抽象

- `LlmClient.stream(messages, options, onChunk, signal): Promise<StreamResult>` — **SSE ストリーミング**。`onChunk(textChunk, reasoningChunk)` で増分を通知（reasoning が無いプロバイダでは第 2 引数は空）。`signal` が `abort()` されると読み取りを打ち切り、`AbortError` 相当で拒否。
- `StreamResult`: `content`（連結済み本文）、`reasoning`（連結済み、無ければ空）、`usage`（`promptTokens` / `completionTokens`、取得不可時は `0`）。
- `ChatMessage`: `role` は `system` | `user` | `assistant`、`content` はプレーンテキスト。
- `ChatOptions`: `temperature`, `systemPrompt`。
- `isAbortError(e)` — オブジェクトの **`name === "AbortError"`** で判定（`instanceof` に依存しない。View でサイレント中止に使用）。

### 5.2 DeepSeek

- **HTTP:** `POST https://api.deepseek.com/chat/completions`
- **認証:** `Authorization: Bearer <apiKey>`
- **モデル（固定）:** `deepseek-chat`
- **ストリーム:** `stream: true`、かつ **`stream_options: { include_usage: true }`**（終端チャンクの `usage` 取得用。プラン ADR 0001 と一致）。
- **SSE:** `data: {json}` 行をパース。`choices[0].delta.content` → `textChunk`、`delta.reasoning_content` があれば → `reasoningChunk`。終端のルート `usage` を `StreamResult.usage` に。
- **メッセージ整形:** `messages` 内の `system` は集約し、設定の `systemPrompt` と連結して **単一の `system` メッセージ** として先頭に置く（両方空なら system 行なし）。残りは `user` / `assistant` を API の `messages` にそのまま並べる。
- **エラー:** 非 2xx はレスポンス JSON の `error.message` があればそれを `Error` に、なければ `DeepSeek HTTP <status>`。ストリーム完了後に本文・reasoning がともに空で、かつ `usage` に報告トークンが無い場合は `DeepSeek: empty stream`。**終端のみ `usage` で本文チャンクが無い**ケースは、トークンが報告されていれば `{ content: "", reasoning: "", usage }` として正常完了とみなす。

### 5.3 Gemini

- **HTTP:** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=<apiKey>`（**モデル名は固定**、**SSE**）
- **system:** 設定 `systemPrompt` と、入力 `messages` 内の `system` を連結し、`systemInstruction.parts[0].text` に渡す（空なら省略）。
- **会話:** `system` を除き、`user` → `user`、`assistant` → `model`。**連続同一 role は `parts` をマージ**。
- **generationConfig:** `{ temperature }` のみ。
- **SSE:** イベント JSON の `candidates[0].content.parts` テキストを処理する。API は **累積全文**または**純粋な差分**のいずれでも来うるため、空でない `textAggregate` があるときは `piece.startsWith(textAggregate)` で累積とみなし増分だけを `onChunk` に渡し、そうでなければ差分として全文を加算する。先頭チャンクは `textAggregate` が空のため別扱い（`"".startsWith("")` の誤判定を避ける）。`usageMetadata` を `StreamResult.usage` に。
- **エラー:** 非 2xx は `error.message` または `Gemini HTTP <status>`。ストリーム完了後にテキスト空なら `Gemini: empty response`。

### 5.4 ファクトリ

`createLlmClient(creds)` — `provider` に応じてキー未設定時は `reject`（空キー）。

### 5.5 トークン推計と API ペイロードの確定

- **`estimateTokens(text)`:** `Math.ceil(text.length * 1.1)` — 厳密な tokenizer は使わず、マルチバイトを考慮した安全側の粗い見積り。
- **`estimatePromptTokens(messages, options, provider)`:** `systemPrompt` と `messages` 内の `system` を §5.2 / §5.3 と同様に連結した文字列に `estimateTokens` を適用し、続けて `system` 以外の各 `content` も合算（プロバイダ共通のテキスト量として扱う）。
- **入力上限（安全圏）:** `getInputTokenLimitForProvider` — **Gemini:** `GEMINI_INPUT_TOKEN_LIMIT_SAFE = 800_000`、**DeepSeek:** `DEEPSEEK_INPUT_TOKEN_LIMIT_SAFE = 100_000`（出力・バッファ分を見込んだプロンプト側の目安）。
- **`trimLeadingAssistantRun(messages)`:** 先頭の連続する `assistant` をすべて除き、ペイロードが可能な限り `user` から始まるようにする（API の役割順序を満たす）。
- **`ChatSession` 側の送信前判定（[`src/core/chat-session.ts`](../src/core/chat-session.ts)）:** `fullTurns`（既存履歴 + 今回ユーザーターン）について `estimatePromptTokens` を上限と比較。**超過時**は delegate 経由で [`TokenLimitModal`](../src/token-limit-modal.ts) を開き **Truncate**（先頭から `shift` して上限内へ。`ChatSession` 内の `messages` も同件数だけ `slice` し `onMessagesChanged` → View が `renderAllMessages`）/ **Clear session 相当**（履歴を空にし今回の入力のみ）/ **Cancel** を選択させる。**上限内**は `trimLeadingAssistantRun(fullTurns)` のみを `stream` に渡す（**件数 10 によるサイレント切り捨ては行わない**）。
- **レガシー:** `limitChatMessagesForApiWindow`（末尾 `maxCount` 件 + 先頭 `assistant` 除去）はテスト互換のため残すが、**本番の送信経路では使用しない**。
- **メモリ・ノート:** Truncate 選択後は **`ChatSession` の `messages` が短くなる**ため、**画面と API コンテキストが一致**。ノートへの追記は従来どおりターン単位。

### 5.6 セッション層（[`src/core/chat-session.ts`](../src/core/chat-session.ts)）

- **`ChatSession`:** 会話履歴（`ChatMessage[]`）、`lockedTarget`（`TFile | null`）、送信中フラグ（`_inFlight`）、`AbortController` を保持する。**送信・トークン判定・LLM `stream`・Vault 追記**はここで行う。`VaultAdapter`（`resolveFile` / `appendToFile` / `buildWikilinkContext`）を**注入**し、本番は View 内の `createVaultAdapter(app)` が `App` を束ねる（wikilink の on/off は `ChatSession` が `buildWikilinkContext` に渡す `enabled` で制御）。
- **`ChatSessionDelegate`:** UI 更新用コールバック。`onSendStarting` で仮 DOM 行、`onStreamChunk` でプレーン累積、**ストリーム完了後・追記前**に `onStreamFinished`（アシスタントの Markdown 確定描画）、追記成功後に `onTurnComplete`（usage 行・入力クリア）、失敗・中止時に `onTurnRolledBack`、読み込み表示に `onLoadingChanged`、Truncate 後に `onMessagesChanged`、セッションクリア時に `onSessionCleared`、トークン超過時に `promptTokenLimitChoice`（Modal）、Notice に `showNotice`。
- **単一の状態源:** 履歴とロックは **`ChatSession` のみ**が保持し、View は `session.messages` / `session.lockedTarget` / `session.inFlight` を参照する。

---

## 6. カスタム View（[`src/view.ts`](../src/view.ts)）

### 6.1 識別子

- `VIEW_TYPE`: `"obsidian-ai-chat-view"`
- タイトル表示: **AI Chat**
- アイコン: `message-circle`

### 6.2 DOM 構成（上から順）

1. **Target ブロック**（`ai-chat-target`）— **ノート選択**（`select.ai-chat-target-select`）、**状態行**（`ai-chat-target-detail`）、**推定トークン行**（`ai-chat-token-estimate`）— `ChatSession.estimateCurrentTokens`（内部で `estimatePromptTokens`）により **履歴＋システム**、入力欄に文字があるときは **ドラフトを仮の user メッセージとして加算**（wikilink 追記は含めない）。表示形式: `Estimated prompt: ~N / L tokens`、ドラフトあり時は `(incl. draft input)` を付与。入力は 200ms デバウンスで更新。
2. **履歴**（`ai-chat-history`）— 縦フレックス。各メッセージは `ai-chat-msg` + ロール修飾子 `ai-chat-msg-user`（右寄せ）または `ai-chat-msg-assistant`（左寄せ）。ロールラベル（`ai-chat-msg-role`）の下に **吹き出し内側** `ai-chat-msg-bubble-inner`（`overflow-x: auto`、`word-break` 系でコードブロック・テーブルが横幅を突き破らない）。確定済み本文は `MarkdownRenderer.render`、ストリーム中のアシスタントのみプレーンテキスト → 完了後に再描画。
3. **入力**（`textarea.ai-chat-input`）— 複数行。**Ctrl+Enter / Cmd+Enter**（および **Mod+Enter**：macOS では Cmd、それ以外では Ctrl）で送信（通常 Enter は改行）。**IME 変換中**（`isComposing`）は送信しない。Obsidian はキーを DOM のみで拾えないことがあるため、**`View.scope`（`new Scope(this.app.scope)`）に `Scope.register`** で `Mod` / `Ctrl` / `Meta` と `Enter` / `NumpadEnter` を登録し、**フォーカスが入力欄のときだけ** `onSend` する（ハンドラは `false` を返して既定処理を抑止）。
4. **ツールバー:** **Send**（`mod-cta`）、**Stop**（`mod-warning`、送信中のみ表示）、**Clear session**、**Usage**、読み込み文言 `Waiting for model…`（`ai-chat-loading`）。

### 6.3 状態（インスタンスフィールド）

| 名前 | 意味 |
|------|------|
| `session` | [`ChatSession`](../src/core/chat-session.ts)。**履歴・ロック・送信中・中止**のソース・オブ・トゥルース（`messages` / `lockedTarget` / `inFlight` はここを参照） |
| `pendingStreamRows` | ストリーム確定前に追加した user/assistant の DOM 行とレイヤ参照。abort またはエラーで削除 |

`MarkdownRenderer` 用に `Component` を `onOpen` で `load()`、`onClose` で `unload()`。`onOpen` で `ChatSession` を生成し `VaultAdapter` を注入する。

### 6.4 履歴の描画

- **差分追記:** 確定済みメッセージは `appendRenderedMessage` で末尾に追加。全消去後の再描画は `renderAllMessages`（起動時・Clear 後）。
- **レイアウト:** ユーザーは右寄せ（`ai-chat-msg-user`）、アシスタントは左寄せ（`ai-chat-msg-assistant`）。本文は `.ai-chat-msg-bubble-inner` 内に描画し、横方向のはみ出しは内側スクロールと折り返しで抑える。
- **ストリーミング中のアシスタント行:** `MarkdownRenderer` は使わず、`textContent` で本文（および reasoning がある場合は別要素）を累積表示。完了後に [`buildAssistantMarkdown`](../src/core/chat-session.ts)（reasoning は `<details>`）を **初めて** `MarkdownRenderer.render` し、プレーン層を隠して Markdown 層を表示（[`styles.css`](../styles.css) の `.ai-chat-md-stack` 等）。ストリーム用スタックも吹き出し内側に置く。
- **ソースパス:** `MarkdownRenderer` の `sourcePath` 引数は **`session.lockedTarget.path`**。未ロック時は `""`。

### 6.5 ターゲットノートのロック

**プルダウン（`ai-chat-target-select`）**

- 先頭オプション **Active note (on send)**（`value` 空）が **既定**: 初回送信時は従来どおり **`workspace.getActiveFile()`** をロック対象とする。アクティブファイルが無ければ Notice して中断。
- 特定パスを選んだ場合: 初回送信時にそのパスを `vault.getAbstractFileByPath` で解決し、`TFile` ならロック。無ければ Notice して中断。
- **パフォーマンス:** Vault 全体の Markdown を列挙せず、`getMarkdownFiles()` を **`stat.mtime` 降順**でソートし、**最新 50 件のみ** を `<option>` に載せる（巨大 Vault での DOM フリーズ回避）。一覧に無いノートは「アクティブノート」経由でロックするか、View を開き直してリスト再構築する。
- **ロック後:** `lockedTarget` が存在する間は `<select>` を **無効化**（セッションと追記先の整合）。**Clear session** で `lockedTarget` を消すと `<select>` を再有効化し、値は **Active note** にリセット、オプション一覧を再構築する。

**ロック後の共通処理**

1. 確定した `lockedTarget` について **`vault.getAbstractFileByPath(lockedTarget.path)`** で存在確認。`TFile` でなければ Notice（`locked note is missing...`）して中断。成功時は参照を最新の `TFile` に更新。

**ロック解除:** **Clear session** のみ（`messages` 空、`lockedTarget` null）。

### 6.6 エディタ選択範囲（コンテキスト）

`getSelectionContext()`:

- `workspace.getActiveFile()` が **存在し**、かつ **`session.lockedTarget` と同一 `path`** のときのみ有効。
- `MarkdownView` を取得し `editor.getSelection().trim()`。それ以外は `""`。

`buildUserTurnBody(rawInput, selection)`:

- 選択なし: `rawInput` のみ。
- あり: `rawInput` + 区切り + `**Selection from note:**` + 選択テキスト（Markdown 断片として連結）。

### 6.6.1 Wikilink コンテキスト（[`src/core/wikilink-context.ts`](../src/core/wikilink-context.ts)）

- **前提:** 設定 `enableWikilinkContextResolution` が **オン**のときのみ実行。オフなら **Vault への読み込みは行わない**。
- **対象:** ユーザー入力 `rawInput` に現れる `[[link]]` / `[[link|alias]]` の **リンク先パス部分のみ**（エイリアスは無視）。**深さ 1**（リンク先ノート本文の中の wikilink は辿らない）。
- **解決:** `app.metadataCache.getFirstLinkpathDest(linkpath, lockedTarget.path)`。`TFile` に解決できたものだけを `vault.cachedRead` で読む（非同期）。
- **重複・閉路:** 同一 `path` は 1 回だけ読む（訪問済み `Set`）。
- **サイズ:** ノートあたり最大 12 000 文字、追記するコンテキスト全体で最大 40 000 文字（実装定数）。超過分は切り捨て、当該ノート末尾に `> [Truncated due to size limit]` を付与。全体上限超過時は残りリンクをスキップし、スキップ用の切り捨て注記を付与。
- **ユーザーターン:** `buildUserTurnBody(...)` の結果の後に、`## Resolved wikilink context (depth 1)` 以下へ各ノート本文を連結したブロックを付加する。

### 6.7 送信フロー（View `onSend` → `ChatSession.send`）

View 側の前提（ターゲット未ロックならロック、選択コンテキスト取得）のあと **`session.send(rawInput, selection)`** が以下を実行する。

1. `baseUserTurn` = `buildUserTurnBody` 相当（セッション内）。設定がオンなら `VaultAdapter.buildWikilinkContext` で付加し、これを `userContent` とする。
2. `fullTurns` = 既存 `session.messages` を `ChatMessage[]` に写したもの + 今ターンの `{ role: "user", content: userContent }`。
3. **トークン判定（§5.5）:** `estimatePromptTokens(fullTurns, …)` とプロバイダ別上限を比較。
   - **上限内:** `apiPayload` = `trimLeadingAssistantRun(fullTurns)`。空なら Notice して終了。
   - **上限超:** delegate の `promptTokenLimitChoice` → `TokenLimitModal`（タイトル **Context Limit Reached**）。**Truncate** — `fullTurns` を末尾の今回ユーザーターンを残しつつ先頭から削り、推定が上限内になるまで `shift`。`session.messages` も削った件数だけ `slice` し `onMessagesChanged` → View `renderAllMessages()`。**Clear** — `messages` を空にして `onMessagesChanged`、再推計。**Cancel** — 何も送らず終了（入力は保持）。
4. **`dispatchStream`（`ChatSession` 内）:** `onSendStarting` でユーザー行を履歴に描画（`MarkdownRenderer`）。アシスタント用プレースホルダ行を追加し View が `pendingStreamRows` に保持。
5. `onLoadingChanged(true)` — Send を隠し Stop を表示、`Waiting for model…`。
6. `AbortController` を生成し `createLlmClient` → `stream(apiPayload, options, onChunk, signal)` を `await`。チャンクごとに `onStreamChunk` でアシスタント行のプレーンテキストを更新（`MarkdownRenderer` は呼ばない）。
7. **正常完了時:** 累積 `StreamResult` で `onStreamFinished` → View が `MarkdownRenderer` を実行し、その後 **`VaultAdapter.appendToFile`** を try。**追記**が失敗した場合は **`onTurnRolledBack`** で当ターンの仮行を削除し、例外を再送出（ノート・`session.messages` は未更新のまま）。成功時のみ続行（ノートには **本文のみ**、reasoning は含めない）。
8. **追記成功後のみ:** `session.messages` に user → assistant（`result.content`）を `push`、`onTurnComplete` で usage 行（`ai-chat-usage-meta`）を表示、入力クリア、`pendingStreamRows` をクリア。
9. **中止（`AbortError`）:** `Notice` なし。`onTurnRolledBack`。ノート・`messages` は変更しない。入力は保持。
10. **その他の失敗:** `showNotice` にエラー文。`onTurnRolledBack`。**入力はクリアしない**。
11. `finally`: `onLoadingChanged(false)`（View は推定トークン行も更新）、`abortController` を null。

**ショートカット送信:** `View.scope` の Mod/Ctrl/Meta + Enter ハンドラ内で **`evt.isComposing` のときは送信しない**（IME 確定中の Enter を誤爆しない）。

**原子性:** ノート追記に失敗した場合、UI 上の履歴は当ターンを増やさず、**仮 DOM もロールバック**する（ファイル・メモリ・表示の整合）。ストリームは完了していても追記失敗なら `messages` に載せない。

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

- 送信中（`session.inFlight`）は **Send 無視**。**Stop** は有効。
- 複数 View インスタンスは **登録上は可能**だが、通常はリーフ 1 つ運用想定。各インスタンスは **独立した `ChatSession`（`messages` / `lockedTarget`）** を持つ。

---

## 8. セッション寿命と永続性

| 状態 | 永続 |
|------|------|
| 設定 | Vault プラグインデータに保存 |
| `ChatSession` の `messages` / `lockedTarget` | メモリのみ。View を閉じる・Obsidian 終了で失われる |
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
- **MarkdownRenderer と追記の順序:** アシスタント行は先に delegate `onStreamFinished` で `MarkdownRenderer` 確定し、その後 `VaultAdapter.appendToFile`。**追記失敗時**は `onTurnRolledBack` で `pendingStreamRows` を削除する。**レンダラが `append` より前に失敗**した場合は従来どおり仮行削除パスに入り、ノートは未更新。

---

## 12. 変更履歴（ドキュメント）

| 日付 | 内容 | コミット（任意・大きな変更時） |
|------|------|--------------------------------|
| 2026-04-06 | 初版: 現行実装に基づき記述 | `41c62d1b…`（初期コミット） |
| 2026-04-06 | 追記: API スライディング・ウィンドウ、`onSend` のノート先行成功後のみ UI 更新、`formatNoteBlock` 先頭 `\n\n` 明示 | `97ac5f8b…` |
| 2026-04-06 | yokii-dev-workflow 遵守用: `docs/RECORDS.md`、`docs/decisions/`（ADR 0001）、`DISCUSSION.md`、`EVAL.md` | `836a61542fe120ce7c69fdbb46c37018113c7e8b` |
| 2026-04-06 | Phase A: `LlmClient.stream`（DeepSeek/Gemini SSE）、Stop / `AbortController`、プレーン→Markdown 確定描画、追記成功後のみ `messages` 確定、usage 行 | `00eb3f85bb4beceaedf5e034a2d5b33850c48043` |
| 2026-04-06 | Phase B 相当: Wikilink コンテキスト（opt-in）、append 失敗時 DOM ロールバック、Gemini/DeepSeek パース調整、ADR `finish_reason` 補足、`docs/archive/SPEC.consulting.md` へ旧コンサル SPEC 退避 | `836a61542fe120ce7c69fdbb46c37018113c7e8b` |
| 2026-04-06 | **v1.0.0** リリース確定: `manifest.json` / `package.json` を `1.0.0` に | `5960c92c34461bd88ded3f1b49bbdfd62d681815` |
| 2026-04-06 | git-flow 採用: [`docs/GITFLOW.md`](GITFLOW.md)、`develop` ブランチ作成、`RECORDS.md` からリンク | `e5bfc50a271ea85f1dcee50130890afd0b3d3623` |
| 2026-04-06 | Phase C（UI）: ターゲット `<select>`（`mtime` 降順・最新 50 件）、吹き出し左右レイアウト・内側 `overflow-x`/折り返し、Ctrl/Cmd+Enter 送信（`isComposing` ガード） | （未コミット可） |
| 2026-04-06 | **v1.1.0** 確定: `manifest.json` / `package.json` を `1.1.0` に（Vitest・core テスト、UI 改善、送信は `Scope` 登録） |  |
| 2026-04-06 | トークンベース・コンテキスト: `estimateTokens` / `estimatePromptTokens`、プロバイダ別安全上限、`trimLeadingAssistantRun`、送信前超過時 `TokenLimitModal`（Truncate / Clear / Cancel）、件数 10 のサイレント切り捨て廃止 |  |
| 2026-04-06 | **v1.2.0** 確定: 画面上の推定トークン行（`ai-chat-token-estimate`）、レビュー／トークン機能レポート、`docs/AGENT_HANDOFF.md`（次エージェント引き継ぎ） |  |
| 2026-04-06 | リファクタ: [`src/core/chat-session.ts`](../src/core/chat-session.ts) に送信・トークン・ストリーム・追記を集約、`VaultAdapter` 注入、`ChatSessionDelegate` で View と連携。振る舞いは v1.2.0 と同一を意図 |  |

記録運用は [`docs/RECORDS.md`](RECORDS.md) を参照。
