# lsp-rust-analyzer

Rust semantic navigation and diagnostics for Pi through [`rust-analyzer`](https://github.com/rust-lang/rust-analyzer).

## Scope

This extension adds these model-facing tools:

- `lsp_workspace_symbols`
- `lsp_document_symbols`
- `lsp_hover`
- `lsp_definition`
- `lsp_references`
- `lsp_diagnostics`

It also refreshes Rust diagnostics after successful `edit`, `write`, and `bash` turns and injects compact diagnostic summaries back into the session.

## Requirements

- A Rust workspace detected from `Cargo.toml` or `rust-project.json`
- A usable existing `rust-analyzer` binary

The extension does not install `rust-analyzer`. Preflight fails explicitly when the binary is missing or unusable.

## Coordinates

All position-taking tools use:

- `line`: 1-based
- `character`: 1-based

Inputs are clamped to file bounds and converted to LSP UTF-16 positions internally.

## Notes

- v1 is Rust-only.
- v1 does not implement completion, rename, code actions, or semantic tokens.
- The extension is intended for auto-discovery from `~/.pi/agent/extensions/lsp-rust-analyzer/`.
