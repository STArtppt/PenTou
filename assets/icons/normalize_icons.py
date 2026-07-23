#!/usr/bin/env python3
"""
Normalize AI brand SVG icons for UI use.

Input:
  SVG files placed directly in assets/icons.

Output:
  assets/icons/normalized/<name>.svg

The generated SVGs use a 200x200 canvas and a single solid color fill
(white by default). Source files are left untouched so they remain useful for
review, replacement, and re-processing.
"""

from __future__ import annotations

import argparse
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


SIZE = 200
DEFAULT_PADDING = 16
DEFAULT_COLOR = "#FFFFFF"
SCRIPT_NAME = Path(__file__).name
OUTPUT_DIR_NAME = "normalized"
REVIEW_FILENAME = "AI_BRAND_ICONS_REVIEW.md"
LANDED_SECTION_HEADING = "## 当前已落地文件"
CANONICAL_FILENAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*\.svg$")
FILENAME_ALIASES = {
    "Kimi.svg": "kimi.svg",
    "zhipuai.svg": "zhipu-ai.svg",
    "讯飞星火-01.svg": "iflytek-spark.svg",
}
BRAND_TABLE_FILES = {
    "Kimi / Moonshot": ("kimi.svg", "已补真矢量 SVG"),
    "Cohere": ("cohere.svg", "已补真矢量 SVG"),
    "Zhipu AI / GLM / 智谱清言": ("zhipu-ai.svg", "已补真矢量 SVG"),
    "iFLYTEK Spark / 讯飞星火": ("iflytek-spark.svg", "已补真矢量 SVG"),
    "Metaso / 秘塔AI搜索": ("metaso.svg", "已补真矢量 SVG"),
}
RASTER_PATTERNS = (
    "<image",
    "data:image",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    "base64,",
)
DROP_TAGS = {"title", "desc", "metadata", "script", "style", "foreignObject"}
SHAPE_TAGS = {
    "path",
    "circle",
    "ellipse",
    "line",
    "polygon",
    "polyline",
    "rect",
    "text",
    "tspan",
}
PRESENTATION_ATTRS = {
    "fill",
    "stroke",
    "color",
    "style",
    "class",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
}


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def parse_number(value: str | None) -> float | None:
    if not value:
        return None
    match = re.match(r"^\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)", value)
    return float(match.group(1)) if match else None


def parse_viewbox(root: ET.Element) -> tuple[float, float, float, float]:
    raw = root.attrib.get("viewBox") or root.attrib.get("viewbox")
    if raw:
        parts = [float(p) for p in re.split(r"[\s,]+", raw.strip()) if p]
        if len(parts) == 4 and parts[2] > 0 and parts[3] > 0:
            return parts[0], parts[1], parts[2], parts[3]

    width = parse_number(root.attrib.get("width"))
    height = parse_number(root.attrib.get("height"))
    if width and height and width > 0 and height > 0:
        return 0.0, 0.0, width, height

    return 0.0, 0.0, 24.0, 24.0


def has_raster_payload(text: str) -> bool:
    lower = text.lower()
    return any(pattern in lower for pattern in RASTER_PATTERNS)


def clean_element(element: ET.Element, color: str) -> ET.Element | None:
    tag = local_name(element.tag)
    if tag in DROP_TAGS:
        return None

    cleaned = ET.Element(tag)

    fill_was_none = element.attrib.get("fill", "").strip().lower() == "none"
    stroke_was_none = element.attrib.get("stroke", "").strip().lower() == "none"

    for key, value in element.attrib.items():
        attr = local_name(key)
        if attr in PRESENTATION_ATTRS:
            continue
        if attr.startswith("on"):
            continue
        cleaned.set(attr, value)

    if tag in SHAPE_TAGS:
        if fill_was_none:
            cleaned.set("fill", "none")
        else:
            cleaned.set("fill", color)

        if "stroke" in element.attrib:
            cleaned.set("stroke", "none" if stroke_was_none else color)
    elif tag == "g":
        cleaned.set("fill", color)
        cleaned.set("color", color)

    if element.text and element.text.strip() and tag in {"text", "tspan"}:
        cleaned.text = element.text

    for child in list(element):
        cleaned_child = clean_element(child, color)
        if cleaned_child is not None:
            cleaned.append(cleaned_child)

    return cleaned


def normalize_svg(source: Path, dest: Path, color: str, padding: int) -> None:
    text = source.read_text(encoding="utf-8")
    if has_raster_payload(text):
        raise ValueError("contains embedded raster data; replace with a true vector SVG first")

    root = ET.fromstring(text)
    if local_name(root.tag) != "svg":
        raise ValueError("root element is not <svg>")

    min_x, min_y, width, height = parse_viewbox(root)
    usable = SIZE - padding * 2
    scale = usable / max(width, height)
    tx = (SIZE - width * scale) / 2 - min_x * scale
    ty = (SIZE - height * scale) / 2 - min_y * scale

    out_root = ET.Element(
        "svg",
        {
            "xmlns": "http://www.w3.org/2000/svg",
            "role": "img",
            "viewBox": f"0 0 {SIZE} {SIZE}",
            "width": str(SIZE),
            "height": str(SIZE),
        },
    )
    title = ET.SubElement(out_root, "title")
    title.text = source.stem

    group = ET.SubElement(
        out_root,
        "g",
        {
            "fill": color,
            "color": color,
            "transform": f"translate({tx:.6g} {ty:.6g}) scale({scale:.6g})",
        },
    )

    for child in list(root):
        cleaned = clean_element(child, color)
        if cleaned is not None:
            group.append(cleaned)

    # Some simple SVGs put drawing attributes directly on the root.
    if not list(group):
        root_copy = clean_element(root, color)
        if root_copy is not None:
            for child in list(root_copy):
                group.append(child)

    dest.parent.mkdir(parents=True, exist_ok=True)
    ET.indent(out_root, space="  ")
    tree = ET.ElementTree(out_root)
    tree.write(dest, encoding="utf-8", xml_declaration=False)
    dest.write_text(dest.read_text(encoding="utf-8") + "\n", encoding="utf-8")


def icon_sources(base_dir: Path) -> list[Path]:
    return sorted(
        path
        for path in base_dir.glob("*.svg")
        if path.is_file() and path.parent.name != OUTPUT_DIR_NAME
    )


def canonicalize_icon_filenames(base_dir: Path, check: bool) -> tuple[int, set[str], list[str]]:
    renamed = 0
    renamed_targets: set[str] = set()
    failures: list[str] = []
    normalized_dir = base_dir / OUTPUT_DIR_NAME

    for source in sorted(base_dir.glob("*.svg")):
        target_name = FILENAME_ALIASES.get(source.name, source.name)
        if not CANONICAL_FILENAME_RE.match(target_name):
            failures.append(
                f"{source.name}: filename must be lowercase English slug, e.g. {source.stem.lower()}-brand.svg"
            )
            continue

        if target_name == source.name:
            continue

        target = base_dir / target_name
        old_normalized = normalized_dir / source.name
        new_normalized = normalized_dir / target_name

        case_only_rename = source.name.lower() == target_name.lower()
        if target.exists() and not case_only_rename:
            failures.append(f"{source.name}: cannot rename to {target_name}; target already exists")
            continue
        normalized_case_only_rename = old_normalized.name.lower() == new_normalized.name.lower()
        if old_normalized.exists() and new_normalized.exists() and not normalized_case_only_rename:
            failures.append(f"{old_normalized.name}: cannot rename normalized file; target already exists")
            continue

        if check:
            print(f"would rename {source.name} -> {target_name}")
            if old_normalized.exists():
                print(f"would rename {OUTPUT_DIR_NAME}/{old_normalized.name} -> {OUTPUT_DIR_NAME}/{new_normalized.name}")
        else:
            if case_only_rename:
                temp = base_dir / f".{target_name}.rename-tmp"
                source.rename(temp)
                temp.rename(target)
            else:
                source.rename(target)
            print(f"renamed {source.name} -> {target_name}")
            if old_normalized.exists():
                if normalized_case_only_rename:
                    temp = normalized_dir / f".{target_name}.rename-tmp"
                    old_normalized.rename(temp)
                    temp.rename(new_normalized)
                else:
                    old_normalized.rename(new_normalized)
                print(f"renamed {OUTPUT_DIR_NAME}/{old_normalized.name} -> {OUTPUT_DIR_NAME}/{new_normalized.name}")
        renamed += 1
        renamed_targets.add(target_name)

    return renamed, renamed_targets, failures


def render_landed_files_section(sources: list[Path]) -> str:
    lines = [LANDED_SECTION_HEADING, ""]
    lines.extend(f"- `{source.name}`" for source in sources)
    return "\n".join(lines)


def update_brand_table_rows(text: str, sources: list[Path]) -> str:
    available = {source.name for source in sources}
    rows_by_brand = {
        brand: f"| {brand} | `{filename}` | 已下载 | {remark} |"
        for brand, (filename, remark) in BRAND_TABLE_FILES.items()
        if filename in available
    }

    if not rows_by_brand:
        return text

    updated_lines: list[str] = []
    for line in text.splitlines():
        replacement = None
        for brand, row in rows_by_brand.items():
            if line.startswith(f"| {brand} |"):
                replacement = row
                break
        updated_lines.append(replacement or line)

    return "\n".join(updated_lines) + ("\n" if text.endswith("\n") else "")


def update_review_doc(base_dir: Path, sources: list[Path], check: bool) -> bool:
    review_path = base_dir / REVIEW_FILENAME
    if not review_path.exists():
        print(f"review doc missing; skip {REVIEW_FILENAME}", file=sys.stderr)
        return False

    text = review_path.read_text(encoding="utf-8")
    text = update_brand_table_rows(text, sources)
    start = text.find(LANDED_SECTION_HEADING)
    if start == -1:
        print(f"review doc missing section: {LANDED_SECTION_HEADING}", file=sys.stderr)
        return False

    next_heading = text.find("\n## ", start + len(LANDED_SECTION_HEADING))
    replacement = render_landed_files_section(sources)

    if next_heading == -1:
        next_text = text[:start].rstrip() + "\n\n" + replacement + "\n"
    else:
        next_text = text[:start].rstrip() + "\n\n" + replacement + "\n" + text[next_heading:]

    if next_text == text:
        return False

    if check:
        print(f"would update {REVIEW_FILENAME} ({LANDED_SECTION_HEADING})")
        return True

    review_path.write_text(next_text, encoding="utf-8")
    print(f"updated {REVIEW_FILENAME} ({LANDED_SECTION_HEADING})")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize SVG icons to 200x200 single-color assets.")
    parser.add_argument("--color", default=DEFAULT_COLOR, help="Output fill color, default: #FFFFFF")
    parser.add_argument("--padding", type=int, default=DEFAULT_PADDING, help="Canvas padding in px, default: 16")
    parser.add_argument("--force", action="store_true", help="Regenerate all icons, even when output is newer")
    parser.add_argument("--check", action="store_true", help="Only report files that would be generated")
    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parent
    out_dir = base_dir / OUTPUT_DIR_NAME
    failures: list[str] = []
    generated = 0
    skipped = 0
    renamed, renamed_targets, rename_failures = canonicalize_icon_filenames(base_dir, args.check)
    failures.extend(rename_failures)
    sources = icon_sources(base_dir)

    for source in sources:
        dest = out_dir / source.name
        up_to_date = (
            source.name not in renamed_targets
            and dest.exists()
            and dest.stat().st_mtime >= source.stat().st_mtime
        )
        if up_to_date and not args.force:
            skipped += 1
            continue

        if args.check:
            print(f"would normalize {source.name} -> {OUTPUT_DIR_NAME}/{source.name}")
            generated += 1
            continue

        try:
            normalize_svg(source, dest, args.color, args.padding)
            print(f"normalized {source.name} -> {OUTPUT_DIR_NAME}/{source.name}")
            generated += 1
        except Exception as exc:  # noqa: BLE001 - CLI should continue through all files.
            failures.append(f"{source.name}: {exc}")

    review_updated = update_review_doc(base_dir, sources, args.check)

    if failures:
        print("\nSkipped files that need manual attention:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)

    print(
        f"\nDone. renamed={renamed} generated={generated} skipped={skipped} "
        f"failed={len(failures)} review_updated={int(review_updated)}"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
