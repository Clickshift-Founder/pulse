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
    // REFERRAL FEE: If JUPITER_REFERRAL_ACCOUNT is set in .env,
    // Pulse earns feeBps on every single swap — buys AND sells.
    // Set up your referral account at: https://referral.jup.ag/
    const swapBody: Record<string, any> = {
      quoteResponse: quote,
      userPublicKey: agent.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    };

    // Inject referral account if configured — this is how Pulse earns on every swap
    if (process.env.JUPITER_REFERRAL_ACCOUNT) {
      swapBody.feeAccount = process.env.JUPITER_REFERRAL_ACCOUNT;
    }

    const swapResponse = await axios.post(`${JUPITER_API}/swap`, swapBody);

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
   * Get current price of a token in USD
   * Fallback chain: Jupiter Price V6 → CoinGecko → CoinGecko simple → last-known cache
   * Works from Railway because these are all public HTTPS APIs
   */
  async getPrice(tokenMint: string): Promise<number> {
    // In-memory price cache (survives per-process lifetime)
    const cache = (global as any).__priceCache || ((global as any).__priceCache = {});

    // 1. Try Jupiter Price API v6 (best for Solana tokens)
    try {
      const r = await axios.get(`https://price.jup.ag/v6/price`, {
        params: { ids: tokenMint },
        timeout: 4000,
      });
      const price = r.data?.data?.[tokenMint]?.price;
      if (price && price > 0) {
        cache[tokenMint] = price;
        return price;
      }
    } catch {}

    // 2. Try Jupiter Price API v4 (older but stable)
    try {
      const r = await axios.get(`https://price.jup.ag/v4/price`, {
        params: { ids: tokenMint },
        timeout: 4000,
      });
      const price = r.data?.data?.[tokenMint]?.price;
      if (price && price > 0) {
        cache[tokenMint] = price;
        return price;
      }
    } catch {}

    // 3. For SOL specifically, try CoinGecko (always works, real price)
    if (tokenMint === "So11111111111111111111111111111111111111112") {
      try {
        const r = await axios.get(
          `https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd`,
          { timeout: 5000 }
        );
        const price = r.data?.solana?.usd;
        if (price && price > 0) {
          cache[tokenMint] = price;
          return price;
        }
      } catch {}
    }

    // 4. Return cached price if we have one (stale is better than 0)
    if (cache[tokenMint]) return cache[tokenMint];

    // 5. Hardcoded fallbacks (known approximate prices — update before demo)
    const FALLBACK_PRICES: Record<string, number> = {
      "So11111111111111111111111111111111111111112": 78.50, // SOL — update this before demo
      "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": 0.0000228, // BONK
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": 1.0, // USDC
    };
    return FALLBACK_PRICES[tokenMint] || 0;
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