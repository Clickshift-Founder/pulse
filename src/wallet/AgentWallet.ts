/**
 * AgentWallet.ts
 * 
 * Core wallet primitive for SentinelSwarm agents.
 * Each agent gets its own sovereign wallet with:
 *  - Encrypted keypair storage (AES-256-GCM)
 *  - Autonomous transaction signing
 *  - SOL + SPL token support
 *  - Full Solana devnet/mainnet compatibility
 */

import {
  Keypair,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  transfer as splTransfer,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as crypto from "crypto";
import bs58 from "bs58";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

const WALLETS_DIR = path.join(process.cwd(), "agent_wallets");
const ALGORITHM = "aes-256-gcm";
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || "sentinelswarm-default-secret-key-32!";

export interface WalletMetadata {
  agentId: string;
  agentRole: AgentRole;
  publicKey: string;
  createdAt: string;
  lastActivity: string;
  totalTransactions: number;
  encryptedPrivateKey: string;
  iv: string;
  authTag: string;
}

export type AgentRole =
  | "orchestrator"
  | "dca_agent"
  | "trailing_stop_agent"
  | "risk_manager"
  | "scout_agent"
  | "liquidity_agent"
  | "custom";

export class AgentWallet {
  private keypair: Keypair;
  public readonly agentId: string;
  public readonly role: AgentRole;
  public readonly connection: Connection;
  private metadata: WalletMetadata;

  constructor(keypair: Keypair, agentId: string, role: AgentRole, connection: Connection) {
    this.keypair = keypair;
    this.agentId = agentId;
    this.role = role;
    this.connection = connection;

    this.metadata = {
      agentId,
      agentRole: role,
      publicKey: keypair.publicKey.toBase58(),
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      totalTransactions: 0,
      encryptedPrivateKey: "",
      iv: "",
      authTag: "",
    };
  }

  /**
   * Factory: Create a brand-new agent wallet with a fresh keypair
   */
  static async create(
    role: AgentRole,
    connection: Connection,
    agentId?: string
  ): Promise<AgentWallet> {
    const keypair = Keypair.generate();
    const id = agentId || `${role}_${uuidv4().slice(0, 8)}`;
    const wallet = new AgentWallet(keypair, id, role, connection);
    await wallet.save();
    console.log(`[AgentWallet] Created new ${role} wallet: ${keypair.publicKey.toBase58()}`);
    return wallet;
  }

  /**
   * Factory: Load an existing agent wallet from disk by agentId
   */
  static async load(agentId: string, connection: Connection): Promise<AgentWallet> {
    const filePath = path.join(WALLETS_DIR, `${agentId}.json`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`No wallet found for agent: ${agentId}`);
    }

    const metadata: WalletMetadata = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const privateKeyBytes = AgentWallet.decrypt(
      metadata.encryptedPrivateKey,
      metadata.iv,
      metadata.authTag
    );

    const keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(privateKeyBytes)));
    const wallet = new AgentWallet(keypair, agentId, metadata.agentRole, connection);
    wallet.metadata = metadata;
    return wallet;
  }

  /**
   * Factory: Load or create — idempotent agent startup
   */
  static async loadOrCreate(
    agentId: string,
    role: AgentRole,
    connection: Connection
  ): Promise<AgentWallet> {
    const filePath = path.join(WALLETS_DIR, `${agentId}.json`);
    if (fs.existsSync(filePath)) {
      return AgentWallet.load(agentId, connection);
    }
    return AgentWallet.create(role, connection, agentId);
  }

  /** Public key of this agent's wallet */
  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  get publicKeyString(): string {
    return this.keypair.publicKey.toBase58();
  }

  /** Get SOL balance in SOL (not lamports) */
  async getBalance(): Promise<number> {
    const lamports = await this.connection.getBalance(this.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  /** Get SPL token balance */
  async getTokenBalance(mintAddress: string): Promise<number> {
    try {
      const mint = new PublicKey(mintAddress);
      const tokenAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.keypair,
        mint,
        this.publicKey
      );
      const accountInfo = await getAccount(this.connection, tokenAccount.address);
      return Number(accountInfo.amount);
    } catch {
      return 0;
    }
  }

  /**
   * Autonomously sign and send a SOL transfer — no human needed
   */
  async sendSOL(toAddress: string, amountSOL: number): Promise<string> {
    const toPubkey = new PublicKey(toAddress);
    const lamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.publicKey,
        toPubkey,
        lamports,
      })
    );

    const signature = await sendAndConfirmTransaction(this.connection, transaction, [this.keypair]);
    await this.recordTransaction();
    console.log(`[${this.agentId}] Sent ${amountSOL} SOL → ${toAddress} | tx: ${signature}`);
    return signature;
  }

  /**
   * Sign a pre-built transaction — used by Jupiter swaps, DeFi protocols
   */
  async signAndSendTransaction(transaction: Transaction): Promise<string> {
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.publicKey;
    transaction.sign(this.keypair);

    const rawTx = transaction.serialize();
    const signature = await this.connection.sendRawTransaction(rawTx, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    await this.connection.confirmTransaction(signature, "confirmed");
    await this.recordTransaction();
    return signature;
  }

  /**
   * Sign a versioned transaction (needed for Jupiter V6 swaps)
   */
  async signAndSendVersionedTransaction(transaction: VersionedTransaction): Promise<string> {
    transaction.sign([this.keypair]);
    const signature = await this.connection.sendTransaction(transaction, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    await this.connection.confirmTransaction(signature, "confirmed");
    await this.recordTransaction();
    return signature;
  }

  /**
   * Export wallet info for agent status reporting
   */
  async getStatus(): Promise<Record<string, any>> {
    const balance = await this.getBalance();
    return {
      agentId: this.agentId,
      role: this.role,
      publicKey: this.publicKeyString,
      solBalance: balance,
      totalTransactions: this.metadata.totalTransactions,
      createdAt: this.metadata.createdAt,
      lastActivity: this.metadata.lastActivity,
      explorer: `https://explorer.solana.com/address/${this.publicKeyString}?cluster=devnet`,
    };
  }

  /** Save encrypted wallet to disk */
  async save(): Promise<void> {
    if (!fs.existsSync(WALLETS_DIR)) {
      fs.mkdirSync(WALLETS_DIR, { recursive: true });
    }

    const privateKeyArray = Array.from(this.keypair.secretKey);
    const { encrypted, iv, authTag } = AgentWallet.encrypt(JSON.stringify(privateKeyArray));

    this.metadata.encryptedPrivateKey = encrypted;
    this.metadata.iv = iv;
    this.metadata.authTag = authTag;

    const filePath = path.join(WALLETS_DIR, `${this.agentId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(this.metadata, null, 2));
  }

  /** List all saved agent wallets */
  static listAll(): WalletMetadata[] {
    if (!fs.existsSync(WALLETS_DIR)) return [];
    return fs
      .readdirSync(WALLETS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(WALLETS_DIR, f), "utf8")));
  }

  private async recordTransaction(): Promise<void> {
    this.metadata.totalTransactions++;
    this.metadata.lastActivity = new Date().toISOString();
    await this.save();
  }

  // ─── AES-256-GCM Encryption ─────────────────────────────────────────────────

  private static encrypt(plaintext: string): { encrypted: string; iv: string; authTag: string } {
    const key = crypto.scryptSync(ENCRYPTION_SECRET, "sentinelswarm_salt", 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return { encrypted, iv: iv.toString("hex"), authTag };
  }

  private static decrypt(encrypted: string, ivHex: string, authTagHex: string): string {
    const key = crypto.scryptSync(ENCRYPTION_SECRET, "sentinelswarm_salt", 32);
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }
}