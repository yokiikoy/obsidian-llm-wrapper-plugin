# Mission: Phase K - Message Timestamps (UI + Vault)

> **Focus:** 会話ターンごとの時刻をメモリ・Vault・チャット UI で一貫して扱い、LLM API には本文だけを渡す

## 要件定義

- **データ:** [`ChatMessage`](../../src/core/llm.ts) に任意の `createdAt`（ISO 8601 UTC）。`content` には時刻を含めない。
- **Vault ワイヤ:** 各 `### User` / `### Assistant` ブロックで、見出し直後に任意で 1 行 `<!-- ai-chat-at:<ISO> -->`（[ADR 0003](../decisions/0003-message-timestamps-vault-wire.md)）。
- **API:** `toApiMessages` は `{ role, content }` のみ（時刻は送信しない）。
- **UI:** ロールラベル下に `ai-chat-msg-time`（ローカル表示）。ストリーミング中はユーザ時刻を即時、アシスタント時刻はターン完了時に表示。
- **再水和:** [`parseNoteConversation`](../../src/core/note-conversation-parser.ts) がコメント行を `createdAt` に復元。コメントなしの旧ノートは従来どおり。

## 実装チェックリスト

- [x] `ChatMessage.createdAt` と `formatNoteBlock`（`chat-session.ts`）
- [x] `parseNoteConversation` と Vitest（`note-conversation-parser` / `chat-session`）
- [x] `ChatSessionDelegate` の `onSendStarting(userContent, userAt)` / `onTurnComplete(..., assistantAt)` と View（`view.ts`）
- [x] `styles.css` の `.ai-chat-msg-time`
- [x] `docs/SPEC.md`、ADR 0003、`docs/TEST_SPEC.md`（件数・CS7）

## 実装状況ログ

- 2026-04-06T20:14:30+09:00: Phase K を後追いで起票。実装コミット `1c69ddf`（本体）、`e06fa67`（ADR 記録 SHA 追記）。SPEC §5.8 / §6.9、TEST_SPEC 計 42 件。
- 2026-04-06T20:14:30+09:00: `Mission_Phase_K_Message_Timestamps` 本ファイルと `Mission_Control_Sub` を追加・更新（コミット `8fcb1ac61238671c67ed80ab9cddf78bb9d08ed1`）。
