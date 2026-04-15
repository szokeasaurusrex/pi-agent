#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  setup-split-patches.sh --source <commit-ish-or-range> [--repo /abs/path] [--workdir /abs/path] [--name label]
EOF
}

source_ref=
repo=
workdir=
name=

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      source_ref=${2-}
      shift 2
      ;;
    --repo)
      repo=${2-}
      shift 2
      ;;
    --workdir)
      workdir=${2-}
      shift 2
      ;;
    --name)
      name=${2-}
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$source_ref" ]]; then
  echo "Missing required --source." >&2
  usage >&2
  exit 1
fi

if [[ -z "$repo" ]]; then
  repo=$(git rev-parse --show-toplevel)
fi
repo=$(cd "$repo" && pwd)

if [[ ! -d "$repo/.git" ]] && ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
  echo "Not a git repository: $repo" >&2
  exit 1
fi

if [[ -z "$workdir" ]]; then
  prefix="split-commit"
  if [[ -n "$name" ]]; then
    safe_name=$(printf '%s' "$name" | tr -cs '[:alnum:]._- ' '_' | tr ' ' '_' | sed 's/^_\+//; s/_\+$//')
    if [[ -n "$safe_name" ]]; then
      prefix+=".$safe_name"
    fi
  fi
  workdir=$(mktemp -d "${TMPDIR:-/tmp}/${prefix}.XXXXXX")
else
  mkdir -p "$workdir"
  workdir=$(cd "$workdir" && pwd)
  if find "$workdir" -mindepth 1 -maxdepth 1 | read -r _; then
    echo "Workdir must be empty or omitted: $workdir" >&2
    exit 1
  fi
fi

mkdir -p "$workdir/todo" "$workdir/applied" "$workdir/skipped" "$workdir/partially-applied"
printf '%s\n' "$repo" > "$workdir/repo"
source_patch="$workdir/source.patch"

if [[ "$source_ref" == *..* ]]; then
  git -C "$repo" diff --binary --no-ext-diff --no-color "$source_ref" > "$source_patch"
else
  if ! git -C "$repo" rev-parse --verify --quiet "${source_ref}^{commit}" >/dev/null; then
    echo "Source is not a valid commit-ish or revision range: $source_ref" >&2
    exit 1
  fi
  git -C "$repo" show --format= --binary --no-ext-diff --no-color "$source_ref" > "$source_patch"
fi

python3 - "$source_patch" "$workdir/todo" <<'PY'
import os
import re
import sys
from pathlib import Path

source_patch = Path(sys.argv[1])
todo_dir = Path(sys.argv[2])
text = source_patch.read_bytes().decode("utf-8", "surrogateescape")
lines = text.splitlines(keepends=True)

file_blocks = []
current = None
for line in lines:
    if line.startswith("diff --git "):
        if current is not None:
            file_blocks.append(current)
        current = [line]
    elif current is not None:
        current.append(line)
if current is not None:
    file_blocks.append(current)

patches = []
for block in file_blocks:
    first_hunk = None
    for i, line in enumerate(block):
        if line.startswith("@@ "):
            first_hunk = i
            break
    if first_hunk is None:
        continue

    header = block[:first_hunk]
    path = None
    for line in header:
        if line.startswith("+++ "):
            candidate = line[4:].strip()
            if candidate != "/dev/null":
                path = candidate[2:] if candidate.startswith("b/") else candidate
                break
    if path is None:
        m = re.match(r"diff --git a/(.+?) b/(.+)\n?$", block[0])
        if m:
            path = m.group(2)
        else:
            path = "unknown"

    hunk_start = first_hunk
    while hunk_start < len(block):
        hunk_end = hunk_start + 1
        while hunk_end < len(block) and not block[hunk_end].startswith("@@ "):
            hunk_end += 1
        hunk = block[hunk_start:hunk_end]
        patches.append((path, header + hunk))
        hunk_start = hunk_end

width = max(3, len(str(len(patches) or 0)))
for index, (path, patch_lines) in enumerate(patches, start=1):
    sanitized = re.sub(r"/", "_", path)
    sanitized = re.sub(r"[^A-Za-z0-9._-]", "_", sanitized)
    sanitized = re.sub(r"_+", "_", sanitized).strip("_") or "unknown"
    filename = f"{index:0{width}d}-{sanitized}.patch"
    (todo_dir / filename).write_bytes("".join(patch_lines).encode("utf-8", "surrogateescape"))

PY

queued_hunks=$(find "$workdir/todo" -type f -name '*.patch' | wc -l | tr -d ' ')

echo "Created split queue in $workdir"
echo "Source patch: $source_patch"
echo "Queued hunks: $queued_hunks"
