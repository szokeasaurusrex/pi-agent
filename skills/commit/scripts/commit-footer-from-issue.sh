#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <github-issue-number> [owner/repo]" >&2
  exit 1
fi

ISSUE_NUMBER="$1"
REPO="${2:-}"

if [[ -n "$REPO" && "$REPO" != */* ]]; then
  echo "Invalid repo: $REPO (expected owner/repo)" >&2
  exit 1
fi

GH_ARGS=(issue view "$ISSUE_NUMBER" --json number,url,comments)
if [[ -n "$REPO" ]]; then
  GH_ARGS+=( -R "$REPO" )
fi

ISSUE_JSON="$(gh "${GH_ARGS[@]}")"

LINEAR_LINE="$(ISSUE_JSON="$ISSUE_JSON" python3 - <<'PY' 2>/dev/null || true
import json
import os
import re
import sys

issue = json.loads(os.environ["ISSUE_JSON"])
comments = issue.get("comments") or []

patterns = [
    re.compile(r'\[(?P<id>[A-Z][A-Z0-9]+-\d+)\]\((?P<url>https://linear\.app/[^)]+)\)'),
    re.compile(r'<a href="(?P<url>https://linear\.app/[^"]+)">(?P<id>[A-Z][A-Z0-9]+-\d+)</a>'),
]

for comment in comments:
    body = comment.get("body") or ""
    for pattern in patterns:
        match = pattern.search(body)
        if match:
            lid = match.group("id")
            url = match.group("url")
            print(f"Closes [{lid}]({url})")
            sys.exit(0)

sys.exit(2)
PY
)"
echo "Closes #$ISSUE_NUMBER"

if [[ -n "$LINEAR_LINE" ]]; then
  echo "$LINEAR_LINE"
  exit 0
fi

exit 0
