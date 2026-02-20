/**
 * HeartbeatEngine.ts
 *
 * The heart of Pulse. This is what separates an "agentic" system from a bot.
 *
 * Every N seconds, every agent WAKES UP and asks:
 *   "What is my current state?"
 *   "What does my directive say?"
 *   "What is the market doing?"
 *   "Do I need to act?"
 *   "What is the risk?"
 *   → ACT or SLEEP
 *
 * Inspired by OpenClaw's Heartbeat Architecture.
 * This is the "Thinking Runtime" that blows minds.
 */

import * as fs from "fs";
import * as path from "path";
import { Connection } from "@solana/web3.js";
import { AgentWallet } from "../wallet/AgentWallet";
import { JupiterSwap, TOKENS } from "../integrations/JupiterSwap";
import { thoughtStream } from "./ThoughtStream";
import { RugCheckService } from "../integrations/RugCheck";
import { EventEmitter } from "events";
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface HeartbeatDirectives {
  mission: string;
  vaultReservePct: number;
  dcaAllocationPct: number;
  dcaTargetToken: string;
  dcaAmountSol: number;
  dcaIntervalMinutes: number;
  trailingStopPct: number;
  maxPriceImpactPct: number;
  rugCheckEnabled: boolean;
  maxSinglePositionPct: number;
  sniperEnabled: boolean;
  sniperMaxSol: number;
  emergencyStop: boolean;
  emergencyExitAll: boolean;
  pauseDca: boolean;
  offRampEnabled: boolean;
  offRampTargetWallet: string;
  offRampTriggerPct: number;
}

export interface HeartbeatCycle {
  cycleNumber: number;
  startTime: string;
  endTime?: string;
  agentId: string;
  thoughts: string[];
  actionsTaken: string[];
  decision: "act" | "sleep" | "alert";
  durationMs?: number;
}

export class HeartbeatEngine extends EventEmitter {
  private wallet: AgentWallet;
  private connection: Connection;
  private jupiter: JupiterSwap;
  private rugCheck: RugCheckService;
  private intervalMs: number;
  private cycleNumber = 0;
  private running = false;
  private handle: NodeJS.Timeout | null = null;
  private heartbeatPath: string;

  constructor(wallet: AgentWallet, connection: Connection, intervalMs: number = 60000) {
    super();
    this.wallet = wallet;
    this.connection = connection;
    this.jupiter = new JupiterSwap(connection);
    this.rugCheck = new RugCheckService();
    this.intervalMs = intervalMs;
    this.heartbeatPath = path.join(process.cwd(), "HEARTBEAT.md");
  }

  start(): void {
    this.running = true;
    thoughtStream.think(this.wallet.agentId, "WAKE", `Heartbeat engine initialized. Pulse interval: ${this.intervalMs / 1000}s`);
    // Run first cycle immediately, then on interval
    this.runCycle();
    this.handle = setInterval(() => this.runCycle(), this.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.handle) clearInterval(this.handle);
    thoughtStream.sleep(this.wallet.agentId, "Heartbeat engine stopped. Agent going offline.");
  }

  private async runCycle(): Promise<void> {
    if (!this.running) return;

    const cycleStart = Date.now();
    this.cycleNumber++;

    const cycle: HeartbeatCycle = {
      cycleNumber: this.cycleNumber,
      startTime: new Date().toISOString(),
      agentId: this.wallet.agentId,
      thoughts: [],
      actionsTaken: [],
      decision: "sleep",
    };

    try {
      // ─── WAKE ────────────────────────────────────────────────────
      thoughtStream.wake(
        this.wallet.agentId,
        `⏰ Waking up. Cycle #${this.cycleNumber}. Good morning.`,
        { cycle: this.cycleNumber }
      );

      // ─── READ HEARTBEAT.md ────────────────────────────────────────
      thoughtStream.read(this.wallet.agentId, "📖 Reading HEARTBEAT.md directive file...");
      const directives = this.parseHeartbeatFile();

      // Check emergency stops first
      if (directives.emergencyStop) {
        thoughtStream.alert(this.wallet.agentId, "🚨 EMERGENCY STOP directive detected. Halting all activity.");
        this.stop();
        this.emit("emergency_stop");
        return;
      }

      // ─── READ MARKET + PORTFOLIO ──────────────────────────────────
      thoughtStream.read(this.wallet.agentId, "📊 Reading portfolio state and market prices...");
      const balance = await this.wallet.getBalance();
      const solPrice = await this.jupiter.getPrice(TOKENS.SOL);

      thoughtStream.observe(
        this.wallet.agentId,
        `Portfolio: ${balance.toFixed(4)} SOL (~$${(balance * solPrice).toFixed(2)} USD) | SOL price: $${solPrice.toFixed(2)}`,
        { balance, solPrice, usdValue: balance * solPrice }
      );

      // ─── THINK ───────────────────────────────────────────────────
      thoughtStream.thinking(
        this.wallet.agentId,
        `Thinking... Mission: "${directives.mission.slice(0, 60)}..."`
      );

      // Use OpenAI to reason about the current situation
      const reasoning = await this.reasonWithAI(balance, solPrice, directives);
      thoughtStream.thinking(this.wallet.agentId, `🧠 AI Reasoning: ${reasoning.summary}`);

      // ─── PLAN ────────────────────────────────────────────────────
      thoughtStream.plan(
        this.wallet.agentId,
        `Plan: ${reasoning.action}`,
        { actions: reasoning.plannedActions }
      );
      cycle.thoughts.push(reasoning.summary);

      // ─── EXECUTE ─────────────────────────────────────────────────
      for (const action of reasoning.plannedActions) {
        const result = await this.executeAction(action, directives, balance, solPrice);
        if (result) {
          cycle.actionsTaken.push(result);
          cycle.decision = "act";
        }
      }

      // ─── SLEEP ───────────────────────────────────────────────────
      const durationMs = Date.now() - cycleStart;
      cycle.endTime = new Date().toISOString();
      cycle.durationMs = durationMs;

      thoughtStream.sleep(
        this.wallet.agentId,
        `💤 Cycle #${this.cycleNumber} complete in ${durationMs}ms. Next wake in ${this.intervalMs / 1000}s.`,
        { durationMs, actionsCount: cycle.actionsTaken.length }
      );

      this.emit("cycle_complete", cycle);

    } catch (err: any) {
      thoughtStream.error(
        this.wallet.agentId,
        `Cycle #${this.cycleNumber} error: ${err.message?.slice(0, 100)}`,
        { error: err.message }
      );
      cycle.decision = "alert";
      this.emit("cycle_error", { cycle, error: err.message });
    }
  }

  private async reasonWithAI(
    balance: number,
    solPrice: number,
    directives: HeartbeatDirectives
  ): Promise<{ summary: string; action: string; plannedActions: string[] }> {
    if (!process.env.OPENAI_API_KEY) {
      return {
        summary: "No OpenAI key — using rule-based reasoning",
        action: balance > 0.1 ? "Monitor and maintain positions" : "Insufficient balance",
        plannedActions: balance > 0.1 ? ["check_rug_exposure", "monitor_prices"] : [],
      };
    }

    try {
      const prompt = `You are the Pulse AI Orchestrator. Current state:
- Agent: ${this.wallet.agentId} (${this.wallet.role})
- Balance: ${balance.toFixed(4)} SOL (~$${(balance * solPrice).toFixed(2)})
- SOL Price: $${solPrice.toFixed(2)}
- Mission: ${directives.mission}
- DCA Enabled: ${!directives.pauseDca}
- DCA Target: ${directives.dcaTargetToken}
- Trailing Stop: ${directives.trailingStopPct}%

Based on current state, decide what to do this heartbeat cycle.
Respond with JSON: { "summary": "one sentence summary of your reasoning", "action": "what you will do", "plannedActions": ["action1", "action2"] }
Available actions: check_rug_exposure, monitor_prices, execute_dca, check_trailing_stops, rebalance_portfolio, none`;

      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 200,
        temperature: 0.2,
      });

      return JSON.parse(completion.choices[0].message.content || "{}");
    } catch {
      return {
        summary: "Reasoning in rule-based mode",
        action: "Monitor positions",
        plannedActions: ["monitor_prices"],
      };
    }
  }

  private async executeAction(
    action: string,
    directives: HeartbeatDirectives,
    balance: number,
    solPrice: number
  ): Promise<string | null> {
    switch (action) {
      case "check_rug_exposure": {
        if (!directives.rugCheckEnabled) return null;
        thoughtStream.execute(this.wallet.agentId, "🛡️ Running rug-pull exposure check...");
        // Emit event so orchestrator can act on rug detection
        this.emit("rug_check_requested", { agentId: this.wallet.agentId });
        return "rug_exposure_checked";
      }

      case "monitor_prices": {
        thoughtStream.observe(this.wallet.agentId, `Monitoring prices. SOL at $${solPrice.toFixed(2)}`);
        this.emit("price_monitored", { solPrice, balance });
        return null; // Monitoring = no action logged
      }

      case "execute_dca": {
        if (directives.pauseDca) {
          thoughtStream.observe(this.wallet.agentId, "DCA is paused per HEARTBEAT.md directive");
          return null;
        }
        thoughtStream.execute(this.wallet.agentId, `Executing DCA: ${directives.dcaAmountSol} SOL → ${directives.dcaTargetToken}`);
        this.emit("dca_execute_requested", {
          agentId: this.wallet.agentId,
          amountSol: directives.dcaAmountSol,
          targetToken: directives.dcaTargetToken,
        });
        return `dca_executed_${directives.dcaAmountSol}_SOL`;
      }

      case "check_trailing_stops": {
        thoughtStream.observe(this.wallet.agentId, `Checking trailing stops. Threshold: ${directives.trailingStopPct}%`);
        this.emit("trailing_check_requested", { agentId: this.wallet.agentId });
        return null;
      }

      case "rebalance_portfolio": {
        thoughtStream.plan(this.wallet.agentId, "Portfolio rebalance flagged for orchestrator review");
        this.emit("rebalance_requested", { agentId: this.wallet.agentId, balance });
        return "rebalance_requested";
      }

      default:
        return null;
    }
  }

  private parseHeartbeatFile(): HeartbeatDirectives {
    const defaults: HeartbeatDirectives = {
      mission: "Grow portfolio conservatively. Protect capital first.",
      vaultReservePct: 40,
      dcaAllocationPct: 30,
      dcaTargetToken: "BONK",
      dcaAmountSol: 0.01,
      dcaIntervalMinutes: 5,
      trailingStopPct: 7,
      maxPriceImpactPct: 3,
      rugCheckEnabled: true,
      maxSinglePositionPct: 25,
      sniperEnabled: false,
      sniperMaxSol: 0.05,
      emergencyStop: false,
      emergencyExitAll: false,
      pauseDca: false,
      offRampEnabled: false,
      offRampTargetWallet: "",
      offRampTriggerPct: 15,
    };

    if (!fs.existsSync(this.heartbeatPath)) return defaults;

    const content = fs.readFileSync(this.heartbeatPath, "utf8");

    const extract = (key: string, fallback: any): any => {
      const regex = new RegExp(`^\\s*${key}:\\s*(.+)`, "m");
      const match = content.match(regex);
      if (!match) return fallback;
      const val = match[1].split("#")[0].trim(); // Strip inline comments
      if (val === "true") return true;
      if (val === "false") return false;
      if (!isNaN(Number(val))) return Number(val);
      return val;
    };

    return {
      ...defaults,
      vaultReservePct: extract("VAULT_RESERVE_PCT", defaults.vaultReservePct),
      dcaAmountSol: extract("DCA_AMOUNT_SOL", defaults.dcaAmountSol),
      dcaIntervalMinutes: extract("DCA_INTERVAL_MINUTES", defaults.dcaIntervalMinutes),
      trailingStopPct: extract("TRAILING_STOP_PCT", defaults.trailingStopPct),
      rugCheckEnabled: extract("RUG_CHECK_ENABLED", defaults.rugCheckEnabled),
      sniperEnabled: extract("SNIPER_ENABLED", defaults.sniperEnabled),
      sniperMaxSol: extract("SNIPER_MAX_SOL", defaults.sniperMaxSol),
      emergencyStop: extract("EMERGENCY_STOP", defaults.emergencyStop),
      emergencyExitAll: extract("EMERGENCY_EXIT_ALL", defaults.emergencyExitAll),
      pauseDca: extract("PAUSE_DCA", defaults.pauseDca),
      offRampEnabled: extract("OFFRAMP_ENABLED", defaults.offRampEnabled),
      offRampTriggerPct: extract("OFFRAMP_TRIGGER_PCT", defaults.offRampTriggerPct),
    };
  }

  getCycleNumber(): number {
    return this.cycleNumber;
  }
}