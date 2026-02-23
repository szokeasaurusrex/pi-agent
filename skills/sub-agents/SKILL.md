---
name: sub-agents
description: Use multiple pi sub-agents for delegation, isolation, and parallel work. Use when tasks can be split and later merged.
---

# Sub-Agents

Spawn additional `pi` processes from the parent agent as needed.

## Possibilities

- Single delegation for a focused subtask
- Parallel delegation for independent subtasks
- Role-based agents (researcher, implementer, reviewer)
- Pipeline orchestration (research → implement → verify)
- Fan-out/fan-in (split work, collect outputs, synthesize)
- Model/tool specialization per sub-agent
- Prompt/session isolation to reduce cross-contamination
- Reliability controls (timeouts, retries, explicit output formats)
- Advanced steering/cancellation via RPC mode

## Common invocations

- One-shot: `pi -p ...`
- Ephemeral: `pi --no-session ...`
- Programmatic control: `pi --mode rpc`

## CLI docs

- Run `pi --help` for CLI flags and modes
- See RPC protocol docs: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/docs/rpc.md`
