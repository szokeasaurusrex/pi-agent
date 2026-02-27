---
name: skill-writing
description: Use when creating or updating agent skills (`skills/<name>/SKILL.md` files).
---

# Skill Writing

## Requirements

You must fetch and follow the latest [Agent Skills specification](https://agentskills.io/specification.md) before writing or updating a skill:

```bash
curl -fsSL https://agentskills.io/specification.md
```

- Use valid frontmatter with:
  - `name` (matches the skill directory name)
  - `description` (clear usage trigger; agents only receive this info to decide whether to use the skill)
- Reference files as relative paths from skill root without dot-slash prefixes.
  - Prefer `scripts/example.sh` style paths.
- Keep file references one level deep where practical (for example `scripts/tool.sh`, `docs/example.md`).
- Keep instructions concise and action-oriented.

## Author checklist

Before finalizing a skill update:

1. Confirm frontmatter is present and valid.
2. Confirm all file/path examples are relative and do not use dot-slash prefixes.
3. Confirm usage trigger in `description` is explicit.
4. Confirm examples and commands are executable as written.
5. Confirm wording is concise and implementation-focused.
