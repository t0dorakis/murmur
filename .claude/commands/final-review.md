# Final Review - Comprehensive PR Review & Testing

## Step 0: Determine Review Pass

Before starting, check the git history to determine if this is a follow-up review:

```bash
git log --oneline -10 | grep -i "Co-Authored-By: Claude"
```

- **First pass**: No recent Claude co-authored commits on this branch, or the Claude commits are from a different feature.
- **Follow-up pass**: Recent Claude co-authored commits exist from a previous `/final-review` run on this same feature.

If this is a follow-up pass:

- Note this in the summary as "Review Pass #2" (or #3, etc.)
- Tell the review agents to check git history to understand WHY recent changes were made before suggesting reversals
- Be more conservative with changes - the previous pass already applied significant improvements
- Focus agents on catching issues introduced BY the previous review, not re-litigating decisions already made

## Step 1: Create or Update the PR

First, check which branch you're on:

- **If on `main`**: Create a new feature branch with a descriptive name based on the changes (e.g., `feature/add-user-metrics`, `fix/dashboard-loading`), then commit the changes to that branch.
- **If already on a feature branch**: Continue with existing branch.

Then handle the PR:

- If a PR doesn't exist for this branch, create one with a clear title and description summarizing the changes.
- If a PR already exists, push any uncommitted changes to it.

## Step 2: Launch Three Review Agents in Parallel

Use the Task tool to launch these three agents simultaneously.

**Important context for all agents**: If this is a follow-up pass, include in each agent's prompt:

- "Check git log to see recent commits and their messages before making recommendations"
- "If a pattern looks intentional based on recent commit messages, don't recommend reversing it without strong justification"
- "Focus on issues that may have been INTRODUCED by recent changes, not re-reviewing the entire file"

### Agent 1: Codebase Consistency Reviewer

Review the code changes with these focuses:

- Are we duplicating logic that already exists elsewhere in the codebase? Search for similar patterns, utilities, hooks, or helpers that we should be using instead.
- Are there other places in the codebase with similar situations where this same logic/fix should be applied? We don't want inconsistency.
- Check for opportunities to consolidate with existing utilities, hooks, or helpers.

### Agent 2: SOLID & Clean Code Reviewer

Review the code changes through the lens of Uncle Bob's Clean Code principles:

- Single Responsibility: Are functions/components doing one thing?
- Open/Closed: Can we extend without modifying?
- Look for opportunities to replace conditionals with polymorphism or strategy patterns
- Identify deeply nested if statements that could be flattened or extracted
- Flag long functions that should be decomposed
- Check for proper abstraction levels

### Agent 3: Defensive Code Auditor

Review for overly defensive code that could hide real issues:

- try-catch blocks that swallow exceptions silently
- Fallback values that mask null/undefined errors we'd want to know about
- Optional chaining (`?.`) that hides broken assumptions
- Empty array/object fallbacks (`?? []`, `?? {}`) that hide missing data
- Conditional checks that prevent useful error logs from being raised
- Any pattern that would make debugging harder in production

## Step 3: Reconcile and Apply Fixes

When the three agents return their recommendations:

1. **Apply most recommendations** - If you're on the fence, do it. This is a single-developer repo so "out of scope" doesn't apply.

2. **Handle conflicts intelligently** - If Agent 1 says "use existing method X" and Agent 2 says "extract to new method Y", prefer using existing code (Agent 1) to keep the codebase DRY.

3. **Track what you skip** - Only skip if you're genuinely confident it's wrong for this codebase. Note these for the summary.

4. **On follow-up passes, aim for convergence** - If agents are only finding minor issues or suggesting stylistic preferences, note this in the summary. The goal is to converge, not to endlessly refactor. If changes from this pass are minimal, recommend that the user proceed without another review pass.

## Step 4: Comprehensive Testing

Run ALL of these that apply to the changes:

### 4a. Type Checking & Linting

```bash
bun typecheck
bun lint
bun format
```

### 4b. Unit Tests

```bash
bun test
```

### 4c. E2E Tests (if configured)

```bash
bun test:e2e
```

### 4d. Browser Testing with agent-browser (if UI changes)

Based on code changes, identify affected pages/features. Then:

1. **Start dev server**: `bun dev`
2. **Plan smoke tests**: List manual tests you'd normally request
3. **Automated browser testing**:
   - Use agent-browser skill for visual/functional verification
   - Navigate to affected pages
   - Use `agent-browser snapshot -i` for accessibility tree
   - Use `agent-browser screenshot` for visual verification

## Step 5: Push Final Changes

After all fixes and tests pass, commit and push the changes to the PR.

## Step 6: Final Summary

Provide a summary with these sections:

### Review Pass

- State which pass this is (e.g., "Review Pass #1" or "Review Pass #2")
- If follow-up pass, briefly note what the previous pass addressed

### Changes Applied

- List the recommendations you implemented from each agent

### Recommendations Skipped

- For each skipped item, explain WHY you decided not to do it
- Remember: "out of scope" is not a valid excuse in a single-developer repo

### Test Coverage

- TypeScript compilation status
- Lint results
- Unit test results
- E2E test results (if applicable)
- What was verified via agent-browser

### Unable to Test

- List anything that couldn't be tested and why
- Explain what you'd want me to manually verify

### Another Pass Needed?

- If this pass made substantial changes (new functions/components, significant refactoring), recommend running `/final-review` again
- If changes were minor (small tweaks, style fixes), recommend proceeding to merge
- Be honest: "This pass was substantial - I'd recommend one more review" or "Changes were minimal - ready to merge"
