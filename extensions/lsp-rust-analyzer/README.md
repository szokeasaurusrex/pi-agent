# lsp-rust-analyzer

Rust semantic navigation and diagnostics for Pi through [`rust-analyzer`](https://github.com/rust-lang/rust-analyzer).

## Tools

- `lsp_find_symbol`
- `lsp_document_symbols`
- `lsp_hover`
- `lsp_definition`
- `lsp_references`
- `lsp_diagnostics`

## Requirements

- A Rust workspace detected from `Cargo.toml` or `rust-project.json`
- A usable existing `rust-analyzer` binary

The extension does not install `rust-analyzer`. Preflight fails explicitly when the binary is missing or unusable.

## Coordinates

All position-taking tools use 1-based `line` and `character` values.

## Path behavior

- `lsp_find_symbol`, `lsp_hover`, `lsp_definition`, and `lsp_references` accept either a Rust file path or a directory path.
- A file path narrows lookup to one file.
- A directory path narrows lookup to a subtree.
- Line and character disambiguation only work with file-scoped lookup.
- `lsp_document_symbols` and `lsp_diagnostics(path=...)` require a file path.

## Activation

- The tools are active only when a Rust project is detected from `Cargo.toml` or `rust-project.json` and `rust-analyzer` passes preflight.
- Otherwise the extension keeps the tools out of the active tool set.

## Notes

- v1 is Rust-only.
- v1 does not implement completion, rename, code actions, or semantic tokens.
- The extension is intended for auto-discovery from `~/.pi/agent/extensions/lsp-rust-analyzer/`.
