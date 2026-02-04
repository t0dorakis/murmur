#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: bun run release <version>"
  echo "  e.g. bun run release 0.2.0"
  exit 1
fi

# Strip leading 'v' if provided
VERSION="${VERSION#v}"

# Validate semver format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Error: '$VERSION' is not a valid semver version"
  exit 1
fi

TAG="v$VERSION"

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: working tree has uncommitted changes. Commit or stash first."
  exit 1
fi

# Check tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists"
  exit 1
fi

# Bump version in package.json
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

bun -e "
  const pkg = await Bun.file('package.json').json();
  pkg.version = '$VERSION';
  await Bun.write('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Generate changelog
if command -v git-cliff >/dev/null 2>&1; then
  git-cliff --tag "$TAG" -o CHANGELOG.md
else
  echo "Warning: git-cliff not found, skipping changelog generation."
  echo "Install with: brew install git-cliff"
fi

# Commit, tag, push
git add package.json CHANGELOG.md
git commit -m "chore(release): $TAG"
git tag "$TAG"
git push && git push origin "$TAG"

echo "Released $TAG"
