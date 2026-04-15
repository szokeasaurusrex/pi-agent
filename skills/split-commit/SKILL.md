---
name: split-commit
description: Split an existing commit or PR into smaller reviewable pieces through a one-hunk patch queue. Use when extracting part of a commit, splitting a commit into multiple commits, or splitting PR changes from one or more source commits without starting from direct source edits.
---

# Split Commit

Use this skill when the user asks to split an existing commit or PR into smaller pieces through an explicit patch queue.

## Requirements

- Start with a clean worktree and index unless the user explicitly says otherwise.
- Do not start by editing source files directly. Use the generated one-hunk patches as the extraction source of truth.
- After setup, do not enumerate `todo/` or read patch files directly. Inspect patches only through `scripts/next-patch.sh`.
- Process the queue strictly in order. Do not inspect later entries before the current patch leaves `todo/`.
- Every patch must leave `todo/` through exactly one state: `applied/`, `skipped/`, `partially-applied/`, or `merge-conflicted/`.
- For `partial`, keep the moved patch as the audit artifact, then reduce that patch to the in-scope subset only. Do not introduce edits that are not already present in the surfaced patch.
- Validate the repo state before creating final commits.

## Scripts

- `scripts/setup-split-patches.sh`
- `scripts/next-patch.sh`
- `scripts/process-patch.sh`

## Workflow

1. Create the queue from a source commit or revision range.
2. Run `scripts/next-patch.sh` to get the next patch path and full patch content.
3. Decide only for that surfaced patch: `apply`, `skip`, or `partial`.
4. Run `scripts/process-patch.sh` for that action.
5. If the action is `partial`, perform the scoped manual edit immediately and keep only the in-scope subset from that patch.
6. If a patch reaches `merge-conflicted/`, resolve the reported conflicts before continuing.
7. Repeat until `scripts/next-patch.sh` prints `All patches are processed.`.

## Example loop

```bash
scripts/setup-split-patches.sh --source 4a95362 --repo /abs/path/to/repo
scripts/next-patch.sh --workdir /tmp/split-commit.ABC123

scripts/process-patch.sh \
  --workdir /tmp/split-commit.ABC123 \
  --patch /tmp/split-commit.ABC123/todo/003-file.patch \
  --action apply

scripts/next-patch.sh --workdir /tmp/split-commit.ABC123

scripts/process-patch.sh \
  --workdir /tmp/split-commit.ABC123 \
  --patch /tmp/split-commit.ABC123/todo/004-file.patch \
  --action partial
# then reduce that surfaced patch to the in-scope subset only

scripts/next-patch.sh --workdir /tmp/split-commit.ABC123
```

## Notes

- `scripts/setup-split-patches.sh` supports `--source <commit-ish>` and also accepts explicit revision ranges.
- `scripts/next-patch.sh` is the only queue inspection entry point and is also the completion check.
- `scripts/process-patch.sh --action apply` tries normal apply first, then falls back to `git apply --3way`.
