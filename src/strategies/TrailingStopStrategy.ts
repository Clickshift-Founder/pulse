/**
 * TrailingStopStrategy.ts
 * 
 * Trailing stop-loss agent for SentinelSwarm.
 * 
 * This agent autonomously monitors a position and sells when the price
 * drops more than N% from the highest price seen since entry.
 * 
 * Classic risk management — protects profits while letting winners run.
 * The agent polls Jupiter price API, updates the trailing high,
 * and fires a sell transaction autonomously when the stop is hit.
 */

import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AgentWallet } from "../wallet/AgentWallet";
import { JupiterSwap, TOKENS } from "../integrations/JupiterSwap";
import { EventEmitter } from "events";

export interface TrailingStopConfig {
  tokenMint: string;          // Token being held
  outputMint: string;         // What to sell into (SOL/USDC)
  trailingPct: number;        // e.g. 5 = trail 5% below peak
  checkIntervalMs: number;    // How often to check price (ms)
  minPositionValue: number;   // Min token balance to bother protecting
}

export interface TrailingStopState {
  active: boolean;
  entryPrice: number;
  currentPrice: number;
  peakPrice: number;
  stopPrice: number;
  drawdownFromPeak: number;
  triggered: boolean;
  triggerSignature: string | null;
  startTime: string;
  priceHistory: { price: number; timestamp: string }[];
}

export class TrailingStopStrategy extends EventEmitter {
  private wallet: AgentWallet;
  private jupiter: JupiterSwap;
  private config: TrailingStopConfig;
  private state: TrailingStopState;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(wallet: AgentWallet, connection: Connection, config: TrailingStopConfig) {
    super();
    this.wallet = wallet;
    this.jupiter = new JupiterSwap(connection);
    this.config = config;
    this.state = {
      active: false,
      entryPrice: 0,
      currentPrice: 0,
      peakPrice: 0,
      stopPrice: 0,
      drawdownFromPeak: 0,
      triggered: false,
      triggerSignature: null,
      startTime: new Date().toISOString(),
      priceHistory: [],
    };
  }

  /** Start monitoring — agent runs autonomously from here */
  async start(): Promise<void> {
    console.log(`[TrailingStop:${this.wallet.agentId}] Starting trailing stop monitor...`);
    console.log(`[TrailingStop:${this.wallet.agentId}] Trail: ${this.config.trailingPct}% below peak`);

    // Initialize entry price
    const entryPrice = await this.jupiter.getPrice(this.config.tokenMint);
    this.state.entryPrice = entryPrice;
    this.state.currentPrice = entryPrice;
    this.state.peakPrice = entryPrice;
    this.state.stopPrice = entryPrice * (1 - this.config.trailingPct / 100);
    this.state.active = true;
    this.state.startTime = new Date().toISOString();

    console.log(`[TrailingStop:${this.wallet.agentId}] Entry price: $${entryPrice.toFixed(6)}`);
    console.log(`[TrailingStop:${this.wallet.agentId}] Initial stop: $${this.state.stopPrice.toFixed(6)}`);

    this.intervalHandle = setInterval(async () => {
      await this.checkAndAct();
    }, this.config.checkIntervalMs);

    this.emit("started", { agentId: this.wallet.agentId, entryPrice });
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.state.active = false;
    this.emit("stopped", { agentId: this.wallet.agentId });
  }

  /** Core logic: check price, update trailing stop, sell if triggered */
  private async checkAndAct(): Promise<void> {
    if (!this.state.active || this.state.triggered) return;

    try {
      const currentPrice = await this.jupiter.getPrice(this.config.tokenMint);
      this.state.currentPrice = currentPrice;

      // Record price history
      this.state.priceHistory.push({ price: currentPrice, timestamp: new Date().toISOString() });
      if (this.state.priceHistory.length > 500) this.state.priceHistory.shift(); // Keep last 500

      // Update peak and trailing stop
      if (currentPrice > this.state.peakPrice) {
        this.state.peakPrice = currentPrice;
        this.state.stopPrice = currentPrice * (1 - this.config.trailingPct / 100);
        console.log(`[TrailingStop:${this.wallet.agentId}] 📈 New peak: $${currentPrice.toFixed(6)} | Stop raised to $${this.state.stopPrice.toFixed(6)}`);
        this.emit("peak_updated", { agentId: this.wallet.agentId, peak: currentPrice, stop: this.state.stopPrice });
      }

      // Calculate drawdown
      this.state.drawdownFromPeak = ((this.state.peakPrice - currentPrice) / this.state.peakPrice) * 100;

      // Check if stop triggered
      if (currentPrice <= this.state.stopPrice) {
        console.log(`[TrailingStop:${this.wallet.agentId}] 🚨 STOP TRIGGERED! Price $${currentPrice.toFixed(6)} ≤ Stop $${this.state.stopPrice.toFixed(6)}`);
        await this.executeSell();
      }
    } catch (err) {
      console.error(`[TrailingStop:${this.wallet.agentId}] Price check error:`, err);
    }
  }

  /** Execute the sell — agent fires this autonomously */
  private async executeSell(): Promise<void> {
    this.state.triggered = true;
    this.stop();

    // Check token balance
    const tokenBalance = await this.wallet.getTokenBalance(this.config.tokenMint);
    if (tokenBalance < this.config.minPositionValue) {
      console.log(`[TrailingStop:${this.wallet.agentId}] Balance too small to sell: ${tokenBalance}`);
      this.emit("no_position", { agentId: this.wallet.agentId });
      return;
    }

    console.log(`[TrailingStop:${this.wallet.agentId}] Executing stop-loss sell of ${tokenBalance} tokens...`);

    const result = await this.jupiter.executeSwap(
      this.wallet,
      this.config.tokenMint,
      this.config.outputMint,
      tokenBalance,
      100 // Higher slippage on stop loss — we want out
    );

    this.state.triggerSignature = result.signature;

    const profitLoss = ((this.state.currentPrice - this.state.entryPrice) / this.state.entryPrice) * 100;

    console.log(`[TrailingStop:${this.wallet.agentId}] ✅ Stop executed | P&L: ${profitLoss.toFixed(2)}% | tx: ${result.signature}`);
    this.emit("triggered", {
      agentId: this.wallet.agentId,
      entryPrice: this.state.entryPrice,
      exitPrice: this.state.currentPrice,
      peakPrice: this.state.peakPrice,
      profitLossPct: profitLoss,
      signature: result.signature,
    });
  }

  getState(): TrailingStopState {
    return { ...this.state };
  }
}