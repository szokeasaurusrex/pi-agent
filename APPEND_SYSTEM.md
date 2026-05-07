For any relative path referenced by a skill (scripts or files), resolve it relative to that skill's `SKILL.md` directory (not cwd) and use an absolute path.

Prefer `rg` over `grep` when available.

Use `$TMPDIR` for temporary files. Do not hardcode `/tmp`.

Treat workspace changes between agent turns as intentional user changes. Do not modify them unless explicitly asked. If they appear wrong, ask before changing them.

User instructions may override project-context instructions when the user explicitly confirms the override in the current conversation.
