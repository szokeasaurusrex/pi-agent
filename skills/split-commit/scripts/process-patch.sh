#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  process-patch.sh --workdir /abs/path/to/workdir --patch /abs/path/to/workdir/todo/file.patch --action apply|skip|partial
EOF
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
patch=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$patch")
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

destination="$workdir"
message=
case "$action" in
  apply)
    git -C "$repo" apply "$patch"
    destination+="/applied/$(basename "$patch")"
    mv "$patch" "$destination"
    echo "Applied patch."
    echo "Moved original patch to $destination"
    ;;
  skip)
    destination+="/skipped/$(basename "$patch")"
    mv "$patch" "$destination"
    echo "Skipped patch."
    echo "Moved original patch to $destination"
    ;;
  partial)
    destination+="/partially-applied/$(basename "$patch")"
    mv "$patch" "$destination"
    echo "Patch was not applied."
    echo "Moved original patch to $destination"
    echo "Manual edits are now required."
    echo "Keep those edits strictly limited to content from this patch."
    ;;
esac
