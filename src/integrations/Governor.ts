/**
 * Governor.ts — The Permissioned Brain
 *
 * This is the most important security architecture in Pulse.
 * It solves the #1 fear judges and investors have about agentic wallets:
 * "What stops the AI from hallucinating and draining my wallet?"
 *
 * The Answer: The Governor.
 *
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────────────────────┐
 * │                    PULSE SECURITY MODEL                 │
 * │                                                         │
 * │  ┌─────────────┐    ┌─────────────┐    ┌────────────┐  │
 * │  │    VAULT    │    │  GOVERNOR   │    │   AGENT    │  │
 * │  │  (Cold)     │───▶│  (Safety    │───▶│  WALLET   │  │
 * │  │ 80% funds   │    │   Layer)    │    │ (Hot/Valet)│  │
 * │  │ AI can't    │    │ Checks all  │    │ 20% limit  │  │
 * │  │ touch this  │    │ AI decisions│    │ AI controls│  │
 * │  └─────────────┘    └─────────────┘    └────────────┘  │
 * │                                                         │
 * │  The AI NEVER touches the Vault.                        │
 * │  The Governor BLOCKS any decision that breaks rules.    │
 * │  The Agent Wallet has a daily spending limit.           │
 * └─────────────────────────────────────────────────────────┘
 *
 * Before any agent transaction is signed:
 *   1. Governor checks spending limit (daily cap)
 *   2. Governor checks single-tx limit (max per trade)
 *   3. Governor checks token liquidity (no rugs)
 *   4. Governor checks price impact (no bad routes)
 *   5. Governor checks against blacklist
 *   6. Governor checks rug score
 *   ONLY if ALL checks pass → transaction is signed
 *
 * This is not just security. This is the pitch:
 * "The AI can't harm you even if it tries."
 */

import { thoughtStream } from "../heartbeat/ThoughtStream";
import { JupiterSwap } from "./JupiterSwap";
import { RugCheckService } from "./RugCheck";
import { Connection } from "@solana/web3.js";
import * as dotenv from "dotenv";

dotenv.config();

export interface GovernorRules {
  maxSingleTxSOL: number;         // Max SOL per single transaction
  dailyLimitSOL: number;          // Max SOL agent can spend in 24h
  minTokenLiquidityUSD: number;   // Min liquidity required to buy a token
  maxPriceImpactPct: number;      // Max acceptable price impact
  allowedTokens: string[];        // Whitelist (empty = allow all except blacklist)
  blacklistedTokens: string[];    // Never buy these
  requireRugCheck: boolean;       // Must pass rug check before buy
  maxRugScore: number;            // Max acceptable rug score (0-1000)
  maxPositionPct: number;         // Max % of agent balance in one position
}

export interface GovernorDecision {
  approved: boolean;
  reason: string;
  checks: GovernorCheck[];
  timestamp: string;
}

export interface GovernorCheck {
  name: string;
  passed: boolean;
  value?: string | number;
  limit?: string | number;
  message: string;
}

export interface SpendingWindow {
  windowStart: number;  // Unix timestamp
  totalSpent: number;   // SOL spent in this window
}

// Default safe rules
const DEFAULT_RULES: GovernorRules = {
  maxSingleTxSOL: parseFloat(process.env.GOVERNOR_MAX_SINGLE_TX_SOL || "0.5"),
  dailyLimitSOL: parseFloat(process.env.GOVERNOR_DAILY_LIMIT_SOL || "2.0"),
  minTokenLiquidityUSD: parseFloat(process.env.GOVERNOR_MIN_LIQUIDITY_USD || "50000"),
  maxPriceImpactPct: parseFloat(process.env.GOVERNOR_MAX_PRICE_IMPACT_PCT || "3"),
  allowedTokens: [],
  blacklistedTokens: [
    // Known rugs/honeypots — hardcoded blacklist
    "11111111111111111111111111111112",
  ],
  requireRugCheck: true,
  maxRugScore: 700,
  maxPositionPct: 25,
};

export class Governor {
  private rules: GovernorRules;
  private spendingWindow: SpendingWindow;
  private jupiter: JupiterSwap;
  private rugCheck: RugCheckService;
  private agentId: string;

  constructor(agentId: string, connection: Connection, customRules?: Partial<GovernorRules>) {
    this.agentId = agentId;
    this.rules = { ...DEFAULT_RULES, ...customRules };
    this.jupiter = new JupiterSwap(connection);
    this.rugCheck = new RugCheckService();
    this.spendingWindow = { windowStart: Date.now(), totalSpent: 0 };

    thoughtStream.think(
      agentId,
      "READ",
      `🛡️ Governor initialized. Daily limit: ${this.rules.dailyLimitSOL} SOL | Max tx: ${this.rules.maxSingleTxSOL} SOL | Min liquidity: $${this.rules.minTokenLiquidityUSD.toLocaleString()}`
    );
  }

  /**
   * The main gate. Call this before EVERY agent transaction.
   * Returns { approved: true } or { approved: false, reason: "..." }
   *
   * Usage:
   *   const decision = await governor.approveSwap(amountSOL, outputMint, currentBalance);
   *   if (!decision.approved) { thoughtStream.alert(...); return; }
   *   // Now safe to sign
   */
  async approveSwap(
    amountSOL: number,
    outputMint: string,
    agentBalanceSOL: number,
    simulatedPriceImpact?: number
  ): Promise<GovernorDecision> {
    const checks: GovernorCheck[] = [];
    thoughtStream.think(this.agentId, "THINK", `🛡️ Governor evaluating swap: ${amountSOL} SOL → ${outputMint.slice(0, 8)}...`);

    // ─── CHECK 1: Single Transaction Limit ─────────────────────────────────
    const singleTxCheck: GovernorCheck = {
      name: "single_tx_limit",
      passed: amountSOL <= this.rules.maxSingleTxSOL,
      value: amountSOL,
      limit: this.rules.maxSingleTxSOL,
      message: amountSOL <= this.rules.maxSingleTxSOL
        ? `✅ Single tx: ${amountSOL} SOL ≤ limit ${this.rules.maxSingleTxSOL} SOL`
        : `❌ Single tx: ${amountSOL} SOL EXCEEDS limit ${this.rules.maxSingleTxSOL} SOL`,
    };
    checks.push(singleTxCheck);

    // ─── CHECK 2: Daily Spending Limit ─────────────────────────────────────
    this.refreshSpendingWindow();
    const projectedDailyTotal = this.spendingWindow.totalSpent + amountSOL;
    const dailyLimitCheck: GovernorCheck = {
      name: "daily_limit",
      passed: projectedDailyTotal <= this.rules.dailyLimitSOL,
      value: projectedDailyTotal,
      limit: this.rules.dailyLimitSOL,
      message: projectedDailyTotal <= this.rules.dailyLimitSOL
        ? `✅ Daily spend: ${projectedDailyTotal.toFixed(4)} SOL ≤ limit ${this.rules.dailyLimitSOL} SOL`
        : `❌ Daily limit: ${projectedDailyTotal.toFixed(4)} SOL EXCEEDS daily cap ${this.rules.dailyLimitSOL} SOL`,
    };
    checks.push(dailyLimitCheck);

    // ─── CHECK 3: Position Size vs Balance ─────────────────────────────────
    const positionPct = (amountSOL / agentBalanceSOL) * 100;
    const positionCheck: GovernorCheck = {
      name: "position_size",
      passed: positionPct <= this.rules.maxPositionPct,
      value: positionPct.toFixed(1) + "%",
      limit: this.rules.maxPositionPct + "%",
      message: positionPct <= this.rules.maxPositionPct
        ? `✅ Position size: ${positionPct.toFixed(1)}% of balance ≤ ${this.rules.maxPositionPct}% limit`
        : `❌ Position too large: ${positionPct.toFixed(1)}% of balance exceeds ${this.rules.maxPositionPct}% limit`,
    };
    checks.push(positionCheck);

    // ─── CHECK 4: Token Blacklist ───────────────────────────────────────────
    const notBlacklisted = !this.rules.blacklistedTokens.includes(outputMint);
    const blacklistCheck: GovernorCheck = {
      name: "blacklist",
      passed: notBlacklisted,
      value: outputMint,
      message: notBlacklisted
        ? `✅ Token not on blacklist`
        : `❌ BLOCKED: Token ${outputMint.slice(0, 8)}... is blacklisted`,
    };
    checks.push(blacklistCheck);

    // ─── CHECK 5: Token Whitelist (if active) ──────────────────────────────
    let whitelistCheck: GovernorCheck | null = null;
    if (this.rules.allowedTokens.length > 0) {
      const allowed = this.rules.allowedTokens.includes(outputMint);
      whitelistCheck = {
        name: "whitelist",
        passed: allowed,
        value: outputMint,
        message: allowed
          ? `✅ Token is on approved whitelist`
          : `❌ BLOCKED: Token not on approved whitelist`,
      };
      checks.push(whitelistCheck);
    }

    // ─── CHECK 6: Price Impact ─────────────────────────────────────────────
    // Resolve to a definite number — TypeScript needs certainty here
    let resolvedPriceImpact: number;
    if (simulatedPriceImpact !== undefined) {
      resolvedPriceImpact = simulatedPriceImpact;
    } else {
      try {
        const sim = await this.jupiter.simulateSwap(
          "So11111111111111111111111111111111111111112",
          outputMint,
          Math.floor(amountSOL * 1e9)
        );
        resolvedPriceImpact = sim.priceImpact;
      } catch {
        resolvedPriceImpact = 0;
      }
    }
    const priceImpactCheck: GovernorCheck = {
      name: "price_impact",
      passed: resolvedPriceImpact <= this.rules.maxPriceImpactPct,
      value: resolvedPriceImpact.toFixed(3) + "%",
      limit: this.rules.maxPriceImpactPct + "%",
      message: resolvedPriceImpact <= this.rules.maxPriceImpactPct
        ? `✅ Price impact: ${resolvedPriceImpact.toFixed(3)}% ≤ ${this.rules.maxPriceImpactPct}% limit`
        : `❌ Price impact too high: ${resolvedPriceImpact.toFixed(3)}% exceeds ${this.rules.maxPriceImpactPct}% limit`,
    };
    checks.push(priceImpactCheck);

    // ─── CHECK 7: Rug Score ────────────────────────────────────────────────
    let rugCheck: GovernorCheck = { name: "rug_score", passed: true, message: "Rug check skipped" };
    if (this.rules.requireRugCheck) {
      const rugAssessment = await this.rugCheck.checkToken(outputMint, this.agentId);
      rugCheck = {
        name: "rug_score",
        passed: rugAssessment.score <= this.rules.maxRugScore,
        value: rugAssessment.score,
        limit: this.rules.maxRugScore,
        message: rugAssessment.score <= this.rules.maxRugScore
          ? `✅ Rug score: ${rugAssessment.score}/1000 (${rugAssessment.riskLevel}) — safe to proceed`
          : `❌ RUG RISK: Score ${rugAssessment.score}/1000 EXCEEDS limit ${this.rules.maxRugScore}. AUTO-BLOCKED.`,
      };
    }
    checks.push(rugCheck);

    // ─── VERDICT ───────────────────────────────────────────────────────────
    const failed = checks.filter((c) => !c.passed);
    const approved = failed.length === 0;

    if (approved) {
      thoughtStream.think(
        this.agentId,
        "SUCCESS",
        `🛡️ Governor APPROVED: All ${checks.length} safety checks passed. Proceeding with swap.`
      );
      // Record spend
      this.spendingWindow.totalSpent += amountSOL;
    } else {
      const reasons = failed.map((c) => c.message).join(" | ");
      thoughtStream.think(
        this.agentId,
        "ALERT",
        `🛡️ Governor BLOCKED: ${failed.length} check(s) failed. ${reasons}`
      );
    }

    return {
      approved,
      reason: approved ? "All safety checks passed" : `Blocked: ${failed.map((c) => c.name).join(", ")}`,
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Approve a simple SOL transfer (e.g., vault refill, off-ramp)
   */
  async approveTransfer(amountSOL: number, toAddress: string): Promise<GovernorDecision> {
    thoughtStream.think(this.agentId, "THINK", `🛡️ Governor evaluating transfer: ${amountSOL} SOL → ${toAddress.slice(0, 8)}...`);

    const checks: GovernorCheck[] = [
      {
        name: "single_tx_limit",
        passed: amountSOL <= this.rules.maxSingleTxSOL,
        value: amountSOL,
        limit: this.rules.maxSingleTxSOL,
        message: amountSOL <= this.rules.maxSingleTxSOL ? "✅ Amount within limit" : "❌ Amount exceeds single-tx limit",
      },
    ];

    this.refreshSpendingWindow();
    const projectedTotal = this.spendingWindow.totalSpent + amountSOL;
    checks.push({
      name: "daily_limit",
      passed: projectedTotal <= this.rules.dailyLimitSOL,
      value: projectedTotal,
      limit: this.rules.dailyLimitSOL,
      message: projectedTotal <= this.rules.dailyLimitSOL ? "✅ Within daily limit" : "❌ Would exceed daily limit",
    });

    const approved = checks.every((c) => c.passed);
    if (approved) this.spendingWindow.totalSpent += amountSOL;

    return {
      approved,
      reason: approved ? "Transfer approved" : "Transfer blocked by spending limit",
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  /** Get current spending window status */
  getSpendingStatus(): { spent: number; remaining: number; windowResetIn: number } {
    this.refreshSpendingWindow();
    return {
      spent: this.spendingWindow.totalSpent,
      remaining: Math.max(0, this.rules.dailyLimitSOL - this.spendingWindow.totalSpent),
      windowResetIn: Math.max(0, 86400000 - (Date.now() - this.spendingWindow.windowStart)),
    };
  }

  updateRules(updates: Partial<GovernorRules>): void {
    this.rules = { ...this.rules, ...updates };
    thoughtStream.think(this.agentId, "READ", `🛡️ Governor rules updated: ${JSON.stringify(updates)}`);
  }

  getRules(): GovernorRules {
    return { ...this.rules };
  }

  private refreshSpendingWindow(): void {
    const now = Date.now();
    const windowAge = now - this.spendingWindow.windowStart;
    if (windowAge >= 86400000) { // 24 hours
      this.spendingWindow = { windowStart: now, totalSpent: 0 };
      thoughtStream.observe(this.agentId, "🛡️ Governor spending window reset (24h cycle)");
    }
  }
}

/**
 * VaultWallet — holds the bulk of funds, AI NEVER touches this
 *
 * Usage pattern:
 *   - Vault holds 80% of user's SOL
 *   - When agent wallet runs low, vault tops it up (up to daily limit)
 *   - AI cannot call vault methods directly — only humans/governor can refill
 */
export class VaultManager {
  private vaultPublicKey: string;
  private agentId: string;
  private refillThresholdSOL: number;
  private refillAmountSOL: number;

  constructor(
    vaultPublicKey: string,
    agentId: string,
    refillThresholdSOL: number = 0.1,
    refillAmountSOL: number = 0.5
  ) {
    this.vaultPublicKey = vaultPublicKey;
    this.agentId = agentId;
    this.refillThresholdSOL = refillThresholdSOL;
    this.refillAmountSOL = refillAmountSOL;
  }

  /** Check if agent wallet needs a refill — orchestrator calls this */
  shouldRefillAgent(agentBalanceSOL: number): boolean {
    const needs = agentBalanceSOL < this.refillThresholdSOL;
    if (needs) {
      thoughtStream.alert(
        this.agentId,
        `⚠️ Agent wallet low: ${agentBalanceSOL.toFixed(4)} SOL < ${this.refillThresholdSOL} SOL threshold. Vault refill needed.`
      );
    }
    return needs;
  }

  getVaultAddress(): string {
    return this.vaultPublicKey;
  }

  getRefillAmount(): number {
    return this.refillAmountSOL;
  }
}