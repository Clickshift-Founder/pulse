# SKILLS.md — Pulse Agentic Wallet OS
> Machine-readable capability manifest. AI agents and external systems parse this file
> to understand how to integrate with, extend, or consume the Pulse protocol.

## Identity
**System:** Pulse — Agentic Wallet Operating System  
**Protocol:** clickshift.io/pulse  
**Built on:** Solana (devnet · mainnet-ready)  
**Architecture:** Heartbeat — agents wake, think, plan, execute, sleep autonomously  
**Version:** 2.0.0  
**Live endpoint:** https://pulse.clickshift.io  
**Wallet proof:** https://pulse.clickshift.io/api/proof/wallets

---

## Active Agent Swarm

Six independent agents run simultaneously. Each has its own encrypted Solana wallet,
its own capital allocation, and its own autonomous heartbeat cycle.

| Agent ID | Role | Heartbeat | Wallet |
|---|---|---|---|
| `orchestrator_main` | AI brain + vault. Receives commands, coordinates swarm | Continuous | Protected |
| `dca_agent_01` | Dollar-cost averages into target tokens via Jupiter V6 | Every 45s | Independent |
| `trailing_agent_01` | Monitors price peaks, fires exit tx when drawdown exceeds threshold | Every 60s | Independent |
| `scout_agent_01` | Scans Raydium for new pools, runs rug filters, flags opportunities | Every 90s | Independent |
| `risk_manager_01` | RugCheck.xyz scans, concentration limits, can halt other agents | Every 75s | Protected |
| `off_ramp_agent_01` | Monitors P&L, sweeps profit to cold wallet when threshold hit | Every 120s | Independent |

---

## Core Skills

### WALLET_CREATE
Programmatically creates a new Solana wallet (Ed25519 keypair), encrypts the private key
with AES-256-GCM, and registers the agent into the live swarm immediately.
```
POST /api/agents/create
Body: { "role": "dca_agent|trailing_stop_agent|scout_agent|risk_manager|custom", "agentId": "optional" }
Response: { "agentId": "...", "publicKey": "...", "explorerUrl": "..." }
```

### WALLET_PROOF
Returns all active agent wallet public addresses with Solana Explorer links.
Use this to verify on-chain that every agent holds real SOL.
```
GET /api/proof/wallets
Response: { "agents": [{ "agentId": "...", "publicKey": "...", "balance": 0.168, "explorerUrl": "..." }] }
```

### NATURAL_LANGUAGE_EXECUTE
Send any instruction in plain English. The Orchestrator AI reasons about
the current portfolio state and executes autonomously. No structured commands required.
```
POST /api/execute
Headers: { "x-pulse-secret": "<secret>", "Content-Type": "application/json" }
Body: { "command": "Start DCA on BONK with 0.01 SOL every 5 minutes" }
Response: { "response": "...", "actionsPlanned": [...], "governorApproved": true }
```

### PORTFOLIO_STATUS
```
GET /api/portfolio
Response: { "totalPortfolioSOL": 1.24, "agentCount": 6, "agents": [...], "recentThoughts": [...] }
```

### MISSION_UPDATE
Change the active mission directive. All agents receive and acknowledge on next heartbeat cycle.
No restart required.
```
POST /api/mission
Body: { "mission": "Accumulate SOL aggressively. DCA into BONK daily. Protect 30% as vault reserve." }
```

### AGENT_LIFECYCLE
Full lifecycle management for non-protected agents.
```
POST /api/agents/:agentId/activate     — start heartbeat
POST /api/agents/:agentId/sleep        — pause heartbeat
POST /api/agents/:agentId/recall       — return agent's SOL to vault (real on-chain tx)
DELETE /api/agents/:agentId/sack       — terminate agent, recall funds, deregister
POST /api/agents/:agentId/revive       — reload wallet from disk, re-register, restart heartbeat
```

### CAPITAL_DISTRIBUTION
```
POST /api/agents/distribute            — split vault SOL across all active agents
POST /api/vault/drain                  — recall all agent SOL back to vault
```

### ON_CHAIN_PROOF
Executes 5 real devnet SOL micro-transfers between agent wallets in sequence.
Each hop produces a real signature verifiable on Solana Explorer.
```
POST /api/demo/prove
Response: { "signatures": [...], "explorerLinks": [...] }
```

### THOUGHT_STREAM
Real-time agent consciousness stream via WebSocket.
Every agent thought — wake, read, think, plan, execute, sleep — is broadcast live.
```
WebSocket: wss://pulse.clickshift.io
Event: { "type": "thought", "data": { "agentId": "...", "type": "WAKE|READ|THINK|PLAN|EXECUTE|SLEEP|ALERT|SUCCESS|ERROR", "message": "...", "timestamp": "..." } }
```

All broadcast event types:
```
thought | heartbeat_cycle | dca_execution | stop_triggered | agent_registered |
agent_sacked | capital_distributed | mission_changed | emergency_exit_required |
offramp_executed | swarm_initialized | governor_blocked
```

### TOKEN_PRICE
```
GET /api/price/:mintAddress
Response: { "mint": "...", "price": 178.82, "timestamp": "..." }
```

### THOUGHT_HISTORY
```
GET /api/thoughts?count=50
GET /api/thoughts/:agentId
```

### GOVERNOR_STATUS
```
GET /api/governor/status
Response: { "spentToday": 0.03, "dailyLimit": 2.0, "totalApproved": 14, "totalBlocked": 2, "approvalRate": "87.5%" }
```

### SYSTEM_HEALTH
```
GET /api/health
Response: { "status": "ok", "initialized": true, "agents": 6, "uptime": 3847, "network": "devnet" }
```

---

## Heartbeat Architecture

Every agent runs an independent HeartbeatEngine. On each cycle:

1. **WAKE** — Agent activates, logs cycle number, checks running state
2. **READ** — Reads `HEARTBEAT.md` directives and fetches live market prices
3. **THINK** — Routes to Orchestrator with full portfolio context for AI reasoning
4. **PLAN** — Decides actions (rule-based fallback if no OpenAI key present)
5. **EXECUTE** — Submits to the Governor for 7-layer safety check, then signs and broadcasts
6. **SLEEP** — Logs result, emits `cycle_complete`, waits for next interval

To change agent behavior without restart: edit `HEARTBEAT.md`. Changes take effect on next cycle.

---

## Security Architecture

### Key Management
- All private keys encrypted with **AES-256-GCM** at rest
- Private key decrypted **in-memory only** for the duration of signing — never persisted in plaintext
- Each agent has a **completely independent keypair** — compromise of one exposes nothing about others
- Wallet files stored in `agent_wallets/` — back up this directory and your `ENCRYPTION_SECRET`

### The Governor (7-Layer Safety System)
Every transaction — without exception — must pass all seven layers before any SOL moves:

| Layer | Rule |
|---|---|
| 1 | Agent cannot spend more than it holds |
| 2 | No single transaction exceeds 0.5 SOL |
| 3 | Maximum 2.0 SOL per day across all agents |
| 4 | Slippage must stay below 3% |
| 5 | Pool must meet minimum liquidity threshold |
| 6 | Token must not appear on blacklist |
| 7 | RugCheck.xyz score must be below 500/1000 |

The Governor also has fund recall authority — it can instruct any agent to return all SOL to the vault instantly.

---

## Available Strategies

| Strategy | Agent | Trigger | Description |
|---|---|---|---|
| DCA | `dca_agent_01` | Heartbeat interval | Buy target token via Jupiter V6 every N seconds |
| Trailing Stop | `trailing_agent_01` | Price poll | Autonomous exit when drawdown from peak exceeds threshold |
| Rug Exit | `risk_manager_01` | Heartbeat | Auto-exit position if RugCheck score spikes above threshold |
| Scout + Sniper | `scout_agent_01` | Heartbeat | Scan new pools, rug-filter, flag clean opportunities |
| Off-Ramp Sweep | `off_ramp_agent_01` | P&L threshold | Sweep profits to cold wallet when gain % target is hit |
| Custom | Any spawned agent | Configurable | Factory-spawned agents with arbitrary strategy and heartbeat |

---

## Emergency Controls

Edit `HEARTBEAT.md` and set any of these flags. Agent picks up changes on next heartbeat — no restart:
```
EMERGENCY_STOP: true         # Halts all agents immediately on next cycle
EMERGENCY_EXIT_ALL: true     # Exits all open positions
PAUSE_DCA: true              # Pauses DCA without stopping other strategies
```

Or via API:
```
POST /api/execute
Body: { "command": "Emergency stop. Halt all agents and return funds to vault." }
```

---

## External Integration Pattern (Telegram / Any App)
```javascript
// Clickbot integration — live in production at @clicksolbot
const response = await axios.post('https://pulse.clickshift.io/api/execute', {
  command: userMessage   // plain English — AI handles the rest
}, {
  headers: { 'x-pulse-secret': process.env.PULSE_SECRET }
});
bot.sendMessage(chatId, response.data.response);
```

### Live Telegram Commands (production, @clicksolbot)
```
/pulse                    — full swarm status
/pulse_deploy [command]   — natural language instruction to orchestrator
/pulse_mission [text]     — update active mission directive
/pulse_fund               — get vault address to deposit SOL
/pulse_agents             — all agent wallets + balances + Explorer links
/pulse_recall [agentId]   — recall SOL from agent to vault
/pulse_sack [agentId]     — terminate agent and recall funds
/pulse_sim                — trigger demonstration simulation
/pulse_trades             — wallet proof + on-chain transaction links
```

---

## Repository Structure
```
src/
  agent/        — Orchestrator, MetricsEngine, SimulationEngine, AgentFactory
  heartbeat/    — HeartbeatEngine, ThoughtStream, AgentPersonality
  wallet/       — AgentWallet (AES-256-GCM), key management
  integrations/ — JupiterSwap (V6), RugCheck, clickbot/pulse-bridge
  api/          — server.ts, Governor, all REST + WebSocket endpoints
  dashboard/
    public/     — dashboard.html, graph.html, metrics.html, docs.html, submission.html
HEARTBEAT.md    — live directive file, read by all agents every cycle
SKILLS.md       — this file
```

---

*Pulse is the agentic wallet infrastructure layer for Solana.*  
*Built by clickshift.io — the brain that powers autonomous agents onchain for profit.*  
*Mainnet roadmap: Solana → Base → chain-abstracted.*