---
name: github-issues-draft
description: Use when asked to create or draft GitHub issues. Do not use when asked only to "plan" issues.
---

# GitHub issues draft

Use this skill when the user wants issue drafts prepared for review before publishing.

## Workflow

1. Gather issue intent and target repository context from the user.
2. Generate the timestamp with `date -u +"%Y-%m-%dT%H-%M-%SZ"` and write draft TOML to `docs/issues/<timestamp>.toml` using `[[issues]]` entries.
3. Maintain `docs/issues/.gitignore`:
   - if `docs/issues` is newly created in this task: create `docs/issues/.gitignore` containing `*`
   - else if `docs/issues/.gitignore` is missing: create it and add an entry to ignore the generated draft filename
   - else update it so the generated draft filename is ignored
4. Validate draft TOML before finishing (path resolved relative to this `SKILL.md`):
   - `python3 scripts/publish_issues.py --validate <draft-path>`
5. Return the draft path, a compact summary for user review, and a copy-pasteable publish command that uses the absolute script path (for example: `python3 /absolute/path/to/skills/github-issues-draft/scripts/publish_issues.py <draft-path>`).

## Writing guidance

- `title` is required and should be concise.
- `body` is Markdown, should be concise while still including enough detail to act on, and should be written as a TOML multiline string (`"""..."""`).
- Prefer one paragraph, at most two in most cases.
- When relevant, include Markdown links to supporting resources/docs and source code; for source code links, use permalinks.
- For longer issues, separate concepts with `###` headings.
- Prefer paragraph form; use lists only when they improve clarity.

## TOML schema

Top-level keys:
- `[defaults]` (optional; use only when creating multiple issues)
- `[[issues]]` (required, non-empty)

`[defaults]` allowed keys:
- `repo` (string)
- `assignees` (array of strings)
- `labels` (array of strings)
- `milestone` (string)
- `project` (string or array of strings)
- `template` (string)

`[[issues]]` allowed keys:
- all default keys above, plus
- `title` (required, non-empty string)
- `body` (string)
- `body_file` (string)

Rules:
- Unknown keys are rejected.
- `body` and `body_file` are mutually exclusive after defaults+issue merge.
- Issue values override defaults.
- Use `[defaults]` only when drafting multiple issues; when used, prefer it for shared/common fields.
- For publish/apply mode, each merged issue must resolve `repo`.

## Host script

Script path (relative to this `SKILL.md`):
- `scripts/publish_issues.py`

Modes:
- Validate only: `python3 scripts/publish_issues.py --validate <file>` (alias: `--dry-run`)
- Publish: `python3 scripts/publish_issues.py <file>`

Publish behavior:
- one confirmation per invocation (shows issue count + titles)
- create in exact TOML order
- continue after failures
- per-success output: created issue URL only
- on failure: print clear failure block with command context and captured `gh` output
- final summary: `created X, failed Y`
