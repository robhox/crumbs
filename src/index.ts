import "dotenv/config";
import pino from "pino";
import { prisma } from "./db";
import { getSignaturesForAddress, getTransaction } from "./heliusClient";
import { PROGRAMS } from "./constants";
import { parseTx } from "./parser";
import { hasFlashloan, hasRepay, hashPattern, numberOfSwap } from "./detector";
import { calcSolDelta, calcUsdcDelta } from "./profit";
import { USDC_MINT, SOL_MINT } from "./constants";

const log = pino({
  transport: { target: "pino-pretty" },
  level: "info",
});

const LIMIT = parseInt(process.env.SCAN_LIMIT || "50", 10);

async function scanProgram(programAddr: string) {
  const signatures = await getSignaturesForAddress(programAddr, LIMIT);
  if (!Array.isArray(signatures) || signatures.length === 0) {
    return;
  }
  for (const entry of signatures) {
    const sig = typeof entry === "string" ? entry : entry?.signature;
    if (!sig) continue;

    try {
      const exists = await prisma.transaction.findUnique({
        where: { signature: sig },
      });
      if (exists) continue;

      const parsed = await getTransaction(sig);
      if (!parsed) continue;

      const { tokenTransfers } = parsed;
      if (!tokenTransfers || tokenTransfers.length === 0) continue;

      const usdcTx = tokenTransfers.filter((t) => t.mint === USDC_MINT);

      if (usdcTx.length !== 2) continue;

      const deltaUsdc = usdcTx[1].tokenAmount - usdcTx[0].tokenAmount;
      const profitUsd = Number.isFinite(deltaUsdc) ? deltaUsdc : 0;
      const isArbLike = profitUsd > 0;
      if (!isArbLike) continue;

      // const patternHash = hashPattern(protocols);

      console.log("Found arbitrage-like transaction");

      await prisma.transaction.create({
        data: {
          signature: parsed.signature,
          slot: parsed.slot,
          timestamp: new Date(parsed.timestamp),
          wallet: parsed.feePayer,
          protocols: [],
          tokens: [],
          profitUsd,
          computeUnits: 0,
          priorityFee: parsed.fee,
          patternHash: "",
        },
      });

      log.info(
        {
          sig: parsed.signature,
          profitUsd: profitUsd.toFixed(4),
          cu: parsed.computeUnits,
          pf: parsed.priorityFee,
          // protocols,
        },
        "Stored arbitrage-like tx",
      );
    } catch (error: unknown) {
      const err =
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : { value: error };
      log.warn({ err, sig }, "Failed to process signature");
    }
  }
}

async function main() {
  if (!process.env.HELIUS_KEY) {
    throw new Error("HELIUS_KEY manquant dans .env");
  }

  // Scan multi-programmes (Raydium/Orca/Jupiter/Marginfi)
  const targets = Object.values(PROGRAMS);
  for (const p of targets) {
    log.info({ program: p }, "Scanning...");
    await scanProgram(p);
  }

  log.info("Scan terminé ✅");
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
