// arb-checker.ts
import "dotenv/config";
import pino from "pino";
import { prisma } from "./db";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { encodeInstruction } from "./encodeInstruction";
import { decodeInstruction } from "./decodeInstruction";

const log = pino({
  transport: { target: "pino-pretty" },
  level: "info",
});

const USDC_DECIMALS = 1_000_000;
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";

// Helper to create a Keypair from env WALLET_KEY (JSON array or base58)
export function loadKeypairFromEnv(): Keypair {
  const raw = process.env.WALLET_KEY;
  if (!raw)
    throw new Error("WALLET_KEY manquant dans .env (JSON array ou base58)");

  try {
    // try JSON array
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    }
  } catch (e) {
    // not JSON -> try base58
  }

  // treat as base58 encoded secret (some users export base58)
  try {
    // base58 secret must be decoded; web3.js doesn't provide base58 -> raw directly
    // but Keypair.fromSecretKey expects a Uint8Array; if user provided base58 of secret key,
    // they'd need to provide raw array. We'll attempt the common case: user passed the
    // base58 of the private key (not standard). In practice prefer JSON array.
    // Fail if not JSON array.
    throw new Error(
      "WALLET_KEY must be a JSON array of 64 numbers (Keypair.toSecretKey()) — base58 not supported in this script for safety",
    );
  } catch (e) {
    throw e;
  }
}

// Helper to call Jupiter /swap-instructions endpoint
async function fetchSwapInstructions({
  quoteResponse,
  userPublicKey,
}: {
  quoteResponse: any;
  userPublicKey: string;
}) {
  const url = "https://lite-api.jup.ag/swap/v1/swap-instructions";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userPublicKey: userPublicKey,
      quoteResponse: quoteResponse,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: 0,
          priorityLevel: "medium",
          global: false,
        },
      },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`swap-instructions failed: ${res.status} ${txt}`);
  }
  const json = await res.json();
  return json;
}

// Convert Jupiter returned instruction objects into TransactionInstruction[]
export function parseJupiterInstructions(resp: any): TransactionInstruction[] {
  const out: TransactionInstruction[] = [];

  const parseInstruction = (obj: any) => {
    if (!obj?.programId || !obj?.data) return null;
    const programId = new PublicKey(obj.programId);
    const keys = (obj.accounts || []).map((a: any) => ({
      pubkey: new PublicKey(a.pubkey || a.pubkeyString || a.pubkeyAddress),
      isSigner: !!a.isSigner,
      isWritable: !!a.isWritable,
    }));
    const data = Buffer.from(obj.data, "base64");
    return new TransactionInstruction({ programId, keys, data });
  };

  const allInstrGroups = [
    ...(resp.computeBudgetInstructions || []),
    ...(resp.setupInstructions || []),
    ...(resp.otherInstructions || []),
    resp.swapInstruction ? [resp.swapInstruction] : [],
    resp.cleanupInstruction ? [resp.cleanupInstruction] : [],
  ].flat();

  for (const obj of allInstrGroups) {
    const ix = parseInstruction(obj);
    if (ix) out.push(ix);
  }

  return out;
}

// Utilitaire pour transformer un objet {programId, accounts, data} en TransactionInstruction
function toInstruction(obj: any): TransactionInstruction | null {
  if (!obj?.programId || !obj?.data) return null;
  const programId = new PublicKey(obj.programId);
  const keys = (obj.accounts || []).map((a: any) => ({
    pubkey: new PublicKey(a.pubkey || a.pubkeyString || a.pubkeyAddress),
    isSigner: !!a.isSigner,
    isWritable: !!a.isWritable,
  }));
  const data = Buffer.from(obj.data, "base64");
  return new TransactionInstruction({ programId, keys, data });
}

/**
 * Construit une transaction atomique Jupiter combinant deux swaps.
 * Filtre les instructions dupliquées interdites (ComputeBudget, ATA setup, cleanup, etc.).
 */
export async function buildAtomicSwapTx(
  connection: Connection,
  wallet: Keypair,
  resp1: any,
  resp2: any,
  inAmount: number,
  outAmount: number,
): Promise<Transaction> {
  const tx = new Transaction();

  // 🔹 Étape 1 : Compute Budget (on garde seulement celui du premier swap)
  const computeIxs = (resp1.computeBudgetInstructions || [])
    .map(toInstruction)
    .filter(Boolean);
  for (const ix of computeIxs) tx.add(ix as TransactionInstruction);

  // 🔹 Étape 2 : Setup (on garde seulement le setup du premier swap) -> pas besoin je le crée 1 seule fois manuellement
  // const setupIxs = (resp1.setupInstructions || [])
  //   .map(toInstruction)
  //   .filter(Boolean);
  // for (const ix of setupIxs) tx.add(ix as TransactionInstruction);

  const decoded: any = decodeInstruction(
    Buffer.from(resp1.swapInstruction?.data, "base64"),
  );
  const swap_id = decoded?.data?.route_plan[0]?.swap?.HumidiFi?.swap_id;
  const modifiedData = encodeInstruction(swap_id, inAmount, outAmount);
  resp1.swapInstruction.data = modifiedData.toString("base64");

  resp1.swapInstruction.accounts = [
    ...resp1.swapInstruction.accounts,
    ...resp2.swapInstruction.accounts.slice(9),
    {
      pubkey: new PublicKey("jitodontfront111111111111111111111111111123"),
      isSigner: false,
      isWritable: false,
    },
  ];

  // 🔹 Étape 3 : Swap principal 1
  const swap = resp1.swapInstruction
    ? toInstruction(resp1.swapInstruction)
    : null;
  if (swap) tx.add(swap);

  // 🔹 Étape 4 : Swap principal 2
  // const swap2 = resp2.swapInstruction
  //   ? toInstruction(resp2.swapInstruction)
  //   : null;
  // if (swap2) tx.add(swap2);

  // 🔹 Étape 5 : Cleanup (on garde seulement le cleanup du second swap) -> pas besoin on ne veut pas clean l'ata wsol
  // const cleanupIxs = (
  //   resp2.cleanupInstruction ? [resp2.cleanupInstruction] : []
  // )
  //   .map(toInstruction)
  //   .filter(Boolean);
  // for (const ix of cleanupIxs) tx.add(ix as TransactionInstruction);

  // 🔹 Étape 6 : Paramètres généraux
  // tx.feePayer = wallet.publicKey;
  // const { blockhash } = await connection.getLatestBlockhash("confirmed");
  // tx.recentBlockhash = blockhash;

  // 🔹 Étape 7 : Ajuster compute units globalement (optionnel mais recommandé)
  // tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }));

  return tx;
}

async function checkArb() {
  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) throw new Error("RPC_URL manquant dans .env");

  const wallet = loadKeypairFromEnv();
  const userPub = wallet.publicKey.toBase58();

  const connection = new Connection(RPC_URL, "confirmed");

  const options = { method: "GET" };

  try {
    const decimals = USDC_DECIMALS;
    const quantity1 = 10 * decimals;
    const url1 = `https://lite-api.jup.ag/swap/v1/quote?slippageBps=0&swapMode=ExactIn&restrictIntermediateTokens=true&maxAccounts=64&instructionVersion=V1&inputMint=${USDC_MINT}&outputMint=${SOL_MINT}&amount=${quantity1}&dexes=HumidiFi`;

    const res1 = await fetch(url1, options);
    const data1 = await res1.json();

    const actualOut1 = Number(data1.outAmount);
    const quantity2 = Math.floor(actualOut1 * 1);
    const url2 = `https://lite-api.jup.ag/swap/v1/quote?slippageBps=0&swapMode=ExactIn&restrictIntermediateTokens=true&maxAccounts=64&instructionVersion=V1&inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${quantity2}&dexes=TesseraV`;

    const res2 = await fetch(url2, options);
    const data2 = await res2.json();

    const profit = Number(data2.outAmount) - Number(data1.inAmount);

    if (profit <= 999) {
      return;
    }
    log.info(
      `HumidiFi → TesseraV arbitrage found ! Value : $${profit / USDC_DECIMALS}`,
    );

    // --- now fetch swap-instructions for both quotes
    const instr1Resp = await fetchSwapInstructions({
      quoteResponse: data1,
      userPublicKey: userPub,
    });
    // const instr2Resp = await fetchSwapInstructions({
    //   quoteResponse: data2,
    //   userPublicKey: userPub,
    // });
    const instr2Resp = JSON.parse(
      `{"tokenLedgerInstruction":null,"computeBudgetInstructions":[{"programId":"ComputeBudget111111111111111111111111111111","accounts":[],"data":"AsBcFQA="}],"setupInstructions":[{"programId":"11111111111111111111111111111111","accounts":[{"pubkey":"Cm7vjoV12JuVqCduW6rkGGcgN77NPkzqZr66pkVTzb5b","isSigner":true,"isWritable":true},{"pubkey":"FkHuP6FSfa8x1WY43U224RU7d9yLodB3XEeNAytX68ZB","isSigner":false,"isWritable":true}],"data":"AgAAAMQlEwMAAAAA"},{"programId":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","accounts":[{"pubkey":"FkHuP6FSfa8x1WY43U224RU7d9yLodB3XEeNAytX68ZB","isSigner":false,"isWritable":true}],"data":"EQ=="}],"swapInstruction":{"programId":"JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4","accounts":[{"pubkey":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","isSigner":false,"isWritable":false},{"pubkey":"Cm7vjoV12JuVqCduW6rkGGcgN77NPkzqZr66pkVTzb5b","isSigner":true,"isWritable":false},{"pubkey":"FkHuP6FSfa8x1WY43U224RU7d9yLodB3XEeNAytX68ZB","isSigner":false,"isWritable":true},{"pubkey":"2ecynoqxYJWM5McNv9qnLgLGRsGfzdjLHRmWEnyhPJZ4","isSigner":false,"isWritable":true},{"pubkey":"JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4","isSigner":false,"isWritable":false},{"pubkey":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","isSigner":false,"isWritable":false},{"pubkey":"JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4","isSigner":false,"isWritable":false},{"pubkey":"D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf","isSigner":false,"isWritable":false},{"pubkey":"JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4","isSigner":false,"isWritable":false},{"pubkey":"TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH","isSigner":false,"isWritable":false},{"pubkey":"8ekCy2jHHUbW2yeNGFWYJT9Hm9FW7SvZcZK66dSZCDiF","isSigner":false,"isWritable":false},{"pubkey":"FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n","isSigner":false,"isWritable":true},{"pubkey":"Cm7vjoV12JuVqCduW6rkGGcgN77NPkzqZr66pkVTzb5b","isSigner":false,"isWritable":false},{"pubkey":"5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV","isSigner":false,"isWritable":true},{"pubkey":"9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx","isSigner":false,"isWritable":true},{"pubkey":"FkHuP6FSfa8x1WY43U224RU7d9yLodB3XEeNAytX68ZB","isSigner":false,"isWritable":true},{"pubkey":"2ecynoqxYJWM5McNv9qnLgLGRsGfzdjLHRmWEnyhPJZ4","isSigner":false,"isWritable":true},{"pubkey":"So11111111111111111111111111111111111111112","isSigner":false,"isWritable":false},{"pubkey":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","isSigner":false,"isWritable":false},{"pubkey":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","isSigner":false,"isWritable":false},{"pubkey":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","isSigner":false,"isWritable":false},{"pubkey":"Sysvar1nstructions1111111111111111111111111","isSigner":false,"isWritable":false}],"data":"5RfLl3rjrSoBAAAAWQFkAAHEJRMDAAAAALmamAAAAAAAAAAA"},"cleanupInstruction":{"programId":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","accounts":[{"pubkey":"FkHuP6FSfa8x1WY43U224RU7d9yLodB3XEeNAytX68ZB","isSigner":false,"isWritable":true},{"pubkey":"Cm7vjoV12JuVqCduW6rkGGcgN77NPkzqZr66pkVTzb5b","isSigner":false,"isWritable":true},{"pubkey":"Cm7vjoV12JuVqCduW6rkGGcgN77NPkzqZr66pkVTzb5b","isSigner":true,"isWritable":false}],"data":"CQ=="},"otherInstructions":[],"addressLookupTableAddresses":["9AKCoNoAGYLW71TwTHY9e7KrZUWWL3c7VtHKb66NT3EV"],"prioritizationFeeLamports":0,"computeUnitLimit":1400000,"prioritizationType":{"computeBudget":{"microLamports":0,"estimatedMicroLamports":455690}},"simulationSlot":null,"dynamicSlippageReport":null,"simulationError":null,"addressesByLookupTableAddress":null,"blockhashWithMetadata":{"blockhash":[87,211,67,96,245,90,161,252,17,109,11,96,45,119,55,75,170,156,154,200,154,7,138,247,124,75,232,33,2,125,77,248],"lastValidBlockHeight":354592018,"fetchedAt":{"secs_since_epoch":1761684298,"nanos_since_epoch":16046125}}}`,
    );

    // Parse instructions into TransactionInstruction[]
    const ix1 = parseJupiterInstructions(instr1Resp);
    const ix2 = parseJupiterInstructions(instr2Resp);

    if (ix1.length === 0 || ix2.length === 0) {
      log.error("failed to parse swap instructions for one of the quotes", {
        ix1_len: ix1.length,
        ix2_len: ix2.length,
      });
      return;
    }

    const tx = await buildAtomicSwapTx(
      connection,
      wallet,
      instr1Resp,
      instr2Resp,
      data1.inAmount,
      data2.outAmount,
    );

    // tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (
      await connection.getLatestBlockhash("confirmed")
    ).blockhash;

    // Convert legacy → v0
    // const { blockhash } = await connection.getLatestBlockhash();

    // const messageV0 = new TransactionMessage({
    //   payerKey: wallet.publicKey,
    //   recentBlockhash: blockhash,
    //   instructions: tx.instructions,
    // }).compileToV0Message();

    // const vtx = new VersionedTransaction(messageV0);

    // // On signe la versioned TX
    // vtx.sign([wallet]);

    // ✅ Simulation avec config moderne
    // const sim = await connection.simulateTransaction(vtx, {
    //   replaceRecentBlockhash: true,
    //   sigVerify: false,
    //   commitment: "processed",
    // });

    // if (sim.value.err) {
    //   console.log("sim failed", sim.value.err);
    //   return;
    // }
    tx.feePayer = wallet.publicKey; // ✅ déplacement ici uniquement

    // ✅ refresher blockhash pour réel envoi
    const { blockhash: bh2, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

    const msgV0Send = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: bh2,
      instructions: tx.instructions,
    }).compileToV0Message();

    const vtxSend = new VersionedTransaction(msgV0Send);
    vtxSend.sign([wallet]);

    const sig = await connection.sendTransaction(vtxSend, {
      skipPreflight: true,
      maxRetries: 0,
    });
    console.log("sent:", sig);

    // ✅ Attendre la confirmation
    await connection.confirmTransaction(
      {
        signature: sig,
        blockhash: bh2,
        lastValidBlockHeight,
      },
      "confirmed",
    );
    console.log("✅ confirmed:", sig);
  } catch (error: any) {
    console.error("Erreur durant checkArb:", error?.message ?? error);
  }
}

async function main() {
  const delay = 2050;
  console.log(`🚀 Lancement du scanner toutes les ${delay}ms...`);
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      await checkArb();
    } finally {
      running = false;
    }
  }
  setInterval(tick, delay);
}

main()
  .catch((error: unknown) => {
    const err =
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { value: error };
    log.error({ err }, "Scan failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
