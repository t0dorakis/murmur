---
name: GitHub Digest
description: Summarizes GitHub notifications, filtering noise and highlighting what needs attention
interval: 6h
timeout: 5m
---

# GitHub Digest

Check my GitHub notifications and create a prioritized summary.

## Steps

1. **Fetch notifications** using `gh api notifications --paginate`
2. **Filter out noise:**
   - Bot comments (dependabot, renovate, github-actions)
   - CI status updates on PRs you didn't author
   - Automated release notifications
3. **Group by priority:**
   - **Review requests** — PRs where you're requested as a reviewer
   - **Mentions** — issues/PRs where you're @mentioned
   - **Failing checks** — CI failures on your own PRs
   - **Everything else** — remaining notifications worth noting
4. **Write summary** to `github-digest.md` in this workspace:
   - Include today's date as a heading
   - List each item with repo name, title, and a direct URL
   - Append to existing file (don't overwrite previous entries)
5. **Mark notifications as read** using `gh api -X PUT notifications`

## Response

- If there are review requests, mentions, or failing checks → `ATTENTION: <count> items need attention (X review requests, Y mentions, Z failures)`
- If only low-priority notifications or inbox zero → `HEARTBEAT_OK`
