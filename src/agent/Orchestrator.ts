/**
 * Orchestrator.ts (v2 — Pulse Edition)
 *
 * The master controller of the Pulse swarm.
 * 
 * V2 upgrades over V1:
 *  - Full Heartbeat Architecture (agents wake on their own)
 *  - ThoughtStream integration (every decision is visible)
 *  - RugCheck self-preservation
 *  - OffRamper agent for autonomous profit sweeping
 *  - Natural language command interface via OpenAI
 *  - HEARTBEAT.md directive file reading
 *  - Emergency stop propagation across all agents
 */

import OpenAI from "openai";
import { Connection } from "@solana/web3.js";
import { AgentWallet, AgentRole } from "../wallet/AgentWallet";
import { DCAStrategy, DCAConfig } from "../strategies/DCAStrategy";
import { TrailingStopStrategy, TrailingStopConfig } from "../strategies/TrailingStopStrategy";
import { HeartbeatEngine } from "../heartbeat/HeartbeatEngine";
import { thoughtStream } from "../heartbeat/ThoughtStream";
import { RugCheckService } from "../integrations/RugCheck";
import { OffRamperAgent } from "./OffRamperAgent";
import { JupiterSwap, TOKENS } from "../integrations/JupiterSwap";
import { EventEmitter } from "events";
import * as dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface AgentEntry {
  wallet: AgentWallet;
  role: AgentRole;
  strategy: DCAStrategy | TrailingStopStrategy | null;
  heartbeat: HeartbeatEngine | null;
  active: boolean;
  trackedMints: string[];  // Tokens this agent holds (for rug check)
}

export type AgentRegistry = Record<string, AgentEntry>;

export interface OrchestratorAction {
  action: string;
  agentId?: string;
  params?: Record<string, any>;
  reasoning: string;
  timestamp: string;
}

export class Orchestrator extends EventEmitter {
  private orchestratorWallet: AgentWallet;
  private agents: AgentRegistry = {};
  private connection: Connection;
  private jupiter: JupiterSwap;
  private rugCheck: RugCheckService;
  private offRamper: OffRamperAgent | null = null;
  private orchestratorHeartbeat: HeartbeatEngine;
  private actionLog: OrchestratorAction[] = [];
  private conversationHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  constructor(orchestratorWallet: AgentWallet, connection: Connection) {
    super();
    this.orchestratorWallet = orchestratorWallet;
    this.connection = connection;
    this.jupiter = new JupiterSwap(connection);
    this.rugCheck = new RugCheckService();

    // The orchestrator itself has a heartbeat — it wakes up and coordinates the swarm
    this.orchestratorHeartbeat = new HeartbeatEngine(
      orchestratorWallet,
      connection,
      parseInt(process.env.HEARTBEAT_INTERVAL_MS || "60000") // Default: 60s
    );

    this.wireHeartbeatEvents(this.orchestratorHeartbeat, orchestratorWallet.agentId);

    // Wire thought stream to WebSocket broadcast
    thoughtStream.on("thought", (thought) => this.emit("thought", thought));
  }

  /** Start the orchestrator's own heartbeat */
  startOrchestrator(): void {
    thoughtStream.wake("orchestrator", "🚀 Pulse Orchestrator is ALIVE. Starting all systems...");
    this.orchestratorHeartbeat.start();
  }

  stopOrchestrator(): void {
    this.orchestratorHeartbeat.stop();
    for (const agent of Object.values(this.agents)) {
      if (agent.heartbeat) agent.heartbeat.stop();
    }
    thoughtStream.sleep("orchestrator", "All systems halted. Goodbye.");
  }

  /** Register an agent and optionally start its heartbeat */
  registerAgent(
    wallet: AgentWallet,
    options: {
      strategy?: DCAStrategy | TrailingStopStrategy | null;
      startHeartbeat?: boolean;
      heartbeatIntervalMs?: number;
      trackedMints?: string[];
    } = {}
  ): void {
    const { strategy = null, startHeartbeat = false, heartbeatIntervalMs = 30000, trackedMints = [] } = options;

    let heartbeat: HeartbeatEngine | null = null;

    if (startHeartbeat) {
      heartbeat = new HeartbeatEngine(wallet, this.connection, heartbeatIntervalMs);
      this.wireHeartbeatEvents(heartbeat, wallet.agentId);
      heartbeat.start();
    }

    this.agents[wallet.agentId] = {
      wallet,
      role: wallet.role,
      strategy,
      heartbeat,
      active: startHeartbeat,
      trackedMints,
    };

    thoughtStream.think(
      "orchestrator",
      "READ",
      `Agent registered: ${wallet.agentId} (${wallet.role}) ${startHeartbeat ? "— heartbeat ACTIVE" : "— standby mode"}`
    );

    this.emit("agent_registered", { agentId: wallet.agentId, role: wallet.role });
  }

  /** Set up the off-ramp agent */
  setupOffRamper(wallet: AgentWallet, destinationWallet: string, triggerPct: number = 15): void {
    this.offRamper = new OffRamperAgent(wallet, this.connection, {
      triggerProfitPct: triggerPct,
      destinationWallet,
      sweepPct: 80, // Sweep 80% of profits, keep 20% for compounding
      dryRun: !destinationWallet,
    });
    this.offRamper.on("offramp_executed", (record) => this.emit("offramp_executed", record));
    thoughtStream.think("orchestrator", "PLAN", `Off-ramp agent configured. Trigger: +${triggerPct}% profit`);
  }

  /** Natural language command interface */
  async executeCommand(command: string): Promise<string> {
    thoughtStream.think("orchestrator", "READ", `📨 Received command: "${command}"`);
    thoughtStream.thinking("orchestrator", "Processing through AI reasoning engine...");

    const portfolioContext = await this.buildPortfolioContext();

    const systemPrompt = `You are the Pulse AI Orchestrator — the brain of a multi-agent DeFi wallet system on Solana.

Your agents: ${JSON.stringify(
      Object.keys(this.agents).map((id) => ({
        id,
        role: this.agents[id].role,
        active: this.agents[id].active,
      })),
      null,
      2
    )}

Portfolio: ${JSON.stringify(portfolioContext, null, 2)}

You can execute: start_dca, stop_dca, start_trailing_stop, stop_agent, check_rug_exposure, status_report, none.
Always reason about risk. Prioritize capital preservation. Never risk more than 50% in one agent.

Respond with JSON: { "reasoning": "...", "actions": [{"action": "...", "agentId": "...", "params": {...}}], "response": "human-friendly reply" }`;

    this.conversationHistory.push({ role: "user", content: command });

    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [{ role: "system", content: systemPrompt }, ...this.conversationHistory],
        response_format: { type: "json_object" },
        temperature: 0.2,
      });

      const responseText = completion.choices[0].message.content || "{}";
      this.conversationHistory.push({ role: "assistant", content: responseText });

      let parsed: any = {};
      try { parsed = JSON.parse(responseText); } catch { return "Processing error. Try again."; }

      if (parsed.actions) {
        for (const action of parsed.actions) {
          thoughtStream.plan("orchestrator", `Planned action: ${action.action} on ${action.agentId || "swarm"}`);
          await this.executeAction(action);
        }
      }

      thoughtStream.success("orchestrator", `Command processed: ${parsed.response?.slice(0, 80)}`);

      const logEntry: OrchestratorAction = {
        action: parsed.actions?.[0]?.action || "none",
        reasoning: parsed.reasoning || "",
        params: parsed.actions?.[0]?.params,
        timestamp: new Date().toISOString(),
      };
      this.actionLog.push(logEntry);
      this.emit("action", logEntry);

      return parsed.response || "Done.";
    } catch (err: any) {
      thoughtStream.error("orchestrator", `OpenAI error: ${err.message?.slice(0, 80)}`);
      return `Error processing command: ${err.message}`;
    }
  }

  /** Execute a single action decided by AI */
  private async executeAction(actionItem: any): Promise<void> {
    const { action, agentId, params } = actionItem;

    switch (action) {
      case "start_dca": {
        const agent = this.agents[agentId];
        if (!agent) return;
        const dcaConfig: DCAConfig = {
          targetMint: params?.targetMint || TOKENS.BONK,
          inputMint: TOKENS.SOL,
          amountPerRound: params?.amountPerRound || 0.01,
          intervalCron: params?.intervalCron || "*/5 * * * *",
          maxRounds: params?.maxRounds || 0,
          minBalanceRequired: 0.05,
          slippageBps: 100,
        };
        const dca = new DCAStrategy(agent.wallet, this.connection, dcaConfig);
        dca.on("execution", (data) => {
          thoughtStream.success(agentId, `DCA round ${data.execution?.round} complete. Acquired: ${data.execution?.amountAcquired} tokens`);
          this.emit("agent_execution", data);
        });
        agent.strategy = dca;
        agent.active = true;
        dca.start();
        thoughtStream.execute(agentId, `DCA strategy started. ${params?.amountPerRound || 0.01} SOL per round.`);
        break;
      }
      case "stop_dca": {
        const agent = this.agents[agentId];
        if (agent?.strategy instanceof DCAStrategy) {
          agent.strategy.stop();
          agent.active = false;
          thoughtStream.sleep(agentId, "DCA strategy stopped per orchestrator command.");
        }
        break;
      }
      case "start_trailing_stop": {
        const agent = this.agents[agentId];
        if (!agent) return;
        const tsConfig: TrailingStopConfig = {
          tokenMint: params?.tokenMint || TOKENS.BONK,
          outputMint: TOKENS.SOL,
          trailingPct: params?.trailingPct || 5,
          checkIntervalMs: 10000,
          minPositionValue: 1000,
        };
        const ts = new TrailingStopStrategy(agent.wallet, this.connection, tsConfig);
        ts.on("triggered", (data) => {
          thoughtStream.alert(agentId, `🚨 Trailing stop triggered! P&L: ${data.profitLossPct?.toFixed(2)}%`);
          this.emit("stop_triggered", data);
        });
        agent.strategy = ts;
        agent.active = true;
        await ts.start();
        thoughtStream.execute(agentId, `Trailing stop active: ${tsConfig.trailingPct}% trail.`);
        break;
      }
      case "check_rug_exposure": {
        const agentEntry = agentId ? this.agents[agentId] : null;
        const mints = agentEntry?.trackedMints || [TOKENS.BONK];
        if (mints.length > 0) {
          const { assessments, requiresEmergencyExit } = await this.rugCheck.scanPortfolio(mints, agentId || "orchestrator");
          if (requiresEmergencyExit) {
            thoughtStream.alert("orchestrator", "🚨 Emergency exit required! Notifying all agents.");
            this.emit("emergency_exit_required", { assessments });
          }
        }
        break;
      }
      case "stop_agent": {
        const agent = this.agents[agentId];
        if (agent) {
          if (agent.strategy instanceof DCAStrategy) agent.strategy.stop();
          if (agent.strategy instanceof TrailingStopStrategy) agent.strategy.stop();
          if (agent.heartbeat) agent.heartbeat.stop();
          agent.active = false;
        }
        break;
      }
    }
  }

  private wireHeartbeatEvents(engine: HeartbeatEngine, agentId: string): void {
    engine.on("cycle_complete", (cycle) => this.emit("heartbeat_cycle", cycle));
    engine.on("dca_execute_requested", (data) => {
      thoughtStream.plan(agentId, "Heartbeat triggered DCA execution request");
      this.emit("dca_execute_requested", data);
    });
    engine.on("rug_check_requested", async (data) => {
      const agent = this.agents[data.agentId];
      if (agent?.trackedMints?.length) {
        await this.rugCheck.scanPortfolio(agent.trackedMints, data.agentId);
      }
    });
    engine.on("emergency_stop", () => {
      thoughtStream.alert("orchestrator", "🚨 Emergency stop triggered via HEARTBEAT.md!");
      this.stopOrchestrator();
    });
  }

  async buildPortfolioContext(): Promise<Record<string, any>> {
    const agentStatuses: any[] = [];
    let totalSOL = 0;

    for (const [agentId, agentData] of Object.entries(this.agents)) {
      const balance = await agentData.wallet.getBalance();
      totalSOL += balance;
      agentStatuses.push({
        agentId,
        role: agentData.role,
        balance,
        active: agentData.active,
        publicKey: agentData.wallet.publicKeyString,
        heartbeatActive: !!agentData.heartbeat,
      });
    }

    const orchestratorBalance = await this.orchestratorWallet.getBalance();

    return {
      orchestratorBalance,
      totalManagedSOL: totalSOL,
      totalPortfolioSOL: orchestratorBalance + totalSOL,
      agentCount: Object.keys(this.agents).length,
      activeAgents: Object.values(this.agents).filter((a) => a.active).length,
      agents: agentStatuses,
      recentThoughts: thoughtStream.getRecent(10),
      timestamp: new Date().toISOString(),
    };
  }

  getThoughtStream() { return thoughtStream; }
  getActionLog() { return this.actionLog; }
  getAgents() { return this.agents; }
}