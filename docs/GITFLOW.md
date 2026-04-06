# Git ブランチ運用（git-flow）

本リポジトリは **Vincent Driessen 系の git-flow** を採用する。CLI の `git flow` 拡張は必須ではない（下記の手動コマンドで同等に運用できる）。

## ブランチの役割

| ブランチ | 用途 |
|----------|------|
| **`main`** | **本番相当**。リリース済みのコミットだけを載せる。`manifest.json` の公開バージョンとタグ `v*` はここ（またはここへマージされたコミット）を指す。 |
| **`develop`** | **次リリースの統合**。日々の機能開発のマージ先。`main` より先に進む。 |
| **`feature/<topic>`** | `develop` から分岐。1 機能・1 トピック。完了したら `develop` へマージ（PR 推奨）。 |
| **`release/<x.y.z>`** | `develop` から分岐。バージョン上げ・仕様書・最終確認。終了時に **`main` と `develop` の両方へマージ**し、`main` に **タグ `v<x.y.z>`** を付ける。 |
| **`hotfix/<topic>`** | **`main` から分岐**。本番の緊急修正。終了時に **`main` と `develop` の両方へマージ**し、必要なら `main` にパッチ版タグ。 |

## リモートをまだ追加していない場合

```bash
git remote add origin <リポジトリURL>
git push -u origin main
git push -u origin develop
git push origin --tags
```

以後、**新しい作業は `develop` をチェックアウトしてから** 始める。

## 日常の例（拡張なし）

```bash
git checkout develop
git pull origin develop
git checkout -b feature/my-change
# … コミット …
git checkout develop
git merge feature/my-change   # または GitHub で PR マージ
git branch -d feature/my-change
```

## リリースの流れ（要約）

1. `git checkout develop && git pull`
2. `git checkout -b release/1.1.0`
3. `manifest.json` / `package.json` のバージョン更新、`docs/SPEC.md` 変更履歴など
4. コミット後、`main` にマージ → タグ `v1.1.0` → `develop` にもマージ（リリースブランチの変更を取り込む）
5. `release/1.1.0` ブランチを削除

## ホットフィックスの流れ（要約）

1. `git checkout main && git pull`
2. `git checkout -b hotfix/fix-thing`
3. 修正・パッチバージョン・コミット
4. `main` にマージしてタグ（例: `v1.0.1`）→ **`develop` にもマージ**（取りこぼし防止）

## `git flow` CLI（任意）

[git-flow (AVH Edition)](https://github.com/petervanderdoes/gitflow-avh) を入れている場合:

```bash
git flow init
```

対話では **`main`** と **`develop`** を既定のまま選べばよい。初期化後も、上表の意味は変わらない。

## いまのローカル状態

- **`develop`** は `main` と同じ履歴から作成済み（分岐前は同一コミット）。
- リモートの **デフォルトブランチ**は環境に合わせてよい（OSS なら `develop` を既定にするとコントリビューションしやすい）。
