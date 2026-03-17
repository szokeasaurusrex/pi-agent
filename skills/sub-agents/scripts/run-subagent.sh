#!/usr/bin/env bash
set -euo pipefail

SESSION_DIR="${HOME}/.pi/agent/subagent-sessions"
DEFAULT_THINKING="medium"

usage() {
  cat <<'EOF'
run-subagent.sh

Launches or resumes a non-interactive pi sub-agent with a persistent session file.
The first stdout line is the session path.

Usage:
  scripts/run-subagent.sh --prompt "<prompt>" [--thinking <level>] [-- <pi-args>...]
  scripts/run-subagent.sh --resume <session-path> --prompt "<prompt>" [--thinking <level>] [-- <pi-args>...]
  scripts/run-subagent.sh -- --help
  scripts/run-subagent.sh --help

Behavior:
  - New sessions are created under ~/.pi/agent/subagent-sessions/.
  - `--resume` requires an existing session file.
  - `--prompt` is required. `--thinking` defaults to `medium`.
  - Arguments after `--` are passed to pi unchanged, except session and prompt controls managed by this script.
  - The script runs pi with `--session <path> --thinking <level> -p "<prompt>"`.
  - Recommended thinking: `high` for planning or deep research, `minimal` or `low` for mechanical work.
  - For pi CLI help, run `scripts/run-subagent.sh -- --help`.

Examples:
  scripts/run-subagent.sh --prompt "<prompt>"
  scripts/run-subagent.sh --thinking high --prompt "<prompt>"
  scripts/run-subagent.sh --resume ~/.pi/agent/subagent-sessions/example.json --prompt "<prompt>"
  scripts/run-subagent.sh --thinking low --prompt "<prompt>" -- --model sonnet
  scripts/run-subagent.sh -- --help
EOF
}

resume_mode=0
session_path=""
thinking="$DEFAULT_THINKING"
prompt=""
extra_args=()

if [[ $# -gt 0 && "$1" == "--" ]]; then
  shift
  if [[ $# -eq 1 && "$1" == "--help" ]]; then
    mkdir -p "$SESSION_DIR"
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    session_path="${SESSION_DIR}/subagent-${timestamp}-$$.json"
    : > "$session_path"
    printf '%s\n' "$session_path"
    exec pi --session "$session_path" --help
  fi
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --resume)
      resume_mode=1
      shift
      if [[ $# -eq 0 ]]; then
        echo "Missing session path after --resume" >&2
        usage >&2
        exit 1
      fi
      session_path="$1"
      shift
      ;;
    --thinking)
      shift
      if [[ $# -eq 0 ]]; then
        echo "Missing thinking level after --thinking" >&2
        usage >&2
        exit 1
      fi
      thinking="$1"
      shift
      ;;
    --prompt)
      shift
      if [[ $# -eq 0 ]]; then
        echo "Missing prompt after --prompt" >&2
        usage >&2
        exit 1
      fi
      prompt="$1"
      shift
      ;;
    --)
      shift
      extra_args=("$@")
      break
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$thinking" in
  off|minimal|low|medium|high|xhigh) ;;
  *)
    echo "Invalid thinking level: $thinking" >&2
    exit 1
    ;;
esac

if [[ -z "$prompt" ]]; then
  echo "Missing required argument: --prompt \"<prompt>\"" >&2
  usage >&2
  exit 1
fi

for arg in "${extra_args[@]}"; do
  case "$arg" in
    --session|--session-dir|--no-session|--resume|-r|--continue|-c|--thinking|-p|--print)
      echo "Unsupported extra pi argument: $arg" >&2
      exit 1
      ;;
  esac
done

mkdir -p "$SESSION_DIR"

if [[ $resume_mode -eq 1 ]]; then
  if [[ ! -f "$session_path" ]]; then
    echo "Session file not found: $session_path" >&2
    exit 1
  fi
else
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  session_path="${SESSION_DIR}/subagent-${timestamp}-$$.json"
  : > "$session_path"
fi

printf '%s\n' "$session_path"
exec pi --session "$session_path" --thinking "$thinking" -p "$prompt" "${extra_args[@]}"
