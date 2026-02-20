/**
 * JupiterSwap.ts
 * 
 * Jupiter V6 DEX aggregator integration for SentinelSwarm agents.
 * Agents call this to execute best-route swaps on Solana devnet/mainnet.
 * 
 * Jupiter is the #1 DEX aggregator on Solana — integrating it here means
 * agents always get the best price across all Solana DEXes.
 */

import axios from "axios";
import {
  Connection,
  VersionedTransaction,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { AgentWallet } from "../wallet/AgentWallet";
import * as dotenv from "dotenv";

dotenv.config();

// Well-known token mints (devnet mirrors)
export const TOKENS = {
  SOL: "So11111111111111111111111111111111111111112",   // Wrapped SOL
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC mainnet
  USDC_DEVNET: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // USDC devnet
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
};

const JUPITER_API = process.env.JUPITER_API_BASE || "https://quote-api.jup.ag/v6";

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: any[];
  otherAmountThreshold: string;
  swapMode: string;
}

export interface SwapResult {
  signature: string;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  agentId: string;
  timestamp: string;
}

export class JupiterSwap {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Get a swap quote from Jupiter
   * @param inputMint - Token mint to sell
   * @param outputMint - Token mint to buy
   * @param amount - Amount in smallest unit (lamports for SOL)
   * @param slippageBps - Slippage in basis points (50 = 0.5%)
   */
  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 50
  ): Promise<SwapQuote> {
    const response = await axios.get(`${JUPITER_API}/quote`, {
      params: {
        inputMint,
        outputMint,
        amount: Math.floor(amount).toString(),
        slippageBps,
        onlyDirectRoutes: false,
        asLegacyTransaction: false,
      },
    });

    return response.data;
  }

  /**
   * Execute a swap on behalf of an agent — fully autonomous
   */
  async executeSwap(
    agent: AgentWallet,
    inputMint: string,
    outputMint: string,
    inputAmountLamports: number,
    slippageBps: number = 50
  ): Promise<SwapResult> {
    console.log(`[Jupiter] ${agent.agentId} requesting swap quote...`);

    // Step 1: Get quote
    const quote = await this.getQuote(inputMint, outputMint, inputAmountLamports, slippageBps);
    const priceImpact = parseFloat(quote.priceImpactPct);

    console.log(`[Jupiter] Quote: ${inputAmountLamports} → ${quote.outAmount} | Impact: ${priceImpact.toFixed(4)}%`);

    // Step 2: Get swap transaction
    const swapResponse = await axios.post(`${JUPITER_API}/swap`, {
      quoteResponse: quote,
      userPublicKey: agent.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    });

    // Step 3: Deserialize and sign — agent signs autonomously
    const swapTransactionBuf = Buffer.from(swapResponse.data.swapTransaction, "base64");
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // Step 4: Agent signs and sends
    const signature = await agent.signAndSendVersionedTransaction(transaction);

    const result: SwapResult = {
      signature,
      inputAmount: inputAmountLamports,
      outputAmount: parseInt(quote.outAmount),
      priceImpact,
      agentId: agent.agentId,
      timestamp: new Date().toISOString(),
    };

    console.log(`[Jupiter] ✅ Swap executed by ${agent.agentId}: ${signature}`);
    return result;
  }

  /**
   * Get current price of a token in USDC
   */
  async getPrice(tokenMint: string): Promise<number> {
    try {
      const response = await axios.get(`https://price.jup.ag/v6/price`, {
        params: { ids: tokenMint },
      });
      return response.data.data[tokenMint]?.price || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Simulate a swap (dry run — useful for risk checking before executing)
   */
  async simulateSwap(
    inputMint: string,
    outputMint: string,
    inputAmountLamports: number
  ): Promise<{ estimatedOutput: number; priceImpact: number; feasible: boolean }> {
    try {
      const quote = await this.getQuote(inputMint, outputMint, inputAmountLamports);
      const priceImpact = parseFloat(quote.priceImpactPct);
      return {
        estimatedOutput: parseInt(quote.outAmount),
        priceImpact,
        feasible: priceImpact < 5, // Reject if >5% price impact
      };
    } catch {
      return { estimatedOutput: 0, priceImpact: 999, feasible: false };
    }
  }
}