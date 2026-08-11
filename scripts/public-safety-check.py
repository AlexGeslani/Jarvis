#!/usr/bin/env python3
"""Fail closed on disclosure risks in the Git publication candidate.

Output is deliberately bounded to aggregate counts and safe root-relative paths.
Matched values and source lines are never emitted.
"""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from collections import Counter, defaultdict

MAX_FILE_BYTES = 5 * 1024 * 1024
BINARY_TEXT_SUFFIXES = {
    ".gif", ".ico", ".jpeg", ".jpg", ".png", ".ttf", ".webp", ".woff", ".woff2",
}
PLACEHOLDER_MARKERS = ("changeme", "example", "fixture", "opaque", "placeholder", "test")
SECRET_KEY_MARKERS = ("API_KEY", "PASSWORD", "PRIVATE_KEY", "SECRET", "TOKEN")

HOST_SUFFIX = "(?:" + "|".join(("lan", "local", r"home\.arpa")) + ")"
PRIVATE_HOST_RE = re.compile(
    rf"(?i)(?<![a-z0-9_.-])[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.{HOST_SUFFIX}\b"
)
IPV4_RE = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
USER_PATH_RE = re.compile(
    r"(?:/" + "Users" + r"/[A-Za-z0-9._-]+/|/" + "home" + r"/[A-Za-z0-9._-]+/|[A-Za-z]:\\" + "Users" + r"\\[A-Za-z0-9._-]+\\)"
)
PRIVATE_KEY_MARKER = "-----BEGIN " + "PRIVATE KEY-----"
PRIVATE_KEY_RE = re.compile(re.escape(PRIVATE_KEY_MARKER))
CREDENTIAL_URL_RE = re.compile(r"(?i)https?://[^/\s:@]+:[^/\s@]+@")
KNOWN_TOKEN_RES = (
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{16,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
)
ENV_ASSIGNMENT_RE = re.compile(
    r"(?m)^[ \t]*(?:export[ \t]+)?([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*([^\r\n#]*)"
)


def private_ipv4(value: str) -> bool:
    try:
        parts = tuple(int(part) for part in value.split("."))
    except ValueError:
        return False
    if len(parts) != 4 or any(part < 0 or part > 255 for part in parts):
        return False
    return (
        parts[0] == 10
        or (parts[0] == 172 and 16 <= parts[1] <= 31)
        or (parts[0] == 192 and parts[1] == 168)
    )


def placeholder_value(value: str) -> bool:
    normalized = value.strip().strip("'\"").strip().lower()
    if not normalized:
        return True
    if normalized.startswith("${") or (normalized.startswith("<") and normalized.endswith(">")):
        return True
    return any(marker in normalized for marker in PLACEHOLDER_MARKERS)


def path_categories(path: PurePosixPath) -> Counter[str]:
    categories: Counter[str] = Counter()
    lower_parts = tuple(part.lower() for part in path.parts)
    name = path.name.lower()
    if name.endswith("-qr.png"):
        categories["qr_artifact"] += 1
    if path.suffix.lower() == ".zab" or ("dist" in lower_parts and path.suffix.lower() == ".zab"):
        categories["build_artifact"] += 1
    if any(part.endswith(".egg-info") for part in lower_parts):
        categories["package_metadata"] += 1
    if (
        "recordings" in lower_parts
        or "audio-captures" in lower_parts
        or ("captures" in lower_parts and "audio" in lower_parts)
    ):
        categories["audio_capture"] += 1
    if "transcripts" in lower_parts:
        categories["transcript_artifact"] += 1
    if "sessions" in lower_parts:
        categories["session_artifact"] += 1
    if "logs" in lower_parts or path.suffix.lower() == ".log":
        categories["log_artifact"] += 1
    return categories


def content_categories(text: str) -> Counter[str]:
    categories: Counter[str] = Counter()
    categories["private_hostname"] += len(PRIVATE_HOST_RE.findall(text))
    categories["private_address"] += sum(private_ipv4(value) for value in IPV4_RE.findall(text))
    categories["user_absolute_path"] += len(USER_PATH_RE.findall(text))
    categories["private_key"] += len(PRIVATE_KEY_RE.findall(text))
    categories["credential_url"] += len(CREDENTIAL_URL_RE.findall(text))
    categories["token_pattern"] += sum(len(pattern.findall(text)) for pattern in KNOWN_TOKEN_RES)
    for key, value in ENV_ASSIGNMENT_RE.findall(text):
        if key.endswith(("_MARKER", "_MARKERS", "_RE", "_RES")):
            continue
        if any(marker in key for marker in SECRET_KEY_MARKERS) and not placeholder_value(value):
            categories["populated_secret"] += 1
    return +categories


def safe_path_label(path: str) -> str:
    if any(ord(char) < 32 for char in path) or content_categories(path):
        identifier = hashlib.sha256(path.encode("utf-8", "surrogateescape")).hexdigest()[:12]
        return f"path_id={identifier}"
    return f"path={path}"


def candidate_paths(root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=root,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("candidate_inventory_failed")
    return sorted(
        path.decode("utf-8", "surrogateescape")
        for path in result.stdout.split(b"\0")
        if path
    )


def scan(root: Path) -> tuple[int, Counter[str], dict[str, Counter[str]]]:
    totals: Counter[str] = Counter()
    findings: dict[str, Counter[str]] = defaultdict(Counter)
    scanned = 0
    for relative in candidate_paths(root):
        path = root / relative
        if not path.exists():
            continue
        scanned += 1
        relative_path = PurePosixPath(relative)
        categories = path_categories(relative_path)
        if path.is_symlink():
            categories["symlink"] += 1
        elif path.is_dir():
            categories["special_entry"] += 1
        else:
            size = path.stat().st_size
            if size > MAX_FILE_BYTES:
                categories["oversize_file"] += 1
            elif not categories:
                data = path.read_bytes()
                if path.suffix.lower() in BINARY_TEXT_SUFFIXES or b"\0" in data:
                    text = data.decode("latin-1")
                else:
                    try:
                        text = data.decode("utf-8")
                    except UnicodeDecodeError:
                        categories["invalid_encoding"] += 1
                        text = data.decode("latin-1")
                categories.update(content_categories(text))
        if categories:
            findings[relative].update(categories)
            totals.update(categories)
    return scanned, totals, findings


def repository_root(value: str) -> Path:
    root = Path(value).expanduser().resolve()
    if not root.is_dir() or root.is_symlink():
        raise RuntimeError("invalid_root")
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=root,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
    )
    if result.returncode != 0 or Path(result.stdout.strip()).resolve() != root:
        raise RuntimeError("root_must_be_git_toplevel")
    return root


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan the Git publication candidate safely")
    parser.add_argument("--root", default=".", help="Git repository root")
    args = parser.parse_args()
    try:
        root = repository_root(args.root)
        scanned, totals, findings = scan(root)
    except (OSError, RuntimeError, subprocess.SubprocessError):
        print("public_safety=failed category=scanner_error findings=1")
        return 2

    finding_count = sum(totals.values())
    if not finding_count:
        print(f"public_safety=passed files_scanned={scanned} findings=0")
        return 0

    print(f"public_safety=failed files_scanned={scanned} findings={finding_count}")
    for category, count in sorted(totals.items()):
        print(f"category={category} count={count}")
    for path, categories in sorted(findings.items()):
        detail = ",".join(f"{category}:{count}" for category, count in sorted(categories.items()))
        print(f"{safe_path_label(path)} categories={detail} count={sum(categories.values())}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
