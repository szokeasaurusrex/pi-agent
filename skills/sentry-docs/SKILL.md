---
name: sentry-docs
description: Use whenever fetching documentation from docs.sentry.io or develop.sentry.dev.
---

# Sentry Docs

Use `scripts/fetch-doc-markdown.sh <docs-url>` to fetch docs content from `docs.sentry.io` or `develop.sentry.dev`.

The script converts the URL to its `.md` endpoint, fetches it via `curl`, and writes to stdout.

```bash
scripts/fetch-doc-markdown.sh https://docs.sentry.io/platforms/react-native/
scripts/fetch-doc-markdown.sh https://develop.sentry.dev/sdk/overview/
```

Output format:
1. YAML frontmatter with:
   - `source_url`
   - `markdown_url`
   - `host`
   - `fetched_at_utc`
2. The fetched markdown body.

If fetching fails, report the error and request a valid URL on one of the supported hosts.
