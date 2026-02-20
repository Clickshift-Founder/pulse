/**
 * OffRamperAgent.ts
 *
 * The profit protector. One of the most practical agents in the swarm.
 *
 * This agent monitors total portfolio value across ALL sub-agents.
 * When profit exceeds the configured threshold (e.g., 15%), it autonomously:
 *   1. Converts positions to SOL
 *   2. Sweeps profits to a designated cold wallet
 *   3. Logs the off-ramp for audit trail
 *
 * For Emmanuel's existing bot: this is what completes the circle.
 * Trade → Profit → Auto off-ramp. Full autonomy, no manual intervention.
 * Connect this to your bank offramp bridge (e.g., Mercuryo, Transak)
 * and you have a completely autonomous money machine.
 */

import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AgentWallet } from "../wallet/AgentWallet";
import { JupiterSwap, TOKENS } from "../integrations/JupiterSwap";
import { thoughtStream } from "../heartbeat/ThoughtStream";
import { EventEmitter } from "events";

export interface OffRampConfig {
  triggerProfitPct: number;    // Off-ramp when profit % exceeds this
  destinationWallet: string;   // Cold wallet or bridge address
  sweepPct: number;            // What % of profit to sweep (e.g., 80 = keep 20% for compounding)
  dryRun: boolean;             // If true, plan but don't execute
}

export interface OffRampRecord {
  timestamp: string;
  profitPct: number;
  amountSwept: number;   // SOL
  destination: string;
  signature?: string;
  dryRun: boolean;
}

export class OffRamperAgent extends EventEmitter {
  private wallet: AgentWallet;
  private connection: Connection;
  private jupiter: JupiterSwap;
  private config: OffRampConfig;
  private initialPortfolioValue: number = 0;
  private offRampHistory: OffRampRecord[] = [];

  constructor(wallet: AgentWallet, connection: Connection, config: OffRampConfig) {
    super();
    this.wallet = wallet;
    this.connection = connection;
    this.jupiter = new JupiterSwap(connection);
    this.config = config;
  }

  /** Set the baseline portfolio value — call this at startup */
  async initialize(totalPortfolioSol: number): Promise<void> {
    this.initialPortfolioValue = totalPortfolioSol;
    thoughtStream.think(
      this.wallet.agentId,
      "READ",
      `Off-ramp agent initialized. Baseline: ${totalPortfolioSol.toFixed(4)} SOL. Trigger at +${this.config.triggerProfitPct}%`,
    );
  }

  /**
   * Called by orchestrator on each heartbeat.
   * Checks if profit threshold is hit — auto-executes sweep if so.
   */
  async checkAndOffRamp(currentPortfolioSol: number): Promise<OffRampRecord | null> {
    if (this.initialPortfolioValue === 0) return null;
    if (!this.config.destinationWallet) {
      thoughtStream.observe(this.wallet.agentId, "Off-ramp destination wallet not configured. Skipping.");
      return null;
    }

    const profitPct = ((currentPortfolioSol - this.initialPortfolioValue) / this.initialPortfolioValue) * 100;
    const profitSol = currentPortfolioSol - this.initialPortfolioValue;

    thoughtStream.observe(
      this.wallet.agentId,
      `Portfolio P&L: ${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(2)}% (${profitSol >= 0 ? "+" : ""}${profitSol.toFixed(4)} SOL)`,
      { profitPct, profitSol, currentPortfolioSol, baseline: this.initialPortfolioValue }
    );

    if (profitPct < this.config.triggerProfitPct) {
      thoughtStream.observe(
        this.wallet.agentId,
        `Off-ramp not triggered. Need ${this.config.triggerProfitPct}% gain, current: ${profitPct.toFixed(2)}%`
      );
      return null;
    }

    // PROFIT THRESHOLD HIT
    const amountToSweep = profitSol * (this.config.sweepPct / 100);
    thoughtStream.alert(
      this.wallet.agentId,
      `🎯 PROFIT TARGET HIT! +${profitPct.toFixed(2)}% gain. Sweeping ${amountToSweep.toFixed(4)} SOL to cold wallet...`,
      { profitPct, amountToSweep, destination: this.config.destinationWallet }
    );

    const record: OffRampRecord = {
      timestamp: new Date().toISOString(),
      profitPct,
      amountSwept: amountToSweep,
      destination: this.config.destinationWallet,
      dryRun: this.config.dryRun,
    };

    if (this.config.dryRun) {
      thoughtStream.plan(
        this.wallet.agentId,
        `[DRY RUN] Would sweep ${amountToSweep.toFixed(4)} SOL → ${this.config.destinationWallet.slice(0, 8)}...`
      );
      record.signature = "DRY_RUN_NO_TX";
    } else {
      const agentBalance = await this.wallet.getBalance();
      const sweepAmount = Math.min(amountToSweep, agentBalance - 0.01); // Keep 0.01 SOL for gas

      if (sweepAmount <= 0) {
        thoughtStream.observe(this.wallet.agentId, "Off-ramp: Agent balance too low to sweep");
        return null;
      }

      thoughtStream.execute(
        this.wallet.agentId,
        `Executing off-ramp: ${sweepAmount.toFixed(4)} SOL → ${this.config.destinationWallet.slice(0, 8)}...`
      );
      const signature = await this.wallet.sendSOL(this.config.destinationWallet, sweepAmount);
      record.signature = signature;

      thoughtStream.success(
        this.wallet.agentId,
        `✅ Off-ramp complete! ${sweepAmount.toFixed(4)} SOL swept. Tx: ${signature.slice(0, 12)}...`,
        { signature, amountSwept: sweepAmount }
      );
    }

    this.offRampHistory.push(record);
    // Update baseline to current (so next off-ramp measures from here)
    this.initialPortfolioValue = currentPortfolioSol;

    this.emit("offramp_executed", record);
    return record;
  }

  getHistory(): OffRampRecord[] {
    return this.offRampHistory;
  }
}