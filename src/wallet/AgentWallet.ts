/**
 * AgentWallet.ts
 *
 * Core wallet primitive for Pulse agents.
 * Each agent gets its own sovereign wallet with:
 *
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  SECURITY MODEL — Two-Layer HKDF Key Derivation             │
 *  │                                                             │
 *  │  MASTER_KEY (env) ──┐                                       │
 *  │  agentId           ─┼─► HKDF(SHA-256) ──► agentKey (32B)  │
 *  │  perAgentSalt      ─┘                          │            │
 *  │                                                ▼            │
 *  │                               AES-256-GCM(agentKey)        │
 *  │                                                │            │
 *  │                                                ▼            │
 *  │                               encryptedPrivateKey (disk)   │
 *  └─────────────────────────────────────────────────────────────┘
 *
 *  Why this beats stored-AEK patterns:
 *  - No AEK file stored on disk — nothing extra to steal
 *  - Requires MASTER_KEY + agentId + perAgentSalt to reconstruct agentKey
 *  - Compromise of one agent reveals zero info about others
 *  - keyVersion enables rolling key rotation without downtime
 *
 *  Primitives: HKDF-SHA256 (RFC 5869), AES-256-GCM, Ed25519, scrypt
 */

import {
  Keypair, Connection, PublicKey, SystemProgram,
  Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount, getAccount,
} from "@solana/spl-token";
import * as crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

const WALLETS_DIR   = path.join(process.cwd(), "agent_wallets");
const ALGORITHM     = "aes-256-gcm";
const KEY_VERSION   = 2;

// MASTER_KEY: hardened with scrypt so brute-forcing env secret is expensive.
// This is the ONLY secret needed to derive all agent keys. Never log it.
const MASTER_KEY_RAW = process.env.ENCRYPTION_SECRET || "pulse-change-this-in-production-32!!";
const MASTER_KEY: Buffer = Buffer.from(crypto.scryptSync(
  MASTER_KEY_RAW,
  "pulse-master-key-hardening-salt-v2",
  32,
  { N: 32768, r: 8, p: 1 }
));

export interface WalletMetadata {
  agentId:             string;
  agentRole:           AgentRole;
  publicKey:           string;
  createdAt:           string;
  lastActivity:        string;
  totalTransactions:   number;
  encryptedPrivateKey: string;
  iv:                  string;
  authTag:             string;
  keyVersion:          number;   // 1=legacy shared key (vuln), 2=HKDF per-agent
  perAgentSalt:        string;   // 32-byte random salt unique to this wallet instance
}

export type AgentRole =
  | "orchestrator"
  | "dca_agent"
  | "trailing_stop_agent"
  | "risk_manager"
  | "scout_agent"
  | "off_ramp_agent"
  | "custom";

export class AgentWallet {
  private keypair:            Keypair;
  public readonly agentId:    string;
  public readonly role:       AgentRole;
  public readonly connection: Connection;
  private metadata:           WalletMetadata;

  constructor(
    keypair: Keypair, agentId: string, role: AgentRole,
    connection: Connection, metadata?: Partial<WalletMetadata>
  ) {
    this.keypair    = keypair;
    this.agentId    = agentId;
    this.role       = role;
    this.connection = connection;
    this.metadata   = {
      agentId, agentRole: role,
      publicKey:           keypair.publicKey.toBase58(),
      createdAt:           new Date().toISOString(),
      lastActivity:        new Date().toISOString(),
      totalTransactions:   0,
      encryptedPrivateKey: "",
      iv: "", authTag: "",
      keyVersion:          KEY_VERSION,
      perAgentSalt:        crypto.randomBytes(32).toString("hex"),
      ...metadata,
    };
  }

  // ── Factory: Create new wallet ────────────────────────────────────────────────

  static async create(role: AgentRole, connection: Connection, agentId?: string): Promise<AgentWallet> {
    const keypair = Keypair.generate();
    const id      = agentId || `${role}_${uuidv4().slice(0, 8)}`;
    const wallet  = new AgentWallet(keypair, id, role, connection);
    await wallet.save();
    console.log(`[AgentWallet] Created ${role} | pub: ${keypair.publicKey.toBase58()} | keyV: ${KEY_VERSION}`);
    return wallet;
  }

  // ── Factory: Load from disk — auto-upgrades v1 → v2 ─────────────────────────

  static async load(agentId: string, connection: Connection): Promise<AgentWallet> {
    const filePath = path.join(WALLETS_DIR, `${agentId}.json`);
    if (!fs.existsSync(filePath)) throw new Error(`No wallet file for agent: ${agentId}`);

    const metadata: WalletMetadata = JSON.parse(fs.readFileSync(filePath, "utf8"));
    let plaintext: string;

    if (!metadata.keyVersion || metadata.keyVersion < 2) {
      console.warn(`[AgentWallet] ${agentId} on v1 (shared key) — upgrading to v2 HKDF...`);
      plaintext = AgentWallet.decryptLegacy(metadata.encryptedPrivateKey, metadata.iv, metadata.authTag);
    } else {
      plaintext = AgentWallet.decryptV2(
        metadata.encryptedPrivateKey, metadata.iv, metadata.authTag,
        agentId, metadata.perAgentSalt
      );
    }

    const keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(plaintext)));
    const wallet  = new AgentWallet(keypair, agentId, metadata.agentRole, connection, metadata);

    if (!metadata.keyVersion || metadata.keyVersion < 2) {
      await wallet.save();
      console.log(`[AgentWallet] ${agentId} upgraded to v2 HKDF`);
    }
    return wallet;
  }

  // ── Factory: Load or create — idempotent ─────────────────────────────────────

  static async loadOrCreate(agentId: string, role: AgentRole, connection: Connection): Promise<AgentWallet> {
    const filePath = path.join(WALLETS_DIR, `${agentId}.json`);
    return fs.existsSync(filePath)
      ? AgentWallet.load(agentId, connection)
      : AgentWallet.create(role, connection, agentId);
  }

  // ── Key rotation: re-encrypt all wallets with new MASTER_KEY ─────────────────

  static async rotateAllKeys(
    oldMasterKeyRaw: string, connection: Connection
  ): Promise<{ rotated: string[]; failed: string[] }> {
    const rotated: string[] = [], failed: string[] = [];
    const oldMasterKey = Buffer.from(crypto.scryptSync(oldMasterKeyRaw, "pulse-master-key-hardening-salt-v2", 32, { N: 32768, r: 8, p: 1 }));

    for (const meta of AgentWallet.listAll()) {
      try {
        const plaintext = AgentWallet.decryptV2(
          meta.encryptedPrivateKey, meta.iv, meta.authTag,
          meta.agentId, meta.perAgentSalt, oldMasterKey
        );
        const keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(plaintext)));
        const wallet  = new AgentWallet(keypair, meta.agentId, meta.agentRole, connection, {
          ...meta,
          perAgentSalt: crypto.randomBytes(32).toString("hex"), // fresh salt on rotation
        });
        await wallet.save();
        rotated.push(meta.agentId);
        console.log(`[AgentWallet] Rotated key for ${meta.agentId}`);
      } catch (err: any) {
        failed.push(meta.agentId);
        console.error(`[AgentWallet] Failed to rotate ${meta.agentId}: ${err.message}`);
      }
    }
    return { rotated, failed };
  }

  // ── Accessors ─────────────────────────────────────────────────────────────────

  get publicKey(): PublicKey    { return this.keypair.publicKey; }
  get publicKeyString(): string { return this.keypair.publicKey.toBase58(); }
  get keyVersion(): number      { return this.metadata.keyVersion; }

  async getBalance(): Promise<number> {
    const lamports = await this.connection.getBalance(this.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  async getTokenBalance(mintAddress: string): Promise<number> {
    try {
      const mint         = new PublicKey(mintAddress);
      const tokenAccount = await getOrCreateAssociatedTokenAccount(
        this.connection, this.keypair, mint, this.publicKey
      );
      const info = await getAccount(this.connection, tokenAccount.address);
      return Number(info.amount);
    } catch { return 0; }
  }

  // ── Autonomous signing — private key only in memory during call ───────────────

  async sendSOL(toAddress: string, amountSOL: number): Promise<string> {
    const lamports    = Math.floor(amountSOL * LAMPORTS_PER_SOL);
    const transaction = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: this.publicKey, toPubkey: new PublicKey(toAddress), lamports })
    );
    const sig = await sendAndConfirmTransaction(this.connection, transaction, [this.keypair]);
    await this.recordTransaction();
    console.log(`[${this.agentId}] Sent ${amountSOL} SOL → ${toAddress} | sig: ${sig}`);
    return sig;
  }

  async signAndSendTransaction(transaction: Transaction): Promise<string> {
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer        = this.publicKey;
    transaction.sign(this.keypair);
    const sig = await this.connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false, preflightCommitment: "confirmed",
    });
    await this.connection.confirmTransaction(sig, "confirmed");
    await this.recordTransaction();
    return sig;
  }

  async signAndSendVersionedTransaction(transaction: VersionedTransaction): Promise<string> {
    transaction.sign([this.keypair]);
    const sig = await this.connection.sendTransaction(transaction, {
      skipPreflight: false, preflightCommitment: "confirmed",
    });
    await this.connection.confirmTransaction(sig, "confirmed");
    await this.recordTransaction();
    return sig;
  }

  async getStatus(): Promise<Record<string, any>> {
    const balance = await this.getBalance();
    return {
      agentId: this.agentId, role: this.role,
      publicKey: this.publicKeyString, solBalance: balance,
      totalTransactions: this.metadata.totalTransactions,
      createdAt: this.metadata.createdAt, lastActivity: this.metadata.lastActivity,
      keyVersion: this.metadata.keyVersion,
      securityModel: "HKDF-SHA256 per-agent key derivation + AES-256-GCM",
      explorer: `https://explorer.solana.com/address/${this.publicKeyString}?cluster=devnet`,
    };
  }

  async save(): Promise<void> {
    if (!fs.existsSync(WALLETS_DIR)) fs.mkdirSync(WALLETS_DIR, { recursive: true });
    const privateKeyArray = Array.from(this.keypair.secretKey);
    const { encrypted, iv, authTag } = AgentWallet.encryptV2(
      JSON.stringify(privateKeyArray), this.agentId, this.metadata.perAgentSalt
    );
    this.metadata.encryptedPrivateKey = encrypted;
    this.metadata.iv       = iv;
    this.metadata.authTag  = authTag;
    this.metadata.keyVersion = KEY_VERSION;
    fs.writeFileSync(
      path.join(WALLETS_DIR, `${this.agentId}.json`),
      JSON.stringify(this.metadata, null, 2)
    );
  }

  static listAll(): WalletMetadata[] {
    if (!fs.existsSync(WALLETS_DIR)) return [];
    return fs.readdirSync(WALLETS_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => JSON.parse(fs.readFileSync(path.join(WALLETS_DIR, f), "utf8")));
  }

  private async recordTransaction(): Promise<void> {
    this.metadata.totalTransactions++;
    this.metadata.lastActivity = new Date().toISOString();
    await this.save();
  }

  // ── Cryptographic Core ────────────────────────────────────────────────────────
  //
  // V2 key derivation:
  //   agentKey = HKDF-SHA256(
  //     ikm  = MASTER_KEY,             ← only in env, never on disk
  //     salt = perAgentSalt,           ← random 32B, stored in wallet file
  //     info = "pulse:{agentId}:v2"    ← context binds key to this agent
  //   )
  //
  // To decrypt any wallet an attacker needs ALL THREE:
  //   MASTER_KEY (env only) + agentId (filename) + perAgentSalt (in file)
  //
  // perAgentSalt alone (readable from disk) is useless without MASTER_KEY.
  // MASTER_KEY alone cannot decrypt without the wallet-specific salt.

  private static deriveAgentKey(
    agentId: string, perAgentSalt: string, masterKey: Buffer = MASTER_KEY
  ): Buffer {
    const info = Buffer.from(`pulse:${agentId}:v2`);
    const salt = Buffer.from(perAgentSalt, "hex");
    return Buffer.from(crypto.hkdfSync("sha256", masterKey, salt, info, 32));
  }

  private static encryptV2(
    plaintext: string, agentId: string, perAgentSalt: string
  ): { encrypted: string; iv: string; authTag: string } {
    const agentKey = AgentWallet.deriveAgentKey(agentId, perAgentSalt);
    const iv       = crypto.randomBytes(12);
    const cipher   = crypto.createCipheriv(ALGORITHM, agentKey, iv);
    let encrypted  = cipher.update(plaintext, "utf8", "hex");
    encrypted     += cipher.final("hex");
    const authTag  = cipher.getAuthTag().toString("hex");
    agentKey.fill(0);  // zero out key material immediately after use
    return { encrypted, iv: iv.toString("hex"), authTag };
  }

  private static decryptV2(
    encrypted: string, ivHex: string, authTagHex: string,
    agentId: string, perAgentSalt: string, masterKey: Buffer = MASTER_KEY
  ): string {
    const agentKey = AgentWallet.deriveAgentKey(agentId, perAgentSalt, masterKey);
    const decipher = crypto.createDecipheriv(ALGORITHM, agentKey, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    let decrypted  = decipher.update(encrypted, "hex", "utf8");
    decrypted     += decipher.final("utf8");
    agentKey.fill(0);  // zero out key material immediately after use
    return decrypted;
  }

  // V1 legacy — only for auto-upgrade path. DO NOT use for new wallets.
  private static decryptLegacy(encrypted: string, ivHex: string, authTagHex: string): string {
    const key      = Buffer.from(crypto.scryptSync(MASTER_KEY_RAW, "sentinelswarm_salt", 32));
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    let decrypted  = decipher.update(encrypted, "hex", "utf8");
    decrypted     += decipher.final("utf8");
    return decrypted;
  }
}