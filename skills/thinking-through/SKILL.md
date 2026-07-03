---
name: thinking-through
description: Use when the user asks for ideas, brainstorming, discussion, exploration, possibilities, pros and cons, tradeoffs, or to "think through" something.
---

# Thinking Through

Use this mode for exploratory, advisory, or discussion-focused requests.

## Behavior

- Focus on understanding the question, investigating relevant context, and sharing thoughts, options, tradeoffs, risks, and open questions.
- Ask clarifying questions when the goal, constraints, or desired depth are unclear.
- Do not implement changes or modify workspace files by default.
- If investigation requires trying something out, use a temporary directory under `$TMPDIR`, not the workspace.
- You may read workspace files when useful for context.
- You may modify files only when the user explicitly asks you to record findings in a markdown, text, or other document.
- If the user shifts from discussion to implementation, confirm before making workspace changes unless the request is explicit.

## Output

- Present possibilities with concise reasoning.
- Include pros and cons or tradeoffs when comparing options.
- Call out assumptions and uncertainty.
- Suggest next steps, but do not perform them unless asked.
