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

## 7. テスト一覧サマリ（件数の目安）

実装時は `npm test` の出力が正。本書作成時点の構成は次のとおり。


| ファイル                       | おおよそのテスト数 | 主題                      |
| -------------------------- | --------- | ----------------------- |
| `llm.test.ts`              | 8         | メッセージ窓 + Abort 判定       |
| `llm.stream.test.ts`       | 8         | `createLlmClient` ストリーム |
| `wikilink-context.test.ts` | 5         | ウィキリンク抽出                |
| **合計**                     | **21**    | —                       |


---

## 8. 純粋性・依存の監視（GitNexus 等）

計画上のチェックとして以下を推奨する。

- `**src/core` の import 監視:** `obsidian` など UI ランタイム依存が純粋モジュールに混入していないか（例: `llm.ts` は原則 `obsidian` を import しない）。
- `**wikilink-context.ts`** は `**App` / `TFile` のため `obsidian` を import する**ため、「core 全体が obsidian フリー」ではない。テストでは **エイリアススタブ**で解決している。

---

## 9. 変更履歴（メンテ用）


| 日付         | 内容                                             |
| ---------- | ---------------------------------------------- |
| 2026-04-06 | 初版: 既存 `*.test.ts` と `vitest.config.ts` に基づき記述 |


