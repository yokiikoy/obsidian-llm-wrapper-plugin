# 記録・遵守（yokii-dev-workflow 対応表）

[`yokii-dev-workflow.mdc`](../.cursor/rules/yokii-dev-workflow.mdc)（正本は `cursor-dev-standards` 側）の要件を、**このリポジトリでどこに書くか**を固定する。チャットだけに決めを残さない。

| ワークフロー要件 | このリポジトリでの置き場所 |
|------------------|---------------------------|
| 設計のやりとり・長文議論の共有 | [`DISCUSSION.md`](../DISCUSSION.md)（要約・リンク集。確定判断は ADR へ） |
| 方針転換・不可逆なアーキテクチャ決定 | [`docs/decisions/`](decisions/) の ADR（`NNNN-title.md`） |
| 数値サマリ・評価の約束 | [`EVAL.md`](../EVAL.md)（該当する計測が出たら更新） |
| 実装の真実（動作仕様） | [`docs/SPEC.md`](SPEC.md) |
| 実装変更の追跡 | Git。意味のあるドキュメント更新では **該当コミットのフル SHA** を ADR または SPEC 変更履歴に残す |
| ブランチ・リリース・タグのルール | [`docs/GITFLOW.md`](GITFLOW.md)（`main` / `develop` / feature / release / hotfix） |

## 運用ルール（短く）

1. **アーキテクチャやロードマップ優先度の確定** → 新規 ADR を 1 本足す（テンプレ: [`docs/decisions/template.md`](decisions/template.md)）。
2. **ADR をマージしたコミットの SHA** は、ADR 末尾の「記録」に書くか、少なくとも `git log -1 --format=%H -- path/to/adr.md` で常に再取得可能にする。
3. **明示の Go が無い Phase 2** はコードに入れない（[`obsidian-ai-chat.mdc`](../.cursor/rules/obsidian-ai-chat.mdc) と併読）。
