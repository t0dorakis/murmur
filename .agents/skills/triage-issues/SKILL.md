---
name: triage-issues
description: >
  Autonomous triage agent that reviews untriaged GitHub issues, classifies them
  by type/priority/size, detects duplicates, and applies labels.
  Triggers: "triage issues", "review new issues", "label issues", "triage the backlog".
---

# Triage Issues

Autonomous workflow: fetch untriaged GitHub issues, classify each by type/priority/size, detect duplicates, and apply labels so the `work-on-issues` skill can pick them up.

## Prerequisites

- `gh` CLI authenticated with repo access
- Repository uses labels: `triaged`, `needs-info`, `security`, `duplicate`, `auto-dismissed`, `wontfix`, `in-progress`
- Priority labels: `priority:must`, `priority:should`, `priority:could`
- Size labels: `size:xs`, `size:s`, `size:m`, `size:l`, `size:xl`

## Workflow

### Step 1 — Ensure labels exist

Create all required labels idempotently. Run each command — `--force` updates existing labels without error:

```bash
gh label create "triaged" --description "Issue has been triaged" --color "0E8A16" --force
gh label create "needs-info" --description "Needs more information from reporter" --color "D93F0B" --force
gh label create "security" --description "Security-related issue" --color "B60205" --force
gh label create "duplicate" --description "Duplicate of another issue" --color "CFD3D7" --force
gh label create "auto-dismissed" --description "Dismissed by triage agent" --color "CFD3D7" --force
gh label create "bug" --description "Something isn't working" --color "D73A4A" --force
gh label create "enhancement" --description "New feature or request" --color "A2EEEF" --force
gh label create "documentation" --description "Documentation improvements" --color "0075CA" --force
gh label create "question" --description "Further information requested" --color "D876E3" --force
gh label create "priority:must" --description "Critical — security, data loss, crashes, blocks core functionality" --color "B60205" --force
gh label create "priority:should" --description "Important — degrades UX, violates docs, affects common workflows" --color "FBCA04" --force
gh label create "priority:could" --description "Nice-to-have — cosmetic, edge cases, documentation polish" --color "C5DEF5" --force
gh label create "size:xs" --description "<20 lines, 1-2 files, trivial" --color "EDEDED" --force
gh label create "size:s" --description "20-100 lines, 1-3 files, straightforward" --color "D4C5F9" --force
gh label create "size:m" --description "100-300 lines, 3-6 files, needs new tests" --color "BFD4F2" --force
gh label create "size:l" --description "300-800 lines, 5-10 files, significant" --color "1D76DB" --force
gh label create "size:xl" --description "800+ lines, 10+ files, multi-day" --color "0052CC" --force
```

### Step 2 — Fetch untriaged issues

```bash
gh issue list --state open --json number,title,labels,body,comments,createdAt --limit 50
```

Filter out any issue that already has one of these labels: `triaged`, `in-progress`, `duplicate`, `wontfix`, `auto-dismissed`, `needs-info`.

If no untriaged issues remain, stop and report: "No untriaged issues found."

### Step 3 — Triage each issue (oldest first)

Process issues from oldest to newest. For each issue:

#### a. Deep-read

Fetch the full issue body and all comments:

```bash
gh issue view <NUMBER> --json body,comments,title,labels,createdAt
```

Read any files in the codebase referenced by the issue. Understand the context, what area of the project it affects, and how it relates to existing code.

#### b. Duplicate detection

Fetch all open and recently closed issues for comparison:

```bash
gh issue list --state all --json number,title,labels,state,body --limit 100
```

Compare the current issue against others by title similarity and body overlap. Only mark as duplicate if you are **confident** the issues describe the same problem or request — when in doubt, do not mark as duplicate.

If duplicate found:

1. Apply labels: `duplicate`, `triaged`
2. Comment on the issue (see comment format below)
3. Close the issue

```bash
gh issue edit <NUMBER> --add-label "duplicate,triaged"
gh issue comment <NUMBER> --body "<duplicate comment>"
gh issue close <NUMBER>
```

Then skip to the next issue.

#### c. Classify

Determine the issue's **type**, **priority**, and **size** using the rubrics below.

**Type:**

| Type            | Criteria                                             |
| --------------- | ---------------------------------------------------- |
| `bug`           | Something is broken or behaves incorrectly           |
| `enhancement`   | New feature or improvement to existing functionality |
| `documentation` | Docs are missing, incorrect, or could be improved    |
| `question`      | User is asking for help or clarification             |
| `security`      | Security vulnerability or concern                    |

**Priority:**

| Label             | Criteria                                                                        |
| ----------------- | ------------------------------------------------------------------------------- |
| `priority:must`   | Security issues, data loss, crashes, breaks core scheduling/heartbeat execution |
| `priority:should` | Degrades UX noticeably, violates documented behavior, affects common workflows  |
| `priority:could`  | Nice-to-have, cosmetic, edge cases, documentation polish                        |

**Size:**

| Label     | Criteria                                  |
| --------- | ----------------------------------------- |
| `size:xs` | <20 lines changed, 1-2 files, trivial fix |
| `size:s`  | 20-100 lines, 1-3 files, straightforward  |
| `size:m`  | 100-300 lines, 3-6 files, needs new tests |
| `size:l`  | 300-800 lines, 5-10 files, significant    |
| `size:xl` | 800+ lines, 10+ files, multi-day effort   |

#### d. Handle edge cases

- **Too vague / insufficient information** — Apply `needs-info` + `triaged`, comment asking specific questions about what's missing. Do not classify priority/size.
- **Spam or off-topic** — Apply `auto-dismissed` + `triaged`, close the issue.
- **Security issue** — Apply `security` + `priority:must` + appropriate size + `triaged`. Add a note in the comment flagging it for human review.

#### e. Apply labels and comment

Apply the classification labels and leave a triage summary comment.

```bash
gh issue edit <NUMBER> --add-label "<type>,priority:<level>,size:<size>,triaged"
gh issue comment <NUMBER> --body "<triage comment>"
```

### Comment Formats

**Standard triage:**

```markdown
## Triage

| Priority | Size   |
| -------- | ------ |
| <LEVEL>  | <SIZE> |

**Summary:** <Brief 1-2 sentence classification of the issue and what it involves.>

---

_Auto-triaged by murmur_
```

**Duplicate:**

```markdown
**Duplicate of #<NUMBER>**

This appears to duplicate #<NUMBER>. Tracking progress there.

---

_Auto-triaged by murmur_
```

**Needs more information:**

```markdown
## Needs More Information

<Specific questions about what's missing or unclear.>

---

_Auto-triaged by murmur_
```

**Security:**

```markdown
## Triage

| Priority | Size   |
| -------- | ------ |
| MUST     | <SIZE> |

**Summary:** <Brief classification.>

**Note:** This is a security-related issue and has been flagged for human review.

---

_Auto-triaged by murmur_
```

### Step 4 — Summary

After processing all issues, output a summary of actions taken:

- Total issues processed
- Issues classified (with breakdown by priority)
- Duplicates found and closed
- Issues marked needs-info
- Issues dismissed

## Important Notes

- One pass per invocation — process all eligible issues in a single run
- Always apply the `triaged` label on every outcome (prevents re-processing on next run)
- Conservative on duplicates — only mark if clearly the same issue, not merely related
- Never apply `good first issue` or `help wanted` — those are for humans to assign
- Never apply `in-progress` — that's for `work-on-issues` when it claims an issue
- This skill only classifies — it does not plan or implement fixes
- Delegates to `work-on-issues` for implementation after triage is complete
