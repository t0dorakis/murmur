# Contributing to murmur

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Dev Setup

```bash
git clone https://github.com/t0dorakis/murmur.git
cd murmur
bun install
```

## Quality Gates

Before pushing, run:

```bash
bun run check      # format (oxfmt) + lint with type-check (oxlint)
bun run test       # unit tests
bun run build      # compile binary
bun run test:e2e   # e2e tests (requires binary + Claude CLI)
```

A pre-commit hook runs `lint-staged` automatically — formatting and linting on every commit.

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `ci`

Examples:

- `feat(cli): add --template flag`
- `fix(daemon): handle socket timeout`
- `docs(readme): update installation instructions`

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes — keep PRs focused on a single concern
3. Ensure all quality gates pass
4. Write a clear PR description explaining **what** and **why**

## Architecture

See `CLAUDE.md` for codebase structure, key files, and coding conventions.

## Questions?

Open an issue or start a discussion — happy to help.
