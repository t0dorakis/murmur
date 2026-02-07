---
name: work-on-issues
description: Autonomous issue worker that picks the highest-priority, smallest-effort triaged GitHub issue, plans and implements changes in a git worktree, then runs final review. Use when told to "work on issues", "pick up an issue", "automate issue work", or "work on the next issue".
---

# Work on Issues

Autonomous workflow: fetch triaged GitHub issues, pick the best candidate, implement changes in an isolated git worktree, and submit for review.

## Prerequisites

- `gh` CLI authenticated with repo access
- Git worktrees supported (standard git)
- Repository has labels: `triaged`, `priority:must/should/could`, `size:xs/s/m/l/xl`, `in-progress`

## Workflow

### Step 1 — Fetch triaged issues

```bash
gh issue list --label "triaged" --state open --json number,title,labels,body,comments --limit 50
```

Skip any issue that:

- Does **not** have the `triaged` label (another agent handles triage)
- Already has `in-progress` label
- Has `duplicate` or `wontfix` or `auto-dismissed` label

### Step 2 — Select the best issue

Rank by **priority descending, then size ascending**:

| Priority          | Weight |
| ----------------- | ------ |
| `priority:must`   | 3      |
| `priority:should` | 2      |
| `priority:could`  | 1      |

| Size      | Weight |
| --------- | ------ |
| `size:xs` | 1      |
| `size:s`  | 2      |
| `size:m`  | 3      |
| `size:l`  | 4      |
| `size:xl` | 5      |

**Score = priority_weight × 10 − size_weight**. Pick the highest score. On tie, pick the lowest issue number (oldest).

### Step 3 — Claim the issue

Create the `in-progress` label if it doesn't exist, then apply it:

```bash
gh label create "in-progress" --description "Being worked on by an agent" --color "1D76DB" --force
gh issue edit <NUMBER> --add-label "in-progress"
```

### Step 4 — Deep-read the issue

1. Fetch issue body and all comments:
   ```bash
   gh issue view <NUMBER> --json body,comments,title,labels
   ```
2. Read all referenced files, related source code, and tests in the repository
3. Understand the UX intent, software design goals, and how this fits the product's USP (murmur = cron daemon for Claude Code, minimal building-block philosophy)
4. If the issue references other issues, read those too

### Step 5 — Plan the implementation

Think through:

- What files need to change and why
- How to keep changes clean, readable, and minimal (Boy Scout Rule)
- Whether `/effect-ts-patterns` guidance applies
- What tests to add or update
- Potential edge cases

Do NOT start coding until the plan is solid.

### Step 6 — Create a git worktree

Branch name: `issue-<NUMBER>-<slug>` where slug is a kebab-case summary (max 50 chars).

```bash
git worktree add -b "issue-<NUMBER>-<slug>" ../murmur-issue-<NUMBER> main
cd ../murmur-issue-<NUMBER>
```

Run `bun install` in the worktree.

### Step 7 — Implement the changes

- Follow CLAUDE.md conventions (Bun, Conventional Commits, semantic naming)
- Use `/effect-ts-patterns` when writing Effect-TS code
- Write or update tests as needed
- Run `bun test src/` after changes to verify unit tests pass
- Run `bun run build` to verify the build succeeds
- Run `bun test test/` to verify e2e tests pass (requires the binary from the build step)

### Step 8 — Commit with conventional format

```bash
git add <specific-files>
git commit -m "<type>(scope): <description>

Closes #<NUMBER>"
```

### Step 9 — Run final review

Execute `/final-review` to get a comprehensive PR review and ensure quality gates pass.

### Step 10 — Push and create PR

```bash
git push -u origin issue-<NUMBER>-<slug>
```

Create PR referencing the issue:

```bash
gh pr create --title "<type>(scope): <description>" --body "Closes #<NUMBER>

## Summary
<bullet points>

## Test plan
<checklist>"
```

### Step 11 — Clean up on failure

If any step fails irrecoverably:

1. Remove `in-progress` label: `gh issue edit <NUMBER> --remove-label "in-progress"`
2. Add a comment explaining what went wrong: `gh issue comment <NUMBER> --body "<explanation>"`
3. Remove the worktree: `git worktree remove ../murmur-issue-<NUMBER>`

## Important Notes

- This skill delegates to `/effect-ts-patterns` and `/final-review` — it does not reimplement them
- Never force-push or rewrite history on shared branches
- If the issue is ambiguous, leave a clarifying comment and move to the next candidate
- One issue at a time — finish or abandon before picking the next
