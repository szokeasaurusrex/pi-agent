---
name: cargo
description: Use when initializing Rust projects or modifying Cargo.toml, Cargo.lock, cargo config, or other cargo-related files. Prefer this skill for dependency changes, features, package metadata, workspaces, and cargo commands. Do not load it for editing Rust source code generally.
---

# Cargo

Prefer `cargo` commands over manual edits to `Cargo.toml`, `Cargo.lock`, and other cargo-related files.

## Workflow

1. Use `cargo` for project setup and manifest changes whenever possible.
2. If you need an operation not listed here, inspect `cargo help` or the relevant subcommand help, for example `cargo help add` or `cargo help init`.
3. Edit cargo-related files manually only after you fail to find a `cargo` command that achieves the needed outcome.

## Examples

Initialize a new project:

```bash
cargo init
cargo init --lib
cargo new my-crate
cargo new my-crate --lib
```

Add dependencies:

```bash
cargo add serde
cargo add tokio --dev
cargo add anyhow --build
```

Enable dependency features:

```bash
cargo add serde --features derive
cargo add tokio --features rt-multi-thread,macros
cargo add reqwest --no-default-features --features json,rustls-tls
```

Remove a dependency:

```bash
cargo remove serde
```
