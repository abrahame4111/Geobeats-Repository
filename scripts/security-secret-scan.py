#!/usr/bin/env python3
"""Small redacted secret scanner for CI.

The scanner reports file names, line numbers, and rule names only. It never
prints the matching value, which keeps CI logs safe if a secret is detected.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

RULES: list[tuple[str, re.Pattern[str]]] = [
    ("google_api_key", re.compile(r"AIza[0-9A-Za-z_-]{20,}")),
    ("mongodb_uri", re.compile(r"mongodb(?:\+srv)?://[^\s\"'<>]+", re.I)),
    ("spotify_secret_assignment", re.compile(r"SPOTIFY_CLIENT_SECRET\s*[:=]\s*['\"]?[^'\"\s]{12,}", re.I)),
    ("generic_client_secret", re.compile(r"client_secret\s*[:=]\s*['\"]?[A-Za-z0-9_./+=-]{16,}", re.I)),
    ("github_token", re.compile(r"(?:ghp_|github_pat_)[A-Za-z0-9_]+")),
    ("openai_key", re.compile(r"sk-[A-Za-z0-9_-]{20,}")),
    ("slack_token", re.compile(r"xox[baprs]-[A-Za-z0-9-]+")),
    ("private_key", re.compile(r"BEGIN (?:RSA |EC |OPENSSH |PRIVATE )?KEY")),
]

IGNORED_PATH_PARTS = {
    ".git",
    "node_modules",
    ".expo",
    ".venv",
    "__pycache__",
    "dist",
    "web-build",
    "MusicNavigatorFinal",
}

SAFE_TEXT_MARKERS = (
    "your_",
    "placeholder",
    "example",
    "127.0.0.1",
    "localhost",
    "YOUR-SERVICE",
)

SAFE_PATH_SUFFIXES = (
    ".env.example",
)


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
        check=True,
        stdout=subprocess.PIPE,
    )
    return [ROOT / p.decode() for p in result.stdout.split(b"\0") if p]


def is_ignored_path(path: Path) -> bool:
    rel_parts = set(path.relative_to(ROOT).parts)
    return bool(rel_parts & IGNORED_PATH_PARTS)


def is_safe_context(path: Path, line: str) -> bool:
    rel = path.relative_to(ROOT).as_posix()
    lower = line.lower()
    if any(rel.endswith(suffix) for suffix in SAFE_PATH_SUFFIXES):
        return True
    return any(marker.lower() in lower for marker in SAFE_TEXT_MARKERS)


def scan_file(path: Path) -> list[tuple[str, int]]:
    if is_ignored_path(path):
        return []
    try:
        raw = path.read_bytes()
    except OSError:
        return []
    if b"\0" in raw:
        return []

    text = raw.decode("utf-8", errors="ignore")
    findings: list[tuple[str, int]] = []
    for line_no, line in enumerate(text.splitlines(), 1):
        if is_safe_context(path, line):
            continue
        for name, pattern in RULES:
            if pattern.search(line):
                findings.append((name, line_no))
    return findings


def main() -> int:
    findings: list[tuple[str, str, int]] = []
    for path in tracked_files():
        for rule, line_no in scan_file(path):
            findings.append((rule, path.relative_to(ROOT).as_posix(), line_no))

    if findings:
        print("Potential secrets detected. Values are redacted; inspect these locations locally:")
        for rule, path, line_no in findings:
            print(f"- {rule}: {path}:{line_no}")
        return 1

    print("No secret-looking values found in tracked files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
