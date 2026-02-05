#!/usr/bin/env python3
"""
Search through Effect-TS pattern reference files for relevant matches.

Usage:
    python search_patterns.py "error handling"
    python search_patterns.py "stream backpressure" -n 10
    python search_patterns.py "catchTag" --verbose
"""

import argparse
import sys
from pathlib import Path

# Exit codes
EXIT_SUCCESS = 0
EXIT_FAILURE = 1

# Default to references directory relative to this script
DEFAULT_REFERENCES_DIR = Path(__file__).parent.parent / "references"


def calculate_score(query: str, content: str, filename: str) -> float:
    """Calculate relevance score based on query match in content and filename."""
    query_lower = query.lower()
    query_terms = query_lower.split()
    content_lower = content.lower()
    filename_lower = filename.lower()

    score = 0.0

    # Filename matching (highest weight - indicates topic relevance)
    if query_lower in filename_lower:
        score += 10.0
    else:
        for term in query_terms:
            if term in filename_lower:
                score += 4.0

    # Exact phrase match in content (high weight)
    if query_lower in content_lower:
        score += 8.0

    # Individual term matches in content
    for term in query_terms:
        # Count occurrences, cap at 10 to avoid over-weighting
        occurrences = min(content_lower.count(term), 10)
        score += occurrences * 0.5

    # Header matching (look for terms in ## headers)
    for line in content.split("\n"):
        if line.startswith("##"):
            header_lower = line.lower()
            if query_lower in header_lower:
                score += 5.0
            else:
                for term in query_terms:
                    if term in header_lower:
                        score += 2.0

    return score


def extract_relevant_section(content: str, query: str, context_lines: int = 5) -> str:
    """Extract the most relevant section containing the query."""
    query_lower = query.lower()
    lines = content.split("\n")

    # Find the line with the best match
    best_idx = -1
    for i, line in enumerate(lines):
        if query_lower in line.lower():
            best_idx = i
            break

    if best_idx == -1:
        # No exact match, find first term match
        for term in query_lower.split():
            for i, line in enumerate(lines):
                if term in line.lower():
                    best_idx = i
                    break
            if best_idx != -1:
                break

    if best_idx == -1:
        return ""

    # Extract context around the match
    start = max(0, best_idx - context_lines)
    end = min(len(lines), best_idx + context_lines + 1)

    return "\n".join(lines[start:end])


def search_references(
    query: str,
    references_dir: Path,
    top_n: int = 5,
    verbose: bool = False
) -> list[dict]:
    """Search reference files and return top N matches."""
    if top_n < 1:
        raise ValueError(f"top_n must be positive, got {top_n}")

    if not references_dir.exists():
        raise FileNotFoundError(f"References directory not found: {references_dir}")

    results = []
    files_processed = 0
    files_skipped = 0

    for md_file in references_dir.glob("*.md"):
        try:
            content = md_file.read_text(encoding="utf-8")
            files_processed += 1
        except OSError as e:
            if verbose:
                print(f"Warning: Could not read {md_file}: {e}", file=sys.stderr)
            files_skipped += 1
            continue
        except UnicodeDecodeError as e:
            if verbose:
                print(f"Warning: Encoding error in {md_file}: {e}", file=sys.stderr)
            files_skipped += 1
            continue

        score = calculate_score(query, content, md_file.stem)

        if score > 0:
            # Extract first header as title
            title = md_file.stem.replace("-", " ").title()
            for line in content.split("\n"):
                if line.startswith("# "):
                    title = line[2:].strip()
                    break

            # Get relevant snippet
            snippet = extract_relevant_section(content, query)

            results.append({
                "title": title,
                "file": md_file.name,
                "path": str(md_file),
                "score": score,
                "snippet": snippet[:300] + "..." if len(snippet) > 300 else snippet,
            })

    if verbose:
        print(f"Processed {files_processed} files", file=sys.stderr)
        if files_skipped > 0:
            print(f"Skipped {files_skipped} files due to errors", file=sys.stderr)

    # Sort by score descending
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_n]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Search Effect-TS pattern reference files."
    )
    parser.add_argument(
        "query",
        help="Search query (e.g., 'error handling', 'catchTag')"
    )
    parser.add_argument(
        "-n", "--top",
        type=int,
        default=5,
        help="Number of results to return (default: 5)"
    )
    parser.add_argument(
        "-d", "--dir",
        type=Path,
        default=DEFAULT_REFERENCES_DIR,
        help="References directory to search"
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Show warnings and processing details"
    )

    args = parser.parse_args()

    try:
        results = search_references(
            args.query,
            args.dir,
            args.top,
            args.verbose
        )
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        return EXIT_FAILURE
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return EXIT_FAILURE

    if not results:
        print(f"No patterns found matching: {args.query}")
        return EXIT_SUCCESS

    print(f"\nTop {len(results)} results for '{args.query}':\n")
    print("=" * 70)

    for i, result in enumerate(results, 1):
        print(f"\n{i}. {result['title']}")
        print(f"   File: {result['file']}")
        print(f"   Score: {result['score']:.1f}")
        if result["snippet"]:
            print(f"   Preview:")
            for line in result["snippet"].split("\n")[:5]:
                print(f"      {line}")
        print("-" * 70)

    return EXIT_SUCCESS


if __name__ == "__main__":
    sys.exit(main())
