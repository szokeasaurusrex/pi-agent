---
name: github-bare-worktree-clone
description: Create a GitHub repo as repo/.bare with repo/<branch> worktrees and origin-tracking branches. Use when users ask for bare+worktree layout.
---

Run:

```bash
create.sh <repo-url> [target-base=/home/agent] [branch1,branch2,...]
```

Examples:

```bash
create.sh https://github.com/getsentry/sentry-docs.git
create.sh https://github.com/getsentry/sentry.git /home/agent main,release/24.8.0
```

What it guarantees:
- `<repo>/.bare` exists and tracks all `origin/*` branches
- default branch worktree (or requested branches) at `<repo>/<branch>`
- local branches track `origin/<branch>`
- safe.directory entries added for `.bare` and worktrees
