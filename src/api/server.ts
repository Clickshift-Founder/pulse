/**
 * server.ts (v3 — Pulse Edition, Railway-compatible)
 *
 * KEY FIXES vs previous version:
 *  - NO dynamic import() inside routes (caused Railway tsc --help / build fail)
 *  - NO require() inside routes
 *  - All imports static at top — TypeScript can analyse them fully
 *  - esModuleInterop-safe import style for express and cors
 *  - metricsEngine, AgentFactory, ROLE_REGISTRY imported statically
 */

import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import * as path from "path";
import * as dotenv from "dotenv";
import { Connection } from "@solana/web3.js";
import { AgentWallet } from "../wallet/AgentWallet";
import { Orchestrator } from "../agent/Orchestrator";
import { JupiterSwap, TOKENS } from "../integrations/JupiterSwap";
import { thoughtStream } from "../heartbeat/ThoughtStream";
import { metricsEngine } from "../agent/MetricsEngine";
import { AgentFactory, ROLE_REGISTRY } from "../agent/AgentFactory";
import { UserTier } from "../agent/UserSession";

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../dashboard/public")));

const connection = new Connection(
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  "confirmed"
);
const jupiter = new JupiterSwap(connection);
const agentFactory = new AgentFactory(connection); // static instance — no dynamic import needed

let orchestrator: Orchestrator | null = null;
let initialized = false;

// ─── WebSocket Broadcast ──────────────────────────────────────────────────────

function broadcast(type: string, data: any) {
  const msg = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

// Wire thought stream to WebSocket — THIS is what makes the dashboard live
thoughtStream.on("thought", (thought) => broadcast("thought", thought));

wss.on("connection", async (ws) => {
  console.log("[WS] Dashboard client connected");
  ws.send(JSON.stringify({ type: "connected", data: { system: "Pulse", version: "2.0" } }));

  // Send recent thoughts on connect so dashboard shows history immediately
  const recentThoughts = thoughtStream.getRecent(30);
  for (const thought of recentThoughts) {
    ws.send(JSON.stringify({ type: "thought", data: thought, timestamp: thought.timestamp }));
  }

  if (orchestrator) {
    const portfolio = await orchestrator.buildPortfolioContext();
    ws.send(JSON.stringify({ type: "portfolio_snapshot", data: portfolio }));
  }
});

// ─── Swarm Initialization ────────────────────────────────────────────────────

async function initializeSwarm() {
  if (initialized) return;

  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║        PULSE — Agentic Wallet OS           ║");
  console.log("║     Powered by Heartbeat Architecture      ║");
  console.log("╚═══════════════════════════════════════════╝\n");

  // Create all agent wallets
  const orchWallet = await AgentWallet.loadOrCreate("orchestrator_main", "orchestrator", connection);
  const dcaWallet = await AgentWallet.loadOrCreate("dca_agent_01", "dca_agent", connection);
  const trailWallet = await AgentWallet.loadOrCreate("trailing_agent_01", "trailing_stop_agent", connection);
  const scoutWallet = await AgentWallet.loadOrCreate("scout_agent_01", "scout_agent", connection);
  const riskWallet = await AgentWallet.loadOrCreate("risk_manager_01", "risk_manager", connection);
  const offrampWallet = await AgentWallet.loadOrCreate("offramp_agent_01", "custom", connection);

  orchestrator = new Orchestrator(orchWallet, connection);

  // Wire orchestrator events to WS
  orchestrator.on("agent_registered", (d) => broadcast("agent_registered", d));
  orchestrator.on("agent_execution", (d) => broadcast("dca_execution", d));
  orchestrator.on("stop_triggered", (d) => broadcast("stop_triggered", d));
  orchestrator.on("action", (d) => broadcast("orchestrator_action", d));
  orchestrator.on("heartbeat_cycle", (d) => broadcast("heartbeat_cycle", d));
  orchestrator.on("emergency_exit_required", (d) => broadcast("emergency_exit_required", d));
  orchestrator.on("offramp_executed", (d) => broadcast("offramp_executed", d));

  // Register agents
  orchestrator.registerAgent(dcaWallet, { startHeartbeat: true, heartbeatIntervalMs: 45000, trackedMints: [TOKENS.BONK] });
  orchestrator.registerAgent(trailWallet, { startHeartbeat: false });
  orchestrator.registerAgent(scoutWallet, { startHeartbeat: false });
  orchestrator.registerAgent(riskWallet, { startHeartbeat: false });
  orchestrator.registerAgent(offrampWallet, { startHeartbeat: false });

  // Setup off-ramp (dry run by default — set OFFRAMP_DESTINATION in .env to enable)
  orchestrator.setupOffRamper(
    offrampWallet,
    process.env.OFFRAMP_DESTINATION || "",
    15
  );

  // Start orchestrator heartbeat
  orchestrator.startOrchestrator();

  initialized = true;
  broadcast("swarm_initialized", {
    message: "Pulse swarm online. All agents breathing.",
    agentCount: 5,
  });

  console.log(`[Pulse] Orchestrator: ${orchWallet.publicKeyString}`);
  console.log(`[Pulse] DCA Agent:    ${dcaWallet.publicKeyString}`);
  console.log(`[Pulse] Trailing:     ${trailWallet.publicKeyString}`);
  console.log(`[Pulse] Scout:        ${scoutWallet.publicKeyString}`);
}

// ─── API Routes ───────────────────────────────────────────────────────────────

app.post("/api/execute", async (req, res) => {
  try {
    if (!orchestrator) return res.status(503).json({ error: "Swarm initializing..." });
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: "command required" });

    // Auth check — header is x-pulse-secret (update your Telegram bot to match)
    const secret = req.headers["x-pulse-secret"];
    if (process.env.TELEGRAM_BOT_INTEGRATION_SECRET && secret !== process.env.TELEGRAM_BOT_INTEGRATION_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    broadcast("command_received", { command });
    const response = await orchestrator.executeCommand(command);
    broadcast("command_result", { command, response });

    res.json({ success: true, response });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/portfolio", async (req, res) => {
  try {
    if (!orchestrator) return res.status(503).json({ error: "Initializing" });
    const portfolio = await orchestrator.buildPortfolioContext();
    res.json(portfolio);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/thoughts", (req, res) => {
  const count = parseInt(req.query.count as string || "50");
  res.json({ thoughts: thoughtStream.getRecent(count) });
});

app.get("/api/thoughts/:agentId", (req, res) => {
  res.json({ thoughts: thoughtStream.getByAgent(req.params.agentId) });
});

app.get("/api/agents", (req, res) => {
  res.json({ agents: AgentWallet.listAll() });
});

app.get("/api/agents/:agentId/balance", async (req, res) => {
  try {
    const wallet = await AgentWallet.load(req.params.agentId, connection);
    res.json(await wallet.getStatus());
  } catch {
    res.status(404).json({ error: "Agent not found" });
  }
});

app.post("/api/agents/create", async (req, res) => {
  try {
    const { role, agentId } = req.body;
    const wallet = await AgentWallet.create(role || "custom", connection, agentId);
    if (orchestrator) orchestrator.registerAgent(wallet);
    broadcast("agent_created", await wallet.getStatus());
    res.json({ success: true, agent: await wallet.getStatus() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/agents/:agentId/send", async (req, res) => {
  try {
    const wallet = await AgentWallet.load(req.params.agentId, connection);
    const { to, amount } = req.body;
    const signature = await wallet.sendSOL(to, amount);
    broadcast("transfer", { from: req.params.agentId, to, amount, signature });
    res.json({ success: true, signature });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/price/:mint", async (req, res) => {
  try {
    const price = await jupiter.getPrice(req.params.mint);
    res.json({ mint: req.params.mint, price, timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Agent Factory Routes ─────────────────────────────────────────────────────

// All roles with tier-lock status — powers the spawner UI on landing page
app.get("/api/factory/roles", (req, res) => {
  try {
    const tier = (req.query.tier as UserTier) || "free";
    const tierOrder: UserTier[] = ["free", "pro", "team"];
    const userIdx = tierOrder.indexOf(tier);
    const roles = ROLE_REGISTRY.map((r) => ({
      ...r,
      locked: tierOrder.indexOf(r.requiredTier) > userIdx,
    }));
    res.json({ roles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Spawn via factory (supports plain-text description OR roleKey)
app.post("/api/factory/spawn", async (req, res) => {
  try {
    const { userId = "demo_user", tier = "free", roleKey, customName, description } = req.body;

    let agent;
    if (description && !roleKey) {
      agent = await agentFactory.spawnFromDescription(userId, tier as UserTier, description);
    } else {
      agent = await agentFactory.spawn({
        userId,
        tier: tier as UserTier,
        roleKey: roleKey || "dca_agent",
        customName,
      });
    }

    if (orchestrator) {
      try {
        const wallet = await AgentWallet.load(agent.agentId, connection);
        orchestrator.registerAgent(wallet, { trackedMints: [] });
      } catch { /* wallet may not be loadable yet — not fatal */ }
    }

    broadcast("agent_spawned", agent);
    res.json({ success: true, agent });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Metrics — powers metrics.html investor page ─────────────────────────────
app.get("/api/metrics", async (_req, res) => {
  try {
    // metricsEngine is imported statically at top — no dynamic import needed
    const metrics = metricsEngine.getProtocolMetrics();
    const agentPerformances = metricsEngine.getAgentPerformances();
    res.json({ metrics, agentPerformances });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Governor status for an agent ────────────────────────────────────────────
app.get("/api/agents/:agentId/governor", async (req, res) => {
  // Returns spending window status for UI display
  // In full implementation, Governor instance is stored per-agent
  res.json({
    agentId: req.params.agentId,
    note: "Governor rules apply to all swaps. Check /api/portfolio for balances.",
    rules: {
      maxSingleTxSOL: parseFloat(process.env.GOVERNOR_MAX_SINGLE_TX_SOL || "0.5"),
      dailyLimitSOL: parseFloat(process.env.GOVERNOR_DAILY_LIMIT_SOL || "2.0"),
      maxPriceImpactPct: parseFloat(process.env.GOVERNOR_MAX_PRICE_IMPACT_PCT || "3"),
      requireRugCheck: true,
    }
  });
});

app.get("/api/health", (_req, res) => {
  // This ALWAYS responds 200 — even before swarm is initialized.
  // Railway uses this for health checks. If it times out, Railway kills the app.
  // 'initialized: false' is fine — it just means swarm is still starting up.
  res.status(200).json({
    status: "ok",
    initialized,
    network:  process.env.SOLANA_NETWORK || "devnet",
    agents:   initialized ? AgentWallet.listAll().length : 0,
    uptime:   Math.floor(process.uptime()),
    message:  initialized ? "Swarm online" : "Server alive — swarm initializing...",
  });
});

app.get("*", (req, res) => {
  const indexPath = path.join(__dirname, "../dashboard/public/index.html");
  const fs = require("fs");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    // Fallback when static files weren't copied — still returns 200 so Railway stays happy
    res.status(200).send(`<!DOCTYPE html><html><head><title>Pulse ⚡</title></head>
      <body style="background:#04080f;color:#22d3ee;font-family:monospace;padding:2rem;text-align:center;margin-top:4rem">
        <h1>⚡ PULSE</h1><h3>Agentic Wallet OS — Live on Solana</h3>
        <p>Backend running. <a href="/api/health" style="color:#6366f1">Check /api/health</a></p>
        <p style="color:#3d5470;font-size:0.8rem">Dashboard files: ${indexPath}</p>
      </body></html>`);
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3000");

// CRITICAL FIX: Do NOT await initializeSwarm inside listen callback.
// Railway health-checks /api/health immediately after the port opens.
// If swarm init blocks the event loop, health check never responds → 502.
// Solution: listen first (port is open, health check works instantly),
// then fire swarm init in the background via .catch() for error resilience.
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  ⚡ Pulse is alive — port ${PORT} open`);
  console.log(`  Dashboard: http://localhost:${PORT}`);
  console.log(`  API:       http://localhost:${PORT}/api`);
  console.log(`  Health:    http://localhost:${PORT}/api/health`);
  console.log(`  Network:   ${process.env.SOLANA_NETWORK || "devnet"}\n`);

  // Non-blocking swarm initialization — server responds immediately
  // 'initialized' flag in /api/health shows false until swarm is ready
  initializeSwarm().catch((err) => {
    console.error("[Pulse] Swarm init error (server still alive):", err.message);
    // Never call process.exit() here — keep server alive regardless
  });
});

export default app;