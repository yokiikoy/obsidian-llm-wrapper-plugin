# レビューAI向けハンドオフレポート — Obsidian AI Chat

本書はコードレビュー・設計レビューを行う AI／人間レビュアーに、**現行実装の意図・範囲・検証観点**を短時間で伝えるためのレポートである。実装の正はソースと [`docs/SPEC.md`](SPEC.md) を優先する。

---

## 1. プロダクト概要

| 項目 | 内容 |
|------|------|
| 名称 | Obsidian AI Chat |
| プラグイン ID | `obsidian-ai-chat` |
| バージョン（`manifest.json`） | **1.2.0** |
| 目的 | Vault 内で LLM とチャットし、**ロックした Markdown ノート末尾へ**会話を追記する |
| プロバイダ | **DeepSeek**（`deepseek-chat`）/ **Gemini**（`gemini-1.5-flash`、SSE） |
| エントリ | `src/main.ts` → esbuild で `main.js` |

---

## 2. ディレクトリと責務（主要ファイル）

| パス | 役割 |
|------|------|
| [`src/main.ts`](../src/main.ts) | プラグイン読み込み、View 登録、コマンド／リボン |
| [`src/view.ts`](../src/view.ts) | `ItemView`：UI、送信、`Scope` ショートカット、トークン表示、Modal 呼び出し |
| [`src/token-limit-modal.ts`](../src/token-limit-modal.ts) | コンテキスト上限超過時の **Modal**（Truncate / Clear / Cancel） |
| [`src/core/llm.ts`](../src/core/llm.ts) | SSE ストリーム、トークン推計、安全上限定数、`trimLeadingAssistantRun` |
| [`src/core/wikilink-context.ts`](../src/core/wikilink-context.ts) | オプションの `[[wikilink]]` 深さ1解決 |
| [`src/settings.ts`](../src/settings.ts) | 設定タブ・永続化 |
| [`styles.css`](../styles.css) | View スタイル（吹き出し、ターゲット行、トークン行など） |
| [`docs/SPEC.md`](SPEC.md) | **実装仕様書**（挙動の正） |

**テスト対象外（意図的）:** `view.ts`、Modal、Obsidian API 直結は **Vitest 未カバー**（手動・E2E 想定）。

---

## 3. トークン・コンテキスト管理（重要）

### 3.1 推計

- `estimateTokens(text)` = `Math.ceil(text.length × 1.1)`（厳密トークナイザは未使用）。
- `estimatePromptTokens(messages, options, provider)` = システム相当テキスト + 各 `content` の合算（プロバイダ共通の粗い見積り）。

### 3.2 安全上限（定数）

| プロバイダ | 定数 | 値 |
|------------|------|-----|
| Gemini | `GEMINI_INPUT_TOKEN_LIMIT_SAFE` | 800_000 |
| DeepSeek | `DEEPSEEK_INPUT_TOKEN_LIMIT_SAFE` | 100_000 |

### 3.3 送信前フロー

1. `fullTurns` = 既存履歴 + 今回ユーザーターン。
2. `estimatePromptTokens` と `getInputTokenLimitForProvider` を比較。
3. **上限内:** `trimLeadingAssistantRun(fullTurns)` のみを API へ（**件数 10 のサイレント切り捨ては廃止**）。
4. **超過:** `TokenLimitModal` → Truncate（先頭 `shift` + `messages` 同期 + `renderAllMessages`）/ Clear（履歴クリアのうえ今ターンのみ）/ Cancel。

### 3.4 レガシー

- `limitChatMessagesForApiWindow` は **テスト互換**のため残存。本番送信経路では**使用しない**。

### 3.5 UI：累計推定トークン表示（`ai-chat-token-estimate`）

- 行文言例: `Estimated prompt: ~N / L tokens`（L は上記安全上限）。
- **入力欄に下書きがあるとき**は仮の `user` として加算し、**(incl. draft input)** を表示。
- **wikilink 解決で付く追記本文は表示用推計に含めない**（送信時の `userContent` とは差がありうる）。
- 入力は **200ms デバウンス**で更新。`renderAllMessages` 後・`dispatchStream` の `finally` でも更新。

---

## 4. その他 UX（要点）

- **送信ショートカット:** `View.scope` に `Mod` / `Ctrl` / `Meta` + `Enter`。**`evt.isComposing` のときは送信しない**（IME）。
- **追記先ノート:** プルダウンは **mtime 降順の最新 50 件**のみ（巨大 Vault 対策）。
- **吹き出し:** ユーザー右・アシスタント左。内側 `overflow-x` / 折り返し。

---

## 5. テスト

| コマンド | 内容 |
|----------|------|
| `npm test` | Vitest：`src/core/*.test.ts` |
| `npm run build` | `main.js` 生成 |
| `npx tsc --noEmit` | 型チェック（`skipLibCheck: true`） |

**カバー例:** `estimateTokens` / `estimatePromptTokens` / `trimLeadingAssistantRun` / `limitChatMessagesForApiWindow` / `isAbortError`、ストリーム（`fetch` モック）、`extractWikilinkLinkpaths`。

---

## 6. レビュー観点チェックリスト（提案）

1. **トークン:** 推計と実 API の乖離を許容しているか。定数の根拠は十分か。
2. **Modal:** Truncate 後に `messages` とノート・DOM が整合するか（`SPEC` §6.7）。
3. **表示行:** 下書き推計と送信時 `userContent`（wikilink 含む）の差をユーザーが誤解しないか。
4. **境界:** 1 ターンのみで上限超過時の Notice パス。
5. **`trimLeadingAssistantRun`:** 空配列や API 仕様に触れないか。
6. **セキュリティ:** API キーは設定に平文保存（仕様どおり）。外部送信は LLM エンドポイントのみ。

---

## 7. 既知の制限（要約）

- トークン数は**推定**であり、請求・厳密制限には使えない。
- View / Modal は自動テストなし。
- 詳細は [`docs/SPEC.md`](SPEC.md) §5.5・§6.7、および [`docs/REPORT_TOKEN_CONTEXT.md`](REPORT_TOKEN_CONTEXT.md)（トークン機能の実装レポート）。

---

## 8. 参照ドキュメント

| 文書 | 用途 |
|------|------|
| [`docs/SPEC.md`](SPEC.md) | 実装の単一の仕様ソース |
| [`docs/TEST_SPEC.md`](TEST_SPEC.md) | 単体テストの意図 |
| [`docs/REPORT_TOKEN_CONTEXT.md`](REPORT_TOKEN_CONTEXT.md) | トークン・Modal 導入時の詳細レポート |

---

*生成目的: レビュー AI への報告。リポジトリの最新コミットに合わせて更新すること。*
