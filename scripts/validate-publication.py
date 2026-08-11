#!/usr/bin/env python3
"""Validate public documentation, local assets, XML, and OpenAPI."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from pathlib import Path, PurePosixPath
import re
import struct
import subprocess
import sys
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

import yaml
from openapi_spec_validator import validate

MARKDOWN_LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
IMAGE_SUFFIXES = {".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"}
MAX_ASSET_BYTES = 5 * 1024 * 1024


def candidates(root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=root,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("candidate_inventory")
    return sorted(
        item.decode("utf-8", "surrogateescape")
        for item in result.stdout.split(b"\0")
        if item and (root / item.decode("utf-8", "surrogateescape")).exists()
    )


def local_target(raw: str) -> str | None:
    target = raw.strip()
    if target.startswith("<") and ">" in target:
        target = target[1 : target.index(">")]
    elif " " in target:
        target = target.split(" ", 1)[0]
    parsed = urlsplit(target)
    if parsed.scheme or parsed.netloc or target.startswith("#"):
        return None
    return unquote(parsed.path)


def within(root: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(root)
    except ValueError:
        return False
    return True


def validate_png(path: Path) -> None:
    data = path.read_bytes()
    if len(data) < 24 or not data.startswith(PNG_SIGNATURE):
        raise ValueError("png_signature")
    width, height = struct.unpack(">II", data[16:24])
    if not (0 < width <= 10_000 and 0 < height <= 10_000):
        raise ValueError("png_dimensions")


def validate_svg(path: Path) -> None:
    root = ET.parse(path).getroot()
    if root.tag.rsplit("}", 1)[-1] != "svg":
        raise ValueError("svg_root")
    if not root.get("viewBox") and not (root.get("width") and root.get("height")):
        raise ValueError("svg_dimensions")


def validate_image(path: Path) -> None:
    if path.stat().st_size > MAX_ASSET_BYTES:
        raise ValueError("image_size")
    suffix = path.suffix.lower()
    if suffix == ".png":
        validate_png(path)
    elif suffix == ".svg":
        validate_svg(path)
    elif suffix in {".jpg", ".jpeg"}:
        data = path.read_bytes()
        if not (data.startswith(b"\xff\xd8") and data.endswith(b"\xff\xd9")):
            raise ValueError("jpeg_signature")
    elif suffix == ".gif":
        if not path.read_bytes().startswith((b"GIF87a", b"GIF89a")):
            raise ValueError("gif_signature")
    elif suffix == ".webp":
        data = path.read_bytes()[:12]
        if len(data) < 12 or data[:4] != b"RIFF" or data[8:] != b"WEBP":
            raise ValueError("webp_signature")
    else:
        raise ValueError("image_type")


def validate_openapi(path: Path) -> None:
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("openapi_document")
    if document.get("openapi") != "3.1.0":
        raise ValueError("openapi_version")
    info = document.get("info")
    if not isinstance(info, dict) or str(info.get("version")) != "0.1.8":
        raise ValueError("release_version")
    validate(document)


def root_from(value: str) -> Path:
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
        raise RuntimeError("git_root")
    return root


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate public release documentation and assets")
    parser.add_argument("--root", default=".")
    args = parser.parse_args()
    failures: dict[str, Counter[str]] = defaultdict(Counter)
    markdown_count = local_link_count = image_count = xml_count = openapi_count = 0
    try:
        root = root_from(args.root)
        paths = candidates(root)
        for relative in paths:
            path = root / relative
            suffix = path.suffix.lower()
            if suffix == ".md":
                markdown_count += 1
                text = path.read_text(encoding="utf-8")
                for match in MARKDOWN_LINK_RE.finditer(text):
                    target = local_target(match.group(1))
                    if target is None:
                        continue
                    local_link_count += 1
                    resolved = path.parent / target
                    if not target or not within(root, resolved) or not resolved.is_file():
                        failures[relative]["local_link"] += 1
                        continue
                    if resolved.suffix.lower() in IMAGE_SUFFIXES:
                        image_count += 1
                        try:
                            validate_image(resolved)
                        except (OSError, ValueError, ET.ParseError):
                            failures[relative]["image_asset"] += 1
            if suffix in {".svg", ".xml"}:
                xml_count += 1
                try:
                    if suffix == ".svg":
                        validate_svg(path)
                    else:
                        ET.parse(path)
                except (OSError, ValueError, ET.ParseError):
                    failures[relative]["xml"] += 1
            if PurePosixPath(relative).name == "openapi.yaml":
                openapi_count += 1
                try:
                    validate_openapi(path)
                except Exception:
                    failures[relative]["openapi"] += 1
        if openapi_count != 1:
            failures["docs/openapi.yaml"]["openapi_count"] += 1
    except (OSError, RuntimeError, UnicodeError):
        print("publication_validation=failed category=validator_error findings=1")
        return 2

    finding_count = sum(sum(categories.values()) for categories in failures.values())
    if finding_count:
        print(f"publication_validation=failed findings={finding_count}")
        totals: Counter[str] = Counter()
        for categories in failures.values():
            totals.update(categories)
        for category, count in sorted(totals.items()):
            print(f"category={category} count={count}")
        for path, categories in sorted(failures.items()):
            detail = ",".join(f"{category}:{count}" for category, count in sorted(categories.items()))
            print(f"path={path} categories={detail}")
        return 1

    print(
        "publication_validation=passed "
        f"markdown_files={markdown_count} local_links={local_link_count} images={image_count} "
        f"xml_files={xml_count} openapi_documents={openapi_count}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
