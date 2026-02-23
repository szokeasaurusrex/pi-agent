#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: fetch-doc-markdown.sh <docs-url>" >&2
  exit 1
fi

input_url="$1"

# Validate URL structure and supported hosts.
if [[ ! "$input_url" =~ ^https?:// ]]; then
  echo "Error: URL must start with http:// or https://" >&2
  exit 1
fi

host="$(printf '%s' "$input_url" | awk -F/ '{print $3}')"
case "$host" in
  docs.sentry.io|develop.sentry.dev)
    ;;
  *)
    echo "Error: Unsupported host '$host'. Use docs.sentry.io or develop.sentry.dev." >&2
    exit 1
    ;;
esac

# Split into base + optional query + optional fragment.
url_no_fragment="${input_url%%#*}"
fragment=""
if [[ "$input_url" == *"#"* ]]; then
  fragment="#${input_url#*#}"
fi

url_no_query="${url_no_fragment%%\?*}"
query=""
if [[ "$url_no_fragment" == *"?"* ]]; then
  query="?${url_no_fragment#*\?}"
fi

# Remove trailing slash (except root path), then append .md
scheme_and_host="$(printf '%s' "$url_no_query" | awk -F/ '{print $1"//"$3}')"
path_part="${url_no_query#${scheme_and_host}}"

if [[ -z "$path_part" ]]; then
  path_part="/"
fi

if [[ "$path_part" != "/" ]]; then
  while [[ "$path_part" == */ ]]; do
    path_part="${path_part%/}"
  done
fi

if [[ "$path_part" == "/" ]]; then
  md_url="${scheme_and_host}/index.md"
else
  if [[ "$path_part" == *.md ]]; then
    md_url="${scheme_and_host}${path_part}"
  else
    md_url="${scheme_and_host}${path_part}.md"
  fi
fi

# Preserve query/fragment when present.
md_url+="$query$fragment"

content="$(curl --fail --silent --show-error --location \
  --header 'Accept: text/markdown, text/plain;q=0.9, */*;q=0.1' \
  "$md_url")"

fetched_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
cat <<EOF
---
source_url: "$input_url"
markdown_url: "$md_url"
host: "$host"
fetched_at_utc: "$fetched_at"
---

EOF

printf '%s\n' "$content"
