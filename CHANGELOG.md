# Changelog

All notable changes to this project will be documented in this file.

## [0.4.2] - 2026-02-09

### Bug Fixes

- **tui:** Correct feed entry alignment and ANSI-aware text helpers (#37)
- Make package description agent-agnostic (#41)

### Documentation

- **readme:** Sharpen tagline to "agent cron daemon" positioning
- Add issue templates and CONTRIBUTING.md

### Features

- **agents:** Add code-review-expert skill and PR reviewer heartbeat (#38)
- **codex:** Add JSONL stream parsing for live TUI output (#39)
- **cli:** Add --template flag with github-digest starter template

### Revert

- Undo direct-to-main commits for PR review

## [0.4.0] - 2026-02-09

### Bug Fixes

- **release:** Run oxfmt on full repo before release commit

### Documentation

- Add project description, key files, and skill sync rule to CLAUDE.md
- **skill:** Sync heartbeat-cron skill with frontmatter-based config
- Add toolchain badges to README

### Features

- **cli:** Improve lifecycle feedback, status output, and YAML parsing (#31)
- Add pre-commit hook with oxlint, oxfmt, and lint-staged
- **status:** Add health checks, outcome display, and recent errors (#30)
- Multi-heartbeat support per workspace (#33) (#34)
- **agents:** Add OpenAI Codex CLI adapter (#36)

## [0.3.0] - 2026-02-07

### Bug Fixes

- **cli:** Resolve frontmatter config in beat command

### Features

- HEARTBEAT.md frontmatter as source of truth for heartbeat config
- HEARTBEAT.md frontmatter as source of truth for config (#29)

## [0.2.1] - 2026-02-07

### Bug Fixes

- Add error handling to workspace commands

### Documentation

- Rewrite README to clarify minimal building-block positioning (#24)

### Features

- Add workspace management commands, fix exit codes (#11, #14)
- Multi-agent support - Enable pi, Claude Code, and future agent harnesses (#26)

## [0.2.0] - 2026-02-05

### Bug Fixes

- Correct stream-json field names and harden conversation log persistence

### Documentation

- Add design for default verbose logging

### Features

- Add verbose beat logging with tool call visibility
- Make verbose logging default with --quiet option
- Restructure heartbeat skill for skills.sh publishing
- Add skill metadata and installation instructions
- Add effect-ts-patterns skill
- Add permission deny-list for heartbeat agents (#10)

### Refactoring

- Extract tool output parsing helper and fix review findings
- Extract shared tool formatting and improve debug logging
- Move skill to .agents/skills, fix search script

### Testing

- Add e2e tests for stream-json parsing against real Claude CLI
- Rewrite e2e tests to exercise murmur beat --verbose

## [0.1.1] - 2026-02-04

### Bug Fixes

- Harden release script and version injection

### Features

- Add changelog generation and release automation

## [0.1.0] - 2026-02-04
