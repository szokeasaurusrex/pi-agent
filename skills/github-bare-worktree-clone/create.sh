#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: $0 <repo-url> [target-base=/home/agent] [branch1,branch2,...]" >&2
  exit 1
fi

REPO_URL="$1"
TARGET_BASE="${2:-/home/agent}"
BRANCH_CSV="${3:-}"

REPO_NAME="$(basename "$REPO_URL")"
REPO_NAME="${REPO_NAME%.git}"
ROOT="$TARGET_BASE/$REPO_NAME"
BARE="$ROOT/.bare"

mkdir -p "$ROOT"

# Recover from interrupted setup with empty bare repo
if [ -d "$BARE" ]; then
  remote_refs="$(git --git-dir="$BARE" for-each-ref refs/remotes/origin --format='%(refname)' | wc -l || true)"
  local_heads="$(git --git-dir="$BARE" for-each-ref refs/heads --format='%(refname)' | wc -l || true)"
  if [ "$remote_refs" = "0" ] && [ "$local_heads" = "0" ]; then
    rm -rf "$BARE"
  fi
fi

if [ ! -d "$BARE" ]; then
  git init --bare "$BARE"
  git --git-dir="$BARE" remote add origin "$REPO_URL"
  git --git-dir="$BARE" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
fi

git config --global --add safe.directory "$BARE" >/dev/null 2>&1 || true

GIT_TERMINAL_PROMPT=0 git --git-dir="$BARE" fetch --filter=blob:none --prune origin
git --git-dir="$BARE" remote set-head origin -a >/dev/null 2>&1 || true

DEFAULT_BRANCH="$(git --git-dir="$BARE" symbolic-ref --short refs/remotes/origin/HEAD | sed 's#^origin/##')"
BRANCHES="$DEFAULT_BRANCH"
if [ -n "$BRANCH_CSV" ]; then
  BRANCHES="$BRANCH_CSV"
fi

OLD_IFS="$IFS"
IFS=','
for BRANCH in $BRANCHES; do
  BRANCH="$(echo "$BRANCH" | xargs)"
  [ -z "$BRANCH" ] && continue

  WT="$ROOT/$BRANCH"
  if [ ! -d "$WT" ]; then
    if git --git-dir="$BARE" show-ref --verify --quiet "refs/heads/$BRANCH"; then
      git --git-dir="$BARE" worktree add "$WT" "$BRANCH"
    else
      git --git-dir="$BARE" worktree add "$WT" --track -b "$BRANCH" "origin/$BRANCH"
    fi
  fi

  git config --global --add safe.directory "$WT" >/dev/null 2>&1 || true

done
IFS="$OLD_IFS"

echo "repo_root=$ROOT"
echo "bare_repo=$BARE"
echo "default_branch=$DEFAULT_BRANCH"
echo -n "origin_tracking_branches="
git --git-dir="$BARE" for-each-ref refs/remotes/origin --format='%(refname:short)' | wc -l

echo "worktrees:"
git --git-dir="$BARE" worktree list
