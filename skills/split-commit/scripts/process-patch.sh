#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  process-patch.sh --workdir /abs/path/to/workdir --patch /abs/path/to/workdir/todo/file.patch --action apply|skip|partial
EOF
}

realpath_py() {
  python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"
}

clear_patch_metadata() {
  local base=$1
  rm -f "$workdir/review-required/$base.txt" "$workdir/conflict-details/$base.txt"
}

extract_patch_paths() {
  python3 - "$1" <<'PY'
from pathlib import Path
import re
import sys

text = Path(sys.argv[1]).read_text("utf-8", "surrogateescape")
paths = []
for line in text.splitlines():
    if line.startswith("+++ "):
        candidate = line[4:].strip()
        if candidate == "/dev/null":
            continue
        if candidate.startswith("b/"):
            candidate = candidate[2:]
        paths.append(candidate)
seen = []
for path in paths:
    if path not in seen:
        seen.append(path)
for path in seen:
    print(path)
PY
}

changed_ranges_report() {
  python3 - "$1" <<'PY'
import re
import subprocess
import sys

repo = sys.argv[1]
text = subprocess.run(
    ["git", "-C", repo, "diff", "--unified=0", "--no-color"],
    check=True,
    text=True,
    capture_output=True,
).stdout

current = None
entries = []
for line in text.splitlines():
    if line.startswith("+++ b/"):
        current = line[6:]
    elif line.startswith("@@ ") and current:
        m = re.search(r"\+(\d+)(?:,(\d+))?", line)
        if not m:
            continue
        start = int(m.group(1))
        length = int(m.group(2) or "1")
        end = start if length == 0 else start + length - 1
        entries.append(f"{current}:{start}-{end}")

if entries:
    print("\n".join(entries))
PY
}

conflict_ranges_report() {
  python3 - "$repo" "$@" <<'PY'
from pathlib import Path
import subprocess
import sys

repo = Path(sys.argv[1])
patch_paths = sys.argv[2:]

candidates = []
seen = set()
for path in patch_paths:
    if path not in seen:
        seen.add(path)
        candidates.append(path)

unmerged = subprocess.run(
    ["git", "-C", str(repo), "diff", "--name-only", "--diff-filter=U"],
    check=True,
    text=True,
    capture_output=True,
).stdout.splitlines()
for path in unmerged:
    if path and path not in seen:
        seen.add(path)
        candidates.append(path)

reports = []
for rel in candidates:
    file_path = repo / rel
    if not file_path.exists():
        continue
    lines = file_path.read_text("utf-8", "surrogateescape").splitlines()
    start = None
    ranges = []
    for idx, line in enumerate(lines, start=1):
        if line.startswith("<<<<<<< ") and start is None:
            start = idx
        elif line.startswith(">>>>>>> ") and start is not None:
            ranges.append((start, idx))
            start = None
    if ranges:
        reports.append(f"{rel}:" + ",".join(f"{a}-{b}" for a, b in ranges))
    elif rel in unmerged:
        reports.append(f"{rel}:line-ranges-unavailable")

if reports:
    print("\n".join(reports))
PY
}

workdir=
patch=
action=

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workdir)
      workdir=${2-}
      shift 2
      ;;
    --patch)
      patch=${2-}
      shift 2
      ;;
    --action)
      action=${2-}
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

if [[ -z "$workdir" || -z "$patch" || -z "$action" ]]; then
  echo "Missing required arguments." >&2
  usage >&2
  exit 1
fi

case "$action" in
  apply|skip|partial) ;;
  *)
    echo "Invalid --action: $action" >&2
    exit 1
    ;;
esac

workdir=$(cd "$workdir" && pwd)
patch=$(realpath_py "$patch")
todo_dir="$workdir/todo"

if [[ ! -d "$todo_dir" ]]; then
  echo "Missing todo directory: $todo_dir" >&2
  exit 1
fi

if [[ ! -f "$patch" ]]; then
  echo "Patch does not exist: $patch" >&2
  exit 1
fi

case "$patch" in
  "$todo_dir"/*) ;;
  *)
    echo "Patch must be under $todo_dir: $patch" >&2
    exit 1
    ;;
esac

repo_file="$workdir/repo"
if [[ ! -f "$repo_file" ]]; then
  echo "Missing repo marker: $repo_file" >&2
  exit 1
fi
repo=$(<"$repo_file")
if [[ ! -d "$repo" ]]; then
  echo "Repo does not exist: $repo" >&2
  exit 1
fi

mkdir -p "$workdir/applied" "$workdir/skipped" "$workdir/partially-applied" "$workdir/merge-conflicted" "$workdir/review-required" "$workdir/conflict-details"

patch_base=$(basename "$patch")
destination="$workdir"

case "$action" in
  apply)
    if git -C "$repo" apply "$patch"; then
      destination+="/applied/$patch_base"
      mv "$patch" "$destination"
      clear_patch_metadata "$patch_base"
      echo "Applied patch."
      echo "Moved original patch to $destination"
      exit 0
    fi

    echo "Normal apply failed. Trying 3-way merge."
    if git -C "$repo" apply --3way "$patch"; then
      ranges=$(changed_ranges_report "$repo")
      destination+="/applied/$patch_base"
      mv "$patch" "$destination"
      clear_patch_metadata "$patch_base"
      if [[ -n "$ranges" ]]; then
        printf '%s\n' "$ranges" > "$workdir/review-required/$patch_base.txt"
      fi
      echo "Normal apply failed."
      echo "3-way merge succeeded. Review the merged result before continuing."
      if [[ -n "$ranges" ]]; then
        echo "Review these changed locations:"
        while IFS= read -r line; do
          echo "  $line"
        done <<< "$ranges"
      else
        echo "Review the repository diff for the merged result."
      fi
      echo "Moved original patch to $destination"
      exit 0
    fi

    mapfile -t patch_paths < <(extract_patch_paths "$patch")
    conflict_report=$(conflict_ranges_report "${patch_paths[@]}")
    if [[ -n "$conflict_report" ]]; then
      destination+="/merge-conflicted/$patch_base"
      mv "$patch" "$destination"
      clear_patch_metadata "$patch_base"
      printf '%s\n' "$conflict_report" > "$workdir/conflict-details/$patch_base.txt"
      echo "Patch was applied in conflict-producing mode."
      echo "Manual conflict resolution is required before continuing."
      echo "Conflict locations:"
      while IFS= read -r line; do
        echo "  $line"
      done <<< "$conflict_report"
      echo "Moved original patch to $destination"
      exit 0
    fi

    echo "Normal apply failed and 3-way apply did not succeed cleanly or leave a detectable conflict state." >&2
    echo "Patch remains in $todo_dir for retry after manual investigation: $patch" >&2
    exit 1
    ;;
  skip)
    destination+="/skipped/$patch_base"
    mv "$patch" "$destination"
    clear_patch_metadata "$patch_base"
    echo "Skipped patch."
    echo "Moved original patch to $destination"
    ;;
  partial)
    destination+="/partially-applied/$patch_base"
    mv "$patch" "$destination"
    clear_patch_metadata "$patch_base"
    echo "Patch was not applied."
    echo "Moved original patch to $destination"
    echo "Manual edits are now required."
    echo "Reduce this patch to the in-scope subset only."
    echo "Do not introduce edits that are not already present in this patch."
    ;;
esac
