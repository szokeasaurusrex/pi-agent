#!/usr/bin/env python3
"""Validate and publish GitHub issues from a TOML draft file."""

from __future__ import annotations

import argparse
import re
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover
    print("Python 3.11+ is required (tomllib module not available)", file=sys.stderr)
    sys.exit(2)


TOP_LEVEL_KEYS = {"defaults", "issues"}
DEFAULT_KEYS = {"repo", "assignees", "labels", "milestone", "project", "template"}
ISSUE_KEYS = DEFAULT_KEYS | {"title", "body", "body_file"}
URL_RE = re.compile(r"https?://\S+")


class ValidationError(Exception):
    """Raised for draft validation errors."""


def _fail(path: str, message: str) -> ValidationError:
    return ValidationError(f"{path}: {message}")


def _ensure_non_empty_string(value: Any, path: str) -> str:
    if not isinstance(value, str):
        raise _fail(path, "must be a string")
    if not value.strip():
        raise _fail(path, "must be a non-empty string")
    return value


def _ensure_string(value: Any, path: str) -> str:
    if not isinstance(value, str):
        raise _fail(path, "must be a string")
    return value


def _ensure_string_list(value: Any, path: str) -> list[str]:
    if not isinstance(value, list):
        raise _fail(path, "must be an array of strings")
    result: list[str] = []
    for i, item in enumerate(value):
        if not isinstance(item, str):
            raise _fail(f"{path}[{i}]", "must be a string")
        result.append(item)
    return result


def _normalize_project(value: Any, path: str) -> list[str]:
    if isinstance(value, str):
        return [value]
    return _ensure_string_list(value, path)


def _check_unknown_keys(table: dict[str, Any], allowed: set[str], path: str) -> None:
    unknown = sorted(set(table.keys()) - allowed)
    if unknown:
        raise _fail(path, f"contains unknown keys: {', '.join(unknown)}")


def _normalize_defaults(data: Any) -> dict[str, Any]:
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise _fail("defaults", "must be a table")

    _check_unknown_keys(data, DEFAULT_KEYS, "defaults")

    normalized: dict[str, Any] = {}
    for key, value in data.items():
        field_path = f"defaults.{key}"
        if key in {"repo", "milestone", "template"}:
            normalized[key] = _ensure_non_empty_string(value, field_path)
        elif key in {"assignees", "labels"}:
            normalized[key] = _ensure_string_list(value, field_path)
        elif key == "project":
            normalized[key] = _normalize_project(value, field_path)
    return normalized


def _normalize_issue(data: Any, idx: int) -> dict[str, Any]:
    path = f"issues[{idx}]"
    if not isinstance(data, dict):
        raise _fail(path, "must be a table")

    _check_unknown_keys(data, ISSUE_KEYS, path)

    if "title" not in data:
        raise _fail(path, "missing required key: title")

    normalized: dict[str, Any] = {}
    for key, value in data.items():
        field_path = f"{path}.{key}"
        if key == "title":
            normalized[key] = _ensure_non_empty_string(value, field_path)
        elif key in {"repo", "milestone", "template", "body_file"}:
            normalized[key] = _ensure_non_empty_string(value, field_path)
        elif key == "body":
            normalized[key] = _ensure_string(value, field_path)
        elif key in {"assignees", "labels"}:
            normalized[key] = _ensure_string_list(value, field_path)
        elif key == "project":
            normalized[key] = _normalize_project(value, field_path)

    return normalized


def load_and_validate(file_path: Path, require_repo: bool) -> list[dict[str, Any]]:
    try:
        raw = tomllib.loads(file_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValidationError(f"{file_path}: file not found") from exc
    except tomllib.TOMLDecodeError as exc:
        raise ValidationError(f"{file_path}: TOML parse error: {exc}") from exc

    if not isinstance(raw, dict):
        raise ValidationError(f"{file_path}: top-level TOML value must be a table")

    _check_unknown_keys(raw, TOP_LEVEL_KEYS, str(file_path))

    defaults = _normalize_defaults(raw.get("defaults"))

    issues_raw = raw.get("issues")
    if issues_raw is None:
        raise ValidationError(f"{file_path}: missing required [[issues]] entries")
    if not isinstance(issues_raw, list) or not issues_raw:
        raise ValidationError(f"{file_path}: issues must be a non-empty array of tables")

    merged_issues: list[dict[str, Any]] = []
    for idx, item in enumerate(issues_raw):
        issue = _normalize_issue(item, idx)
        merged = dict(defaults)
        merged.update(issue)

        if "body" in merged and "body_file" in merged:
            raise ValidationError(
                f"{file_path}: issues[{idx}] has both body and body_file after defaults/issue merge"
            )

        if require_repo and "repo" not in merged:
            raise ValidationError(
                f"{file_path}: issues[{idx}] missing repo (set defaults.repo or issues[{idx}].repo)"
            )

        merged_issues.append(merged)

    return merged_issues


def _build_create_command(issue: dict[str, Any], toml_path: Path) -> list[str]:
    cmd = ["gh", "issue", "create", "--repo", issue["repo"], "--title", issue["title"]]

    if "body" in issue:
        cmd.extend(["--body", issue["body"]])
    elif "body_file" in issue:
        body_path = Path(issue["body_file"])
        if not body_path.is_absolute():
            body_path = (toml_path.parent / body_path).resolve()
        cmd.extend(["--body-file", str(body_path)])
    elif "template" not in issue:
        cmd.extend(["--body", ""])

    for assignee in issue.get("assignees", []):
        cmd.extend(["--assignee", assignee])

    for label in issue.get("labels", []):
        cmd.extend(["--label", label])

    if "milestone" in issue:
        cmd.extend(["--milestone", issue["milestone"]])

    for project in issue.get("project", []):
        cmd.extend(["--project", project])

    if "template" in issue:
        cmd.extend(["--template", issue["template"]])

    return cmd


def _extract_url(stdout: str, stderr: str) -> str | None:
    for stream in (stdout, stderr):
        match = URL_RE.search(stream)
        if match:
            return match.group(0)
    return None


def _print_validate_summary(toml_path: Path, issues: list[dict[str, Any]]) -> None:
    print(f"Validated {toml_path}: {len(issues)} issue(s)")
    for idx, issue in enumerate(issues, start=1):
        repo = issue.get("repo", "<repo required for apply>")
        print(f"{idx}. [{repo}] {issue['title']}")


def _confirm(issues: list[dict[str, Any]]) -> bool:
    print(f"About to create {len(issues)} issue(s):")
    for idx, issue in enumerate(issues, start=1):
        print(f"{idx}. {issue['title']}")
    answer = input("Continue? [y/N]: ").strip().lower()
    return answer in {"y", "yes"}


def run_apply(toml_path: Path, issues: list[dict[str, Any]]) -> int:
    if not _confirm(issues):
        print("Aborted.")
        return 1

    created = 0
    failed = 0

    for idx, issue in enumerate(issues, start=1):
        cmd = _build_create_command(issue, toml_path)
        result = subprocess.run(cmd, text=True, capture_output=True)

        if result.returncode == 0:
            url = _extract_url(result.stdout, result.stderr)
            if url:
                print(url)
                created += 1
            else:
                failed += 1
                print(f"Issue {idx} failed (unable to parse URL from gh output):")
                print(f"  title: {issue['title']}")
                print(f"  repo:  {issue['repo']}")
                print(f"  cmd:   {shlex.join(cmd)}")
                if result.stdout.strip():
                    print("  stdout:")
                    print(result.stdout.rstrip())
                if result.stderr.strip():
                    print("  stderr:")
                    print(result.stderr.rstrip())
            continue

        failed += 1
        print(f"Issue {idx} failed:")
        print(f"  title: {issue['title']}")
        print(f"  repo:  {issue['repo']}")
        print(f"  cmd:   {shlex.join(cmd)}")
        if result.stdout.strip():
            print("  stdout:")
            print(result.stdout.rstrip())
        if result.stderr.strip():
            print("  stderr:")
            print(result.stderr.rstrip())

    print(f"created {created}, failed {failed}")
    return 0 if failed == 0 else 1


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate and publish GitHub issues from a TOML file."
    )
    parser.add_argument("file", nargs="?", help="Draft TOML file")
    parser.add_argument("--dry-run", metavar="FILE", help="Validate only, do not call gh")
    parser.add_argument(
        "--validate",
        metavar="FILE",
        help="Validate only, do not call gh (alias of --dry-run)",
    )
    return parser.parse_args(argv)


def resolve_mode_and_file(args: argparse.Namespace) -> tuple[str, Path]:
    provided = [
        ("apply", args.file),
        ("dry-run", args.dry_run),
        ("validate", args.validate),
    ]
    selected = [(mode, value) for mode, value in provided if value]

    if len(selected) != 1:
        raise ValidationError(
            "provide exactly one mode: <file> for apply, or --dry-run <file>, or --validate <file>"
        )

    mode, file_value = selected[0]
    return mode, Path(file_value)


def main(argv: list[str]) -> int:
    try:
        args = parse_args(argv)
        mode, toml_path = resolve_mode_and_file(args)

        if mode in {"dry-run", "validate"}:
            issues = load_and_validate(toml_path, require_repo=False)
            _print_validate_summary(toml_path, issues)
            return 0

        issues = load_and_validate(toml_path, require_repo=True)
        return run_apply(toml_path, issues)

    except ValidationError as exc:
        print(f"Validation error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
