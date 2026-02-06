/**
 * Agent adapter registry.
 *
 * This module exports all available agent adapters and provides
 * registration functionality. Import this module to ensure all
 * adapters are registered before use.
 */

import { registerAdapter } from "./adapter.ts";
import { ClaudeCodeAdapter } from "./claude-code.ts";
import { PiAdapter } from "./pi.ts";

// Register all available adapters
registerAdapter(new ClaudeCodeAdapter());
registerAdapter(new PiAdapter());

// Re-export adapter utilities
export {
  getAdapter,
  listAdapters,
  detectAvailableAgents,
  type AgentAdapter,
  type AgentExecutionResult,
  type AgentStreamCallbacks,
} from "./adapter.ts";
