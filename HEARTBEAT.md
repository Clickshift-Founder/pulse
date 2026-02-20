# HEARTBEAT.md — Agent Directive File
> This file is read by the Pulse AI Orchestrator on every heartbeat cycle.
> Edit this file to change agent behavior WITHOUT restarting the system.
> The agent will pick up your changes on its next wake cycle (every 60 seconds).

---

## 🎯 Current Mission
"Grow the portfolio conservatively. Protect capital first. Seek asymmetric upside on high-conviction tokens."

## 📋 Active Directives

### Capital Allocation
- VAULT_RESERVE_PCT: 40        # Keep 40% in orchestrator vault untouched
- DCA_ALLOCATION_PCT: 30       # Allocate 30% to DCA agent
- SNIPER_ALLOCATION_PCT: 20    # Allocate 20% to sniper opportunities
- OFFRAMP_TRIGGER_PCT: 15      # Off-ramp when total profit exceeds 15%

### DCA Settings
- DCA_TARGET: BONK             # Token to DCA into
- DCA_AMOUNT_SOL: 0.01         # SOL per DCA round
- DCA_INTERVAL_MINUTES: 5      # Every 5 minutes

### Risk Settings
- MAX_PRICE_IMPACT_PCT: 3      # Reject swaps with >3% price impact
- TRAILING_STOP_PCT: 7         # Sell if price drops 7% from peak
- RUG_CHECK_ENABLED: true      # Auto-exit on rug detection
- MAX_SINGLE_POSITION_PCT: 25  # No single position > 25% of portfolio

### Sniper Settings
- SNIPER_ENABLED: false        # Set to true to enable new pool sniping
- SNIPER_MAX_SOL: 0.05         # Max SOL per snipe
- SNIPER_MIN_LIQUIDITY_USD: 5000  # Only snipe pools with >$5k liquidity

### Off-Ramp Settings
- OFFRAMP_ENABLED: false       # Enable when ready for profit taking
- OFFRAMP_TARGET_WALLET: ""    # Cold wallet address to sweep profits to

## 🚨 Emergency Commands
# Uncomment any line below to trigger on next heartbeat:
# EMERGENCY_STOP: true         # Halt all agents immediately
# EMERGENCY_EXIT_ALL: true     # Exit all positions and halt
# PAUSE_DCA: false             # Pause DCA without stopping

## 📝 Notes
# Last updated: auto-managed by orchestrator
# Human override: edit this file directly — agent reads it every 60 seconds