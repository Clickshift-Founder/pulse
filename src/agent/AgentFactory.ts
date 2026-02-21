/**
 * AgentFactory.ts — Self-Generating Agent Engine
 *
 * HOW CUSTOM AGENTS WORK TECHNICALLY:
 *
 * When a user (or another agent) requests a new agent:
 *   1. Factory validates their tier/token balance (free vs $PULSE holder)
 *   2. Factory selects or generates a role config from RoleRegistry
 *   3. AgentWallet.create() generates a new Ed25519 keypair on Solana
 *   4. Keypair is AES-256-GCM encrypted and saved to agent_wallets/
 *   5. HeartbeatEngine is instantiated for this agent
 *   6. Governor is configured with the agent's tier limits
 *   7. Agent is registered with the Orchestrator
 *   8. Agent's heartbeat starts — it begins its wake-think-act-sleep loop
 *
 * The "heartbeat" is NOT a cron job. It's a setInterval() inside the Node.js
 * process. When you run `npm run dev`, Node starts a long-running server.
 * The HeartbeatEngine calls setInterval(runCycle, 60000) — that's an internal
 * timer. Every 60 seconds the process wakes itself. No external scheduler.
 * No cron tab. The process IS the clock.
 *
 * A cron job, by contrast, is an EXTERNAL scheduler (Linux /etc/crontab)
 * that says "run this script at 9am". Our agents don't need that.
 * They breathe from within the Node process as long as it stays alive.
 * Railway and DigitalOcean keep the process alive — that's why they work.
 * Vercel kills it — that's why Vercel doesn't work.
 */

import { Connection } from "@solana/web3.js";
import { AgentWallet, AgentRole } from "../wallet/AgentWallet";
import { HeartbeatEngine } from "../heartbeat/HeartbeatEngine";
import { Governor, GovernorRules } from "../integrations/Governor";
import { thoughtStream } from "../heartbeat/ThoughtStream";
import { TIER_LIMITS, UserTier } from "./UserSession";
import { EventEmitter } from "events";

// ─── Role Registry ────────────────────────────────────────────────────────────
// All roles a user can spawn. Role descriptions drive AI reasoning.
// Adding a new role here makes it available everywhere automatically.

export interface RoleDefinition {
  role: AgentRole | string;
  label: string;
  icon: string;
  description: string;
  defaultStrategy: string;
  suggestedHeartbeatMs: number;
  requiredTier: UserTier;
  governorOverrides?: Partial<GovernorRules>;
  capabilities: string[];
}

export const ROLE_REGISTRY: RoleDefinition[] = [
  // ── CORE ROLES (free tier) ──
  {
    role: "orchestrator",
    label: "Orchestrator",
    icon: "🧠",
    description: "AI brain that coordinates the swarm. Processes natural language commands and allocates capital.",
    defaultStrategy: "coordinate",
    suggestedHeartbeatMs: 60000,
    requiredTier: "free",
    capabilities: ["natural_language", "capital_allocation", "risk_gating", "swarm_coordination"],
  },
  {
    role: "dca_agent",
    label: "DCA Agent",
    icon: "📈",
    description: "Dollar-cost-averages into a target token on a fixed schedule. Governor-gated before every swap.",
    defaultStrategy: "dca",
    suggestedHeartbeatMs: 60000,
    requiredTier: "free",
    capabilities: ["jupiter_swap", "scheduled_buy", "balance_check", "position_tracking"],
  },

  // ── PRO ROLES ──
  {
    role: "trailing_stop_agent",
    label: "Trailing Stop",
    icon: "📉",
    description: "Monitors peak price. Auto-exits if price drops N% from high. Locks profits, limits losses.",
    defaultStrategy: "trailing_stop",
    suggestedHeartbeatMs: 15000,
    requiredTier: "pro",
    capabilities: ["price_polling", "auto_exit", "pnl_tracking", "jupiter_swap"],
  },
  {
    role: "risk_manager",
    label: "Risk Manager",
    icon: "🚨",
    description: "Runs rug-pull detection on every heartbeat. Triggers emergency halt on critical risk.",
    defaultStrategy: "risk_monitor",
    suggestedHeartbeatMs: 30000,
    requiredTier: "pro",
    capabilities: ["rugcheck_api", "emergency_stop", "position_scan", "portfolio_health"],
  },
  {
    role: "custom",
    label: "Off-Ramper",
    icon: "💸",
    description: "Monitors P&L. Auto-sweeps profits to cold wallet when target hit. Connects to Clickbot for fiat.",
    defaultStrategy: "offramp",
    suggestedHeartbeatMs: 60000,
    requiredTier: "pro",
    capabilities: ["pnl_monitor", "auto_sweep", "clickbot_bridge"],
  },

  // ── SOVEREIGN ($PULSE) ROLES ──
  {
    role: "scout_agent",
    label: "Token Sniper",
    icon: "🏹",
    description: "Monitors new Raydium/Orca pools. Enters autonomously within seconds of listing when thresholds met.",
    defaultStrategy: "snipe",
    suggestedHeartbeatMs: 5000,
    requiredTier: "team",
    governorOverrides: { maxSingleTxSOL: 0.05 },
    capabilities: ["new_pool_detection", "fast_entry", "liquidity_check", "auto_exit"],
  },
  {
    role: "scout_agent",
    label: "Arbitrage Agent",
    icon: "🔄",
    description: "Scans price differences across DEXes. Executes arbitrage when spread exceeds gas cost.",
    defaultStrategy: "arbitrage",
    suggestedHeartbeatMs: 10000,
    requiredTier: "team",
    capabilities: ["multi_dex_scan", "spread_calc", "atomic_swap"],
  },
  {
    role: "scout_agent",
    label: "Yield Farmer",
    icon: "🌾",
    description: "Monitors yield opportunities across Solana protocols. Auto-moves liquidity to highest APY.",
    defaultStrategy: "yield",
    suggestedHeartbeatMs: 300000,
    requiredTier: "team",
    capabilities: ["apy_scan", "auto_deposit", "auto_compound", "impermanent_loss_calc"],
  },
  {
    role: "risk_manager",
    label: "Whale Watcher",
    icon: "🐳",
    description: "Tracks large wallet movements. Alerts and can mirror trades of detected whale wallets.",
    defaultStrategy: "whale_watch",
    suggestedHeartbeatMs: 30000,
    requiredTier: "team",
    capabilities: ["wallet_tracking", "large_tx_detection", "mirror_trade_opt", "alert"],
  },
  {
    role: "scout_agent",
    label: "Sentiment Trader",
    icon: "📰",
    description: "Reads on-chain social signals and token momentum. Buys/sells based on sentiment score.",
    defaultStrategy: "sentiment",
    suggestedHeartbeatMs: 60000,
    requiredTier: "team",
    capabilities: ["sentiment_api", "momentum_calc", "auto_entry", "auto_exit"],
  },
];

// ─── Spawned Agent Record ─────────────────────────────────────────────────────

export interface SpawnedAgent {
  agentId: string;
  publicKey: string;
  role: string;
  roleLabel: string;
  icon: string;
  tier: UserTier;
  heartbeatIntervalMs: number;
  spawnedAt: string;
  spawnedBy: string;   // userId or "system"
  active: boolean;
  explorerUrl: string;
  capabilities: string[];
}

export interface SpawnRequest {
  userId: string;
  tier: UserTier;
  roleKey: string;        // role from ROLE_REGISTRY
  customName?: string;    // optional custom agentId suffix
  customDescription?: string;  // for AI reasoning context
}

// ─── Agent Factory ────────────────────────────────────────────────────────────

export class AgentFactory extends EventEmitter {
  private connection: Connection;
  private network: string;
  private spawnedAgents: SpawnedAgent[] = [];

  constructor(connection: Connection) {
    super();
    this.connection = connection;
    this.network = process.env.SOLANA_NETWORK || "devnet";
  }

  /**
   * Get all available roles for a given user tier.
   * This is what the UI calls to show role suggestions.
   */
  getAvailableRoles(tier: UserTier): RoleDefinition[] {
    const tierOrder: UserTier[] = ["free", "pro", "team"];
    const userTierIndex = tierOrder.indexOf(tier);
    return ROLE_REGISTRY.filter((r) => {
      const roleTierIndex = tierOrder.indexOf(r.requiredTier);
      return roleTierIndex <= userTierIndex;
    });
  }

  /**
   * Get ALL roles with lock status — for displaying in UI with lock icons.
   */
  getAllRolesWithLockStatus(tier: UserTier): Array<RoleDefinition & { locked: boolean }> {
    const tierOrder: UserTier[] = ["free", "pro", "team"];
    const userTierIndex = tierOrder.indexOf(tier);
    return ROLE_REGISTRY.map((r) => ({
      ...r,
      locked: tierOrder.indexOf(r.requiredTier) > userTierIndex,
    }));
  }

  /**
   * Spawn a new agent wallet.
   * This is the core of the self-generating engine.
   *
   * Technical flow:
   *   1. Validate tier can spawn this role
   *   2. Check user hasn't exceeded agent count limit
   *   3. Generate agentId from userId + role + timestamp
   *   4. AgentWallet.create() → generates Ed25519 keypair on Solana
   *   5. Keypair AES-256-GCM encrypted → saved to agent_wallets/
   *   6. Governor configured with tier limits
   *   7. HeartbeatEngine instantiated (setInterval — NOT a cron job)
   *   8. Emit "agent_spawned" event → WebSocket broadcasts to dashboard
   */
  async spawn(request: SpawnRequest): Promise<SpawnedAgent> {
    const { userId, tier, roleKey, customName, customDescription } = request;

    // Find role definition
    const roleDef = ROLE_REGISTRY.find((r) => r.label.toLowerCase().replace(/\s/g, "_") === roleKey || r.role === roleKey);
    if (!roleDef) {
      throw new Error(`Unknown role: ${roleKey}. Available: ${ROLE_REGISTRY.map((r) => r.label).join(", ")}`);
    }

    // Tier check
    const tierOrder: UserTier[] = ["free", "pro", "team"];
    if (tierOrder.indexOf(roleDef.requiredTier) > tierOrder.indexOf(tier)) {
      throw new Error(`Role "${roleDef.label}" requires ${roleDef.requiredTier} tier. Upgrade or hold $PULSE tokens.`);
    }

    // Agent count check
    const limits = TIER_LIMITS[tier];
    const userAgents = this.spawnedAgents.filter((a) => a.spawnedBy === userId);
    if (userAgents.length >= limits.maxAgents) {
      throw new Error(`Agent limit reached: ${limits.maxAgents} for ${tier} tier. Hold $PULSE to unlock more.`);
    }

    // Generate unique agentId
    const suffix = customName
      ? customName.toLowerCase().replace(/[^a-z0-9_]/g, "_")
      : `${roleKey.slice(0, 8)}_${Date.now().toString(36)}`;
    const agentId = `${userId.slice(0, 8)}_${suffix}`;

    thoughtStream.think("factory", "PLAN",
      `Spawning ${roleDef.icon} ${roleDef.label} for user ${userId.slice(0, 8)}...`
    );

    // Create wallet on Solana
    const wallet = await AgentWallet.create(
      roleDef.role as AgentRole,
      this.connection,
      agentId
    );

    // Configure Governor for this agent
    const governor = new Governor(agentId, this.connection, {
      dailyLimitSOL: limits.dailySpendLimitSOL,
      maxSingleTxSOL: limits.dailySpendLimitSOL / 4,
      ...(roleDef.governorOverrides || {}),
    });

    // Build heartbeat interval (tier-based)
    const heartbeatMs = Math.max(
      roleDef.suggestedHeartbeatMs,
      limits.heartbeatIntervalMs
    );

    // Create heartbeat engine
    // setInterval inside HeartbeatEngine IS the autonomy mechanism.
    // No external cron. The Node process runs the clock internally.
    const heartbeat = new HeartbeatEngine(wallet, this.connection, heartbeatMs);
    heartbeat.start();

    const explorerUrl = `https://explorer.solana.com/address/${wallet.publicKeyString}?cluster=${this.network}`;

    const spawnedAgent: SpawnedAgent = {
      agentId,
      publicKey: wallet.publicKeyString,
      role: roleDef.role,
      roleLabel: roleDef.label,
      icon: roleDef.icon,
      tier,
      heartbeatIntervalMs: heartbeatMs,
      spawnedAt: new Date().toISOString(),
      spawnedBy: userId,
      active: true,
      explorerUrl,
      capabilities: roleDef.capabilities,
    };

    this.spawnedAgents.push(spawnedAgent);

    thoughtStream.think("factory", "SUCCESS",
      `✅ ${roleDef.icon} ${roleDef.label} spawned! ID: ${agentId} | Address: ${wallet.publicKeyString.slice(0, 12)}... | Heartbeat: ${heartbeatMs / 1000}s`
    );

    this.emit("agent_spawned", spawnedAgent);
    return spawnedAgent;
  }

  /**
   * Spawn a completely custom agent described in plain text.
   * AI maps the description to the closest role + custom reasoning context.
   */
  async spawnFromDescription(userId: string, tier: UserTier, description: string): Promise<SpawnedAgent> {
    // Map plain text description to a role
    const desc = description.toLowerCase();
    let matched = "dca_agent"; // default

    if (desc.includes("snip") || desc.includes("new pool") || desc.includes("fast")) matched = "scout_agent";
    else if (desc.includes("arbitrage") || desc.includes("spread")) matched = "arbitrage_agent";
    else if (desc.includes("yield") || desc.includes("farm") || desc.includes("lp")) matched = "yield_farmer";
    else if (desc.includes("whale") || desc.includes("track") || desc.includes("mirror")) matched = "whale_watcher";
    else if (desc.includes("stop") || desc.includes("trail") || desc.includes("exit")) matched = "trailing_stop_agent";
    else if (desc.includes("risk") || desc.includes("rug") || desc.includes("safe")) matched = "risk_manager";
    else if (desc.includes("sentiment") || desc.includes("social") || desc.includes("news")) matched = "sentiment_trader";

    return this.spawn({
      userId,
      tier,
      roleKey: matched,
      customDescription: description,
    });
  }

  getSpawnedAgents(userId?: string): SpawnedAgent[] {
    return userId
      ? this.spawnedAgents.filter((a) => a.spawnedBy === userId)
      : this.spawnedAgents;
  }

  getRoleRegistry(): RoleDefinition[] {
    return ROLE_REGISTRY;
  }
}