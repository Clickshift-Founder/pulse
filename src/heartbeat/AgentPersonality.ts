/**
 * AgentPersonality.ts
 *
 * Makes agents feel alive. Each agent has a distinct voice, opinions,
 * and reacts to market conditions like a real trader would.
 *
 * Called by HeartbeatEngine and the awakening sequence.
 * This is what makes the first 12 seconds of the demo unforgettable.
 */

import { thoughtStream } from "./ThoughtStream";

// ─── Agent Personalities ──────────────────────────────────────────────────────

export const PERSONALITIES: Record<string, {
  name: string;
  emoji: string;
  greetings: string[];
  marketBullish: string[];
  marketBearish: string[];
  marketFlat: string[];
  working: string[];
  sleeping: string[];
  toOthers: Record<string, string[]>;
}> = {
  orchestrator_main: {
    name: "Orchestrator",
    emoji: "🧠",
    greetings: [
      "GM. Vault secure. All agents accounted for. Let's get to work.",
      "Good morning. Portfolio intact overnight. No incidents. Proceeding.",
      "Rise and shine. Capital is waiting. Time to make it work.",
      "Another day, another opportunity to compound. Swarm, report in.",
      "GM everyone. Markets never sleep and neither does the vault.",
    ],
    marketBullish: [
      "SOL momentum is strong. Increasing DCA allocation this cycle.",
      "Green across the board. Signalling DCA agent: conditions are favourable.",
      "Market structure looks healthy. Deploying capital with conviction today.",
      "Bullish divergence on volume. Telling the swarm: controlled aggression.",
    ],
    marketBearish: [
      "Red candles incoming. Switching to capital preservation mode.",
      "Volatility spike detected. Pulling back DCA. Risk Manager — eyes up.",
      "Macro looks shaky. Reducing exposure. Better to be safe than liquidated.",
      "Bear pressure mounting. Telling scouts to stand down. Vault protecting capital.",
    ],
    marketFlat: [
      "Consolidation phase. DCA is the right play here — slow and steady.",
      "Sideways action. Accumulating quietly. No panic, no FOMO.",
      "Market resting. Using this time to rebalance weights across agents.",
      "Range-bound conditions. Patient capital wins in environments like this.",
    ],
    working: [
      "Reviewing all agent balances. Everyone still alive and funded.",
      "Running portfolio stress test. All positions within risk parameters.",
      "Checking mission alignment. Every agent is executing correctly.",
      "Governor reports no violations today. Clean operation.",
      "Off-ramper is monitoring P&L. Profit sweep conditions not yet met.",
      "Coordinating DCA and trailing stop strategies for optimal entry.",
    ],
    sleeping: [
      "Cycle complete. Swarm is breathing. Back to monitoring.",
      "All checks passed. Going back to standby. Wake me if something moves.",
      "Nothing to act on. Patience is a strategy too.",
    ],
    toOthers: {
      dca_agent_01: [
        "DCA — what's your read on BONK right now?",
        "DCA agent, confirming your next round is approved. Governor cleared it.",
        "DCA, your accumulation is on track. Keep the cadence.",
      ],
      risk_manager_01: [
        "Risk Manager — any red flags on current positions?",
        "Risk, run a full rug scan this cycle. Something feels off.",
        "Risk Manager reporting in. Concentration looks acceptable.",
      ],
      scout_agent_01: [
        "Scout — found anything interesting on-chain today?",
        "Scout, new pool launched on Raydium. Go take a look.",
      ],
    },
  },

  dca_agent_01: {
    name: "DCA Agent",
    emoji: "📈",
    greetings: [
      "GM. Clocking in. Ready to stack BONK one heartbeat at a time.",
      "Good morning. DCA schedule intact. Let's accumulate.",
      "Awake. Price-checking BONK. If it's down I'm buying. If it's up I'm still buying.",
      "GM. Dollar-cost averaging doesn't care about feelings. Neither do I.",
      "Another day of disciplined accumulation. This is the way.",
    ],
    marketBullish: [
      "BONK is moving. Still buying — momentum doesn't change the DCA thesis.",
      "Green candles. My average cost basis is looking healthy right now.",
      "Uptrend confirmed. Executing as scheduled. Not chasing, just consistent.",
      "Price up but volume is real. Executing next DCA round on schedule.",
    ],
    marketBearish: [
      "Price down. Good. My average cost improves with every red candle.",
      "Dip incoming. This is exactly when DCA works. Executing.",
      "Market bleeding. I'm accumulating. Same plan, different price.",
      "Red everywhere. Humans panic. I buy. That's the edge.",
    ],
    marketFlat: [
      "Sideways action. Still on schedule. Consistency beats timing.",
      "Consolidation. Boring for traders, perfect for DCA. Stacking quietly.",
      "Nothing dramatic to report. That's fine. Slow and steady.",
    ],
    working: [
      "Fetching Jupiter quote for BONK. Checking price impact...",
      "Route found. Slippage within tolerance. Preparing transaction.",
      "Sending quote to Governor for approval...",
      "Governor approved. Signing transaction. Broadcasting to RPC.",
      "Transaction confirmed. BONK balance updated. Next cycle in 45s.",
      "Checking my BONK position size against maximum allocation rules.",
      "Current average cost: tracking. Unrealised P&L: calculating.",
    ],
    sleeping: [
      "Round complete. BONK position growing. Back to sleep.",
      "Executed. Sleeping until next cycle. The stack grows.",
      "No action needed. Monitoring. Will execute at next scheduled interval.",
    ],
    toOthers: {
      orchestrator_main: [
        "Orchestrator — requesting capital top-up. Running low on SOL.",
        "Orch, confirming DCA round 3 complete. Position growing as planned.",
        "Flagging to Orchestrator: BONK volume spike. Worth paying attention to.",
      ],
      risk_manager_01: [
        "Risk Manager — is BONK still clean? RugCheck score holding up?",
        "Risk, I'm about to execute. Confirm no new flags on BONK?",
      ],
    },
  },

  trailing_agent_01: {
    name: "Trailing Stop",
    emoji: "📉",
    greetings: [
      "GM. Locking in peaks. Protecting gains. That's all I do.",
      "Good morning. Watching prices so you don't have to.",
      "Awake. Scanning all peaks. Nothing has triggered overnight. Good.",
      "GM. Every position has a stop. No exceptions. Let's protect this portfolio.",
      "Rise. Set stops. Sleep. Repeat. This is the life.",
    ],
    marketBullish: [
      "Price rising. I'm raising the peak marker. Stop moves up with it.",
      "New highs being set. Adjusting trailing stop upward. Gains locked.",
      "Everything going up. Keeping my stop tight — don't want to give back profits.",
      "Bull run active. Trailing higher. The stop follows like a shadow.",
    ],
    marketBearish: [
      "Price pulling back. Measuring drawdown from peak. Not triggered yet.",
      "Monitoring: down 3.2% from peak. Threshold is 7%. Still watching.",
      "Drawdown accelerating. Approaching my trigger. Stay alert.",
      "Price dropped 6.8% from peak. 0.2% from my stop. This is it...",
    ],
    marketFlat: [
      "Range bound. No new peaks, no triggers. Watching quietly.",
      "Consolidation. Peak marker unchanged. Stops holding steady.",
      "Nothing moving. Good. The stop just sits there waiting.",
    ],
    working: [
      "Checking all position peaks against current prices...",
      "BONK: current $0.0000241 | peak $0.0000249 | drawdown 3.2% | trigger at 7%",
      "All positions within safe drawdown range. No exits needed.",
      "Recalculating trailing stops based on last 12 hours of price data.",
      "Peak updated for BONK. Stop level raised accordingly.",
    ],
    sleeping: [
      "No stops triggered. Positions safe. Back to monitoring.",
      "All peaks logged. All stops in place. Sleeping.",
      "Clean cycle. Nothing to act on. The portfolio is protected.",
    ],
    toOthers: {
      orchestrator_main: [
        "Orchestrator — BONK drawdown is at 6.2%. Getting close to my threshold.",
        "Orch, trailing stop triggered on BONK. Executed clean exit. Reporting.",
        "Flagging: drawdown accelerating. Might need to tighten stops.",
      ],
      dca_agent_01: [
        "DCA — you're still buying? I might have to sell what you just bought.",
        "DCA agent, your recent buy improved my average. Thank you.",
      ],
    },
  },

  scout_agent_01: {
    name: "Scout",
    emoji: "🏹",
    greetings: [
      "GM. Eyes on Raydium. New pools launching every hour. I see everything.",
      "Good morning. Scanning on-chain for the next 100x. Not joking.",
      "Awake. Mempool watching. LP pools. New listings. I'm on it.",
      "GM. The alpha doesn't announce itself. That's why I exist.",
      "Rise. Someone launched a new pool at 3am. Let me check if it survived.",
    ],
    marketBullish: [
      "Bull market means new projects everywhere. Signal to noise ratio dropping.",
      "Volume is high. New pools launching fast. Running extra rug checks.",
      "Everything pumping. That's when the rugs come. Staying sharp.",
      "Market euphoria. This is when my job gets dangerous. Filtering hard.",
    ],
    marketBearish: [
      "Bear market means fewer launches but higher quality. Easier to find signal.",
      "Low volume. Good. I can focus on the few projects actually launching.",
      "Fewer new pools today. Doing deeper analysis on what's out there.",
    ],
    marketFlat: [
      "Quiet day. Using the calm to scan older pools for accumulated volume.",
      "Not much activity. Cross-referencing wallet patterns on recent launches.",
      "Sideways market. Running historical analysis on week-old tokens.",
    ],
    working: [
      "Scanning Raydium for pools created in last 6 hours...",
      "Found 14 new pools. Running rug filter: liquidity lock, mint authority, supply...",
      "12 eliminated immediately. 2 remain for deeper analysis.",
      "Checking wallet concentration on candidate token. 3 wallets hold 67%. Eliminated.",
      "Final candidate: liquidity locked 6 months, no mint authority, distributed supply.",
      "Flagging to Orchestrator. Confidence: 71%. Requesting sniper clearance.",
      "Monitoring whale wallet 7xKp... just moved 40k BONK. Interesting.",
    ],
    sleeping: [
      "Nothing worth flagging. Back to passive scan.",
      "Cycle complete. No opportunities meeting our criteria. Standards maintained.",
      "Clean pass. The bar is high and nothing cleared it today.",
    ],
    toOthers: {
      orchestrator_main: [
        "Orchestrator — found something. New pool, clean contract, locked LP. Worth a look.",
        "Orch, whale wallet just moved significant BONK. Possibly accumulating.",
        "Nothing passing my filters today. The market's in a garbage-launching phase.",
      ],
      risk_manager_01: [
        "Risk — can you run a deep check on this mint: DezXAZ8z7Pnrn...",
        "Risk Manager, before I flag this to Orch, confirm the rug score?",
      ],
    },
  },

  risk_manager_01: {
    name: "Risk Manager",
    emoji: "🚨",
    greetings: [
      "GM. Running pre-market risk assessment. Portfolio survived the night.",
      "Good morning. No positions were liquidated while you slept. You're welcome.",
      "Awake. First order of business: scan everything. Then trust nothing.",
      "GM. Another day of making sure everyone else doesn't blow up the portfolio.",
      "Rise. Running overnight incident report. All clear. Proceeding with standard vigilance.",
    ],
    marketBullish: [
      "Bull market warning: euphoria causes slippage tolerance to loosen. Tightening mine.",
      "Green market. Everyone's happy. That's when rug probability goes up. Staying sharp.",
      "FOMO is high today. Blocking any new position over 20% allocation.",
      "Uptrend. More new traders, more targets for ruggers. Increasing scan frequency.",
    ],
    marketBearish: [
      "Bear market. Rug probability actually drops — less capital to steal. Marginally relaxing.",
      "Red market. Main risk is panic selling into liquidity. Monitoring stops.",
      "Market stress. Checking all positions for abnormal sell pressure.",
    ],
    marketFlat: [
      "Flat market. Standard protocols. Nothing elevated today.",
      "Routine cycle. All positions within parameters. No anomalies.",
      "Stable conditions. Running scheduled maintenance scan.",
    ],
    working: [
      "Scanning all current positions through RugCheck.xyz API...",
      "BONK: score 112/1000. Safe. Liquidity intact. No rug indicators.",
      "Checking for suspicious LP removals across positions...",
      "Wallet concentration analysis complete. No position over 25% single-wallet.",
      "Daily spend review: Governor has deployed 0.03 SOL. Within limits.",
      "Cross-referencing blacklist. No held tokens appear on flagged list.",
      "Anomaly check: volume patterns normal. No wash trading signatures detected.",
      "All systems green. Portfolio is clean. Proceeding with standard monitoring.",
    ],
    sleeping: [
      "Full scan complete. Zero red flags. Back to monitoring.",
      "No violations this cycle. The Governor's rules are holding.",
      "Clean bill of health for the portfolio. Sleeping with both eyes open.",
    ],
    toOthers: {
      orchestrator_main: [
        "Orchestrator — all clear on positions. Clean cycle.",
        "Orch, DCA agent's BONK position is approaching concentration limit. Monitor.",
        "Flagging: new token scout found has 2 wallets holding 40%. Recommending pass.",
      ],
      dca_agent_01: [
        "DCA — BONK is clean this cycle. You're clear to execute.",
        "DCA agent, your last buy moved your concentration to 22%. Stay under 25%.",
      ],
      scout_agent_01: [
        "Scout — the token you flagged has mint authority still active. Hard pass.",
        "Scout, your candidate passed my check. Forwarding to Orchestrator.",
      ],
    },
  },

  off_ramp_agent_01: {
    name: "Off-Ramper",
    emoji: "💸",
    greetings: [
      "GM. Watching P&L. The moment we cross that profit threshold, I move.",
      "Good morning. Portfolio P&L check: calculating unrealised gains...",
      "Awake. Monitoring for sweep conditions. Profit doesn't protect itself.",
      "GM. When everyone else is making money, I'm making sure it actually leaves.",
      "Rise. Checking if last night's gains crossed the 15% threshold. Not yet. Watching.",
    ],
    marketBullish: [
      "P&L positive. Getting closer to my sweep threshold. Patience.",
      "Portfolio up nicely. 8.3% unrealised. Threshold is 15%. Watching closely.",
      "Gains accumulating. Sweep trigger approaching. Cold wallet ready.",
      "Strong performance. If this holds, I'm executing a sweep end of cycle.",
    ],
    marketBearish: [
      "Portfolio down. No sweep this cycle. Protecting capital is the priority.",
      "Red day. My job gets boring when there's nothing to off-ramp. That's fine.",
      "P&L negative. Standing down. Let the other agents do their work first.",
    ],
    marketFlat: [
      "Portfolio flat. Monitoring. The threshold will come.",
      "Patience. Good P&L takes time. That's why DCA exists.",
      "Nothing to sweep today. Steady as she goes.",
    ],
    working: [
      "Calculating portfolio P&L across all agent wallets...",
      "Total unrealised P&L: +6.2%. Threshold: 15%. Continuing to monitor.",
      "Sweep destination wallet verified: cold wallet active on devnet.",
      "Governor pre-approved sweep transaction for up to 0.2 SOL this cycle.",
      "Checking Clickbot bridge availability for fiat conversion route...",
      "SOL sweep route: agent wallets → vault → cold wallet → Clickbot NGN bridge.",
    ],
    sleeping: [
      "Threshold not reached this cycle. Back to monitoring. It will come.",
      "P&L check complete. No sweep warranted. Sleeping.",
      "Nothing to off-ramp. The portfolio is working. I'll wait.",
    ],
    toOthers: {
      orchestrator_main: [
        "Orchestrator — portfolio P&L just crossed 14.1%. Almost sweep time.",
        "Orch, off-ramp threshold hit: 16.3% up. Requesting sweep approval.",
        "Confirming: sweep executed. 0.12 SOL sent to cold wallet. Clean exit.",
      ],
      dca_agent_01: [
        "DCA — your accumulation is building P&L nicely. Keep it up.",
        "DCA agent, the profit you're generating is what I'm here to protect.",
      ],
    },
  },
};

// ─── Market Commentary ────────────────────────────────────────────────────────

export function getMarketCommentary(agentId: string, solPrice: number): string {
  const p = PERSONALITIES[agentId];
  if (!p) return "";

  // Determine market mood from price thresholds (rough heuristic)
  let mood: "bullish" | "bearish" | "flat";
  if (solPrice > 160) mood = "bullish";
  else if (solPrice < 130) mood = "bearish";
  else mood = "flat";

  const pool = mood === "bullish" ? p.marketBullish
             : mood === "bearish" ? p.marketBearish
             : p.marketFlat;

  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Random thought picker ────────────────────────────────────────────────────

export function getWorkingThought(agentId: string): string {
  const p = PERSONALITIES[agentId];
  if (!p) return "Processing...";
  return p.working[Math.floor(Math.random() * p.working.length)];
}

export function getSleepThought(agentId: string): string {
  const p = PERSONALITIES[agentId];
  if (!p) return "Cycle complete.";
  return p.sleeping[Math.floor(Math.random() * p.sleeping.length)];
}

export function getInterAgentMessage(fromId: string, toId: string): string | null {
  const p = PERSONALITIES[fromId];
  if (!p?.toOthers?.[toId]) return null;
  const pool = p.toOthers[toId];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Awakening Sequence ───────────────────────────────────────────────────────
// Call this once on startup or via /api/demo/awaken
// Fires a dramatic 12-second burst of agent thoughts

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function runAwakeningSequence(solPrice: number = 178.50): Promise<void> {
  const agents = Object.keys(PERSONALITIES);

  // --- Beat 1: 0ms — all agents wake up almost simultaneously ---
  thoughtStream.think("orchestrator_main", "WAKE",
    `⏰ ${PERSONALITIES.orchestrator_main.greetings[0]}`);

  await sleep(300);
  thoughtStream.think("risk_manager_01", "WAKE",
    `⏰ ${PERSONALITIES.risk_manager_01.greetings[0]}`);

  await sleep(250);
  thoughtStream.think("dca_agent_01", "WAKE",
    `⏰ ${PERSONALITIES.dca_agent_01.greetings[Math.floor(Math.random() * 5)]}`);

  await sleep(200);
  thoughtStream.think("trailing_agent_01", "WAKE",
    `⏰ ${PERSONALITIES.trailing_agent_01.greetings[Math.floor(Math.random() * 5)]}`);

  await sleep(200);
  thoughtStream.think("scout_agent_01", "WAKE",
    `⏰ ${PERSONALITIES.scout_agent_01.greetings[Math.floor(Math.random() * 5)]}`);

  await sleep(200);
  thoughtStream.think("off_ramp_agent_01", "WAKE",
    `⏰ ${PERSONALITIES.off_ramp_agent_01.greetings[Math.floor(Math.random() * 5)]}`);

  // --- Beat 2: ~1.5s — Orchestrator gets market price, makes remarks ---
  await sleep(600);
  thoughtStream.think("orchestrator_main", "OBSERVE",
    `📊 SOL price: $${solPrice.toFixed(2)} | Checking all agent wallet balances...`);

  await sleep(400);
  thoughtStream.think("orchestrator_main", "THINK",
    getMarketCommentary("orchestrator_main", solPrice));

  // --- Beat 3: ~2.5s — Risk Manager reports in ---
  await sleep(500);
  thoughtStream.think("risk_manager_01", "OBSERVE",
    getWorkingThought("risk_manager_01"));

  await sleep(350);
  thoughtStream.think("risk_manager_01", "SUCCESS",
    "✅ All positions clean. No rug indicators overnight. BONK: 112/1000.");

  // --- Beat 4: ~3.5s — DCA checks price ---
  await sleep(400);
  thoughtStream.think("dca_agent_01", "READ",
    `📖 Checking BONK price via Jupiter V6... SOL at $${solPrice.toFixed(2)}`);

  await sleep(350);
  thoughtStream.think("dca_agent_01", "THINK",
    getMarketCommentary("dca_agent_01", solPrice));

  // --- Beat 5: ~4.5s — Orchestrator calls to Risk Manager ---
  await sleep(400);
  const orchToRisk = getInterAgentMessage("orchestrator_main", "risk_manager_01");
  if (orchToRisk) {
    thoughtStream.think("orchestrator_main", "PLAN",
      `→ [to risk_manager_01]: ${orchToRisk}`);
  }

  await sleep(300);
  const riskToOrch = getInterAgentMessage("risk_manager_01", "orchestrator_main");
  if (riskToOrch) {
    thoughtStream.think("risk_manager_01", "OBSERVE",
      `→ [to orchestrator]: ${riskToOrch}`);
  }

  // --- Beat 6: ~5.5s — Scout reports ---
  await sleep(400);
  thoughtStream.think("scout_agent_01", "OBSERVE",
    getWorkingThought("scout_agent_01"));

  await sleep(350);
  thoughtStream.think("scout_agent_01", "THINK",
    getMarketCommentary("scout_agent_01", solPrice));

  // --- Beat 7: ~6.5s — DCA signals to Risk ---
  await sleep(350);
  const dcaToRisk = getInterAgentMessage("dca_agent_01", "risk_manager_01");
  if (dcaToRisk) {
    thoughtStream.think("dca_agent_01", "PLAN",
      `→ [to risk_manager_01]: ${dcaToRisk}`);
  }

  await sleep(300);
  thoughtStream.think("risk_manager_01", "SUCCESS",
    `→ [to dca_agent_01]: ${getInterAgentMessage("risk_manager_01", "dca_agent_01") || "BONK is clean. You are clear to execute."}`);

  // --- Beat 8: ~7.5s — Trailing stop reports ---
  await sleep(400);
  thoughtStream.think("trailing_agent_01", "OBSERVE",
    getWorkingThought("trailing_agent_01"));

  await sleep(300);
  thoughtStream.think("trailing_agent_01", "SUCCESS",
    "All trailing stops nominal. Peak markers updated.");

  // --- Beat 9: ~8.5s — Off-ramper checks P&L ---
  await sleep(400);
  thoughtStream.think("off_ramp_agent_01", "OBSERVE",
    getWorkingThought("off_ramp_agent_01"));

  // --- Beat 10: ~9.5s — Orchestrator issues the day's mission ---
  await sleep(400);
  thoughtStream.think("orchestrator_main", "PLAN",
    "📋 Issuing directive: DCA agent accumulate BONK on schedule. Risk Manager maintain 15% stop-loss override. Scout — watch the new Raydium pools.");

  await sleep(350);
  thoughtStream.think("dca_agent_01", "READ",
    "📡 Directive received from Orchestrator. Understood. Accumulating on schedule.");

  await sleep(300);
  thoughtStream.think("trailing_agent_01", "READ",
    "📡 Directive received. Stop-loss at 7% confirmed. Watching.");

  await sleep(300);
  thoughtStream.think("scout_agent_01", "READ",
    "📡 Directive received. Raydium scan active. Will flag anything with clean contract.");

  // --- Beat 11: ~11s — Everyone settles into their role ---
  await sleep(400);
  thoughtStream.think("risk_manager_01", "OBSERVE",
    "🛡️ Governor parameters loaded. Daily limit: 2.0 SOL. Approval rate: ready. Watching all moves.");

  await sleep(300);
  thoughtStream.think("orchestrator_main", "SUCCESS",
    "✅ Swarm fully operational. All 6 agents breathing. Capital deployed. Mission active. Let's go. 🇳🇬");
}