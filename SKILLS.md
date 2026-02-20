# SKILLS.md — Pulse Agentic Wallet OS
> Machine-readable capability manifest. AI agents parse this file to understand how to integrate with Pulse.

## Identity
**System:** Pulse — Agentic Wallet OS  
**Built on:** Solana  
**Architecture:** Heartbeat — agents wake, think, plan, execute, sleep autonomously  
**Version:** 2.0.0

---

## Core Skills

### WALLET_CREATE
```
POST /api/agents/create
Body: { "role": "dca_agent|trailing_stop_agent|scout_agent|risk_manager", "agentId": "optional" }
```

### NATURAL_LANGUAGE_EXECUTE
Send any natural language command. The AI Orchestrator reasons and acts.
```
POST /api/execute
Headers: { "x-sentinel-secret": "<secret>", "Content-Type": "application/json" }
Body: { "command": "Start DCA on BONK with 0.01 SOL every 5 minutes" }
```

### THOUGHT_STREAM
Real-time agent consciousness stream via WebSocket.
```
WebSocket: ws://host:port
Event types: thought | heartbeat_cycle | dca_execution | stop_triggered | emergency_exit_required | offramp_executed
```

### PORTFOLIO_STATUS
```
GET /api/portfolio
```

### TOKEN_PRICE
```
GET /api/price/:mintAddress
```

### THOUGHT_HISTORY
```
GET /api/thoughts?count=50
GET /api/thoughts/:agentId
```

---

## Heartbeat Architecture
Every agent has a configurable heartbeat interval. On each cycle:
1. **WAKE** — Agent becomes active
2. **READ** — Reads HEARTBEAT.md directives + market data
3. **THINK** — AI reasons about current state vs mission
4. **PLAN** — Decides what actions to take
5. **EXECUTE** — Signs and sends transactions autonomously
6. **SLEEP** — Goes dormant until next cycle

To change agent behavior: edit `HEARTBEAT.md`. Agent picks up changes on next cycle. No restart needed.

---

## Self-Preservation
Pulse agents run rug-pull detection via RugCheck.xyz API.
If a held token scores above the critical threshold, the agent autonomously exits the position.

---

## Available Strategies
| Strategy | Trigger | Description |
|---|---|---|
| DCA | Cron | Buy X tokens every N interval |
| Trailing Stop | Price poll | Sell if drops N% from peak |
| Rug Exit | Heartbeat | Auto-exit on rug detection |
| Off-Ramp Sweep | Profit % | Sweep profits to cold wallet |

---

## Emergency Controls
Edit `HEARTBEAT.md` and uncomment:
- `EMERGENCY_STOP: true` — halts all agents on next cycle
- `EMERGENCY_EXIT_ALL: true` — exits all positions
- `PAUSE_DCA: true` — pauses DCA without stopping

---

## Telegram Bot Integration Pattern
```javascript
const response = await axios.post('http://localhost:3000/api/execute', {
  command: userMessage
}, {
  headers: { 'x-sentinel-secret': process.env.PULSE_SECRET }
});
bot.sendMessage(chatId, response.data.response);
```

---
*Pulse — Built for the Superteam Nigeria DeFi Agentic Wallets Bounty.*  
*clickshift.io — Building the brain that powers autonomous agents onchain.*