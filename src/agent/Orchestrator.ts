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

    // Detect mission change FIRST — don't need AI for this
    const newMission = this.detectMissionChange(command);
    if (newMission) {
      this.setMission(newMission);
    }

    // Detect capital distribution commands
    if (command.toLowerCase().includes("distribute") && command.toLowerCase().includes("capital")) {
      const result = await this.distributeCapital("role_based");
      return result.success
        ? `Capital distributed: ${Object.entries(result.distributed).map(([id, amt]) => `${id}: ${(amt as number).toFixed(4)} SOL`).join(", ")}`
        : `Distribution failed: ${result.error}`;
    }

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

You can execute: start_dca, stop_dca, start_trailing_stop, stop_agent, fund_agent, check_rug_exposure, status_report, none.
fund_agent params: { agentId: "target_agent_id", amountSOL: 0.05 } — transfers SOL from vault to that agent.
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

      const responseText2 = typeof parsed.response === "string"
        ? parsed.response
        : JSON.stringify(parsed.response || "Done.");

      if (parsed.actions) {
        for (const action of parsed.actions) {
          thoughtStream.plan("orchestrator", `Planned action: ${action.action} on ${action.agentId || "swarm"}`);
          await this.executeAction(action);
        }
      }

      thoughtStream.success("orchestrator", `Command processed: ${responseText2.slice(0, 80)}`);

      const logEntry: OrchestratorAction = {
        action: parsed.actions?.[0]?.action || "none",
        reasoning: parsed.reasoning || "",
        params: parsed.actions?.[0]?.params,
        timestamp: new Date().toISOString(),
      };
      this.actionLog.push(logEntry);
      this.emit("action", logEntry);

      return responseText2;
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
      case "fund_agent": {
        // Orchestrator assigns capital to a specific agent from the vault
        const targetAgent = this.agents[agentId];
        if (!targetAgent) {
          thoughtStream.error("orchestrator", `fund_agent: agent ${agentId} not found in registry`);
          return;
        }
        const amount = parseFloat(params?.amountSOL || params?.amount || 0.05);
        const vaultBal = await this.orchestratorWallet.getBalance();
        if (vaultBal < amount + 0.01) {
          thoughtStream.alert("orchestrator",
            `⛔ Cannot fund ${agentId}: vault has ${vaultBal.toFixed(4)} SOL, need ${(amount + 0.01).toFixed(4)}`);
          return;
        }
        const sig = await this.orchestratorWallet.sendSOL(targetAgent.wallet.publicKeyString, amount);
        const newBal = await targetAgent.wallet.getBalance();
        thoughtStream.success("orchestrator",
          `✅ Orchestrator funded ${agentId}: ${amount} SOL assigned | new balance: ${newBal.toFixed(4)} SOL | sig: ${sig.slice(0,12)}...`);
        this.emit("capital_distributed", { agentId, amountSOL: amount, signature: sig, newBalance: newBal });
        break;
      }
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

  // ─── Mission Management ───────────────────────────────────────────────────

  private currentMission: string = "Grow portfolio conservatively. Protect capital first. DCA into quality tokens only.";
  private missionCycles: number = 0;
  private missionStartCycle: number = 0;

  getMission(): string { return this.currentMission; }

  setMission(newMission: string): void {
    const old = this.currentMission;
    this.currentMission = newMission;
    this.missionStartCycle = this.missionCycles;
    thoughtStream.think("orchestrator", "PLAN", `📡 Mission updated: "${newMission.slice(0, 80)}"`);
    // Broadcast to all agents via thought stream + event
    for (const agentId of Object.keys(this.agents)) {
      thoughtStream.think(agentId, "READ", `📡 Mission change received: "${newMission.slice(0, 60)}"`);
    }
    this.emit("mission_changed", { mission: newMission, previousMission: old, timestamp: new Date().toISOString() });
  }

  getMissionStatus(): { mission: string; cyclesCompleted: number; cyclesTotal: number; pct: number } {
    const cyclesCompleted = this.missionCycles - this.missionStartCycle;
    const cyclesTotal = 20; // Default mission horizon
    return { mission: this.currentMission, cyclesCompleted, cyclesTotal, pct: Math.min(100, Math.round((cyclesCompleted / cyclesTotal) * 100)) };
  }

  // ─── Agent Lifecycle Control ─────────────────────────────────────────────

  activateAgent(agentId: string, intervalMs: number = 30000): boolean {
    const agent = this.agents[agentId];
    if (!agent) return false;
    if (agent.heartbeat) { agent.heartbeat.start(); } else {
      agent.heartbeat = new HeartbeatEngine(agent.wallet, this.connection, intervalMs);
      this.wireHeartbeatEvents(agent.heartbeat, agentId);
      agent.heartbeat.start();
    }
    agent.active = true;
    thoughtStream.wake(agentId, `▶ Agent activated by orchestrator command`);
    this.emit("agent_activated", { agentId, role: agent.role });
    return true;
  }

  sleepAgent(agentId: string): boolean {
    const agent = this.agents[agentId];
    if (!agent) return false;
    if (agent.heartbeat) agent.heartbeat.stop();
    if (agent.strategy instanceof (require("../strategies/DCAStrategy").DCAStrategy)) (agent.strategy as any).stop();
    agent.active = false;
    thoughtStream.sleep(agentId, `⏸ Agent put to sleep by orchestrator`);
    this.emit("agent_slept", { agentId });
    return true;
  }

  // ─── Governor: Recall Funds from Agent → Vault ──────────────────────────

  async recallFunds(agentId: string): Promise<{ success: boolean; amount: number; signature?: string; error?: string }> {
    const agent = this.agents[agentId];
    if (!agent) return { success: false, amount: 0, error: "Agent not found" };
    if (agentId === this.orchestratorWallet.agentId) return { success: false, amount: 0, error: "Cannot recall from vault" };

    const balance = await agent.wallet.getBalance();
    const recallAmount = Math.max(0, balance - 0.002); // Leave 0.002 SOL for gas

    if (recallAmount < 0.001) return { success: false, amount: 0, error: "Insufficient balance to recall" };

    try {
      thoughtStream.think("orchestrator", "EXECUTE", `↩ Governor demanding recall: ${recallAmount.toFixed(4)} SOL from ${agentId} → vault`);
      const sig = await agent.wallet.sendSOL(this.orchestratorWallet.publicKeyString, recallAmount);
      thoughtStream.success("orchestrator", `✅ Recall complete: ${recallAmount.toFixed(4)} SOL returned to vault. Sig: ${sig.slice(0, 12)}...`);
      this.emit("governor_recall", { agentId, amount: recallAmount, signature: sig, timestamp: new Date().toISOString() });
      return { success: true, amount: recallAmount, signature: sig };
    } catch (err: any) {
      thoughtStream.error("orchestrator", `Recall failed: ${err.message}`);
      return { success: false, amount: 0, error: err.message };
    }
  }

  // ─── Sack Agent (Recall + Terminate) ────────────────────────────────────

  async sackAgent(agentId: string): Promise<{ success: boolean; recalledSOL?: number; error?: string }> {
    const PROTECTED = ["orchestrator_main", "risk_manager_01"];
    if (PROTECTED.includes(agentId)) return { success: false, error: "Protected agent cannot be sacked" };

    const agent = this.agents[agentId];
    if (!agent) return { success: false, error: "Agent not found" };

    let recalledSOL = 0;
    // Recall funds first
    const recall = await this.recallFunds(agentId);
    if (recall.success) recalledSOL = recall.amount;

    // Stop all activity
    if (agent.heartbeat) agent.heartbeat.stop();
    if (agent.strategy) { try { (agent.strategy as any).stop(); } catch {} }
    agent.active = false;

    // Remove from registry
    delete this.agents[agentId];

    thoughtStream.think("orchestrator", "ALERT", `🔴 Agent ${agentId} has been sacked. ${recalledSOL ? `${recalledSOL.toFixed(4)} SOL recalled.` : ""}`);
    this.emit("agent_sacked", { agentId, recalledSOL, timestamp: new Date().toISOString() });
    return { success: true, recalledSOL };
  }

  // ─── Capital Distribution: Vault → Agents ───────────────────────────────

  async distributeCapital(strategy: "equal" | "role_based" = "role_based"): Promise<{ success: boolean; distributed: Record<string, number>; error?: string }> {
    const vaultBalance = await this.orchestratorWallet.getBalance();
    const reserveSOL = 0.1; // Keep in vault for gas
    const distributable = Math.max(0, vaultBalance - reserveSOL);

    if (distributable < 0.01) return { success: false, distributed: {}, error: `Insufficient vault balance: ${vaultBalance.toFixed(4)} SOL` };

    // Exclude vault/orchestrator itself
    const agents = Object.entries(this.agents).filter(
      ([agentId]) => agentId !== this.orchestratorWallet.agentId
    );

    if (agents.length === 0) return { success: false, distributed: {}, error: "No agents registered to receive funds" };

    // Base role weights — role_based distributes more to active trading agents
    const roleBaseWeights: Record<string, number> = {
      dca_agent:            4.0,
      trailing_stop_agent:  2.5,
      scout_agent:          2.0,
      risk_manager:         0.5,
      off_ramp_agent:       1.0,
      custom:               1.5,  // custom/factory agents get a fair share
    };

    // Calculate total weight sum across ALL registered agents dynamically
    // This means new agents are always included proportionally
    const totalWeight = strategy === "equal"
      ? agents.length
      : agents.reduce((sum, [, agent]) => sum + (roleBaseWeights[agent.role] || 1.5), 0);

    const distributed: Record<string, number> = {};
    let totalSent = 0;

    thoughtStream.plan("orchestrator",
      `💸 Distributing ${distributable.toFixed(4)} SOL across ${agents.length} agents (${strategy} strategy)`
    );

    for (const [agentId, agent] of agents) {
      const weight = strategy === "equal" ? 1 : (roleBaseWeights[agent.role] || 1.5);
      const proportion = weight / totalWeight;
      const amount = parseFloat((distributable * proportion).toFixed(4));
      if (amount < 0.001) continue;
      try {
        const sig = await this.orchestratorWallet.sendSOL(agent.wallet.publicKeyString, amount);
        distributed[agentId] = amount;
        totalSent += amount;
        thoughtStream.execute(agentId,
          `💰 Received ${amount.toFixed(4)} SOL from vault (${(proportion * 100).toFixed(1)}% share) | sig: ${sig.slice(0, 10)}...`
        );
      } catch (err: any) {
        thoughtStream.error("orchestrator", `Distribution to ${agentId} failed: ${err.message?.slice(0, 50)}`);
      }
    }

    this.emit("capital_distributed", { totalSOL: totalSent, agentCount: Object.keys(distributed).length, distributed });
    thoughtStream.success("orchestrator",
      `✅ Capital distribution complete: ${totalSent.toFixed(4)} SOL → ${Object.keys(distributed).length} agents`
    );
    return { success: true, distributed };
  }

  // ─── Risk Manager: Halt Agent ────────────────────────────────────────────

  haltAgent(agentId: string, reason: string): void {
    const agent = this.agents[agentId];
    if (!agent) return;
    if (agent.strategy) { try { (agent.strategy as any).stop(); } catch {} }
    agent.active = false;
    thoughtStream.alert(agentId, `⛔ HALTED by Risk Manager: ${reason}`);
    this.emit("risk_halt", { agentId, reason, timestamp: new Date().toISOString() });
  }

  haltAll(reason: string): void {
    for (const agentId of Object.keys(this.agents)) {
      this.haltAgent(agentId, reason);
    }
    thoughtStream.alert("orchestrator", `🚨 ALL AGENTS HALTED: ${reason}`);
  }

  // ─── Mission increment (called by heartbeat cycles) ──────────────────────

  incrementMissionCycle(): void { this.missionCycles++; }

  // ─── Detect + execute mission change from natural language ───────────────

  private detectMissionChange(command: string): string | null {
    const lower = command.toLowerCase();
    if (lower.includes("change mission") || lower.includes("new mission") || lower.startsWith("mission:")) {
      // Extract the new mission text
      const idx = lower.indexOf("mission");
      const after = command.slice(idx + 7).replace(/^[:\s-]+/, "").trim();
      if (after.length > 5) return after;
    }
    return null;
  }

  // ─── Remove Agent from Registry (used by sack route) ────────────────────

  removeAgent(agentId: string): void {
    const agent = this.agents[agentId];
    if (agent) {
      if (agent.heartbeat) agent.heartbeat.stop();
      if (agent.strategy) { try { (agent.strategy as any).stop(); } catch {} }
      delete this.agents[agentId];
    }
    thoughtStream.think("orchestrator", "EXECUTE", `🔴 ${agentId} removed from swarm registry`);
  }

  getThoughtStream() { return thoughtStream; }
  getActionLog() { return this.actionLog; }
  getAgents() { return this.agents; }
  getVaultAddress(): string { return this.orchestratorWallet.publicKeyString; }
  getVaultBalance(): Promise<number> { return this.orchestratorWallet.getBalance(); }
  getVaultWallet(): AgentWallet { return this.orchestratorWallet; }
}