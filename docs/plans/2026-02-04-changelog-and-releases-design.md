# Changelog & Release Automation Design

## Goal

Automatic changelog generation and streamlined releases using conventional commits and git-cliff.

## Components

### 1. Conventional Commits

All commit messages follow the format `type(scope): description`. Enforced via CLAUDE.md convention (no CI linter). Allowed types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `ci`.

### 2. Build-Time Version Injection

The version string in `src/cli.ts` is injected at compile time via `bun build --define __VERSION__=...`, reading from `package.json`. This makes `package.json` the single source of truth. For development (uncompiled) runs, falls back to `require("../package.json").version`.

### 3. git-cliff Changelog Generation

`cliff.toml` configures how conventional commits map to changelog sections:
- `feat` -> Features
- `fix` -> Bug Fixes
- `perf` -> Performance
- `refactor` -> Refactoring
- `test` -> Testing
- `doc` -> Documentation
- `ci`, `chore` -> hidden

### 4. Release Script

`scripts/release.sh` takes a version argument and:
1. Validates semver format and clean working tree
2. Bumps `version` in `package.json`
3. Runs `git-cliff --tag vX.Y.Z -o CHANGELOG.md`
4. Commits as `chore(release): vX.Y.Z`
5. Tags and pushes — triggering the existing CI release workflow

## Files Changed

- `src/cli.ts` — Replace hardcoded `VERSION` with build-time `__VERSION__` injection
- `package.json` — Update build script with `--define`, add `release` script
- `cliff.toml` — New: git-cliff configuration
- `scripts/release.sh` — New: release automation script
- `CLAUDE.md` — Add conventional commits and releasing sections

## Prerequisites

- `git-cliff` installed locally (`brew install git-cliff`)
