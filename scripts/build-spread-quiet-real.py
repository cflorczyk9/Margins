#!/usr/bin/env python3
"""Generate a real-data version of files-library-index-spread-quiet.html
populated from Connor's actual wiki/ vault.

Picks the N most-recently-modified .md files, extracts frontmatter +
[[wikilinks]] + first paragraph + word count, then injects them into
the Quiet template's FILES array.

Run from repo root: python3 margins/scripts/build-spread-quiet-real.py
"""
from __future__ import annotations
import json
import os
import re
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WIKI = REPO / "wiki"
TEMPLATE = REPO / "margins" / "design-demos" / "files-library-index-spread-quiet.html"
OUT = REPO / "margins" / "design-demos" / "files-library-index-spread-quiet-real.html"

# How many files to include per bucket — the demo selects the most-recently
# modified N from each bucket so every section has real content even when
# (for instance) the ideas/ folder dominates recency overall.
PER_BUCKET_LIMIT = 8
ABSOLUTE_LIMIT = 60

# Map real top-level folders → the 6 demo buckets.
BUCKET_FOR_FOLDER = {
    "entities":  "entities",
    "career":    "career",
    "concepts":  "concepts",
    "sources":   "sources",
    "synthesis": "synthesis",
    "queries":   "synthesis",
    "ideas":     "concepts",
    "projects":  "concepts",
    "daily":     "sources",
    "sessions":  "sources",
    "outbound":  "sources",
    "personal":  "entities",
    "health":    "entities",
    "finance":   "entities",
    "coding":    "concepts",
    "activities": "sources",
    "entertainment": "concepts",
    "bucket-list": "concepts",
}

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n?", re.DOTALL)
WIKILINK_RE = re.compile(r"\[\[([^\]]+?)\]\]")
TAG_FRONTMATTER_LINE_RE = re.compile(r"^tags?\s*:\s*(.*)$", re.MULTILINE)


def parse_frontmatter(text: str) -> tuple[dict, str]:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    fm_raw = m.group(1)
    body = text[m.end():]
    fm: dict[str, object] = {}
    current_key = None
    for line in fm_raw.splitlines():
        if not line.strip():
            continue
        if line.startswith(("  - ", "- ")) and current_key:
            fm.setdefault(current_key, []).append(line.strip().lstrip("- ").strip().strip('"\''))
            continue
        if ":" in line:
            k, _, v = line.partition(":")
            k = k.strip()
            v = v.strip()
            current_key = k
            if not v:
                fm[k] = []
            elif v.startswith("[") and v.endswith("]"):
                inner = v[1:-1]
                fm[k] = [s.strip().strip('"\'') for s in inner.split(",") if s.strip()]
            else:
                fm[k] = v.strip('"\'')
    return fm, body


def title_from(path: Path, body: str, fm: dict) -> str:
    if "title" in fm and isinstance(fm["title"], str) and fm["title"]:
        return fm["title"]
    # First H1
    for line in body.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    # Prettify filename
    stem = path.stem.replace("-", " ").replace("_", " ")
    return stem[:1].upper() + stem[1:]


def excerpt_from(body: str, max_chars: int = 380) -> str:
    # Strip [[ ]] decorations but keep readable label
    text = WIKILINK_RE.sub(lambda m: m.group(1).split("|")[-1], body)
    # Strip HTML / leading markdown headings
    paragraphs = []
    for chunk in re.split(r"\n\s*\n", text):
        chunk = chunk.strip()
        if not chunk:
            continue
        if chunk.startswith("#"):
            continue
        if chunk.startswith("|") or chunk.startswith("---"):
            continue
        # Drop bullet list items collapsing to one line
        chunk = re.sub(r"^[\-*]\s+", "", chunk, flags=re.MULTILINE)
        chunk = re.sub(r"\s+", " ", chunk)
        if len(chunk) < 20:
            continue
        paragraphs.append(chunk)
        if sum(len(p) for p in paragraphs) > max_chars * 2:
            break
    joined = " ".join(paragraphs)
    if not joined:
        return "No body content yet."
    return joined[:max_chars].rstrip() + ("…" if len(joined) > max_chars else "")


def extended_from(body: str, after_chars: int = 380, max_chars: int = 400) -> str:
    text = WIKILINK_RE.sub(lambda m: m.group(1).split("|")[-1], body)
    text = re.sub(r"^#+\s.*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= after_chars:
        return ""
    rest = text[after_chars:after_chars + max_chars].strip()
    if not rest:
        return ""
    return rest + ("…" if len(text) > after_chars + max_chars else "")


def count_words(body: str) -> int:
    text = WIKILINK_RE.sub(lambda m: m.group(1).split("|")[-1], body)
    text = re.sub(r"[#*_`>\-]+", " ", text)
    return len([w for w in text.split() if w.strip()])


def tags_from(fm: dict) -> list[str]:
    raw = fm.get("tags") or fm.get("tag") or []
    if isinstance(raw, str):
        raw = [raw]
    return [t for t in raw if isinstance(t, str) and t.strip()][:6]


def relative_age(mtime: float, now: float) -> str:
    delta = now - mtime
    if delta < 60:
        return "now"
    if delta < 3600:
        return f"{int(delta // 60)}m"
    if delta < 86400:
        return f"{int(delta // 3600)}h"
    if delta < 86400 * 30:
        return f"{int(delta // 86400)}d"
    if delta < 86400 * 365:
        return f"{int(delta // (86400 * 30))}mo"
    return f"{int(delta // (86400 * 365))}y"


def bucket_for(rel_path: Path) -> str:
    # rel_path is relative to the repo root, e.g. wiki/daily/2026-05-11.md.
    # parts[0] is always "wiki"; parts[1] is the bucket folder we map.
    parts = rel_path.parts
    if len(parts) <= 2:
        return "meta"
    folder = parts[1]
    return BUCKET_FOR_FOLDER.get(folder, "meta")


def wikilink_targets(body: str, all_paths: set[str]) -> list[dict]:
    seen = []
    seen_set = set()
    for m in WIKILINK_RE.finditer(body):
        raw = m.group(1).split("|")[0].strip()
        if not raw or raw in seen_set:
            continue
        seen_set.add(raw)
        # Try to resolve to a real path
        candidate_paths = [
            f"wiki/{raw}.md",
            f"wiki/{raw}",
            f"wiki/entities/{raw}.md",
            f"wiki/career/{raw}.md",
            f"wiki/concepts/{raw}.md",
            f"wiki/sources/{raw}.md",
            f"wiki/synthesis/{raw}.md",
            f"wiki/projects/{raw}.md",
        ]
        target = next((p for p in candidate_paths if p in all_paths), None)
        label = raw.replace("-", " ").replace("_", " ")
        label = label[:1].upper() + label[1:]
        seen.append({"label": label, "target": target})
        if len(seen) >= 6:
            break
    return seen


def main() -> None:
    if not WIKI.exists():
        sys.exit(f"vault not found: {WIKI}")
    if not TEMPLATE.exists():
        sys.exit(f"template not found: {TEMPLATE}")

    now = time.time()

    md_files = []
    for path in WIKI.rglob("*.md"):
        rel = path.relative_to(REPO)
        # Skip templates, hidden, queries can stay
        if "/_templates" in str(rel) or "/.margins" in str(rel):
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        md_files.append((path, rel, stat.st_mtime))

    md_files.sort(key=lambda t: t[2], reverse=True)

    # Bin files by their target demo bucket, then take the most recent
    # PER_BUCKET_LIMIT from each. This guarantees every bucket section in
    # the Quiet design has content rather than 4 of 6 sitting empty.
    by_bucket: dict[str, list] = {}
    for path, rel, mtime in md_files:
        by_bucket.setdefault(bucket_for(rel), []).append((path, rel, mtime))
    selected = []
    for bucket_key in ("entities", "concepts", "sources", "synthesis", "career", "meta"):
        selected.extend(by_bucket.get(bucket_key, [])[:PER_BUCKET_LIMIT])
    # Sort the final pick by recency so the Index column still reads
    # newest-first within each bucket — bucket grouping happens at render.
    selected.sort(key=lambda t: t[2], reverse=True)
    selected = selected[:ABSOLUTE_LIMIT]

    all_paths_set = {str(rel).replace("\\", "/") for _, rel, _ in md_files}

    files_data = []
    for path, rel, mtime in selected:
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        fm, body = parse_frontmatter(text)
        title = title_from(path, body, fm)
        bucket = bucket_for(rel)
        words = count_words(body)
        tags = tags_from(fm)
        excerpt = excerpt_from(body)
        extended = extended_from(body)
        connections = wikilink_targets(body, all_paths_set)
        age = relative_age(mtime, now)
        last_edited = time.strftime("%Y-%m-%d %H:%M", time.localtime(mtime))
        files_data.append({
            "bucket": bucket,
            "path": str(rel).replace("\\", "/"),
            "title": title,
            "age": age,
            "words": words,
            "lastEdited": last_edited,
            "tags": tags,
            "connections": connections,
            "excerpt": excerpt,
            "extended": extended,
        })

    template_text = TEMPLATE.read_text(encoding="utf-8")

    # Find the existing FILES array block and replace it.
    start_marker = "    const FILES = ["
    start_idx = template_text.find(start_marker)
    if start_idx == -1:
        sys.exit("FILES = [ marker not found in template")

    # Find the matching closing bracket for the array. Scan brackets.
    i = start_idx + len(start_marker)
    depth = 1
    while i < len(template_text) and depth > 0:
        ch = template_text[i]
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
        i += 1
    if depth != 0:
        sys.exit("could not find closing ] for FILES array")
    end_idx = i  # index AFTER the closing ]

    # Encode as a pretty JS literal (JSON is valid JS for arrays of objects).
    files_js = json.dumps(files_data, indent=2, ensure_ascii=False)
    # Reindent so it nests cleanly inside the script block
    files_js = "\n".join(
        ("    " + line if line.strip() else line) for line in files_js.splitlines()
    )
    new_block = "    const FILES = " + files_js.lstrip()

    out_text = template_text[:start_idx] + new_block + template_text[end_idx:]

    # Update the pull-quote header to reflect real totals.
    total_words = sum(f["words"] for f in files_data)
    total_files = len(files_data)
    last_age = files_data[0]["age"] if files_data else "—"
    pull_re = re.compile(r"(\d+[,\d]*) files\s*·\s*([\d,]+) words\s*·\s*last touched\s*[\w]+")
    out_text, n = pull_re.subn(
        f"{total_files} files · {total_words:,} words · last touched {last_age}",
        out_text,
    )
    # Also patch a less-formatted variant just in case.
    out_text = re.sub(
        r"14 files\.\s*22,400 words\.\s*Last touched 2h ago\.",
        f"{total_files} files. {total_words:,} words. Last touched {last_age} ago.",
        out_text,
    )

    OUT.write_text(out_text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(REPO)} — {total_files} files, {total_words:,} words")


if __name__ == "__main__":
    main()
