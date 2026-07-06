---
name: delegation-plan
description: Write plans intended for a cheaper or less capable implementation model. Use when the user asks for a plan suitable for another LLM, junior engineer, intern, cheaper model, coding agent, or implementation delegate.
---

# Delegation Planning

Use this skill to write implementation plans for a capable but lower-reasoning executor.

## Goal

Write a plan that removes ambiguity without doing the implementation reasoning that the delegate can do cheaply.

Think like a senior engineer and prompt engineer:
- Specify the objective, constraints, and success criteria.
- Define clear boundaries and decision rules.
- Leave routine code navigation and implementation details to the delegate.

## Planning principles

- Do not paste full implementations unless the exact code is the requirement.
- Do not provide large code blocks that solve the task.
- Prefer descriptions of required behavior over exact replacement snippets.
- Give file/module targets, not line-by-line edits, unless the location is genuinely ambiguous.
- State what must not change.
- State how to handle known edge cases.
- Include validation commands and expected outcomes.
- Include escalation criteria: when the delegate should stop and ask.

## Required structure

Use this structure unless the user requests another format:

```markdown
# <Task title>

## Objective
<One paragraph describing the user-visible behavior to achieve.>

## Scope
- In scope: <files, modules, behavior>
- Out of scope: <explicit non-goals>

## Constraints
- <compatibility, minimality, performance, style, or API constraints>

## Implementation guidance
1. <Concrete step with target files/modules and intended behavior.>
2. <Concrete step.>
3. <Concrete step.>

## Edge cases
- <case>: <required handling>

## Tests
- <test to add/update and what it should prove>

## Validation
Run:
- `<command>`

Expected result:
- <what passing looks like>

## Stop and ask if
- <condition that requires human/senior decision>
```

## Specificity calibration

Use more detail for:
- Non-obvious invariants.
- Risky migrations.
- Security, data loss, auth, or compatibility concerns.
- Places where multiple valid implementations would conflict with user intent.

Use less detail for:
- Obvious syntax.
- Mechanical refactors.
- Test fixture boilerplate.
- Exact code the delegate can infer safely from surrounding code.

## Anti-patterns

Avoid:
- Writing exact helper functions when a behavior description is enough.
- Replacing the delegate's design work with full code.
- Hiding choices as assumptions.
- Saying "update tests" without naming the behavior each test must verify.
- Over-constraining harmless implementation details.

## Final self-check

Before finalizing, verify:
- A motivated intern could start without guessing the goal.
- The delegate still has meaningful implementation work to do.
- Every ambiguity that affects correctness has a rule or escalation path.
- The plan says how to prove the change works.
