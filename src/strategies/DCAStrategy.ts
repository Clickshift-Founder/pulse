/**
 * DCAStrategy.ts
 * 
 * Dollar-Cost Averaging agent for SentinelSwarm.
 * This agent autonomously buys a target token at regular intervals
 * regardless of price — the classic long-term accumulation strategy.
 * 
 * Fully autonomous: it wakes up on its own schedule, checks its wallet,
 * executes a swap via Jupiter, and goes back to sleep. No human needed.
 */

import { Connection } from "@solana/web3.js";
import * as cron from "node-cron";
import { AgentWallet } from "../wallet/AgentWallet";
import { JupiterSwap, TOKENS } from "../integrations/JupiterSwap";
import { EventEmitter } from "events";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export interface DCAConfig {
  targetMint: string;        // Token to accumulate
  inputMint: string;         // Token to spend (usually SOL or USDC)
  amountPerRound: number;    // How much to spend per interval (in SOL)
  intervalCron: string;      // Cron expression e.g. "*/5 * * * *" = every 5 min
  maxRounds: number;         // Stop after N rounds (0 = infinite)
  minBalanceRequired: number; // Minimum SOL balance to keep (safety buffer)
  slippageBps: number;       // Slippage tolerance
}

export interface DCAState {
  roundsCompleted: number;
  totalSpent: number;        // In SOL
  totalAcquired: number;     // In target token units
  averagePrice: number;
  lastExecutionTime: string | null;
  nextExecutionTime: string | null;
  active: boolean;
  history: DCAExecution[];
}

export interface DCAExecution {
  round: number;
  timestamp: string;
  amountSpent: number;
  amountAcquired: number;
  price: number;
  signature: string;
}

export class DCAStrategy extends EventEmitter {
  private wallet: AgentWallet;
  private jupiter: JupiterSwap;
  private config: DCAConfig;
  private state: DCAState;
  private cronJob: cron.ScheduledTask | null = null;

  constructor(wallet: AgentWallet, connection: Connection, config: DCAConfig) {
    super();
    this.wallet = wallet;
    this.jupiter = new JupiterSwap(connection);
    this.config = config;
    this.state = {
      roundsCompleted: 0,
      totalSpent: 0,
      totalAcquired: 0,
      averagePrice: 0,
      lastExecutionTime: null,
      nextExecutionTime: null,
      active: false,
      history: [],
    };
  }

  /** Start autonomous DCA execution */
  start(): void {
    console.log(`[DCA:${this.wallet.agentId}] Starting DCA strategy...`);
    console.log(`[DCA:${this.wallet.agentId}] Interval: ${this.config.intervalCron}`);
    console.log(`[DCA:${this.wallet.agentId}] Amount per round: ${this.config.amountPerRound} SOL`);

    this.state.active = true;
    this.cronJob = cron.schedule(this.config.intervalCron, async () => {
      await this.executeDCARound();
    });

    this.emit("started", { agentId: this.wallet.agentId, config: this.config });
  }

  /** Stop the DCA agent */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    this.state.active = false;
    console.log(`[DCA:${this.wallet.agentId}] DCA strategy stopped.`);
    this.emit("stopped", { agentId: this.wallet.agentId, state: this.state });
  }

  /** Execute one DCA round manually (also called by cron) */
  async executeDCARound(): Promise<DCAExecution | null> {
    if (this.config.maxRounds > 0 && this.state.roundsCompleted >= this.config.maxRounds) {
      console.log(`[DCA:${this.wallet.agentId}] Max rounds reached. Stopping.`);
      this.stop();
      return null;
    }

    const balance = await this.wallet.getBalance();
    const amountNeeded = this.config.amountPerRound + this.config.minBalanceRequired;

    if (balance < amountNeeded) {
      console.log(`[DCA:${this.wallet.agentId}] ⚠️ Insufficient balance: ${balance} SOL < ${amountNeeded} SOL required`);
      this.emit("insufficient_balance", { agentId: this.wallet.agentId, balance });
      return null;
    }

    const amountLamports = Math.floor(this.config.amountPerRound * LAMPORTS_PER_SOL);

    // Simulate first — risk check
    const simulation = await this.jupiter.simulateSwap(
      this.config.inputMint,
      this.config.targetMint,
      amountLamports
    );

    if (!simulation.feasible) {
      console.log(`[DCA:${this.wallet.agentId}] ⚠️ Swap not feasible. Price impact: ${simulation.priceImpact}%`);
      this.emit("swap_rejected", { reason: "high_price_impact", priceImpact: simulation.priceImpact });
      return null;
    }

    console.log(`[DCA:${this.wallet.agentId}] Executing DCA round ${this.state.roundsCompleted + 1}...`);

    const result = await this.jupiter.executeSwap(
      this.wallet,
      this.config.inputMint,
      this.config.targetMint,
      amountLamports,
      this.config.slippageBps
    );

    // Calculate price (SOL per token unit)
    const price = amountLamports / result.outputAmount;

    const execution: DCAExecution = {
      round: this.state.roundsCompleted + 1,
      timestamp: new Date().toISOString(),
      amountSpent: this.config.amountPerRound,
      amountAcquired: result.outputAmount,
      price,
      signature: result.signature,
    };

    // Update state
    this.state.roundsCompleted++;
    this.state.totalSpent += this.config.amountPerRound;
    this.state.totalAcquired += result.outputAmount;
    this.state.averagePrice = this.state.totalSpent / this.state.totalAcquired;
    this.state.lastExecutionTime = new Date().toISOString();
    this.state.history.push(execution);

    console.log(`[DCA:${this.wallet.agentId}] ✅ Round ${execution.round} complete | Acquired: ${result.outputAmount} units`);
    this.emit("execution", { agentId: this.wallet.agentId, execution });

    return execution;
  }

  getState(): DCAState {
    return { ...this.state };
  }

  getConfig(): DCAConfig {
    return { ...this.config };
  }
}