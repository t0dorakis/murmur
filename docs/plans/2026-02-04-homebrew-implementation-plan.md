# Homebrew Distribution — Implementation Plan

Reference: `docs/plans/2026-02-04-homebrew-distribution-design.md`

## Prerequisites (manual, outside this repo)

These are done by the user on GitHub, not automated:

- [ ] Create public repo `t0dorakis/homebrew-murmur` with `Formula/murmur.rb` (placeholder)
- [ ] Create fine-grained PAT scoped to that repo (Contents: Read and write)
- [ ] Add PAT as `TAP_GITHUB_TOKEN` secret in the murmur repo

## Steps

### Step 1: Fix `startDetached()` for compiled binary

**Problem:** `src/cli.ts:143` spawns `bun daemon.ts` as a subprocess. After `bun build --compile`, `daemon.ts` doesn't exist as a file — the binary is self-contained.

**Fix:** Self-re-exec pattern. The compiled binary spawns itself with a `--daemon` flag instead of spawning `bun daemon.ts`.

**Changes to `src/cli.ts`:**

1. Add `--daemon` to `parseGlobalArgs()` (new boolean flag, like `--detach`)
2. In `startDetached()`, replace:
   ```ts
   const daemonPath = join(import.meta.dir, "daemon.ts");
   const daemonArgs = ["bun", daemonPath];
   ```
   with:
   ```ts
   const daemonArgs = [process.argv[0], "--daemon"];
   ```
   `process.argv[0]` is the path to the current executable — works for both `bun src/cli.ts` and a compiled binary.
3. Add a new `--daemon` command branch at the top of the switch statement that runs the daemon inline (same logic as `daemon.ts`'s `import.meta.main` block)

**Changes to `src/daemon.ts`:**

- Export a `runDaemonMain(opts: { dataDir?: string; tick?: string })` function extracted from the `import.meta.main` block
- Keep `import.meta.main` guard for backwards compat (calls the new function)

This keeps `bun src/daemon.ts` working for development while also allowing the compiled binary to run the daemon via `murmur --daemon`.

### Step 2: Add `--version` flag

**Why:** Homebrew conventions. Users expect `murmur --version`. Also useful for debugging.

**Changes to `src/cli.ts`:**

1. Read version from a `VERSION` constant (hardcoded string, e.g., `"0.1.0"`)
2. Add `--version` / `-v` check before the command switch:
   ```ts
   if (command === "--version" || command === "-v") {
     console.log(VERSION);
     process.exit(0);
   }
   ```
3. Add version to `package.json` as `"version": "0.1.0"`

We hardcode the version rather than reading `package.json` at runtime because `package.json` won't be available in a compiled binary.

### Step 3: Add LICENSE file

**Why:** Homebrew expects `license` in the formula and warns without one.

**File:** `LICENSE` (MIT) in repo root.

### Step 4: Add `bun build --compile` script

**Why:** Verify the binary compiles and runs before setting up CI.

**Changes to `package.json`:**

```json
"scripts": {
  "build": "bun build --compile src/cli.ts --outfile murmur",
  "test:e2e": "bun test test/e2e.test.ts"
}
```

Manually test: `bun run build && ./murmur --version && ./murmur status`

### Step 5: Create GitHub Actions release workflow

**File:** `.github/workflows/release.yml`

Single `ubuntu-latest` job triggered on `v*` tags:

1. Checkout, setup Bun, `bun install`
2. `bun test` (unit tests only — e2e requires Claude CLI)
3. Create GitHub Release via `softprops/action-gh-release`
4. Compute SHA256 of source tarball
5. Clone `homebrew-murmur` tap, update formula URL + SHA, push

See design doc for full YAML.

### Step 6: Create Homebrew formula template

**File:** Initial `Formula/murmur.rb` for the `homebrew-murmur` repo.

The formula:

- `depends_on "bun"`
- Runs `bun install && bun build --compile src/cli.ts --outfile murmur`
- Installs the binary to `bin/`
- Test block runs `murmur --version`

### Step 7: Test the full flow

1. Build locally: `bun run build`
2. Test compiled binary: `./murmur --version`, `./murmur status`, `./murmur start --detach`, `./murmur stop`
3. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`
4. Verify GitHub Release is created
5. Verify Homebrew formula is updated
6. Test: `brew install t0dorakis/murmur/murmur`

## File Change Summary

| File                            | Change                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- |
| `src/cli.ts`                    | Add `--daemon` flag, self-re-exec in `startDetached()`, add `--version` |
| `src/daemon.ts`                 | Extract `runDaemonMain()` from `import.meta.main` block                 |
| `package.json`                  | Add `"version"`, add `"build"` script                                   |
| `LICENSE`                       | New file (MIT)                                                          |
| `.github/workflows/release.yml` | New file                                                                |

## What stays out of scope

- Windows support (Unix sockets don't work there)
- npm publishing (not needed with Homebrew)
- `curl | sh` install script (can add later for non-Homebrew Linux users)
- Auto-update mechanism (Homebrew handles this)
