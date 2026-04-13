# Plan-only mode

Use this mode when the user asks only for a plan.

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

## Output location

1. Run `scripts/init_plan.py --title "<plan title>"`.
2. Write the plan to the returned path.

The script creates `docs/plans/<timestamp>-<descriptive-name>.md`, ensures the plan path is not tracked by default, and prints the plan path.
