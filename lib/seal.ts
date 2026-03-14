import {
    PublicKey,
    TransactionInstruction,
    SystemProgram,
    Transaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { SEAL_PROGRAM_ID, SOLANA_RPC_URL } from "./constants";

// ═══════════════════════════════════════════════════════════════
// PDA Derivation (mirrors sigil-backend/src/services/solana.ts)
// ═══════════════════════════════════════════════════════════════

const PROGRAM_ID = new PublicKey(SEAL_PROGRAM_ID);
const WALLET_SEED = Buffer.from("seal");
const AGENT_SEED = Buffer.from("agent");

export function deriveWalletPda(owner: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [WALLET_SEED, owner.toBuffer()],
        PROGRAM_ID
    );
}

export function deriveAgentPda(
    wallet: PublicKey,
    agent: PublicKey
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [AGENT_SEED, wallet.toBuffer(), agent.toBuffer()],
        PROGRAM_ID
    );
}

// ═══════════════════════════════════════════════════════════════
// Instruction builders
// ═══════════════════════════════════════════════════════════════

/**
 * Build a CreateWallet instruction for the Seal program.
 * Discriminant: 0
 *
 * Data layout (18 bytes total):
 *   [0]    u8   discriminant (0)
 *   [1]    u8   PDA bump
 *   [2]    u64  daily_limit_lamports  (LE)
 *   [10]   u64  per_tx_limit_lamports (LE)
 *
 * Accounts:
 *   0. funder (signer, writable) — pays rent + fees (= owner for self-funded)
 *   1. owner  (signer)           — becomes wallet owner; used for PDA
 *   2. wallet PDA (writable)     — derived from ["seal", owner]
 *   3. system_program (readonly)
 */
export function buildCreateWalletInstruction(
    owner: PublicKey,
    opts?: {
        funder?: PublicKey;
        dailyLimitLamports?: bigint;
        perTxLimitLamports?: bigint;
    }
): TransactionInstruction {
    const funder = opts?.funder ?? owner;
    const dailyLimit = opts?.dailyLimitLamports ?? BigInt(5_000_000_000);  // 5 SOL default
    const perTxLimit = opts?.perTxLimitLamports ?? BigInt(1_000_000_000);  // 1 SOL default

    const [walletPda, bump] = deriveWalletPda(owner);

    const data = Buffer.alloc(18);
    data.writeUInt8(0, 0);     // CreateWallet discriminant
    data.writeUInt8(bump, 1);  // PDA bump
    data.writeBigUInt64LE(dailyLimit, 2);   // daily_limit_lamports
    data.writeBigUInt64LE(perTxLimit, 10);  // per_tx_limit_lamports

    return new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: funder, isSigner: true, isWritable: true },
            { pubkey: owner, isSigner: true, isWritable: false },
            { pubkey: walletPda, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
    });
}

/**
 * Build a RegisterAgent instruction for the Seal program.
 * Discriminant: 1
 *
 * Data layout (variable length, min 100 bytes with disc):
 *   [0]    u8         discriminant (1)
 *   [1]    u8         bump (agentConfigPda bump)
 *   [2]    [u8;32]    agent_pubkey
 *   [34]   [u8;32]    name (null-padded)
 *   [66]   u8         allowed_programs_count
 *   [67]   [Pubkey;N] allowed_programs (variable)
 *          u8         allowed_instructions_count
 *          [[u8;8];M] allowed_instructions (variable)
 *          u64 LE     dailyLimitLamports
 *          u64 LE     perTxLimitLamports
 *          i64 LE     defaultSessionDuration (seconds)
 *          i64 LE     maxSessionDuration (seconds)
 *
 * Accounts:
 *   0. owner (signer, writable)
 *   1. wallet PDA (writable)
 *   2. agentConfigPda (writable)
 *   3. system_program (readonly)
 */
export function buildRegisterAgentInstruction(params: {
    owner: PublicKey;
    agentPubkey: PublicKey;
    name: string;
    dailyLimitLamports: bigint;
    perTxLimitLamports: bigint;
    allowedPrograms?: PublicKey[];
    allowedInstructions?: Buffer[];
    defaultSessionDuration?: bigint;
    maxSessionDuration?: bigint;
}): TransactionInstruction {
    const {
        owner,
        agentPubkey,
        name,
        dailyLimitLamports,
        perTxLimitLamports,
        allowedPrograms = [],
        allowedInstructions = [],
        defaultSessionDuration = BigInt(3600),   // 1 hour
        maxSessionDuration = BigInt(86400),       // 24 hours
    } = params;

    const [walletPda] = deriveWalletPda(owner);
    const [agentConfigPda, bump] = deriveAgentPda(walletPda, agentPubkey);

    // Variable-length instruction data
    const dataSize =
        1 +                                // discriminant
        1 +                                // bump
        32 +                               // agent_pubkey
        32 +                               // name
        1 + allowedPrograms.length * 32 +  // programs_count + programs
        1 + allowedInstructions.length * 8 + // instructions_count + instructions
        8 + 8 + 8 + 8;                     // daily + perTx + defaultDur + maxDur

    const data = Buffer.alloc(dataSize);
    let offset = 0;

    // Discriminant
    data.writeUInt8(1, offset);
    offset += 1;

    // Bump
    data.writeUInt8(bump, offset);
    offset += 1;

    // Agent pubkey (32 bytes)
    agentPubkey.toBuffer().copy(data, offset);
    offset += 32;

    // Name (32 bytes, null-padded)
    const nameBytes = Buffer.from(name, "utf8").subarray(0, 32);
    nameBytes.copy(data, offset);
    offset += 32;

    // Allowed programs count + data
    data.writeUInt8(allowedPrograms.length, offset);
    offset += 1;
    for (const prog of allowedPrograms) {
        prog.toBuffer().copy(data, offset);
        offset += 32;
    }

    // Allowed instructions count + data
    data.writeUInt8(allowedInstructions.length, offset);
    offset += 1;
    for (const ix of allowedInstructions) {
        ix.copy(data, offset, 0, 8);
        offset += 8;
    }

    // Daily limit (u64 LE)
    data.writeBigUInt64LE(dailyLimitLamports, offset);
    offset += 8;

    // Per-TX limit (u64 LE)
    data.writeBigUInt64LE(perTxLimitLamports, offset);
    offset += 8;

    // Default session duration (i64 LE, seconds)
    data.writeBigInt64LE(defaultSessionDuration, offset);
    offset += 8;

    // Max session duration (i64 LE, seconds)
    data.writeBigInt64LE(maxSessionDuration, offset);

    return new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: owner, isSigner: true, isWritable: true },
            { pubkey: walletPda, isSigner: false, isWritable: true },
            { pubkey: agentConfigPda, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
    });
}

/**
 * Build a serialized transaction for RegisterAgent that can be signed by a wallet.
 */
export async function buildRegisterAgentTransaction(params: {
    owner: PublicKey;
    agentPubkey: PublicKey;
    name: string;
    dailyLimitLamports: bigint;
    perTxLimitLamports: bigint;
    allowedPrograms?: PublicKey[];
    allowedInstructions?: Buffer[];
    defaultSessionDuration?: bigint;
    maxSessionDuration?: bigint;
}): Promise<Transaction> {
    const { Connection } = await import("@solana/web3.js");
    const connection = new Connection(SOLANA_RPC_URL, "confirmed");

    const ix = buildRegisterAgentInstruction(params);
    const tx = new Transaction().add(ix);
    tx.feePayer = params.owner;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    return tx;
}
