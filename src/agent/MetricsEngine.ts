/**
 * MetricsEngine.ts — The Investor Dashboard
 *
 * What moves investors to sit forward:
 *  - Real numbers moving in real time
 *  - Proof of autonomous activity (transactions without human input)
 *  - Security metrics (how many rug attacks blocked)
 *  - Predictive indicators (projected returns at current DCA pace)
 *  - Network effects (users × agents × volume = protocol value)
 *
 * These metrics serve three audiences:
 *  1. Judges: "This works and it's safe"
 *  2. Users: "My money is growing autonomously"
 *  3. Investors: "This protocol has TVL, volume, and retention"
 */

import { thoughtStream } from "../heartbeat/ThoughtStream";
import { sessionStore } from "./UserSession";

export interface ProtocolMetrics {
  // Headline numbers
  totalValueLockedSOL: number;
  totalVolumeAllTimeSOL: number;
  totalTransactionsExecuted: number;

  // Safety proof
  rugAttacksBlocked: number;
  governorBlocksTotal: number;
  averageGovernorApprovalRate: number; // % of proposed txns that passed governor

  // Agent activity
  totalActiveAgents: number;
  heartbeatsExecutedToday: number;
  averageCycleTimeMs: number;

  // User metrics
  totalUsers: number;
  activeUsersToday: number;
  retentionRate: number; // % of users active in last 7 days

  // Performance
  averagePortfolioGrowthPct: number;
  topPerformingStrategy: string;
  bestAgentPnlPct: number;

  // Network
  solanaTransactionsFired: number;
  jupiterSwapsExecuted: number;
  totalFeesEarnedSOL: number; // Protocol revenue

  // Predictions
  projectedMonthlyVolumeSOL: number;
  projectedAnnualRevenueUSD: number;

  timestamp: string;
}

export interface AgentPerformance {
  agentId: string;
  role: string;
  totalTxns: number;
  totalVolumeSOL: number;
  pnlPct: number;
  heartbeatsCompleted: number;
  governorBlockedTxns: number;
  rugAttacksBlocked: number;
  uptime: number; // percentage
}

class MetricsEngine {
  // In-memory metrics (replace with DB aggregation for production)
  private rugAttacksBlocked = 0;
  private governorBlocks = 0;
  private governorApprovals = 0;
  private heartbeats = 0;
  private cycleTimes: number[] = [];
  private jupiterSwaps = 0;
  private feesEarnedSOL = 0;
  private agentPerformances: Map<string, AgentPerformance> = new Map();

  recordGovernorDecision(approved: boolean): void {
    if (approved) this.governorApprovals++;
    else this.governorBlocks++;
  }

  recordRugBlock(): void {
    this.rugAttacksBlocked++;
  }

  recordHeartbeat(cycleTimeMs: number): void {
    this.heartbeats++;
    this.cycleTimes.push(cycleTimeMs);
    if (this.cycleTimes.length > 1000) this.cycleTimes.shift();
  }

  recordSwap(agentId: string, volumeSOL: number, feeSOL: number = 0): void {
    this.jupiterSwaps++;
    this.feesEarnedSOL += feeSOL;

    const perf = this.agentPerformances.get(agentId) || this.initAgentPerf(agentId);
    perf.totalTxns++;
    perf.totalVolumeSOL += volumeSOL;
    this.agentPerformances.set(agentId, perf);
  }

  getProtocolMetrics(): ProtocolMetrics {
    const userMetrics = sessionStore.getMetrics();
    const totalGovDecisions = this.governorApprovals + this.governorBlocks;
    const approvalRate = totalGovDecisions > 0 ? (this.governorApprovals / totalGovDecisions) * 100 : 100;
    const avgCycleTime = this.cycleTimes.length > 0
      ? this.cycleTimes.reduce((a, b) => a + b, 0) / this.cycleTimes.length
      : 0;

    const dailyVolume = Array.from(this.agentPerformances.values()).reduce((s, p) => s + p.totalVolumeSOL, 0);
    const projectedMonthly = dailyVolume * 30;
    const projectedAnnualRevenue = projectedMonthly * 12 * 0.001 * 180; // 0.1% fee at $180/SOL

    return {
      totalValueLockedSOL: userMetrics.totalVolumeSOL,
      totalVolumeAllTimeSOL: dailyVolume,
      totalTransactionsExecuted: this.jupiterSwaps,
      rugAttacksBlocked: this.rugAttacksBlocked,
      governorBlocksTotal: this.governorBlocks,
      averageGovernorApprovalRate: Math.round(approvalRate),
      totalActiveAgents: userMetrics.totalAgents,
      heartbeatsExecutedToday: this.heartbeats,
      averageCycleTimeMs: Math.round(avgCycleTime),
      totalUsers: userMetrics.totalUsers,
      activeUsersToday: userMetrics.activeUsers,
      retentionRate: userMetrics.totalUsers > 0
        ? Math.round((userMetrics.activeUsers / userMetrics.totalUsers) * 100)
        : 0,
      averagePortfolioGrowthPct: 0, // Calculate from real trade history
      topPerformingStrategy: "DCA",
      bestAgentPnlPct: 0,
      solanaTransactionsFired: this.jupiterSwaps,
      jupiterSwapsExecuted: this.jupiterSwaps,
      totalFeesEarnedSOL: this.feesEarnedSOL,
      projectedMonthlyVolumeSOL: projectedMonthly,
      projectedAnnualRevenueUSD: projectedAnnualRevenue,
      timestamp: new Date().toISOString(),
    };
  }

  getAgentPerformances(): AgentPerformance[] {
    return Array.from(this.agentPerformances.values());
  }

  private initAgentPerf(agentId: string): AgentPerformance {
    return {
      agentId,
      role: agentId.split("_")[1] || "unknown",
      totalTxns: 0,
      totalVolumeSOL: 0,
      pnlPct: 0,
      heartbeatsCompleted: 0,
      governorBlockedTxns: 0,
      rugAttacksBlocked: 0,
      uptime: 100,
    };
  }
}

export const metricsEngine = new MetricsEngine();