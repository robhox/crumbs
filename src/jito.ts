// JITO BUNDLES + fast path
// - Deux swaps séparés (HumidiFi + TesseraV) dans un bundle atomique
// - Tip Jito obligatoire
// - Zéro simulation

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
  ComputeBudgetProgram,
  SystemProgram,
} from "@solana/web3.js";
import { encodeInstruction } from "./encodeInstruction";
import { decodeInstruction } from "./decodeInstruction";
import { Agent as HttpAgent } from "http";
import { Agent as HttpsAgent } from "https";

const httpAgent = new HttpAgent({
  keepAlive: true,
  keepAliveMsecs: 15_000,
  maxSockets: 64,
});
const httpsAgent = new HttpsAgent({
  keepAlive: true,
  keepAliveMsecs: 15_000,
  maxSockets: 64,
});
const fastFetch = (input: any, init: any = {}) =>
  fetch(input, {
    agent: (url: any) =>
      String(url).startsWith("http://") ? httpAgent : httpsAgent,
    ...init,
  });

const log = pino({ transport: { target: "pino-pretty" }, level: "info" });

const USDC_DECIMALS = 1_000_000;
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";

// ========= JITO BLOCK-ENGINE JSON-RPC =========
// Par défaut: endpoint public Jito mainnet (JSON-RPC bundles).
// Tu peux aussi utiliser un endpoint provider compatible (privé conseillé).
const JITO_URL =
  process.env.JITO_URL ||
  "https://london.mainnet.block-engine.jito.wtf/api/v1/";

async function jitoRpc<T = any>(
  method: string,
  params: any[] = [],
  id = 1,
  uri: string | null = null,
  uuid = "b4d77ff1-6464-4cc6-be3a-3c6d702329cd",
): Promise<T> {
  console.log("caall wil methoid", method);
  const res = await fastFetch(`${JITO_URL}${uri ? uri : method}?uuid=${uuid}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-jito-auth": uuid },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`Jito RPC ${method} failed: ${JSON.stringify(json.error)}`);
  }
  return json.result as T;
}

// Récupère la liste des tip accounts Jito (8 comptes en général)
async function getTipAccounts(): Promise<string[]> {
  // Méthode JSON-RPC standardisée côté block-engine
  return jitoRpc<string[]>("getTipAccounts", []);
}

// Envoi d’un bundle: array de tx base64
async function sendBundle(b64txs: string[]): Promise<string> {
  return jitoRpc<string>(
    "sendBundle",
    [b64txs, { encoding: "base64" }],
    1,
    "bundles",
  );
}

// (optionnel) récupérer le statut d’un bundle
async function getBundleStatuses(bundleIds: string[]): Promise<any> {
  return jitoRpc<any>("getBundleStatuses", [bundleIds]);
}

// ========= WALLET =========
export function loadKeypairFromEnv(): Keypair {
  const raw = process.env.WALLET_KEY;
  if (!raw) throw new Error("WALLET_KEY manquant dans .env (JSON array)");
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr))
    throw new Error("WALLET_KEY doit être un JSON array de 64 nombres");
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

// ========= HUMIDIFI TEMPLATE (WARM ONCE) =========
type HumidiTemplate = {
  programId: PublicKey;
  accounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
  computeBudgetIxs: TransactionInstruction[];
};
let HUMIDI_TEMPLATE: HumidiTemplate | null = null;

async function warmHumidiTemplate(userPublicKey: string) {
  const dummyQuote = JSON.parse(
    `{"inputMint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","inAmount":"1000000","outputMint":"So11111111111111111111111111111111111111112","outAmount":"5206073","otherAmountThreshold":"5206073","swapMode":"ExactIn","slippageBps":0,"platformFee":null,"priceImpactPct":"0.0004220978192495882607039257","routePlan":[{"swapInfo":{"ammKey":"FksffEqnBRixYGR791Qw2MgdU7zNCpHVFYBL4Fa4qVuH","label":"HumidiFi","inputMint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","outputMint":"So11111111111111111111111111111111111111112","inAmount":"1000000","outAmount":"5206073","feeAmount":"0","feeMint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"},"percent":100,"bps":10000}],"contextSlot":376435416,"timeTaken":0.000427429,"swapUsdValue":"0.9995779021807504117392960743","simplerRouteUsed":false,"mostReliableAmmsQuoteReport":{"info":{"Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE":"Amm is excluded from request's dexes_selection.","BZtgQEyS6eXUXicYPHecYQ7PybqodXQMvkjUbP4R8mUU":"Amm is excluded from request's dexes_selection."}},"useIncurredSlippageForQuoting":null,"otherRoutePlans":null,"loadedLongtailToken":false,"instructionVersion":"V1"}`,
  );

  const url = "https://lite-api.jup.ag/swap/v1/swap-instructions";
  const res = await fastFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userPublicKey, quoteResponse: dummyQuote }),
  });
  if (!res.ok)
    throw new Error(
      `warmHumidiTemplate failed: ${res.status} ${await res.text()}`,
    );
  const json = await res.json();

  const swapIx = json.swapInstruction;
  if (!swapIx?.programId || !swapIx?.accounts || !swapIx?.data) {
    throw new Error("Invalid HumidiFi swapInstruction during warmup");
  }

  HUMIDI_TEMPLATE = {
    programId: new PublicKey(swapIx.programId),
    accounts: (swapIx.accounts || []).map((a: any) => ({
      pubkey: new PublicKey(a.pubkey || a.pubkeyString || a.pubkeyAddress),
      isSigner: !!a.isSigner,
      isWritable: !!a.isWritable,
    })),
    computeBudgetIxs: (json.computeBudgetInstructions || []).map((obj: any) => {
      const programId = new PublicKey(obj.programId);
      const keys = (obj.accounts || []).map((a: any) => ({
        pubkey: new PublicKey(a.pubkey || a.pubkeyString || a.pubkeyAddress),
        isSigner: !!a.isSigner,
        isWritable: !!a.isWritable,
      }));
      const data = Buffer.from(obj.data, "base64");
      return new TransactionInstruction({ programId, keys, data });
    }),
  };

  log.info("✅ HumidiFi template prêt");
}

// ========= TESSERAV TEMPLATE (WARM ONCE) =========
type TesseraVTemplate = {
  programId: PublicKey;
  accounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
  computeBudgetIxs: TransactionInstruction[];
};
let TESSERAV_TEMPLATE: TesseraVTemplate | null = null;

async function warmTesseraVTemplate(userPublicKey: string) {
  const dummyQuote = JSON.parse(
    `{"inputMint":"So11111111111111111111111111111111111111112","inAmount":"52003323","outputMint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","outAmount":"10059512","otherAmountThreshold":"10059512","swapMode":"ExactIn","slippageBps":0,"platformFee":null,"priceImpactPct":"0.000247210608629760063602091","routePlan":[{"swapInfo":{"ammKey":"FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n","label":"TesseraV","inputMint":"So11111111111111111111111111111111111111112","outputMint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","inAmount":"52003323","outAmount":"10059512","feeAmount":"0","feeMint":"11111111111111111111111111111111"},"percent":100,"bps":10000}],"contextSlot":376439583,"timeTaken":0.0004231,"swapUsdValue":"10.061999433003865186181918767","simplerRouteUsed":false,"mostReliableAmmsQuoteReport":{"info":{"BZtgQEyS6eXUXicYPHecYQ7PybqodXQMvkjUbP4R8mUU":"Not used RG: FullLiquidIntermediate, contains ALT: true","Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE":"Amm is excluded from request's dexes_selection."}},"useIncurredSlippageForQuoting":null,"otherRoutePlans":null,"loadedLongtailToken":false,"instructionVersion":"V1"}`,
  );

  const url = "https://lite-api.jup.ag/swap/v1/swap-instructions";
  const res = await fastFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userPublicKey, quoteResponse: dummyQuote }),
  });
  if (!res.ok)
    throw new Error(
      `warmTesseraVTemplate failed: ${res.status} ${await res.text()}`,
    );
  const json = await res.json();

  const swapIx = json.swapInstruction;
  if (!swapIx?.programId || !swapIx?.accounts || !swapIx?.data) {
    throw new Error("Invalid TesseraV swapInstruction during warmup");
  }

  TESSERAV_TEMPLATE = {
    programId: new PublicKey(swapIx.programId),
    accounts: (swapIx.accounts || []).map((a: any) => ({
      pubkey: new PublicKey(a.pubkey || a.pubkeyString || a.pubkeyAddress),
      isSigner: !!a.isSigner,
      isWritable: !!a.isWritable,
    })),
    computeBudgetIxs: (json.computeBudgetInstructions || []).map((obj: any) => {
      const programId = new PublicKey(obj.programId);
      const keys = (obj.accounts || []).map((a: any) => ({
        pubkey: new PublicKey(a.pubkey || a.pubkeyString || a.pubkeyAddress),
        isSigner: !!a.isSigner,
        isWritable: !!a.isWritable,
      }));
      const data = Buffer.from(obj.data, "base64");
      return new TransactionInstruction({ programId, keys, data });
    }),
  };

  log.info("✅ TesseraV template prêt");
}

let TIP_ACCOUNTS: string[] = [];

// ======== WARM TIP ACCOUNTS ========
async function warmTipAccounts() {
  TIP_ACCOUNTS = await getTipAccounts();
  log.info("✅ Jito tip accounts prêt");
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

// ========= UTIL =========
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

// ========= QUOTES =========
async function getJupQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  dex: string,
) {
  const url = `https://lite-api.jup.ag/swap/v1/quote?slippageBps=0&swapMode=ExactIn&restrictIntermediateTokens=true&maxAccounts=64&instructionVersion=V1&inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&dexes=${dex}`;
  const res = await fastFetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`quote failed ${res.status}`);
  return res.json();
}

// ========= BUILDERS =========
async function buildV0Tx(
  connection: Connection,
  payer: Keypair,
  ixs: TransactionInstruction[],
) {
  const { blockhash } = await connection.getLatestBlockhash("processed");
  const msgV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const vtx = new VersionedTransaction(msgV0);
  vtx.sign([payer]);
  return vtx;
}

function serializeB64(vtx: VersionedTransaction) {
  return Buffer.from(vtx.serialize()).toString("base64");
}

// ========= ARB + BUNDLE =========
async function sendArbBundle(
  connection: Connection,
  wallet: Keypair,
  humidiSwapIx: TransactionInstruction,
  tessSwapIx: TransactionInstruction,
  lamportsTip: number,
) {
  // vtx 1: HumidiFi
  const vtx1 = await buildV0Tx(connection, wallet, [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 3000 }),
    humidiSwapIx,
  ]);

  // vtx 2: TesseraV
  const vtx2 = await buildV0Tx(connection, wallet, [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 3000 }),
    tessSwapIx,
  ]);

  // vtx 3: TIP → compte Jito
  if (!TIP_ACCOUNTS?.length) throw new Error("No Jito tip accounts returned");
  const tipTo = new PublicKey(
    TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)],
  );
  log.info(`🎁 Sending tip (${lamportsTip} lamports) to ${tipTo}`);
  const tipIx = SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: tipTo,
    lamports: lamportsTip,
  });
  const tipVtx = await buildV0Tx(connection, wallet, [tipIx]);

  // Bundle: ordre = exécution
  const bundle = [serializeB64(vtx1), serializeB64(vtx2), serializeB64(tipVtx)];
  const bundleId = await sendBundle(bundle);
  log.info(`🧨 bundle sent: ${bundleId}`);

  // Optionnel: check status (non bloquant)
  try {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const statuses = await getBundleStatuses([bundleId]);
    log.info({ statuses }, "📦 bundle statuses");
  } catch {
    // silencieux, certains endpoints ne l'implémentent pas
  }
}

// ========= MAIN ARB CHECK =========
async function checkArb(connection: Connection, wallet: Keypair) {
  const t0 = performance.now();

  const amountInUSDC = 0.1 * USDC_DECIMALS;

  // 1) Quote USDC->SOL via HumidiFi
  const q1 = await getJupQuote(USDC_MINT, SOL_MINT, amountInUSDC, "HumidiFi");
  const outSol = Number(q1.outAmount);

  // 2) Quote SOL->USDC via TesseraV
  const q2 = await getJupQuote(
    SOL_MINT,
    USDC_MINT,
    Math.floor(outSol),
    "TesseraV",
  );
  const profit = Number(q2.outAmount) - Number(q1.inAmount);

  const t1 = performance.now();
  // if (profit <= 999) {
  //   log.info(
  //     `📉 Arbitrage négatif, stop here (${(profit / USDC_DECIMALS).toFixed(6)}$)`,
  //   );
  //   if (t1 - t0 > 200) log.debug?.(`no-op in ${(t1 - t0).toFixed(1)}ms`);
  //   return;
  // }
  log.info(
    `💡 Arbitrage détecté: $${(profit / USDC_DECIMALS).toFixed(6)} | compute ${(t1 - t0).toFixed(1)}ms`,
  );

  // 3) Récupérer les swap-instructions pour les deux quotes (séparées)
  //    Important: on ne bidouille PAS la liste des accounts
  const [respHumidi, respTess] = await Promise.all([
    fastFetch("https://lite-api.jup.ag/swap/v1/swap-instructions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userPublicKey: wallet.publicKey.toBase58(),
        quoteResponse: q1,
      }),
    }).then((r) => r.json()),
    fastFetch("https://lite-api.jup.ag/swap/v1/swap-instructions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userPublicKey: wallet.publicKey.toBase58(),
        quoteResponse: q2,
      }),
    }).then((r) => r.json()),
  ]);

  const ixHumidi = toInstruction(respHumidi.swapInstruction);
  const ixTess = toInstruction(respTess.swapInstruction);
  if (!ixHumidi || !ixTess)
    throw new Error("failed to build swap instructions");

  // 4) Tip dynamique simple: 0.002–0.01 SOL selon le profit
  const profitUsd = profit / USDC_DECIMALS;
  const lamportsTip =
    profitUsd > 5 ? 10_000_000 : profitUsd > 2 ? 7_000_000 : 4_000_000; // ajuste à ta sauce

  // 5) Envoi du bundle Jito (atomique, invisible au mempool public)
  const t2 = performance.now();
  await sendArbBundle(connection, wallet, ixHumidi, ixTess, lamportsTip);
  const t3 = performance.now();
  log.info(
    `🚀 bundle sent | build ${(t2 - t1).toFixed(1)}ms | send ${(t3 - t2).toFixed(1)}ms`,
  );
}

// ========= BOOT =========
async function main() {
  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) throw new Error("RPC_URL manquant dans .env");
  const wallet = loadKeypairFromEnv();

  // Connexion en processed pour réduire la latence
  const connection = new Connection(RPC_URL, { commitment: "processed" });

  // Warm optional (garde utile si plus tard tu réencodes data à la main)
  await warmTipAccounts();
  await warmHumidiTemplate(wallet.publicKey.toBase58());
  await warmTesseraVTemplate(wallet.publicKey.toBase58());

  const delay = 1800;
  log.info(`🚀 Scanner toutes les ${delay}ms...`);
  let running = false;

  await checkArb(connection, wallet);
  // setInterval(async () => {
  //   if (running) return;
  //   running = true;
  //   try {
  //     await checkArb(connection, wallet);
  //   } catch (e: any) {
  //     log.error(e?.message ?? e);
  //   } finally {
  //     running = false;
  //   }
  // }, delay);
}

main()
  .catch(async (err) => {
    log.error({ err }, "Scan failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
