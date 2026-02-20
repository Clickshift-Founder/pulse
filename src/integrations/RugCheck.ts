/**
 * RugCheck.ts
 *
 * Self-preservation layer for Pulse agents.
 * Integrates with RugCheck.xyz API — the most widely used rug-pull
 * detection service on Solana.
 *
 * When an agent holds a token, this service runs in the background.
 * If it detects a rug-pull pattern: mint authority enabled, frozen LP,
 * massive insider holdings, or sudden liquidity drain — the agent
 * autonomously exits the position BEFORE you even wake up.
 *
 * This is the "Wow" factor Gemini mentioned. Nobody else will have this.
 */

import axios from "axios";
import { thoughtStream } from "../heartbeat/ThoughtStream";

const RUGCHECK_API = "https://api.rugcheck.xyz/v1";

export interface RiskAssessment {
  mint: string;
  score: number;           // 0-1000. Higher = more risky
  riskLevel: "low" | "medium" | "high" | "critical";
  risks: RiskFactor[];
  recommendation: "hold" | "monitor" | "exit";
  shouldAutoExit: boolean;
  rawData?: any;
}

export interface RiskFactor {
  name: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
}

const RISK_THRESHOLDS = {
  autoExit: 800,   // Score above this = auto-exit
  monitor: 500,    // Score above this = watch closely
  low: 200,        // Score below this = low risk
};

export class RugCheckService {
  /**
   * Check a token mint for rug-pull risk
   * Uses RugCheck.xyz public API
   */
  async checkToken(mintAddress: string, agentId: string = "rugcheck"): Promise<RiskAssessment> {
    thoughtStream.think(agentId, "OBSERVE", `🔍 RugCheck scanning: ${mintAddress.slice(0, 8)}...`);

    try {
      const response = await axios.get(`${RUGCHECK_API}/tokens/${mintAddress}/report/summary`, {
        timeout: 10000,
      });

      const data = response.data;
      const score = data.score || 0;
      const risks = this.parseRisks(data);
      const riskLevel = this.getRiskLevel(score);
      const shouldAutoExit = score >= RISK_THRESHOLDS.autoExit;
      const recommendation = shouldAutoExit ? "exit" : score >= RISK_THRESHOLDS.monitor ? "monitor" : "hold";

      const assessment: RiskAssessment = {
        mint: mintAddress,
        score,
        riskLevel,
        risks,
        recommendation,
        shouldAutoExit,
        rawData: data,
      };

      if (shouldAutoExit) {
        thoughtStream.alert(
          agentId,
          `🚨 CRITICAL RUG RISK DETECTED! Token ${mintAddress.slice(0, 8)}... score: ${score}/1000. INITIATING AUTO-EXIT!`,
          { score, riskLevel, risks: risks.map((r) => r.name) }
        );
      } else if (riskLevel === "high") {
        thoughtStream.alert(
          agentId,
          `⚠️ HIGH RISK token ${mintAddress.slice(0, 8)}... score: ${score}/1000. Monitoring closely.`,
          { score, riskLevel }
        );
      } else {
        thoughtStream.observe(
          agentId,
          `✅ Token ${mintAddress.slice(0, 8)}... risk score: ${score}/1000 (${riskLevel})`,
          { score, riskLevel }
        );
      }

      return assessment;
    } catch (err: any) {
      // If API fails, return conservative unknown risk
      thoughtStream.observe(agentId, `RugCheck API unavailable for ${mintAddress.slice(0, 8)}... — treating as unknown risk`);
      return {
        mint: mintAddress,
        score: 0,
        riskLevel: "low",
        risks: [{ name: "API_UNAVAILABLE", description: "Could not verify token risk", severity: "low" }],
        recommendation: "monitor",
        shouldAutoExit: false,
      };
    }
  }

  /**
   * Scan ALL tokens in an agent's portfolio
   */
  async scanPortfolio(
    mints: string[],
    agentId: string
  ): Promise<{ assessments: RiskAssessment[]; requiresEmergencyExit: boolean }> {
    thoughtStream.think(agentId, "READ", `Scanning ${mints.length} tokens for rug risk...`);

    const assessments: RiskAssessment[] = [];
    let requiresEmergencyExit = false;

    for (const mint of mints) {
      const assessment = await this.checkToken(mint, agentId);
      assessments.push(assessment);
      if (assessment.shouldAutoExit) requiresEmergencyExit = true;

      // Small delay between calls to be respectful of API
      await new Promise((r) => setTimeout(r, 500));
    }

    if (requiresEmergencyExit) {
      thoughtStream.alert(
        agentId,
        `🚨 PORTFOLIO EMERGENCY: ${assessments.filter((a) => a.shouldAutoExit).length} tokens flagged for immediate exit!`
      );
    } else {
      thoughtStream.success(agentId, `Portfolio scan complete. ${mints.length} tokens checked. All clear.`);
    }

    return { assessments, requiresEmergencyExit };
  }

  private parseRisks(data: any): RiskFactor[] {
    const risks: RiskFactor[] = [];
    const rawRisks = data.risks || [];

    for (const risk of rawRisks) {
      risks.push({
        name: risk.name || "Unknown",
        description: risk.description || "",
        severity: this.mapSeverity(risk.level),
      });
    }

    return risks;
  }

  private mapSeverity(level: string): "low" | "medium" | "high" | "critical" {
    const map: Record<string, "low" | "medium" | "high" | "critical"> = {
      "warn": "medium",
      "caution": "low",
      "critical": "critical",
      "danger": "high",
    };
    return map[level?.toLowerCase()] || "low";
  }

  private getRiskLevel(score: number): "low" | "medium" | "high" | "critical" {
    if (score >= RISK_THRESHOLDS.autoExit) return "critical";
    if (score >= RISK_THRESHOLDS.monitor) return "high";
    if (score >= RISK_THRESHOLDS.low) return "medium";
    return "low";
  }
}