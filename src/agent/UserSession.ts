/**
 * UserSession.ts — Multi-User Architecture for Pulse
 *
 * HOW PULSE HANDLES MULTIPLE USERS:
 *
 * The key architectural insight: each user gets their OWN isolated
 * agent swarm. Not shared wallets. Not shared state. Sovereign per user.
 *
 * Authentication is WALLET-BASED (sign a message, not a password).
 * This is DeFi — we don't ask for emails. We ask you to prove you own
 * a Solana wallet. That's your identity.
 *
 * USER FLOW:
 *   1. User connects wallet (Phantom/Solflare) to pulse.clickshift.io
 *   2. Dashboard asks them to sign a "Login nonce" (proves wallet ownership)
 *   3. Pulse creates their isolated agent swarm (5 wallets, their own HEARTBEAT config)
 *   4. They see ONLY their agents — nobody else's
 *   5. Their HEARTBEAT config is stored in DB per-user (not a shared file)
 *   6. They can edit it via the dashboard UI (no file editing needed)
 *
 * IP / SOVEREIGNTY:
 *   - Pulse's Governor, ThoughtStream, HeartbeatEngine = our IP
 *   - Users' agent wallets = their own keys (they can export)
 *   - Users' data = stored encrypted in our DB
 *   - The PROTOCOL stays ours. Users use the PRODUCT.
 *   This is exactly how Uniswap works: the protocol is theirs, users provide liquidity.
 *
 * FUTURE: Turn Governor rules into an NFT-gated permission system.
 * Hold $PULSE token → unlock more agents, tighter heartbeat, advanced strategies.
 */

import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";
import { AgentWallet, AgentRole } from "../wallet/AgentWallet";
import { Governor, GovernorRules } from "../integrations/Governor";
import { HeartbeatEngine } from "../heartbeat/HeartbeatEngine";
import { thoughtStream } from "../heartbeat/ThoughtStream";
import { Connection, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

// ─── User Tier System ─────────────────────────────────────────────────────────

export type UserTier = "free" | "pro" | "team";

export const TIER_LIMITS: Record<UserTier, {
  maxAgents: number;
  heartbeatIntervalMs: number;
  dailySpendLimitSOL: number;
  strategies: string[];
}> = {
  free: {
    maxAgents: 2,
    heartbeatIntervalMs: 300000, // 5 minutes
    dailySpendLimitSOL: 0.5,
    strategies: ["dca"],
  },
  pro: {
    maxAgents: 5,
    heartbeatIntervalMs: 60000, // 1 minute
    dailySpendLimitSOL: 5.0,
    strategies: ["dca", "trailing_stop", "rug_exit"],
  },
  team: {
    maxAgents: 20,
    heartbeatIntervalMs: 15000, // 15 seconds
    dailySpendLimitSOL: 50.0,
    strategies: ["dca", "trailing_stop", "rug_exit", "sniper", "offramp"],
  },
};

// ─── User Session ─────────────────────────────────────────────────────────────

export interface UserConfig {
  // Per-user HEARTBEAT.md equivalent — stored in DB, not a file
  mission: string;
  dcaTargetToken: string;
  dcaAmountSol: number;
  dcaIntervalMinutes: number;
  trailingStopPct: number;
  rugCheckEnabled: boolean;
  maxPriceImpactPct: number;
  offRampEnabled: boolean;
  offRampDestination: string;
  offRampTriggerPct: number;
  emergencyStop: boolean;
}

export const DEFAULT_USER_CONFIG: UserConfig = {
  mission: "Grow portfolio conservatively. Protect capital first.",
  dcaTargetToken: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
  dcaAmountSol: 0.01,
  dcaIntervalMinutes: 5,
  trailingStopPct: 7,
  rugCheckEnabled: true,
  maxPriceImpactPct: 3,
  offRampEnabled: false,
  offRampDestination: "",
  offRampTriggerPct: 15,
  emergencyStop: false,
};

export interface UserSession {
  userId: string;          // Derived from wallet pubkey
  walletAddress: string;   // User's connected wallet (identity)
  tier: UserTier;
  createdAt: string;
  lastSeen: string;
  config: UserConfig;
  agentIds: string[];      // The agent wallets Pulse manages for this user
  totalVolumeSOL: number;  // For metrics
  totalTxCount: number;
}

// ─── In-Memory Session Store (replace with DB for production) ─────────────────

class SessionStore {
  private sessions: Map<string, UserSession> = new Map();
  private nonces: Map<string, { nonce: string; expires: number }> = new Map();

  // Generate a login nonce for wallet-auth
  generateNonce(walletAddress: string): string {
    const nonce = `pulse-login-${uuidv4()}-${Date.now()}`;
    this.nonces.set(walletAddress, {
      nonce,
      expires: Date.now() + 5 * 60 * 1000, // 5 min expiry
    });
    return nonce;
  }

  // Verify wallet signature — proves user owns the wallet
  verifySignature(walletAddress: string, signature: string): boolean {
    const nonceEntry = this.nonces.get(walletAddress);
    if (!nonceEntry || Date.now() > nonceEntry.expires) return false;

    try {
      const message = new TextEncoder().encode(nonceEntry.nonce);
      const sigBytes = bs58.decode(signature);
      const pubkeyBytes = new PublicKey(walletAddress).toBytes();
      const valid = nacl.sign.detached.verify(message, sigBytes, pubkeyBytes);
      if (valid) this.nonces.delete(walletAddress); // One-time use
      return valid;
    } catch {
      return false;
    }
  }

  createSession(walletAddress: string): UserSession {
    const userId = crypto.createHash("sha256").update(walletAddress).digest("hex").slice(0, 16);
    const session: UserSession = {
      userId,
      walletAddress,
      tier: "free",
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      config: { ...DEFAULT_USER_CONFIG },
      agentIds: [],
      totalVolumeSOL: 0,
      totalTxCount: 0,
    };
    this.sessions.set(walletAddress, session);
    return session;
  }

  getSession(walletAddress: string): UserSession | null {
    return this.sessions.get(walletAddress) || null;
  }

  getOrCreate(walletAddress: string): UserSession {
    return this.getSession(walletAddress) || this.createSession(walletAddress);
  }

  updateConfig(walletAddress: string, config: Partial<UserConfig>): void {
    const session = this.sessions.get(walletAddress);
    if (session) {
      session.config = { ...session.config, ...config };
      session.lastSeen = new Date().toISOString();
    }
  }

  addAgent(walletAddress: string, agentId: string): void {
    const session = this.sessions.get(walletAddress);
    if (session && !session.agentIds.includes(agentId)) {
      session.agentIds.push(agentId);
    }
  }

  getAllSessions(): UserSession[] {
    return Array.from(this.sessions.values());
  }

  getMetrics() {
    const sessions = this.getAllSessions();
    return {
      totalUsers: sessions.length,
      activeUsers: sessions.filter(s => Date.now() - new Date(s.lastSeen).getTime() < 24 * 60 * 60 * 1000).length,
      byTier: {
        free: sessions.filter(s => s.tier === "free").length,
        pro: sessions.filter(s => s.tier === "pro").length,
        team: sessions.filter(s => s.tier === "team").length,
      },
      totalVolumeSOL: sessions.reduce((sum, s) => sum + s.totalVolumeSOL, 0),
      totalAgents: sessions.reduce((sum, s) => sum + s.agentIds.length, 0),
    };
  }
}

export const sessionStore = new SessionStore();

// ─── Agent Factory — spawns per-user agents ───────────────────────────────────

export class AgentFactory {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Spawn a complete agent swarm for a new user.
   * Creates isolated wallets namespaced by userId.
   */
  async spawnUserSwarm(userId: string, tier: UserTier): Promise<string[]> {
    const limits = TIER_LIMITS[tier];
    const agentRoles: Array<{ role: AgentRole; suffix: string }> = [
      { role: "orchestrator", suffix: "orch" },
      { role: "dca_agent", suffix: "dca" },
    ];

    if (tier === "pro" || tier === "team") {
      agentRoles.push({ role: "trailing_stop_agent", suffix: "trail" });
      agentRoles.push({ role: "risk_manager", suffix: "risk" });
    }

    if (tier === "team") {
      agentRoles.push({ role: "scout_agent", suffix: "scout" });
    }

    const agentIds: string[] = [];

    for (const { role, suffix } of agentRoles.slice(0, limits.maxAgents)) {
      const agentId = `${userId}_${suffix}`;
      const wallet = await AgentWallet.loadOrCreate(agentId, role, this.connection);
      agentIds.push(agentId);
      thoughtStream.think(
        "system",
        "SUCCESS",
        `Spawned ${role} wallet for user ${userId}: ${wallet.publicKeyString.slice(0, 8)}...`
      );
    }

    return agentIds;
  }

  /**
   * Self-generating agent spawner — create custom role agents on demand
   * This is the "self-generating engine" Emmanuel asked about.
   * Any agent or human can call this to spin up a new specialist.
   */
  async spawnCustomAgent(
    userId: string,
    role: AgentRole,
    customSuffix: string
  ): Promise<AgentWallet> {
    const agentId = `${userId}_custom_${customSuffix}_${Date.now()}`;
    const wallet = await AgentWallet.create(role, this.connection, agentId);
    thoughtStream.think(
      "system",
      "SUCCESS",
      `Self-generated agent: ${agentId} (${role})`
    );
    return wallet;
  }

  /**
   * Apply user config to their agent (replaces HEARTBEAT.md per-user)
   */
  buildGovernorFromConfig(agentId: string, config: UserConfig, tier: UserTier): Governor {
    const limits = TIER_LIMITS[tier];
    const rules: Partial<GovernorRules> = {
      dailyLimitSOL: limits.dailySpendLimitSOL,
      maxSingleTxSOL: limits.dailySpendLimitSOL / 4,
      maxPriceImpactPct: config.maxPriceImpactPct,
      requireRugCheck: config.rugCheckEnabled,
    };
    return new Governor(agentId, this.connection, rules);
  }
}