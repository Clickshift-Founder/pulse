/**
 * SimulationEngine.ts — Pulse Demo Simulation
 *
 * Fires ALL demo scenarios in sequence so every dashboard metric gets populated.
 * This is triggered by POST /api/simulate from the dashboard "Run Full Demo Simulation" button.
 *
 * Scenarios covered:
 *  1.  Capital distribution vault → agents
 *  2.  DCA execution (realistic tx signature)
 *  3.  Governor blocks (over-limit + blacklisted token)
 *  4.  Rug detection + emergency block
 *  5.  Risk manager halt
 *  6.  Trailing stop trigger
 *  7.  Off-ramp execution  
 *  8.  Mission change + broadcast
 *  9.  Custom agent spawn
 *  10. Governor recall funds from agent
 *  11. Sack a custom agent
 *  12. Agent-to-agent transfer
 *  13. Multiple heartbeat cycles
 */

import { thoughtStream } from "../heartbeat/ThoughtStream";
import { EventEmitter } from "events";

// Realistic-looking Solana signatures and addresses for simulation
const SIM_SIGS = [
  "5xHBqJmYnK2rVwLZ8pQ3dNfTe6Ys1CgXuMvA4bR7oWi",
  "3tPwKcLmH9sGj4FqN7dVeA2Yx8Zr5BnMuI6oTyCpWlE",
  "7rQkDvFn3hXp2LtM9wA5cJeYg8Iu4SmBoCz6dRxNjKb",
  "4mSvBqT7yNu1RxC8aP5eGkJ3LwH6dFiZo2McEjYtXnQ",
  "9hLpDcW4kYr6MnE3sT8uBvJ2FqI7ZoXaC1RgNbSjPeA",
];
const SIM_TOKENS = [
  { name: "PEPE2024", mint: "PePe2024aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", score: 870 },
  { name: "RUGTOKEN", mint: "RUGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", score: 950 },
  { name: "BONK",     mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB32",  score: 120 },
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class SimulationEngine extends EventEmitter {
  private broadcast: (type: string, data: any) => void;
  private orchestrator: any; // Orchestrator reference
  private eventsGenerated = 0;

  constructor(broadcast: (type: string, data: any) => void, orchestrator: any) {
    super();
    this.broadcast = broadcast;
    this.orchestrator = orchestrator;
  }

  private fire(type: string, data: any, thoughtType?: string, agentId?: string, msg?: string) {
    this.broadcast(type, data);
    if (thoughtType && agentId && msg) {
      thoughtStream.think(agentId, thoughtType as any, msg);
    }
    this.eventsGenerated++;
  }

  private sig(): string { return SIM_SIGS[Math.floor(Math.random() * SIM_SIGS.length)] + Math.random().toString(36).slice(2, 6); }
  private addr(): string { return "sim" + Math.random().toString(36).slice(2, 16).toUpperCase().padEnd(16, "x") + "SoL"; }

  async runFull(): Promise<{ eventsGenerated: number; scenarios: string[] }> {
    this.eventsGenerated = 0;
    const scenarios: string[] = [];

    thoughtStream.think("orchestrator", "EXECUTE", "🎬 DEMO SIMULATION STARTING — all scenarios will fire in sequence");
    await sleep(800);

    // ── SCENARIO 1: Capital Distribution ──────────────────────────────────
    scenarios.push("Capital Distribution");
    thoughtStream.think("orchestrator", "PLAN", "💸 Distributing working capital from vault to all agents...");
    await sleep(600);
    this.fire("capital_distributed", {
      totalSOL: 0.4200,
      agentCount: 5,
      distributed: {
        dca_agent_01:       0.1680,
        trailing_agent_01:  0.1050,
        scout_agent_01:     0.0630,
        risk_manager_01:    0.0210,
        offramp_agent_01:   0.0630,
      }
    }, "SUCCESS", "orchestrator", "✅ Capital distributed: 0.4200 SOL across 5 agents");
    await sleep(1200);

    // ── SCENARIO 2: DCA Execution — BONK ─────────────────────────────────
    scenarios.push("DCA Execution");
    const dcaSig = this.sig();
    thoughtStream.think("dca_agent_01", "WAKE", "⏰ Waking up. DCA round triggered. Checking BONK price...");
    await sleep(500);
    thoughtStream.think("dca_agent_01", "EXECUTE", "⚡ Governor approved. Executing DCA: 0.0100 SOL → BONK");
    await sleep(700);
    this.fire("dca_execution", {
      agentId: "dca_agent_01",
      execution: { round: 1, amountSpent: 0.0100, amountAcquired: 142857, token: "BONK", signature: dcaSig }
    }, "SUCCESS", "dca_agent_01", `✅ DCA round 1 complete. Acquired 142,857 BONK. Sig: ${dcaSig.slice(0,12)}...`);
    await sleep(1000);

    // ── SCENARIO 3: DCA Execution 2 — More BONK ──────────────────────────
    const dcaSig2 = this.sig();
    thoughtStream.think("dca_agent_01", "WAKE", "⏰ Cycle #2. Conditions favorable. Continuing DCA.");
    await sleep(600);
    this.fire("dca_execution", {
      agentId: "dca_agent_01",
      execution: { round: 2, amountSpent: 0.0100, amountAcquired: 139240, token: "BONK", signature: dcaSig2 }
    }, "SUCCESS", "dca_agent_01", `✅ DCA round 2 complete. Total BONK position growing.`);
    await sleep(900);

    // ── SCENARIO 4: Governor Block — Over Limit ───────────────────────────
    scenarios.push("Governor Block (Over Limit)");
    thoughtStream.think("scout_agent_01", "THINK", "🤔 Found new token. Requesting 5.0 SOL position...");
    await sleep(500);
    thoughtStream.think("scout_agent_01", "ALERT", "🛡️ Governor evaluation: 5.0 SOL exceeds single transaction limit of 0.5 SOL");
    await sleep(400);
    this.fire("governor_block", {
      agentId: "scout_agent_01",
      reason: "Amount 5.0 SOL exceeds max single transaction limit of 0.5 SOL",
      requestedSOL: 5.0,
      limitSOL: 0.5,
    }, "ALERT", "orchestrator", "🛡️ Governor BLOCKED scout_agent: 5.0 SOL exceeds single tx limit");
    await sleep(1000);

    // ── SCENARIO 5: Governor Block — Blacklisted Token ────────────────────
    scenarios.push("Governor Block (Blacklisted Token)");
    thoughtStream.think("dca_agent_01", "THINK", `🤔 Evaluating new position: RUGTOKEN...`);
    await sleep(500);
    this.fire("governor_block", {
      agentId: "dca_agent_01",
      reason: `Token ${SIM_TOKENS[1].mint.slice(0,12)}... is on the blacklist`,
      token: "RUGTOKEN",
    }, "ALERT", "orchestrator", "🛡️ Governor BLOCKED dca_agent: RUGTOKEN is blacklisted");
    await sleep(900);

    // ── SCENARIO 6: Rug Detection ─────────────────────────────────────────
    scenarios.push("Rug Detection");
    thoughtStream.think("risk_manager_01", "WAKE", "👁️ Risk Manager scanning all positions via RugCheck.xyz...");
    await sleep(800);
    thoughtStream.think("risk_manager_01", "ALERT", `🚨 HIGH RISK detected: PEPE2024 score 870/1000 — potential rug`);
    await sleep(400);
    this.fire("rug_blocked", {
      agentId: "risk_manager_01",
      token: SIM_TOKENS[0].name,
      mint: SIM_TOKENS[0].mint,
      score: SIM_TOKENS[0].score,
      reason: "Score 870/1000 — high probability exit scam pattern detected",
    }, "ALERT", "risk_manager_01", `🚨 PEPE2024 score 870/1000 — auto-exit triggered to protect position`);
    await sleep(1000);

    // ── SCENARIO 7: Risk Manager Halts Scout ─────────────────────────────
    scenarios.push("Risk Manager Halt");
    thoughtStream.think("risk_manager_01", "ALERT", "⛔ Market volatility spike detected. Halting scout_agent_01 until conditions stabilize");
    await sleep(600);
    this.fire("risk_halt", {
      agentId: "scout_agent_01",
      reason: "Market volatility >15% in 1 hour — precautionary halt",
      severity: "HIGH",
    });
    thoughtStream.sleep("scout_agent_01", "⛔ Halted by Risk Manager. Awaiting clearance to resume.");
    await sleep(1000);

    // ── SCENARIO 8: Trailing Stop Trigger ────────────────────────────────
    scenarios.push("Trailing Stop");
    const trailSig = this.sig();
    thoughtStream.think("trailing_agent_01", "WAKE", "👁️ Trailing stop monitoring: BONK price polling...");
    await sleep(600);
    thoughtStream.think("trailing_agent_01", "ALERT", "📉 BONK dropped 7.3% from peak — trailing stop triggered!");
    await sleep(500);
    this.fire("stop_triggered", {
      agentId: "trailing_agent_01",
      token: "BONK",
      profitLossPct: -7.3,
      peakPrice: 0.0000142,
      currentPrice: 0.0000132,
      signature: trailSig,
    }, "SUCCESS", "trailing_agent_01", `📉 Trailing stop executed. Exit at 7.3% drawdown. Position protected.`);
    await sleep(1000);

    // ── SCENARIO 9: Off-Ramp Execution ───────────────────────────────────
    scenarios.push("Off-Ramp to Cold Wallet");
    const offRampSig = this.sig();
    thoughtStream.think("offramp_agent_01", "WAKE", "👁️ Off-Ramp agent scanning portfolio P&L...");
    await sleep(500);
    thoughtStream.think("offramp_agent_01", "EXECUTE", "💸 Portfolio up 18.3%. Threshold exceeded. Sweeping profit to cold wallet...");
    await sleep(700);
    this.fire("offramp_executed", {
      agentId: "offramp_agent_01",
      amountSwept: 0.0840,
      profitPct: 18.3,
      destinationWallet: "ColdW4llet...EmmanueL",
      signature: offRampSig,
    }, "SUCCESS", "offramp_agent_01", `✅ Off-Ramp: 0.0840 SOL swept to cold wallet. Sig: ${offRampSig.slice(0,12)}...`);
    await sleep(1000);

    // ── SCENARIO 10: Mission Change + Broadcast ───────────────────────────
    scenarios.push("Mission Change Broadcast");
    const newMission = "Aggressive accumulation mode: maximize BONK position. Deploy 80% of available capital.";
    thoughtStream.think("orchestrator", "MISSION" as any, `📡 Mission update incoming...`);
    await sleep(500);
    if (this.orchestrator) {
      this.orchestrator.setMission(newMission);
    } else {
      this.fire("mission_changed", {
        mission: newMission,
        previousMission: "Grow portfolio conservatively. Protect capital first.",
        timestamp: new Date().toISOString(),
      });
    }
    thoughtStream.think("dca_agent_01", "READ", "📡 Mission received: switching to aggressive accumulation");
    thoughtStream.think("trailing_agent_01", "READ", "📡 Mission received: widening trailing stop to 12% for longer holds");
    await sleep(1000);

    // ── SCENARIO 11: Custom Agent Spawn ──────────────────────────────────
    scenarios.push("Custom Agent Spawn");
    const spawnedId = "whale_watcher_sim_01";
    thoughtStream.think("orchestrator", "PLAN", "🏭 Factory spawning custom agent: Whale Watcher");
    await sleep(700);
    this.fire("agent_spawned", {
      agentId: spawnedId,
      roleLabel: "Whale Watcher",
      icon: "🐋",
      publicKey: this.addr(),
      explorerUrl: "https://explorer.solana.com/address/sim?cluster=devnet",
      tier: "pro",
      active: true,
      capabilities: ["Wallet monitoring", "Copy trade detection", "Alert on large movements"],
    }, "SUCCESS", "orchestrator", `🐋 Custom agent spawned: Whale Watcher (pro tier)`);
    await sleep(1000);

    // ── SCENARIO 12: Governor Recall Funds ────────────────────────────────
    scenarios.push("Governor Fund Recall");
    thoughtStream.think("orchestrator", "EXECUTE", "↩ Governor demanding recall: risk_manager has excessive allocation");
    await sleep(500);
    this.fire("governor_recall", {
      agentId: "risk_manager_01",
      amount: 0.0180,
      signature: this.sig(),
    }, "SUCCESS", "orchestrator", "↩ 0.0180 SOL recalled from risk_manager_01 → vault");
    await sleep(900);

    // ── SCENARIO 13: Sack Custom Agent ───────────────────────────────────
    scenarios.push("Agent Sacked");
    thoughtStream.think("orchestrator", "ALERT", `🔴 User sacking ${spawnedId} — recalling funds first`);
    await sleep(600);
    this.fire("agent_sacked", {
      agentId: spawnedId,
      recalledSOL: 0.0,
      reason: "User terminated agent",
      timestamp: new Date().toISOString(),
    }, "ALERT", "orchestrator", `🔴 ${spawnedId} sacked and removed from swarm`);
    await sleep(800);

    // ── SCENARIO 14: Heartbeat cycles for all agents ─────────────────────
    scenarios.push("Heartbeat Cycles");
    const agents = ["orchestrator_main", "dca_agent_01", "trailing_agent_01", "risk_manager_01", "offramp_agent_01"];
    for (let cycle = 1; cycle <= 3; cycle++) {
      for (const agentId of agents) {
        this.fire("heartbeat_cycle", { agentId, cycleNumber: cycle, durationMs: 300 + Math.floor(Math.random() * 400) });
      }
      await sleep(400);
    }

    // ── FINAL SUMMARY ─────────────────────────────────────────────────────
    thoughtStream.success("orchestrator", `🎬 Simulation complete. ${this.eventsGenerated} events fired. All dashboard metrics populated.`);
    this.fire("swarm_initialized", {
      message: "Demo simulation complete. All scenarios executed successfully.",
      agentCount: 5,
    });

    return { eventsGenerated: this.eventsGenerated, scenarios };
  }
}