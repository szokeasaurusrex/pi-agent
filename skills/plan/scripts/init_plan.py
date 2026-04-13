#!/usr/bin/env python3

import argparse
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class PlanInitResult:
    path: Path
    timestamp: str


def slugify(value: str) -> str:
    slug = value.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    if not slug:
        raise SystemExit("error: title must contain at least one ASCII letter or digit for the filename slug")
    return slug


def ensure_gitignore(plans_dir: Path, plan_filename: str, plans_dir_preexisted: bool) -> None:
    gitignore_path = plans_dir / ".gitignore"

    if not plans_dir_preexisted:
        gitignore_path.write_text("*\n", encoding="utf-8")
        return

    if not gitignore_path.exists():
        gitignore_path.write_text(f".gitignore\n{plan_filename}\n", encoding="utf-8")
        return

    existing = gitignore_path.read_text(encoding="utf-8")
    lines = existing.splitlines()
    if "*" in lines or plan_filename in lines:
        return

    updated = existing
    if updated and not updated.endswith("\n"):
        updated += "\n"
    updated += f"{plan_filename}\n"
    gitignore_path.write_text(updated, encoding="utf-8")


def init_plan(repo_root: Path, title: str) -> PlanInitResult:
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    slug = slugify(title)
    plans_dir = repo_root / "docs" / "plans"
    plans_dir_preexisted = plans_dir.exists()
    plans_dir.mkdir(parents=True, exist_ok=True)

    plan_filename = f"{timestamp}-{slug}.md"
    ensure_gitignore(plans_dir, plan_filename, plans_dir_preexisted)

    plan_path = plans_dir / plan_filename
    plan_path.write_text("", encoding="utf-8")
    return PlanInitResult(path=plan_path, timestamp=timestamp)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Create an empty plan file at docs/plans/<timestamp>-<slug>.md and maintain "
            "docs/plans/.gitignore according to the plan skill rules."
        )
    )
    parser.add_argument(
        "--title",
        required=True,
        help="Plan title. Used only for the slugified filename suffix.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path.cwd().resolve()
    result = init_plan(repo_root, args.title)
    print(result.path.relative_to(repo_root))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
