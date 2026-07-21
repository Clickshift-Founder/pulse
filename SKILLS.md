# Pulse — Complete User Guide & Journey
## From First Contact to Running Autonomous Agents

---

## What is Pulse?

Pulse is an **Agentic Wallet OS** on Solana. You connect your existing Phantom wallet, and Pulse creates a private fleet of AI-powered "sub-wallets" that trade, DCA, protect your positions, and sweep profits — all autonomously, without you needing to click a button.

Think of it as hiring a 24/7 trading desk that never sleeps, never panics, and can't be bribed or manipulated. But you set the rules, and the Governor makes sure the AI follows them.

---

## The One-Sentence Pitch

> You deposit SOL. Pulse's agents grow it. You watch them think in real-time.

---

## User Journey — End to End

### Stage 1: Discovery

**How users find Pulse:**
- Superteam bounty announcement (initial launch credibility)
- `pulse.clickshift.io` — your product domain
- Your existing Clickbot Telegram community — existing users who already trust you
- Twitter/X: "Watch AI agents trade on Solana in real-time" + screen recording of the thought stream
- Word of mouth: "There's a dashboard where you can literally watch bots think"

---

### Stage 2: First Contact — Connecting to Pulse

1. User opens `pulse.clickshift.io`
2. They see the live dashboard with the thought stream already running (swarm is public-visible)
3. They see agents thinking in real-time — WAKE, READ, THINK, EXECUTE, SLEEP — before even logging in
4. A banner says: **"These are Pulse's demo agents. Connect your wallet to get your own."**
5. User clicks **"Connect Wallet"** button (top right)

**Currently in the code:** Wallet connection is NOT yet integrated in the UI. It exists as a concept in `UserSession.ts` but there's no Phantom adapter in the dashboard yet. You need `@solana/wallet-adapter-react` for this — it's the standard Solana wallet connection library. For the bounty demo, this is fine to skip. For production, add it in the next sprint.

**For the bounty demo:** The demo shows YOUR agents. Judges see the thought stream. You can describe multi-user as the roadmap.

---

### Stage 3: Wallet Authentication (No Password, No Email)

The moment they click "Connect Wallet":

1. Phantom (or Solflare/Backpack) pops up asking to connect — standard wallet approval
2. Once connected, Pulse asks them to **sign a message** (not a transaction — no SOL spent):
   ```
   Sign to log into Pulse
   Nonce: pulse-login-abc123-1234567890
   ```
3. This signature proves they own the wallet — it's their identity
4. Pulse creates their session — **no email, no password, no KYC**
5. Their wallet address IS their user ID — full DeFi-native auth

---

### Stage 4: Getting an Agent Swarm

Once logged in, Pulse automatically spawns their personal agent swarm:

**Free tier:**
- 1 Orchestrator wallet (AI brain)
- 1 DCA Agent wallet
- Total: 2 agent wallets

**Pro tier ($29/mo or in-app PULSE token):**
- + Trailing Stop Agent
- + Risk Manager
- Faster heartbeat (1 min vs 5 min)

The user sees their 2-5 agent wallets appear in the dashboard, each with a Solana address and 0 SOL balance.

---

### Stage 5: Funding — Vault vs Agent Wallets

**The key question: "Do I fund each agent or just one place?"**

**Answer: You fund the VAULT only. Pulse handles the rest.**

**Flow:**
1. User goes to "Fund Vault" in the dashboard
2. They send SOL from their Phantom wallet to their **Vault address** (displayed in UI)
   - The Vault is a read-only wallet Pulse shows them — it's just a Solana address
   - They can send from Phantom directly: copy address, paste in Phantom, send
3. Pulse's Orchestrator Agent detects the Vault balance
4. It distributes capital to sub-agents based on their config:
   - 40% stays in Vault (Governor enforced — AI can't touch the reserve)
   - 30% → DCA Agent
   - 20% → Trailing Stop Agent
   - 10% → Scout/Risk

**Security:** The user keeps custody of the Vault address. Pulse agents only control the sub-wallets it created. If the user wants to exit completely, they can always drain the sub-wallets by adding their own wallet to the whitelist or using the emergency stop.

**Minimum to start:** 0.2 SOL recommended (covers gas + meaningful DCA positions)

---

### Stage 6: Configuring Their Strategy

Users configure strategy through the **dashboard UI** (not by editing a file):

```
┌─────────────────────────────────────────────┐
│  My Strategy Settings                        │
│                                              │
│  Mission: [Grow portfolio 5% this week ____] │
│                                              │
│  DCA Target: [BONK ▼]                        │
│  DCA Amount: [0.01] SOL per round            │
│  DCA Interval: [Every 5 minutes ▼]           │
│                                              │
│  Trailing Stop: [7]% below peak              │
│  Rug Check: [ON ●]                           │
│  Max Price Impact: [3]%                      │
│                                              │
│  Off-Ramp at: [15]% profit                   │
│  Off-Ramp to: [your-cold-wallet ____]         │
│                                              │
│  [Save Settings]  [Emergency Stop 🚨]         │
└─────────────────────────────────────────────┘
```

When they hit Save, it updates their `UserConfig` in the database. The next heartbeat cycle, their agents pick up the new rules. **This is the per-user equivalent of editing HEARTBEAT.md.**

---

### Stage 7: Watching Agents Work

The main dashboard shows:
- **Left panel**: Their agents, balances, status badges
- **Center**: The thought stream — their agents' internal monologue, live
- **Right**: Command center — natural language control

They'll see thoughts like:
```
⏰ [their_dca_agent] Waking up. Cycle #12.
📖 [their_dca_agent] Reading strategy config...
📊 [their_dca_agent] Portfolio: 0.3 SOL (~$54). SOL at $180.
🤔 [their_dca_agent] Thinking... Mission: "Grow 5% this week"
📋 [their_dca_agent] Plan: Execute DCA round. 0.01 SOL → BONK
🛡️ [their_dca_agent] Governor: Checking 7 safety rules...
✅ [their_dca_agent] Governor APPROVED. All checks passed.
⚡ [their_dca_agent] Executing swap via Jupiter...
✅ [their_dca_agent] DCA Round 12 complete. Acquired 420,000 BONK
💤 [their_dca_agent] Sleeping 60 seconds.
```

Every transaction links to Solana Explorer so they can verify it's real.

---

### Stage 8: Natural Language Commands

They can type anything in the command box:
- *"How is my portfolio doing?"*
- *"Stop DCA until tomorrow"*
- *"I'm nervous about the market — reduce risk exposure"*
- *"Take profits now and sweep to my cold wallet"*

The AI Orchestrator reasons about their specific portfolio and acts.

---

### Stage 9: Off-Ramping (Profits Back to Reality)

When profit target is hit:
1. Off-Ramp Agent detects portfolio is up 15%
2. It logs: `🎯 PROFIT TARGET HIT! +15.3% gain. Sweeping 80% of profits to cold wallet...`
3. SOL is sent autonomously to their designated cold wallet
4. **To connect to Clickbot's bank offramp**: cold wallet → Clickbot → bank bridge
   - This is the integration point: Pulse sends to an address that Clickbot monitors
   - Clickbot detects incoming SOL and triggers the bank offramp process
   - Users get their profit in their bank account without touching anything

---

## Clickbot Integration — The Right Answer

**Should you integrate Clickbot INTO Pulse or build capabilities into Pulse?**

**Keep them separate, but wire them together at the seams.** Here's why:

Clickbot is your bank bridge — that's a distinct, regulated-adjacent product with its own user base, trust, and flows. Pulse is autonomous DeFi strategy execution. They serve adjacent use cases but are architecturally different.

**The integration points:**
1. **Off-ramp**: Pulse sweeps profits to a Clickbot-monitored wallet → Clickbot handles the fiat conversion
2. **Funding**: Clickbot users can "Fund Pulse" by moving SOL from their Clickbot wallet to their Pulse Vault address
3. **Reporting**: Clickbot can call `pulse.clickshift.io/api/portfolio` to show users their Pulse balance inside Telegram

**In Clickbot, add:**
```javascript
// When user types /pulse_status in Telegram:
const portfolio = await axios.get('https://pulse.clickshift.io/api/portfolio', {
  headers: { 'x-pulse-secret': process.env.PULSE_SECRET }
});
bot.sendMessage(chatId, `Your Pulse portfolio: ${portfolio.data.totalPortfolioSOL} SOL`);

// When user says "send profits to bank":
// 1. Clickbot reads the Pulse off-ramp wallet balance
// 2. Triggers your existing bank bridge
// Done — no code changes in Pulse needed
```

This preserves each product's identity while creating a unified experience for your users.

---

## How External Agents Use Pulse

Any AI agent (not just humans) can use Pulse as their wallet infrastructure:

```python
# An AI agent that wants to execute DeFi strategies
import requests

class PulseClient:
    def __init__(self, base_url, secret):
        self.base = base_url
        self.headers = {'x-pulse-secret': secret, 'Content-Type': 'application/json'}

    def command(self, instruction: str) -> str:
        r = requests.post(f'{self.base}/api/execute',
                         json={'command': instruction},
                         headers=self.headers)
        return r.json()['response']

    def portfolio(self) -> dict:
        return requests.get(f'{self.base}/api/portfolio', headers=self.headers).json()

# Usage by any AI agent:
pulse = PulseClient('https://pulse.clickshift.io', 'your-secret')
pulse.command('Start DCA on BONK with 0.01 SOL every 5 minutes')
pulse.command('Set trailing stop at 7% on all positions')
print(pulse.portfolio())
```

New agent roles that don't exist yet (self-generating engine):
```
POST /api/agents/create
{ "role": "sniper_agent", "agentId": "user_sniper_v1" }
```
→ Pulse spawns a new wallet with a custom role. The orchestrator can assign strategies to it. This is the self-generating engine — any role, any time, on demand.

---

## Summary: What Users Need to Do

| Step | Action                                     | Time       |
|------|--------------------------------------------|---------   |
| 1    | Go to pulse.clickshift.io                  | 10 seconds |
| 2    | Click Connect Wallet → Approve in Phantom  | 15 seconds |
| 3    | Sign login message in Phantom              | 5 seconds  |
| 4    | See your 2 agent wallets appear            | Instant    |
| 5    | Copy Vault address → Send SOL from Phantom | 1 minute   |
| 6    | Set strategy (DCA target, amount, interval)| 2 minutes  |
| 7    | Watch agents think and trade               | Passive    |
| 8    | Collect profits to cold wallet (auto)      | 0 effort   |

**Total setup: under 5 minutes. After that: zero effort required.**

---

*Pulse — The brain that powers autonomous agents onchain.*
*pulse.clickshift.io · clickshift.io · Built in Nigeria 🇳🇬*