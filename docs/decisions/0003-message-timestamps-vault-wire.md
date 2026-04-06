# ADR 0003: Vault wire format for message timestamps

## Status

Accepted

## Context

チャット履歴をノートに追記する既存形式は `### User` / `### Assistant` と本文のみだった。時系列を UI とファイルの両方で分かるようにしたい。LLM API には余計な文脈を載せたくない。

## Decision

- メモリ上の [`ChatMessage`](../../src/core/llm.ts) に任意の **`createdAt`**（ISO 8601 UTC 文字列）を持たせる。
- Vault では各ブロックの見出し直後に **1 行** `<!-- ai-chat-at:<ISO> -->` を書く。パーサはこれを `createdAt` にし、**本文 `content` からは除外**する。
- **API ペイロード**は従来どおり `role` / `content` のみ（[`toApiMessages`](../../src/core/chat-session.ts)）。

## Consequences

### 良い点

- Reading ビューでは HTML コメントは通常非表示で、本文の可読性を大きく損ねにくい。
- 旧ノート（コメントなし）はそのままパースでき、`createdAt` なしとして扱える。

### 悪い点・リスク

- 手編集でコメント行を消すと、そのターンの時刻だけ失う。
- 表示タイムゾーンはクライアントのローカル（`Date` + `toLocaleString`）に依存。

## 記録

- 採用日: 2026-04-06
- 記録コミット: TBD（マージ後にフル SHA を差し替え）
