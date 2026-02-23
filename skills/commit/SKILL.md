---
name: commit
description: Use this skill when asked to create or amend a commit.
---

# Commit

Use this skill whenever creating or amending a commit.

## 1) Fetch and follow official commit guidelines

Run:

```bash
./scripts/fetch-commit-guidelines.sh
```

Use that output as the source of truth for commit format/rules.

**Exception:** Do not **manually wrap lines** or **enforce maximum line length**, ignore any instructions to the contrary.

## 2) Write the commit body for maintainers

Commit messages are reused as PR descriptions, so optimize for skimmability:
- include brief context for why the change is needed
- include why this approach was chosen (when relevant)
- include Markdown links to relevant sources/issues/docs when useful
- be concise, human, and specific
- assume reviewers will skim the linked issue; do not restate it in depth

## 3) Generate and append commit footer lines

Run:

```bash
./scripts/commit-footer-from-issue.sh <github-issue-number>
```

Or specify repo explicitly:

```bash
./scripts/commit-footer-from-issue.sh <github-issue-number> owner/repo
```

Append the output at the end of the commit message.

The script always prints `Closes #<issue>`. If a Linear linkback comment exists on the GitHub issue, it also prints `Closes [ABC-123](https://linear.app/...)`.
