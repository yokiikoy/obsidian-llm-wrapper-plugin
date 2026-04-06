# Obsidian AI Chat — 単体テスト仕様書

本書は `src/**/*.test.ts` に実装されている Vitest ベースの単体テストの**仕様**（何を検証しているか、前提・入力・期待結果）をまとめたものである。実装の詳細は各 `*.test.ts` を正とする。

---

## 1. 目的とスコープ

### 1.1 目的

- `**src/core`** の純粋ロジックと、`**fetch` をモックしたストリーミング（SSE）パース**の回帰を防ぐ。
- **Abort 判定**は `instanceof` に依存せず、`**error.name === "AbortError"`** を正とする方針と整合させる（Node / CI の `DOMException` 差異を避ける）。

### 1.2 テスト対象（In scope）


| 領域                | ファイル                           | 検証単位                                             |
| ----------------- | ------------------------------ | ------------------------------------------------ |
| メッセージ窓・Abort 判定   | `src/core/llm.ts`              | `limitChatMessagesForApiWindow`, `isAbortError`  |
| LLM クライアント（ストリーム） | `src/core/llm.ts`              | `createLlmClient` → DeepSeek / Gemini の `stream` |
| ウィキリンク抽出（純粋）      | `src/core/wikilink-context.ts` | `extractWikilinkLinkpaths`                       |
| セッション（Vault 注入）      | `src/core/chat-session.ts`     | `ChatSession.send`、トークン超過・Truncate、Abort / 追記失敗 / ファイル消失時のロールバック |
| ノート会話パース              | `src/core/note-conversation-parser.ts` | `### User` / `### Assistant`、フロントマター除去 |
| URL 抽出（ネットワークなし）   | `src/core/url-fetch.ts`        | `extractUrls` のみ（`requestUrl` はテスト外） |


### 1.3 テスト対象外（Out of scope）

- `**src/view.ts` 等、Obsidian UI 依存**の挙動。
- `**buildWikilinkContextAppendix`**（`App` / `vault` / `metadataCache` が必要な非同期結合ロジック）— 現状テストなし。
- **実ネットワーク**へのリクエスト（すべて `fetch` スタブ）。
- **esbuild バンドル結果**そのもの（`npm run build` は別工程）。

---

## 2. 実行環境とコマンド


| 項目     | 内容                                               |
| ------ | ------------------------------------------------ |
| ランナー   | Vitest 3.x                                       |
| 環境     | Node（`vitest.config.ts` で `environment: "node"`） |
| 対象ファイル | `src/**/*.test.ts`                               |
| 一括実行   | `npm test`（`vitest run`）                         |
| ウォッチ   | `npm run test:watch`（`vitest`）                   |


### 2.1 TypeScript との関係

- `src` 内のテストが `vitest` を import するため、依存チェーン上のライブラリ型で `tsc` がノイズを出しやすい。
- ルート `tsconfig.json` の `**skipLibCheck: true`** により、**ライブラリの `.d.ts` は検査をスキップ**し、プロジェクトソースの型チェックを安定させている。

---

## 3. モック・エイリアス方針

### 3.1 `fetch`（`llm.stream.test.ts`）

- `**beforeEach`** で `vi.stubGlobal("fetch", vi.fn())`。
- `**afterEach**` で `vi.unstubAllGlobals()`。
- レスポンス本文は `**ReadableStream<Uint8Array>**` を自前生成（`TextEncoder` で SSE 断片を enqueue）。

### 3.2 `obsidian` パッケージ（Vitest / Vite 解決）

- npm の `obsidian` は Vitest から**パッケージエントリとして解決できない**場合がある。
- `**vitest.config.ts` の `resolve.alias`** で `obsidian` → `**src/test/stubs/obsidian.ts**`（最小の `TFile` / `App` 型スタブ）に向ける。
- `wikilink-context.test.ts` は `**extractWikilinkLinkpaths` のみ**を import するため実行時には Obsidian API を呼ばないが、`wikilink-context.ts` 側の `import "obsidian"` のためにエイリアスが必要。

---

## 4. `src/core/llm.test.ts`

### 4.1 `limitChatMessagesForApiWindow(messages, maxCount)`

**実装の要点（検証の根拠）**

- `maxCount < 1` → **空配列**。
- `messages.length <= maxCount` → **先頭からのコピー**（`slice()` により**新しい配列**）。
- それ以外 → **末尾 `maxCount` 件をスライス**したうえで、**先頭から連続する `role === "assistant"` をすべて除去**して返す。


| #   | ケース名                                     | 入力                                                            | 期待結果                              |
| --- | ---------------------------------------- | ------------------------------------------------------------- | --------------------------------- |
| L1  | `maxCount < 1`                           | `[user("x")], 0`                                              | `[]`                              |
| L2  | 上限内はコピー                                  | `[u("1"), a("2")], 10`                                        | 内容は入力と同一だが `**out !== m`（参照不一致）** |
| L3  | 末尾 `maxCount` 件                          | `[u1,a2,u3,a4,u5], 3`                                         | `[u("3"), a("4"), u("5")]`        |
| L4  | スライス後の先頭 assistant 連続を除去                 | `[u1,a2,a3,u4,a5], 3` スライス → `[a3,u4,a5]` → 先頭 `a3` を落とす      | `[u("4"), a("5")]`                |
| L5  | `system` も通常メッセージとして数える／先頭 assistant トリム | `[sys, u1, a2, u3], maxCount=2` スライス → `[a2,u3]` → 先頭 `a2` 除去 | `[u("3")]`                        |


**補助定義（テスト内）**

- `u(content)` → `{ role: "user", content }`
- `a(content)` → `{ role: "assistant", content }`
- `sys` → `{ role: "system", content: "sys" }`

### 4.2 `isAbortError(e)`

**実装の要点**

- `null` / `undefined` / 非オブジェクト → `false`。
- オブジェクトで `**(e as { name }).name === "AbortError"`**（厳密等価）→ `true`。


| #   | ケース名                          | 入力                                                           | 期待          |
| --- | ----------------------------- | ------------------------------------------------------------ | ----------- |
| A1  | `Error` で name を AbortError に | `Error` を生成し `e.name = "AbortError"`                         | `true`      |
| A2  | プレーンオブジェクト                    | `{ name: "AbortError" }`                                     | `true`      |
| A3  | その他                           | `new Error("nope")`, `null`, `undefined`, 文字列 `"AbortError"` | すべて `false` |


**注:** `DOMException` や `AbortSignal` 由来の実オブジェクトを使った E2E 的な検証は本テストには含めない（**名前文字列ベース**の契約を固定するのが主目的）。

---

## 5. `src/core/llm.stream.test.ts`

対象: `**createLlmClient(creds).stream(messages, options, onChunk, signal)`**  
共通: 各ケースで `fetch` はモック。成功時レスポンスは必要に応じて `text/event-stream` 風の行をストリームで送る。

### 5.1 認証・プロバイダ分岐


| #   | ケース名         | クレデンシャル                                       | 期待                                                               |
| --- | ------------ | --------------------------------------------- | ---------------------------------------------------------------- |
| S1  | DeepSeek キー空 | `provider: "deepseek"`, `deepseekApiKey: " "` | `reject` メッセージ `**DeepSeek API key is empty**`、`fetch` **未呼び出し** |
| S2  | Gemini キー空   | `provider: "gemini"`, `geminiApiKey: ""`      | `reject` メッセージ `**Gemini API key is empty`**                     |


### 5.2 DeepSeek — 正常ストリーム・ペイロード


| #   | ケース名          | モックレスポンス                                                                                                 | `onChunk` / 戻り値の期待                                                                                       | `fetch` 検証                                                                                                                        |
| --- | ------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| S3  | デルタ結合 + usage | SSE 行: `choices[0].delta.content` が `"Hello"` → `" world"`、続けて `usage`（prompt 3 / completion 5）、`[DONE]` | `out.content === "Hello world"`, `out.reasoning === ""`, `usage` 一致、`textChunks === ["Hello", " world"]` | URL `https://api.deepseek.com/chat/completions`, `POST`, body に `**stream: true**`, `**stream_options: { include_usage: true }**` |


### 5.3 DeepSeek — エッジ・エラー


| #   | ケース名                | モック                                                            | 期待                                     |
| --- | ------------------- | -------------------------------------------------------------- | -------------------------------------- |
| S4  | usage のみ（トークンあり）    | `data: {"usage":{"prompt_tokens":1,"completion_tokens":0}}` のみ | `content === ""`, `promptTokens === 1` |
| S5  | HTTP エラー            | `status: 401`, body `{"error":{"message":"bad"}}`              | `reject` に `**bad**` を含む               |
| S6  | 空ストリーム（usage も実質なし） | `choices: [{}]` のようなデルタなし行                                     | `reject` `**DeepSeek: empty stream**`  |


### 5.4 Gemini — ストリーム形態


| #   | ケース名                    | モック SSE の意味                                                                     | 期待                                                                                                                     |
| --- | ----------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| S7  | 累積プレフィックス → より長いプレフィックス | 1 行目 `text: "Hello"`、2 行目 `text: "Hello world"`（**全文累積型**）、3 行目 `usageMetadata` | `out.content === "Hello world"`、`onChunk` デルタは `["Hello", " world"]`；**URL に `streamGenerateContent` と `alt=sse` を含む** |
| S8  | 純デルタ連続                  | `Hi` のあと `there`（短いセグメント）                                                       | `out.content === "Hi there"`                                                                                           |


**注:** S7/S8 は Gemini 側が「累積全文」と「デルタ」の混在しうる実装に対し、パーサが最終テキストとチャンクコールバックを一貫して扱えることを固定する。

---

## 6. `src/core/wikilink-context.test.ts`

対象: `**extractWikilinkLinkpaths(rawPrompt)`**（`[[...]]` の非再帰抽出）


| #   | ケース名      | 入力                             | 期待                |
| --- | --------- | ------------------------------ | ----------------- |
| W1  | ブラケットなし   | `"hello"`                      | `[]`              |
| W2  | 単純リンク     | `"see [[Note A]]"`             | `["Note A"]`      |
| W3  | パイプ別名     | `"[[Real                       | Alias]]"`         |
| W4  | 重複除去・順序維持 | `"[[A]] then [[A]] and [[B]]"` | `["A", "B"]`（初出順） |
| W5  | 内側空白トリム   | `"[[ spaced ]]"`               | `["spaced"]`      |


**未カバー（仕様上ありうるがテストに無い例）**

- 空の `[[|alias]]`、ネストした `[[`、同一行外の複雑なパターンなどは、必要に応じてケース追加で明文化する。

---

## 7. `src/core/chat-session.test.ts`

対象: **`ChatSession`**（`VaultAdapter` と `createLlmClient` をモック注入）。設定はテスト内オブジェクト（`settings.ts` の実行時 import を避け `PluginSettingTab` スタブ問題を回避）。**履歴ありのケース（CS4）**では公開 API がないため、テストのみ `_messages` を型アサーションで代入する。


| #   | ケース名                         | 前提・操作                                                         | 期待                                                                 |
| --- | ---------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| CS1 | 正常送信                         | `stream` が本文返却、`appendToFile` あり                               | `appendToFile` が呼ばれ、`session.messages` が user/assistant 2 件、`onTurnComplete` が呼ばれる |
| CS2 | `AbortError`                   | `stream` が `name === "AbortError"` で reject                         | `append` なし、`messages` 空のまま、`onTurnRolledBack`、Notice なし              |
| CS3 | トークン超過 → Modal（`estimatePromptTokens` スタブ） | `estimatePromptTokens` を大きい値に固定し、`promptTokenLimitChoice` が `"cancel"` | `stream` 未呼び出し、`promptTokenLimitChoice` が呼ばれる                              |
| CS4 | トークン超過 → Truncate        | `_messages` に 4 件を注入、`estimatePromptTokens` が長い履歴で超過・短い候補で上限内、`promptTokenLimitChoice` が `"truncate"`（1 回） | 先頭ターンが落ち `onMessagesChanged` のあと `stream` / `append` が成功し、残り履歴＋今ターンが `messages` に残る |
| CS5 | `appendToFile` 失敗            | `stream` 成功後 `appendToFile` が reject                              | `messages` は空のまま、`onTurnRolledBack`、`showNotice` にエラー文言                    |
| CS6 | ストリーム後にロックファイル消失     | `resolveFile` が 1 回目は `TFile`、2 回目（追記直前）は `null`                 | `append` なし、`messages` 不変、`onTurnRolledBack`、Notice に「no longer exists」系        |

---

## 8. テスト一覧サマリ（件数の目安）

実装時は `npm test` の出力が正。本書作成時点の構成は次のとおり。


| ファイル                       | おおよそのテスト数 | 主題                      |
| -------------------------- | --------- | ----------------------- |
| `llm.test.ts`              | 12        | メッセージ窓 + Abort 判定       |
| `llm.stream.test.ts`       | 9         | `createLlmClient` ストリーム |
| `wikilink-context.test.ts` | 5         | ウィキリンク抽出                |
| `chat-session.test.ts`     | 8         | `ChatSession` + Vault モック（`url-fetch` はモック） |
| `note-conversation-parser.test.ts` | 3 | 見出しパース |
| `url-fetch.test.ts`        | 2         | `extractUrls` |
| **合計**                     | **39**    | —                       |


---

## 9. Android 手動検証（Vitest 外）

単体テストでは Obsidian ランタイムやモバイル UI を再現しない。Android 版 Obsidian でプラグインを手動サイドロードしたうえで、以下を確認する（[README の Android 節](../README.md) 参照）。

| ID | 確認項目 | 期待 |
| -- | -------- | ---- |
| A1 | プラグイン有効化後に **Open AI Chat** でビューが開く | エラーなし |
| A2 | **Send** でメッセージ送信（キーボードショートカットに依存しない） | ストリーム表示・ノート追記 |
| A3 | **Stop** でストリーム中止 | 仮行ロールバック、Notice なし |
| A4 | **URL Fetch** ON で URL を含む入力を送信 | フェッチ Notice / 本文連結 |
| A5 | **URL Fetch** OFF | `fetchUrlsAppendix` 相当の挙動なし（本文に URL 追記ブロックなし） |
| A6 | Gemini + **Web Search** ON で送信 | **Modal** で確認（Continue / Cancel）。Cancel で送信されない |
| A7 | DeepSeek 選択時、**Web Search** トグル | 無効化（disabled） |
| A8 | **Load note**（ロック済みノート） | 再水和成功またはトークン拒否メッセージ |
| A9 | **Gemini** / **AI Studio** / **Usage** ボタン | 外部が開く、または OS により挙動差（README 注記） |
| A10 | 狭い画面幅 | ツールバーが折り返し、横スクロールで全体が破綻しない |

---

## 10. 純粋性・依存の監視（GitNexus 等）

計画上のチェックとして以下を推奨する。

- `**src/core` の import 監視:** `obsidian` など UI ランタイム依存が純粋モジュールに混入していないか（例: `llm.ts` は原則 `obsidian` を import しない）。
- `**wikilink-context.ts`** は `**App` / `TFile` のため `obsidian` を import する**ため、「core 全体が obsidian フリー」ではない。テストでは **エイリアススタブ**で解決している。
- **`chat-session.ts`** は `**TFile` 型のため `obsidian` を import する**（`VaultAdapter` の引数型）。`chat-session.test.ts` は **`TFile` スタブ**を使用する。

---

## 11. 変更履歴（メンテ用）


| 日付         | 内容                                             |
| ---------- | ---------------------------------------------- |
| 2026-04-06 | 初版: 既存 `*.test.ts` と `vitest.config.ts` に基づき記述 |
| 2026-04-06 | `chat-session.test.ts` と件数サマリ（計 28）を追記 |
| 2026-04-06 | CS4–CS6（Truncate / append 失敗 / ファイル消失）と件数サマリ（計 31）を追記 |
| 2026-04-06 | `note-conversation-parser` / `url-fetch`（extractUrls）と件数サマリ（計 36）を追記 |
| 2026-04-06 | §9 Android 手動検証チェックリストを追加（セクション番号繰り下げ） |
| 2026-04-06 | 件数サマリを Vitest 実数（計 39）に合わせて更新 |


