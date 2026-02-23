# Plan-and-implement mode

Use this mode when the user asks to both plan and execute in one run.

## Flow

1. Provide a concise implementation plan directly in the assistant message.
2. Immediately execute the plan.
3. Report progress and outcomes.

Do not create a plan document by default in this mode.

## Approval-gated variant

If the user explicitly asks for plan first and implementation only after approval:
- provide the plan,
- pause,
- wait for explicit approval,
- then implement.

## Plan expectations

Even when planning inline, the plan should be specific enough to guide implementation:
- concrete files/components to change,
- ordered steps,
- validation approach.

Keep it concise.