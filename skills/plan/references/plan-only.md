# Plan-only mode

Use this mode when the user asks only for a plan.

## Output location

- Write the finalized plan to `docs/plans/<timestamp>-<descriptive-name>.md`.
- Generate the timestamp with `date -u +"%Y-%m-%dT%H-%M-%SZ"` and use it as the filename prefix.
- Keep the descriptive suffix specific to the requested work.
- Include the same timestamp inside the plan document near the top (for example: `Created: 2026-02-19T12-53-06Z`).

## Plan quality bar

The plan must let another agent execute the work correctly with only:
- this plan document, and
- the repository contents.

The plan must therefore be:
- implementation-ready, with concrete file/module targets,
- explicit about sequencing, constraints, and validation,
- complete enough that no hidden assumptions remain.

## Decision process

- Iterate with the user until all ambiguities are resolved.
- Ask about non-obvious paths and edge cases, not just obvious choices.
- Before finalizing, ensure there are no open questions.
- Final document must describe exactly one accepted proposal.
- You may mention rejected options briefly, but do not detail them.

## Concision

- Keep the plan as concise as possible without losing required detail.

## Keep plan files uncommitted by default

Unless the user asks otherwise, ensure plan artifacts are git-ignored via `docs/plans/.gitignore`.

Rules:
- If `docs/plans` is newly created for this task, create `docs/plans/.gitignore` containing:
  - `*`
- Otherwise, if `docs/plans/.gitignore` is missing, create it and add entries that ignore:
  - `.gitignore`
  - the specific created plan file (for example `my-plan.md`)
- If `docs/plans/.gitignore` already exists, update it as needed so the plan file is ignored.
