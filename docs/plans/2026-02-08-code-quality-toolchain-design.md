# Code Quality Toolchain Design

## Goal

Add linting, type-checking, and formatting enforcement via pre-commit hooks using the oxc ecosystem. Update CLAUDE.md with guidance on preferring trusted packages over custom code.

## Toolchain

| Tool          | Purpose                       | Status            |
| ------------- | ----------------------------- | ----------------- |
| `oxfmt`       | Formatting                    | Already installed |
| `oxlint`      | Linting + type-aware checking | New               |
| `husky`       | Git hook management           | New               |
| `lint-staged` | Run commands on staged files  | New               |

## Pre-commit Pipeline

Every `git commit` triggers:

```
staged files → oxfmt (auto-fix) → oxlint --type-check → commit
```

### lint-staged config (in package.json)

```json
{
  "lint-staged": {
    "*": "oxfmt --no-error-on-unmatched-pattern",
    "*.{ts,tsx,js,jsx}": "oxlint --type-check"
  }
}
```

- `oxfmt` runs on all files with `--no-error-on-unmatched-pattern` to silently skip unsupported file types.
- `oxlint` with `--type-check` runs on JS/TS files only, providing linting and type-checking in one pass via oxlint's type-aware alpha feature.

### Husky setup

`.husky/pre-commit`:

```sh
bunx lint-staged
```

## Package.json Changes

### New devDependencies

- `oxlint`
- `husky`
- `lint-staged`

### New/updated scripts

```json
{
  "lint": "oxlint --type-check",
  "check": "oxfmt --check && oxlint --type-check",
  "prepare": "husky"
}
```

- `lint` — standalone linting
- `check` — full quality gate (format + lint), for CI and manual use
- `prepare` — auto-installs husky git hook on `bun install`

## CI Update

In `.github/workflows/release.yml`, update the quality gate step:

```diff
- bun test src/
+ bun run check && bun test src/
```

## CLAUDE.md Updates

### 1. Update testing/quality section

Mention `bun run check` as a quality gate alongside tests.

### 2. New section under Code Quality: "Prefer Packages Over Custom Code"

Before writing complex utilities (regex patterns, parsers, protocol handlers, date handling), evaluate alternatives in this order:

1. **Native Bun API** — if Bun provides a simple built-in, use it
2. **Effect-TS** — if our existing Effect dependency solves it cleanly, use it
3. **unjs ecosystem** — preferred package source for its quality and minimal footprint
4. **Other well-maintained packages** — must be actively maintained with reasonable size

Decision criteria — MUST justify hand-rolling when a package alternative exists:

- Does the package result in _less_ code than a custom solution? If the package adds more code/complexity than writing it ourselves, skip it.
- Is it actively maintained? Unmaintained packages are worse than custom code.
- Bundle size is secondary to correctness, but avoid bloat — this is a CLI tool where performance and developer ergonomics matter most.
