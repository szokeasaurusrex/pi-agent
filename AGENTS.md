# Environment

- Running in a Docker sandbox.
- `~` is persisted and synced to host across sessions.
- `git` and `gh` use a read-only token (public repos only).
- On bind-mounted paths, Git may report "dubious ownership". Be aware this can happen; only add repos/worktrees to global safe.directory if that error occurs.
- Do not attempt `git push` or PR creation; ask the user to run such commands on host with a full-access token.

# Style Preferences

- In link-capable formats (MD/MDX/HTML), prefer inline prose links (`[text](url)`); avoid bare URLs and link-only lists/sections.
- For agent rules/prompts, use minimal wording that preserves intent.
- Keep responses concise; include all necessary details, no extra verbosity.

# Running Skills

- When running an agent skill, any scripts mentioned in the SKILL.md file are relative to that SKILL.md file. When running the script, use the absolute path to the script.
- Avoid reading any agent skill's scripts. Just run the script. Only read the script if you need to understand how it works, for example, to debug an unexpected error.
