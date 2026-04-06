# 実装レポート — トークンベース・コンテキスト管理と上限超過モーダル

レビュー AI／第三者向けの包括サマリは [`REPORT_REVIEW_HANDOFF.md`](REPORT_REVIEW_HANDOFF.md) を参照。

| 項目 | 内容 |
|------|------|
| プラグイン | Obsidian AI Chat（`obsidian-ai-chat`） |
| 対象バージョン | `manifest.json` **1.2.0** ベースの実装（詳細は [`AGENT_HANDOFF.md`](AGENT_HANDOFF.md)） |
| スコープ | API 送信前の推定トークン判定、超過時のユーザー確認、件数固定（10 件）によるサイレント切り捨ての廃止 |

---

## 1. 背景と目的

従来は `limitChatMessagesForApiWindow(..., 10)` により、直近 10 メッセージ以外を**通知なし**で API ペイロードから除外していた。モデルごとの入力上限を活かしつつ、超過時はユーザーが方針を選べるようにするため、**文字数ベースの粗いトークン推計**と**プロバイダ別の安全上限**、および **`Modal` による 3 択**を導入した。

---

## 2. 実装サマリ

### 2.1 コア（`src/core/llm.ts`）

| 要素 | 説明 |
|------|------|
| `estimateTokens(text)` | `Math.ceil(text.length × 1.1)`。Tiktoken 等は未導入。 |
| `estimatePromptTokens(messages, options, provider)` | `systemPrompt` と `system` ロールの結合、続けて各 `content` を合算（送信テキスト量の目安）。 |
| `GEMINI_INPUT_TOKEN_LIMIT_SAFE` | `800_000` |
| `DEEPSEEK_INPUT_TOKEN_LIMIT_SAFE` | `100_000` |
| `getInputTokenLimitForProvider(provider)` | 上記定数の選択。 |
| `trimLeadingAssistantRun(messages)` | 先頭の連続 `assistant` を削除し、可能な限り `user` から始まるペイロードにする。 |
| `limitChatMessagesForApiWindow` | **本番の送信経路では使用しない**。スライス＋`trimLeadingAssistantRun` のロジックはテスト互換のため維持。 |

### 2.2 UI（`src/token-limit-modal.ts`）

- `openTokenLimitModal(app, estimated, limit)` が `Promise<"truncate" \| "clear" \| "cancel">` を返す。
- タイトル: **Context Limit Reached**。
- ボタン: **Truncate Old Messages (Continue)** / **Clear Session (New Start)** / **Cancel**。
- 閉じる・Esc は **cancel** とみなし、二重 resolve を防止。

### 2.3 ビュー（`src/view.ts`）

- `onSend` 内で `fullTurns` 組み立て後、`estimatePromptTokens` と上限を比較。
- **上限内:** `trimLeadingAssistantRun(fullTurns)` を `stream` に渡す（件数 10 による切り捨てなし）。
- **上限超:** Modal を表示。
  - **Truncate:** 末尾の今回ユーザーターンを残し、`fullTurns` を先頭から `shift` して上限内へ。`this.messages` も同件数 `slice` し、`renderAllMessages()` で UI と整合。
  - **Clear:** `messages` を空に再描画し、今回のユーザーのみの `fullTurns` で再判定。なお超過なら Notice。
  - **Cancel:** 送信せず終了（入力は保持）。
- ストリーム処理は **`dispatchStream`** に分離。

### 2.4 既存動作との関係

- **IME:** `View.scope` の Mod/Ctrl/Meta + Enter で **`evt.isComposing` のとき送信しない**（従来どおり）。
- **ノート追記・`messages` 確定・abort 時のロールバック:** 従来の `dispatchStream` 内の契約を維持。

---

## 3. テスト

| 対象 | ファイル |
|------|----------|
| `estimateTokens`, `estimatePromptTokens`, `trimLeadingAssistantRun`, 既存 `limitChatMessagesForApiWindow` / `isAbortError` | `src/core/llm.test.ts` |
| ストリーム（fetch モック） | `src/core/llm.stream.test.ts` |
| ウィキリンク抽出 | `src/core/wikilink-context.test.ts` |

コマンド: `npm test`（Vitest）。Modal・`ItemView` は単体テスト対象外。

---

## 4. ドキュメント

- [`docs/SPEC.md`](SPEC.md): §5.5（トークン推計・上限・`trimLeadingAssistantRun`・Modal）、§6.7（`onSend` / `dispatchStream`）を更新。§12 変更履歴に追記。

---

## 5. 既知の限界・注意

- 推計は**文字数ベース**であり、実 API のトークナイザとは一致しない。安全側に振るため係数 1.1 を使用。
- 1 ターンのみでも推定が上限を超える場合は、Truncate でも削れないため **Notice** で短縮を促す。
- プロバイダの実上限・料金ポリシーは API 側の変更がありうる。定数は「安全圏」として保守する。

---

## 6. ビルド確認

- `npm run build` — `main.js` 生成
- `npx tsc --noEmit` — 型チェック（`skipLibCheck` あり）

---

*本レポートは実装完了時点のリポジトリ状態に基づく。*
