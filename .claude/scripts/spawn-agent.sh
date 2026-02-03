#!/usr/bin/env bash

# Agent Spawn Helper for Multi-Agent Orchestration
# Usage: spawn-agent.sh <persona> <issue-number> <task-description>
#   persona: Agent persona name (lead-agent, planning-agent, database-architect, etc.)
#   issue-number: GitHub issue number
#   task-description: Task or instruction for the agent

set -euo pipefail

if [ $# -lt 3 ]; then
  echo "Usage: $0 <persona> <issue-number> <task-description>"
  echo "Example: $0 lead-agent 123 'Triage issue #123'"
  exit 1
fi

PERSONA=$1
ISSUE_NUMBER=$2
TASK_DESCRIPTION=$3
MANUAL_TITLE="${4:-}"
MANUAL_BODY="${5:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PERSONA_FILE="$PROJECT_ROOT/.claude/orchestration/${PERSONA}.md"

# Create log file early so log() can write to it
LOG_DIR="$PROJECT_ROOT/.claude/orchestration/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/issue-${ISSUE_NUMBER}.log"

# Verify dependencies early
if ! command -v claude &> /dev/null; then
  echo "ERROR: claude CLI not found. Install from https://claude.com/cli"
  exit 1
fi

if ! command -v jq &> /dev/null; then
  echo "ERROR: jq is required. Install: brew install jq"
  exit 1
fi

# Use existing agent personas if not in orchestration directory
if [ ! -f "$PERSONA_FILE" ]; then
  PERSONA_FILE="$PROJECT_ROOT/.claude/agents/${PERSONA}.md"
fi

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$msg"                    # Show in terminal (for debugging)
  if [ -n "${LOG_FILE:-}" ]; then
    echo "$msg" >> "$LOG_FILE"   # ALSO write to log file
  fi
}

log "Spawning agent: $PERSONA for issue #$ISSUE_NUMBER"
log "Task: $TASK_DESCRIPTION"

# Verify persona file exists
if [ ! -f "$PERSONA_FILE" ]; then
  log "ERROR: Persona file not found: $PERSONA_FILE"
  exit 1
fi

# Check if this is a manual message (starts with 'm-')
if [[ "$ISSUE_NUMBER" =~ ^m- ]]; then
  log "Manual message detected (no GitHub fetch)"
  ISSUE_TITLE="${MANUAL_TITLE:-Manual task}"
  ISSUE_BODY="${MANUAL_BODY:-No description}"
  ISSUE_URL="manual://${ISSUE_NUMBER}"
else
  # Get issue details from GitHub
  if ! ISSUE_DETAILS=$(gh issue view "$ISSUE_NUMBER" --json title,body,labels,url 2>&1); then
    log "ERROR: gh CLI failed for issue #$ISSUE_NUMBER: $ISSUE_DETAILS"
    exit 1
  fi

  if [ -z "$ISSUE_DETAILS" ]; then
    log "ERROR: Empty response from gh CLI for #$ISSUE_NUMBER"
    exit 1
  fi

  ISSUE_TITLE=$(echo "$ISSUE_DETAILS" | jq -r '.title')
  ISSUE_BODY=$(echo "$ISSUE_DETAILS" | jq -r '.body // ""')
  ISSUE_URL=$(echo "$ISSUE_DETAILS" | jq -r '.url')
fi

log "Issue title: $ISSUE_TITLE"

# Construct prompt for Claude Code
# For orchestration agents, we pass context directly
# For execution agents, they're loaded via Skill tool from Lead Agent
AGENT_PROMPT=$(cat <<EOF
You are the ${PERSONA} agent.

Read your full persona definition from: ${PERSONA_FILE}

## GitHub Issue Context

**Issue**: #${ISSUE_NUMBER}
**Title**: ${ISSUE_TITLE}
**URL**: ${ISSUE_URL}

**Description**:
${ISSUE_BODY}

## Your Task

${TASK_DESCRIPTION}

## Instructions

1. Read ${PERSONA_FILE} to understand your role and workflow
2. Follow the development workflow defined in your persona
3. Use the tools available to you (Read, Write, Bash, Glob, Grep, Task)
4. Log progress and update GitHub issue with comments
5. For complex issues: spawn Planning Agent using Task tool
6. For simple issues: execute directly

Begin by reading your persona file and then proceeding with the task.
EOF
)

# Change to project directory
cd "$PROJECT_ROOT"

log "Executing Claude Code with persona: $PERSONA"

# Determine model based on persona
MODEL="sonnet"
if [ "$PERSONA" = "planning-agent" ]; then
  MODEL="opus"
fi

# Optional: Save prompt for debugging if DEBUG_SAVE_PROMPT is set
if [ -n "${DEBUG_SAVE_PROMPT:-}" ]; then
  PENDING_DIR="$PROJECT_ROOT/.claude/orchestration/pending"
  mkdir -p "$PENDING_DIR"
  cat > "$PENDING_DIR/issue-${ISSUE_NUMBER}-${PERSONA}.md" <<< "$AGENT_PROMPT"
  log "Debug: Prompt saved to pending/ directory"
fi

# Execute agent via claude CLI
log "Spawning agent with model: $MODEL"

if [ -n "${DRY_RUN:-}" ]; then
  log "DRY_RUN mode: Would execute: echo \$PROMPT | claude -p --model $MODEL --output-format json --no-session-persistence"
  log "DRY_RUN mode: Would log to: $LOG_FILE"
  log "DRY_RUN mode: Prompt preview (first 200 chars):"
  echo "$AGENT_PROMPT" | head -c 200
  echo ""
  log "DRY_RUN mode: Skipping actual execution"
else
  echo "$AGENT_PROMPT" | claude -p \
    --model "$MODEL" \
    --output-format json \
    --no-session-persistence \
    --permission-mode bypassPermissions \
    >> "$LOG_FILE" 2>&1 &

  AGENT_PID=$!
  log "Agent spawned (PID: $AGENT_PID), logging to: $LOG_FILE"
  log "Agent execution started in background"

  # Store PID for monitoring
  echo "$AGENT_PID" > "$LOG_DIR/issue-${ISSUE_NUMBER}.pid"

  log "Agent spawn complete: $PERSONA"
  log "Monitor progress: tail -f $LOG_FILE"
fi
