---
name: sub-agents
description: Use multiple pi sub-agents for delegation, isolation, and parallel work. Use when tasks can be split and later merged.
---

# Sub-Agents

Use sub-agents for focused delegation, parallel work, role separation, prompt isolation, and staged pipelines.

## Uses

- Single delegation for a focused subtask
- Parallel delegation for independent subtasks
- Role-based agents (researcher, implementer, reviewer)
- Pipeline orchestration (research → implement → verify)
- Fan-out/fan-in (split work, collect outputs, synthesize)
- Model/tool specialization per sub-agent
- Prompt/session isolation to reduce cross-contamination
- Reliability controls (timeouts, retries, explicit output formats)
- Advanced steering/cancellation via RPC mode

## Launch

- Use `scripts/run-subagent.sh`.
- Use non-interactive mode only.
- Pass `--prompt "<prompt>"` on every launch and resume.
- Record and report the session path.
- Inspect wrapper behavior with `scripts/run-subagent.sh --help`.
- Inspect pi CLI help with `scripts/run-subagent.sh -- --help`.

## Prompt

- Make the prompt specific. State the exact task, scope, inputs, constraints, expected output, and stopping condition.
- Avoid broad prompts such as `look into this` or `help with this`.

## Thinking

- The script defaults to `medium`. This thinking level is suitable for most tasks.
- Set `--thinking minimal` or `--thinking low` for mechanical edits, straightforward execution, or format conversion, as less thinking is faster.

## Recovery

- If a sub-agent fails or times out, continue the session. You may also decide on a different approach.

## Invocation

- Launch: `scripts/run-subagent.sh --prompt "<prompt>"`
- Launch with explicit thinking: `scripts/run-subagent.sh --thinking minimal --prompt "<prompt>"`
- Resume: `scripts/run-subagent.sh --resume ~/.pi/agent/subagent-sessions/<file>.json --prompt "<prompt>"`
- Extra pi args: `scripts/run-subagent.sh --prompt "<prompt>" -- --model sonnet`
- Pi help: `scripts/run-subagent.sh -- --help`
