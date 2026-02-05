#!/usr/bin/env python3
"""
Search through Effect-TS pattern files for relevant matches.

Usage:
    python search_patterns.py "error handling"
    python search_patterns.py "stream backpressure"
"""

import argparse
import re
from pathlib import Path

import yaml

PATTERNS_DIR = Path(
    "/private/tmp/claude-501/-Users-theo-repos-orchester-issue-4/"
    "fde90518-1499-4839-9319-45c527333f3b/scratchpad/EffectPatterns/"
    "content/published/patterns"
)


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Extract YAML frontmatter and body from MDX content."""
    if not content.startswith("---"):
        return {}, content

    # Find the closing ---
    end_match = re.search(r"\n---\n", content[3:])
    if not end_match:
        return {}, content

    frontmatter_end = end_match.start() + 3
    frontmatter_str = content[3:frontmatter_end]
    body = content[frontmatter_end + 5 :]  # Skip past \n---\n

    try:
        frontmatter = yaml.safe_load(frontmatter_str) or {}
    except yaml.YAMLError:
        frontmatter = {}

    return frontmatter, body


def calculate_score(query: str, frontmatter: dict, body: str) -> float:
    """Calculate relevance score for a pattern based on query match."""
    query_lower = query.lower()
    query_terms = query_lower.split()
    score = 0.0

    # Title matching (highest weight)
    title = frontmatter.get("title", "").lower()
    if query_lower in title:
        score += 10.0
    else:
        for term in query_terms:
            if term in title:
                score += 3.0

    # Tags matching (high weight)
    tags = frontmatter.get("tags", [])
    if tags:
        tags_str = " ".join(str(t) for t in tags).lower()
        if query_lower in tags_str:
            score += 8.0
        else:
            for term in query_terms:
                if term in tags_str:
                    score += 2.0

    # Summary matching (medium weight)
    summary = frontmatter.get("summary", "").lower()
    if query_lower in summary:
        score += 5.0
    else:
        for term in query_terms:
            if term in summary:
                score += 1.5

    # Body content matching (lower weight, but counts)
    body_lower = body.lower()
    if query_lower in body_lower:
        score += 3.0
    else:
        for term in query_terms:
            if term in body_lower:
                score += 0.5

    return score


def search_patterns(query: str, top_n: int = 5) -> list[dict]:
    """Search patterns and return top N matches."""
    results = []

    for mdx_file in PATTERNS_DIR.rglob("*.mdx"):
        try:
            content = mdx_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        frontmatter, body = parse_frontmatter(content)
        if not frontmatter:
            continue

        score = calculate_score(query, frontmatter, body)
        if score > 0:
            results.append(
                {
                    "title": frontmatter.get("title", "Untitled"),
                    "file_path": str(mdx_file),
                    "summary": frontmatter.get("summary", "No summary available"),
                    "skill_level": frontmatter.get("skillLevel", "unknown"),
                    "score": score,
                }
            )

    # Sort by score descending and return top N
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_n]


def main():
    parser = argparse.ArgumentParser(
        description="Search Effect-TS pattern files for relevant matches."
    )
    parser.add_argument("query", help="Search query (e.g., 'error handling')")
    parser.add_argument(
        "-n",
        "--top",
        type=int,
        default=5,
        help="Number of results to return (default: 5)",
    )

    args = parser.parse_args()

    if not PATTERNS_DIR.exists():
        print(f"Error: Patterns directory not found: {PATTERNS_DIR}")
        return 1

    results = search_patterns(args.query, args.top)

    if not results:
        print(f"No patterns found matching: {args.query}")
        return 0

    print(f"\nTop {len(results)} patterns matching '{args.query}':\n")
    print("=" * 80)

    for i, result in enumerate(results, 1):
        print(f"\n{i}. {result['title']}")
        print(f"   Skill Level: {result['skill_level']}")
        print(f"   File: {result['file_path']}")
        print(f"   Summary: {result['summary']}")
        print("-" * 80)

    return 0


if __name__ == "__main__":
    exit(main())
