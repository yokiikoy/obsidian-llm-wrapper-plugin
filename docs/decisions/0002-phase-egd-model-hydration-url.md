# ADR 0002: Phase E / G / D（モデル選択・履歴再水和・URL 取り込み）

## Status

Accepted

## Context

Vault の Mission（Phase E → G → D）に沿い、対話で要件を詰めたうえで実装する方針とした。本 ADR は **合意に基づくスコープの要約**（対話の代替として記録した前提を含む）。

## Decision

### Phase E — Model & Intelligence

- プロバイダごとに **API モデル ID を設定で保持**する（DeepSeek: `deepseek-chat` / `deepseek-reasoner`、Gemini: `gemini-1.5-flash` / `gemini-1.5-pro`）。設定タブとチャット View ツールバーから切り替え可能。
- **推論テキスト（reasoning）は Vault 追記に含めない**（従来どおり `formatNoteBlock` は本文のみ）。チャット UI では `<details>` 相当で表示し、**設定でチャット内の推論表示をオフ**にできる。
- 月次予算をコード側のデフォルトに自動連動させる要件は **採用しない**（ユーザーが手でモデルを選ぶ）。

### Phase G — Session Hydration

- パース対象の見出しは **実装仕様どおり `### User` / `### Assistant`**（絵文字見出しは対象外）。
- トリガは **手動ボタン**「ロック中のノートから履歴を読み込む」のみ（ファイルオープン時の自動同期はしない）。
- YAML フロントマターは **読み飛ばしてから**本文をパースする。フロントマター本文を「前提知識」として会話に混ぜる機能は **本 ADR のスコープ外**。
- 読み込み直前に **推定トークンが安全上限を超える場合は Notice で警告**し、読み込みは中止する。

### Phase D — Smart Ingester

- 送信時、ユーザーメッセージ内の **http(s) URL を検出**し、**送信前に直列で `requestUrl` フェッチ**し、抽出テキストをユーザーターンに連結する。
- **本文抽出**は `DOMParser` + `document.body.innerText` の軽量方式（Readability 相当ライブラリは導入しない）。レスポンス長は **文字数で上限**を設ける。
- 失敗時はその URL をスキップし Notice、残りは続行。

## Consequences

- `llm.ts` の Gemini URL がモデル ID に依存する動的パスになる。
- `ChatSessionDelegate` に URL 進捗用の必須メソッドは追加せず、`showNotice` で足りる範囲に留める。
- セキュリティ: 任意 URL へのクライアント側リクエストとなるため、ユーザーが貼った URL のみ（明示的送信）とする。

## 記録

- ADR 採用コミット: TBD（マージ後にフル SHA を追記）
