/**
 * ThoughtStream.ts
 *
 * The most visually impressive part of Pulse.
 * Every agent thought — from waking up to deciding to trade — is captured
 * here and broadcast live to the dashboard's "Internal Monologue" panel.
 * Inspired by OpenClaw's thought stream concept, built for Solana DeFi.
 */

import { EventEmitter } from "events";

export type ThoughtType =
  | "WAKE"          // Agent is waking up from sleep
  | "READ"          // Agent is reading HEARTBEAT.md or market data
  | "THINK"         // Agent is reasoning about what to do
  | "PLAN"          // Agent has decided on a course of action
  | "EXECUTE"       // Agent is executing a transaction
  | "OBSERVE"       // Agent is monitoring/watching
  | "ALERT"         // Agent detected something important
  | "SLEEP"         // Agent is going back to sleep
  | "ERROR"         // Something went wrong
  | "SUCCESS";      // Action completed successfully

export interface Thought {
  id: string;
  agentId: string;
  type: ThoughtType;
  message: string;
  data?: Record<string, any>;
  timestamp: string;
  durationMs?: number;  // How long this thought/action took
}

// Visual icons for each thought type — shows in dashboard
export const THOUGHT_ICONS: Record<ThoughtType, string> = {
  WAKE:    "⏰",
  READ:    "📖",
  THINK:   "🤔",
  PLAN:    "📋",
  EXECUTE: "⚡",
  OBSERVE: "👁️",
  ALERT:   "🚨",
  SLEEP:   "💤",
  ERROR:   "❌",
  SUCCESS: "✅",
};

export const THOUGHT_COLORS: Record<ThoughtType, string> = {
  WAKE:    "#6366f1",
  READ:    "#a78bfa",
  THINK:   "#f59e0b",
  PLAN:    "#22d3ee",
  EXECUTE: "#10b981",
  OBSERVE: "#64748b",
  ALERT:   "#ef4444",
  SLEEP:   "#374151",
  ERROR:   "#ef4444",
  SUCCESS: "#10b981",
};

let thoughtCounter = 0;

export class ThoughtStream extends EventEmitter {
  private thoughts: Thought[] = [];
  private maxHistory = 500;

  /**
   * Log a thought — this is called constantly by every agent
   */
  think(agentId: string, type: ThoughtType, message: string, data?: Record<string, any>): Thought {
    const thought: Thought = {
      id: `t_${++thoughtCounter}`,
      agentId,
      type,
      message,
      data,
      timestamp: new Date().toISOString(),
    };

    this.thoughts.push(thought);
    if (this.thoughts.length > this.maxHistory) {
      this.thoughts.shift();
    }

    // Log to terminal with icon
    const icon = THOUGHT_ICONS[type];
    const time = new Date().toLocaleTimeString();
    console.log(`  [${time}] ${icon} [${agentId}] ${message}`);

    // Emit for WebSocket broadcast
    this.emit("thought", thought);

    return thought;
  }

  /** Shorthand methods for cleaner agent code */
  wake(agentId: string, message: string, data?: any) {
    return this.think(agentId, "WAKE", message, data);
  }
  read(agentId: string, message: string, data?: any) {
    return this.think(agentId, "READ", message, data);
  }
  thinking(agentId: string, message: string, data?: any) {
    return this.think(agentId, "THINK", message, data);
  }
  plan(agentId: string, message: string, data?: any) {
    return this.think(agentId, "PLAN", message, data);
  }
  execute(agentId: string, message: string, data?: any) {
    return this.think(agentId, "EXECUTE", message, data);
  }
  observe(agentId: string, message: string, data?: any) {
    return this.think(agentId, "OBSERVE", message, data);
  }
  alert(agentId: string, message: string, data?: any) {
    return this.think(agentId, "ALERT", message, data);
  }
  sleep(agentId: string, message: string, data?: any) {
    return this.think(agentId, "SLEEP", message, data);
  }
  error(agentId: string, message: string, data?: any) {
    return this.think(agentId, "ERROR", message, data);
  }
  success(agentId: string, message: string, data?: any) {
    return this.think(agentId, "SUCCESS", message, data);
  }

  getRecent(count: number = 50): Thought[] {
    return this.thoughts.slice(-count);
  }

  getAll(): Thought[] {
    return [...this.thoughts];
  }

  getByAgent(agentId: string): Thought[] {
    return this.thoughts.filter((t) => t.agentId === agentId);
  }
}

// Singleton — all agents share one thought stream
export const thoughtStream = new ThoughtStream();