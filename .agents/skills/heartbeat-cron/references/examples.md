# Heartbeat Examples

Use these as inspiration during the interview. Adapt to the user's tools, APIs, and delivery preferences.

**Key constraint:** Murmur is just a scheduler — it runs Claude with a prompt and classifies the output. It cannot send notifications on its own. If the user wants results delivered somewhere (Slack, Telegram, a file, a database), the HEARTBEAT.md must include that step explicitly. The heartbeat prompt is the entire action — from gathering data to delivering output.

## Delivery Patterns

Every heartbeat that produces output needs a destination. Common patterns:

- **Slack webhook**: `curl -X POST -H 'Content-Type: application/json' -d '{"text":"..."}' $SLACK_WEBHOOK_URL`
- **Telegram bot**: `curl -s "https://api.telegram.org/bot$TELEGRAM_TOKEN/sendMessage" -d "chat_id=$CHAT_ID&text=..."`
- **Append to local file**: Write findings to a markdown file in the workspace
- **GitHub issue/comment**: Use `gh issue create` or `gh issue comment`
- **Ntfy push notification**: `curl -d "message" ntfy.sh/your-topic`
- **ATTENTION response**: Murmur logs it — useful if the user checks `murmur status` or the TUI

Remind the user: if they want to be _notified_, the heartbeat itself must do the notifying. Murmur won't forward anything.

---

## Code & Repos

### Codex: architecture review

```markdown
---
agent: codex
sandbox: workspace-write
cron: "0 6 * * 1"
timeout: 15m
---

You are Martin Fowler — the author of "Refactoring" and "Patterns of Enterprise
Application Architecture." You've been asked to review this codebase as a personal
favor. Read every source file, trace the dependency graph, and evaluate the
architecture holistically.

Apply your signature lens:

- Smell out code that needs refactoring — duplications, long methods, feature envy
- Identify missing or leaky abstractions
- Evaluate whether the module boundaries reflect the actual domain
- Call out shotgun surgery, divergent change, and inappropriate intimacy
- Judge whether the code communicates its intent clearly

Write like Fowler: precise, pedagogical, with concrete examples. Don't soften
your critique — this team asked for honest feedback.

Write your review to `docs/architecture-review.md` with clear sections, specific
file references, and concrete recommendations. Rate the overall architecture health
on a scale of 1-10.

Respond HEARTBEAT_OK when done.
```

### Auto-triage incoming issues

```markdown
---
interval: 30m
---

Check for new GitHub issues on {org}/{repo} using `gh issue list --state open --json number,title,body,labels`.
For any issue with no labels:

- Read the title and body
- Apply one of: `bug`, `feature`, `question`, `security`
- Use `gh issue edit {number} --add-label {label}`

If any issue is labeled `security`, post to Slack:
`curl -X POST -H 'Content-Type: application/json' -d '{"text":"Security issue #{number}: {title}"}' {webhook_url}`

If no unlabeled issues, respond HEARTBEAT_OK.
```

### Stale PR nudge

```markdown
---
interval: 12h
---

List open PRs on {org}/{repo} with `gh pr list --json number,title,author,createdAt,reviewRequests`.
For any PR open > 48 hours with no reviews:

- Post a comment: `gh pr comment {number} --body "Friendly nudge: this PR has been waiting for review."`
- Send a Telegram message: `curl -s "https://api.telegram.org/bot{token}/sendMessage" -d "chat_id={id}&text=PR #{number} needs review: {title}"`

If all PRs are reviewed or < 48h old, respond HEARTBEAT_OK.
```

### CI failure digest

```markdown
---
interval: 1h
---

Check the last 10 GitHub Actions runs: `gh run list --limit 10 --json status,conclusion,name,headBranch,createdAt`.
Collect any with conclusion=failure.

If failures exist, write a summary to `ci-report.md` in this workspace:

- Workflow name, branch, when it failed
- Append to the file (don't overwrite previous entries), date-stamped.

If all green, respond HEARTBEAT_OK.
```

## Research & Intelligence

### Hacker News scout

```markdown
---
interval: 6h
---

Fetch top 30 HN stories via `curl -s https://hacker-news.firebaseio.com/v0/topstories.json`.
For each, fetch details: `curl -s https://hacker-news.firebaseio.com/v0/item/{id}.json`.

Filter for stories about: {topics}.
If relevant stories exist, append them to `hn-digest.md` in this workspace:

- Date header
- Each story: title, URL, score, comment count
- Sorted by score descending

Also post the top 3 to Slack:
`curl -X POST -H 'Content-Type: application/json' -d '{"text":"HN digest:\n1. {title} ({score}pts) {url}\n..."}' {webhook_url}`

If nothing relevant, respond HEARTBEAT_OK.
```

### Competitor changelog tracker

```markdown
---
interval: 1d
---

Fetch the changelog/release pages for:

- `curl -s https://github.com/{competitor}/releases.atom`
- `curl -s {competitor_changelog_url}`

Check for releases or announcements published in the last 24 hours.
If anything new, write a summary to `competitive-intel.md` in this workspace and send a Telegram message with a one-liner per release.

If nothing new, respond HEARTBEAT_OK.
```

### Arxiv paper monitor

```markdown
---
interval: 1d
---

Search recent arxiv papers using the API:
`curl -s "http://export.arxiv.org/api/query?search_query=all:{keywords}&sortBy=submittedDate&sortOrder=descending&max_results=10"`

For each paper, extract title, authors, abstract, and link.
Filter for papers relevant to: {research_focus}.

If relevant papers found, append to `papers.md`:

- Date header
- Title, authors, one-sentence summary, link

If nothing relevant, respond HEARTBEAT_OK.
```

## Ops & Infrastructure

### Endpoint canary

```markdown
---
interval: 15m
---

Check these endpoints and record response status + latency:

- `curl -s -o /dev/null -w "%{http_code} %{time_total}" {url_1}`
- `curl -s -o /dev/null -w "%{http_code} %{time_total}" {url_2}`

If any returns non-200 or latency > 2s, send a push notification:
`curl -d "ALERT: {url} returned {status} ({latency}s)" ntfy.sh/{topic}`

Log every check to `uptime.csv` (timestamp, url, status, latency).

If all healthy, respond HEARTBEAT_OK.
```

### Docker resource check

```markdown
---
interval: 6h
---

Run `docker system df` and `docker ps --format '{{.Names}} {{.Status}}'`.

- If disk usage > 80%, run `docker system prune -f` and log what was cleaned.
- If any container is in "Restarting" or "Exited" state, report it.

Append results to `docker-health.log` in this workspace.

If everything is healthy and disk < 80%, respond HEARTBEAT_OK.
```

## Personal & Creative

### Daily journal prompt

```markdown
---
interval: 1d
---

Create today's journal entry file: `journal/{YYYY-MM-DD}.md`.
Include:

- A thoughtful writing prompt based on the current date, season, or recent world events
- 3 reflection questions
- A quote that fits the theme

If today's file already exists, respond HEARTBEAT_OK.
```

### Repo activity digest

```markdown
---
interval: 1d
---

For each repo in [{repo_list}]:

- `gh api repos/{owner}/{repo}/events --jq '.[0:10]'`
- Summarize: pushes, PRs opened/merged/closed, issues opened, releases

Write a digest to `weekly-activity.md`:

- One section per repo
- Only include repos with activity
- Overwrite the file each time (it's a rolling snapshot)

If zero activity across all repos, respond HEARTBEAT_OK.
```

## Choosing the Right Schedule

Use **interval** for fixed-frequency checks. Use **cron** when you need specific times or weekday-only runs.

| Use case                               | Interval     | Cron alternative                      |
| -------------------------------------- | ------------ | ------------------------------------- |
| Critical uptime (endpoints, services)  | `15m`        | `*/15 * * * *`                        |
| Active development (CI, tests, triage) | `30m` – `1h` | `*/30 9-18 * * 1-5` (work hours)      |
| Reviews & collaboration                | `6h` – `12h` | `0 9,17 * * 1-5` (9am + 5pm weekdays) |
| Research & intelligence                | `6h` – `1d`  | `0 8 * * *` (daily at 8am)            |
| Housekeeping (deps, cleanup, digests)  | `1d`         | `0 3 * * 0` (Sunday 3am)              |

Cron heartbeats support an optional `tz` frontmatter field (e.g., `tz: America/New_York`) — defaults to local system timezone.
