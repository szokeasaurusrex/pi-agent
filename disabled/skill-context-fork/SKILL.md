---
name: context-fork
description: Checkpoint, inspect, and return through session tree branches. Use when exploring uncertain approaches, investigating code, or when the user asks for a forked agent.
---

# Context Fork

Tools: `ctx_checkpoint`, `ctx_inspect`, `ctx_return`

## When to Checkpoint

Set a checkpoint before:
- Exploring uncertain approaches or implementation strategies.
- Reading files that might be large or irrelevant.
- Running long commands that might produce verbose errors.
- Investigations that load substantial context (reading multiple files, running diagnostic commands, exploring unfamiliar code).

## Investigations

Checkpoints are ideal for investigation tasks. Load files, run commands, build deep understanding — all of which consumes context. Checkpoint before the investigation, return with a distilled summary afterward. The agent gets the conclusions without the context cost. This is the primary mechanism for keeping context lean during complex tasks.

## Writing Good Summaries

The summary is the **only** information that survives navigation. Include:
- What was attempted and what was learned.
- File paths modified or relevant.
- Key decisions made.
- Concrete answers to the question that motivated the fork.

Exclude:
- Verbose command output.
- Full file contents.
- Stack traces (summarize the error instead).

## Forked Agent Pattern

When the user asks for a "forked agent" (or "fork off and do X", "investigate X in a fork"):
1. Checkpoint the current position immediately.
2. Perform the requested work (the agent is now "in the fork").
3. Return to the checkpoint with a summary of the results.

The user does not need to say "checkpoint first" — "forked agent" or "fork" implies the full checkpoint → work → return cycle.

## Workflow Patterns

**Investigate-and-return**: Checkpoint → read files, run commands, build understanding → return with distilled findings. Keeps investigation artifacts out of main context.

**Explore-and-return**: Checkpoint → try an approach → return with what was learned.

**Discard irrelevant context**: Checkpoint → read a file / run a command → realize it's not useful → return with a one-line note ("File X was irrelevant, contains only Y").

**Sequential exploration**: Checkpoint → try approach A → return → try approach B → return → decide.

## Anti-patterns

- Don't checkpoint every turn (overhead, clutters the tree).
- Don't write empty or vague summaries.
- Don't forget to return — always close your forks.

## ctx_inspect Usage

Use when you need to find a specific point to return to (e.g., "before I read that file"). Default count of 5 is usually enough; increase for long explorations.
