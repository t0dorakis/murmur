#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# --- Helpers ---

validate_input() {
  local version="${1:-}"
  if [[ -z "$version" ]]; then
    echo "Usage: bun run release <version>"
    echo "  e.g. bun run release 0.2.0"
    exit 1
  fi

  # Strip leading 'v' if provided
  version="${version#v}"

  if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
    echo "Error: '$version' is not a valid semver version"
    exit 1
  fi

  echo "$version"
}

assert_clean_tree() {
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Error: working tree has uncommitted changes. Commit or stash first."
    exit 1
  fi
}

assert_tag_available() {
  local tag="$1"
  if git rev-parse "$tag" >/dev/null 2>&1; then
    echo "Error: tag $tag already exists"
    exit 1
  fi
}

assert_prerequisites() {
  if ! command -v git-cliff >/dev/null 2>&1; then
    echo "Error: git-cliff is required but not found."
    echo "Install with: brew install git-cliff"
    exit 1
  fi
}

bump_version() {
  local version="$1"
  VERSION_STR="$version" bun -e "
    const pkg = await Bun.file('package.json').json();
    pkg.version = process.env.VERSION_STR;
    await Bun.write('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
}

bump_skill_version() {
  local version="$1"
  local skill="$REPO_ROOT/.agents/skills/heartbeat-cron/SKILL.md"
  if [[ -f "$skill" ]]; then
    sed -i '' "s/^  version: \".*\"/  version: \"$version\"/" "$skill"
  fi
}

generate_changelog() {
  local tag="$1"
  git-cliff --tag "$tag" -o CHANGELOG.md
}

format_all() {
  bunx oxfmt .
  # Stage any formatting fixes alongside release changes
  git add -u
}

commit_tag_push() {
  local tag="$1"
  git add package.json CHANGELOG.md .agents/skills/heartbeat-cron/SKILL.md
  git commit -m "chore(release): $tag"
  git tag "$tag"
  git pull --rebase
  git push origin HEAD "$tag"
}

# --- Rollback on failure ---

CLEANUP_NEEDED=false
TAG=""

cleanup() {
  if $CLEANUP_NEEDED; then
    echo "Error: release failed. Reverting local changes..."
    git checkout package.json CHANGELOG.md .agents/skills/heartbeat-cron/SKILL.md 2>/dev/null || true
    git reset HEAD~ 2>/dev/null || true
    git tag -d "$TAG" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# --- Main ---

VERSION=$(validate_input "$1")
TAG="v$VERSION"

assert_clean_tree
assert_tag_available "$TAG"
assert_prerequisites

CLEANUP_NEEDED=true

bump_version "$VERSION"
bump_skill_version "$VERSION"
generate_changelog "$TAG"
format_all
commit_tag_push "$TAG"

CLEANUP_NEEDED=false
echo "Released $TAG"
