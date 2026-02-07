---
interval: 1h
name: My Heartbeat
description: What this heartbeat does
agent: claude-code
model: haiku
maxTurns: 50
---

Add a new penguin joke to `jokes.txt` in this directory. One joke per heartbeat.
If the file doesn't exist, create it. Append to the end, don't overwrite existing jokes.
Number each joke sequentially.

Then respond with `HEARTBEAT_OK`.
