#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  next-patch.sh --workdir /abs/path/to/workdir
EOF
}

workdir=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --workdir)
      workdir=${2-}
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

if [[ -z "$workdir" ]]; then
  echo "Missing required --workdir." >&2
  usage >&2
  exit 1
fi

workdir=$(cd "$workdir" && pwd)
todo_dir="$workdir/todo"
if [[ ! -d "$todo_dir" ]]; then
  echo "Missing todo directory: $todo_dir" >&2
  exit 1
fi

next_patch=$(find "$todo_dir" -maxdepth 1 -type f -name '*.patch' -print | sort | head -n 1 || true)
if [[ -z "$next_patch" ]]; then
  echo "All patches are processed."
  exit 0
fi

echo "Next patch: $next_patch"
echo
echo "--- patch begin ---"
cat "$next_patch"
printf '\n--- patch end ---\n'
