# Mission: Phase H - Repository-managed Mission Docs
> **Focus:** Mission文書をGit管理しつつObsidianから運用する

## 📋 要件定義
- **単一正本:** Mission文書の実体はリポジトリ（`docs/missions`）に置く。
- **Vault運用:** Obsidian側はシンボリックリンク経由で同一ファイルを編集する。
- **履歴管理:** Mission更新は通常のGit差分・PRで追跡可能にする。
- **安全運用:** 移行時にバックアップを残し、破壊的操作を避ける。

## 🛠 実装チェックリスト
- [x] Vault `Missions` をリポジトリ `docs/missions` へのシンボリックリンクに切替
- [x] `Mission_Control_Sub.md` をリポジトリ `docs/Mission_Control_Sub.md` へのシンボリックリンクに切替
- [x] 運用ルール（作成場所・命名規則・レビュー手順）を `docs/missions/README.md` に追記
- [x] 旧バックアップ（`.bak-*`）の保管期限を 30 日に決定

## 📝 備忘録
- Obsidian UIからリンク配下に新規作成したファイルは、実体がリポジトリ側に生成される。
- `git status` で Mission更新を即確認できる。
- 運用ルール詳細は `docs/missions/README.md` を参照。

## 実装状況ログ
- 2026-04-06T18:14:41+09:00: Phase H を起票。Mission文書のGit管理運用（symlink方式）を開始。
- 2026-04-06T18:19:24+09:00: `docs/missions/README.md` を追加し、命名規則・更新手順・レビュー観点・`.bak-*` の 30 日保管方針を確定。
