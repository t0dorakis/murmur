# Bun

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

```bash
# Build binary
bun run build

# Unit tests only (fast, no binary needed)
bun run test

# E2E tests (build binary before)
bun run test:e2e
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
Bun.serve({
...
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/). Format:

```
type(scope): description
```

Allowed types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `ci`

Scope is optional. Examples:

- `feat: add cron scheduling support`
- `fix(daemon): handle socket timeout`
- `refactor(tui): extract screen buffer`
- `chore(release): v0.2.0`

Breaking changes: add `BREAKING CHANGE:` in the commit body or `!` after type (e.g. `feat!: redesign config format`).

## Releasing

Run `bun run release <version>` (e.g. `bun run release 0.2.0`). This bumps package.json, generates CHANGELOG.md via git-cliff, commits, tags, and pushes. The existing CI workflow handles the GitHub release + Homebrew update.

**Code Quality**

- Avoid duplication but prioritize readability
- Semantic naming (purpose, not implementation)
- Write straightforward code; avoid clever/obscure solutions.
- **Boy Scout Rule**: Leave code cleaner than you found it. Small improvements (rename unclear vars, extract duplicates, add types) welcome when touching nearby code.

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **Run quality gates** (if code changed) - Tests, linters, builds, /final-review
2. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
3. **Clean up** - Clear stashes, prune remote branches
4. **Verify** - All changes committed AND pushed
5. **Hand off** - Provide context for next session

**CRITICAL RULES:**

- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
