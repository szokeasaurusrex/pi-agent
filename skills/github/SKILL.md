---
name: github
description: Use GitHub CLI (`gh`) for all GitHub interactions. Prefer built-in `gh` commands; use `gh api` only when needed.
allowed-tools: Bash
---

# GitHub CLI

Use `gh` (via Bash) for **all** GitHub operations.

Rules:
1. **Always prefer built-in commands** (`gh issue`, `gh pr`, `gh repo`, `gh search`, `gh release`, etc.).
2. **Fallback to `gh api` only if a built-in command cannot do the task**.
3. If unsure how to do something, **discover first with help text**:
   - `gh --help`
   - `gh <command> --help`
   - `gh <command> <subcommand> --help`
4. For machine-readable output, use `--json` and parse with `jq`.

When inside a git repo, `gh` usually infers the target repo. Otherwise use `-R owner/repo`.

## Common examples

```bash
# Issues (read)
gh issue list --state open -R owner/repo
gh issue view 123 --comments -R owner/repo

# Pull requests (read)
gh pr list --state open -R owner/repo
gh pr view 456 --comments -R owner/repo
gh pr diff 456 -R owner/repo
gh pr checks 456 -R owner/repo

# Repository/search
gh repo view owner/repo
gh search issues "memory leak" --repo owner/repo
gh search prs "author:octocat" --repo owner/repo

# JSON output
gh pr list -R owner/repo --json number,title,author --jq '.[] | {number,title,author:.author.login}'

# Fallback: API only when built-ins are insufficient (read endpoints)
gh api repos/owner/repo/issues
gh api --paginate repos/owner/repo/pulls
```

## Auth

```bash
gh auth status
```
