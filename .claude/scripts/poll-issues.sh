#!/usr/bin/env bash

# GitHub Issue Polling Script for Multi-Agent Orchestration
# Checks GitHub API every 60s for issues labeled 'claude-assist'
# Spawns Lead Agent when new issue detected

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROCESSED_FILE="$HOME/.claude/processed_issues.txt"
POLL_INTERVAL=60
LOG_DIR="$PROJECT_ROOT/.claude/orchestration/logs"

# Create processed issues file if not exists
mkdir -p "$(dirname "$PROCESSED_FILE")"
touch "$PROCESSED_FILE"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

is_processed() {
  local issue_number=$1
  grep -q "^${issue_number}$" "$PROCESSED_FILE" 2>/dev/null
}

mark_processed() {
  local issue_number=$1
  echo "$issue_number" >> "$PROCESSED_FILE"
}

spawn_lead_agent() {
  local issue_number=$1
  local issue_title=$2
  local issue_url=$3
  local log_file="$LOG_DIR/issue-${issue_number}.log"

  log "Spawning Lead Agent for issue #${issue_number}: ${issue_title}"

  # Call spawn-agent.sh helper
  "$SCRIPT_DIR/spawn-agent.sh" "lead-agent" "$issue_number" \
    "Triage and process GitHub issue #${issue_number}: ${issue_title}" \
    >> "$log_file" 2>&1 &

  log "Lead Agent spawned (PID: $!), logging to: $log_file"
}

poll_github() {
  log "Checking for new issues with 'claude-assist' label..."

  # Get open issues with claude-assist label
  local issues
  issues=$(gh issue list \
    --repo "$(git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/')" \
    --label "claude-assist" \
    --state open \
    --json number,title,url \
    --limit 50)

  # Check if we got valid JSON
  if ! echo "$issues" | jq empty 2>/dev/null; then
    log "ERROR: Invalid JSON response from gh CLI"
    return 1
  fi

  # Process each issue
  echo "$issues" | jq -r '.[] | "\(.number)|\(.title)|\(.url)"' | while IFS='|' read -r number title url; do
    if ! is_processed "$number"; then
      log "Found new issue: #${number}"
      mark_processed "$number"
      spawn_lead_agent "$number" "$title" "$url"
    fi
  done

  log "Polling complete. Next check in ${POLL_INTERVAL}s"
}

main() {
  log "Starting GitHub issue polling (interval: ${POLL_INTERVAL}s)"
  log "Project root: $PROJECT_ROOT"
  log "Processed issues file: $PROCESSED_FILE"

  # Verify gh CLI is installed and authenticated
  if ! command -v gh &> /dev/null; then
    log "ERROR: gh CLI not found. Install: brew install gh"
    exit 1
  fi

  if ! gh auth status &> /dev/null; then
    log "ERROR: gh CLI not authenticated. Run: gh auth login"
    exit 1
  fi

  log "gh CLI authenticated successfully"

  # Change to project directory
  cd "$PROJECT_ROOT"

  # Main polling loop
  while true; do
    poll_github || log "ERROR: Polling failed, retrying in ${POLL_INTERVAL}s"
    sleep "$POLL_INTERVAL"
  done
}

# Handle cleanup on exit
trap 'log "Polling stopped"' EXIT INT TERM

main "$@"
