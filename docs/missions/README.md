# Mission Docs Operations

## Scope
- The source of truth for Mission documents is this directory: `docs/missions`.
- Obsidian edits happen through Vault symlinks that point to this directory.
- Keep all Phase mission files under Git for reviewable history.

## Naming Convention
- Use `Mission_Phase_<Letter>_<Topic>.md`.
- Keep `<Letter>` as a single uppercase phase identifier.
- Keep `<Topic>` concise, ASCII, and underscore-separated.

## Update Workflow
1. Edit or create mission files in `docs/missions` (or via linked Vault path).
2. Confirm diff scope with `git status` and `git diff`.
3. Keep mission logs in JST ISO format (`YYYY-MM-DDTHH:mm:ss+09:00`).
4. Commit with the project prefix rule when ready.

## Review Checklist
- Requirements are clear and phase-scoped.
- Implementation checklist reflects current completion.
- Implementation log has append-only timestamped entries.
- Timestamp format is JST ISO and consistent.

## Backup Retention Policy
- Migration backups matching `.bak-*` are retained for 30 days from creation.
- After 30 days, backups can be deleted when mission files are verified in Git history.
