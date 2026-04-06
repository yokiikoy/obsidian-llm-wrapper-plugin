# Mission: Phase G - Session Hydration (再水和)
> **Focus:** 過去の思考ログの復元と対話の継続

## 📋 要件定義
- **パースエンジン:** Markdownノートをスキャンし、`### User` と `### Assistant` を区切りとして会話履歴を抽出する。
- **コンテキスト復元:** 抽出データを `ChatSession.messages` に再投入して状態を復元する。
- **フロントマター:** 先頭 YAML frontmatter は除去してからパースする。
- **手編集への耐性:** ヘッダーが維持される限り、編集後本文を正として読み込む。

## 🛠 実装チェックリスト
- [x] `src/core/note-conversation-parser.ts` を実装（Markdown -> Message[]）
- [x] `ChatSession.hydrateFromNoteMarkdown(content)` を実装
- [x] UI（View）に「Load note」ボタンを実装（ロック中ノート対象）
- [x] 読み込み時のトークン数チェック（安全上限超過時は拒否 + Notice）
- [x] Load note: 送信中は再水和不可・UI で多重実行抑止（`loadNoteInFlight` / `hydrateFromNoteMarkdown` の `_inFlight` 拒否）

## 📝 ログ・備忘録
- パーサは `### User` / `### Assistant` のみを対象（絵文字ヘッダーは未対応）。
- 独自見出し（`## 考察` など）は直前ヘッダーの本文として取り込まれる。

## 実装状況ログ
- 2026-04-06T17:50:35+09:00: `parseNoteConversation` と `stripYamlFrontmatter` を追加、単体テストを整備。
- 2026-04-06T17:50:35+09:00: View から手動ロード可能。ファイルオープン時の自動同期は未採用。
- 2026-04-06T18:06:48+09:00: Load note の排他ガード（送信中は再水和不可、連打抑止）。`docs/SPEC.md` に実行制約を記載。
