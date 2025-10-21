import "dotenv/config";
import pino from "pino";
import { prisma } from "./db";
import { getSignaturesForAddress, getTransaction } from "./heliusClient";
import { PROGRAMS } from "./constants";
import { parseTx } from "./parser";
import { hasFlashloan, hasRepay, hashPattern } from "./detector";
import { calcUsdcDelta } from "./profit";

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

      const raw = await getTransaction(sig);
      const parsed = parseTx(sig, raw);
      if (!parsed) continue;

      const { logs, preTokenBalances, postTokenBalances, protocols, tokens } = parsed;
      const swapCount = protocols.length;

      const isArbLike =
        (hasFlashloan(logs) && hasRepay(logs) && swapCount >= 2) ||
        swapCount >= 3; // heuristique permissive pour capter + large

      if (!isArbLike) continue;

      const deltaUsdc = calcUsdcDelta(preTokenBalances, postTokenBalances);
      const profitUsd = Number.isFinite(deltaUsdc) ? deltaUsdc : 0;
      const patternHash = hashPattern(protocols);

      await prisma.transaction.create({
        data: {
          signature: parsed.signature,
          slot: parsed.slot,
          timestamp: new Date(parsed.blockTime * 1000),
          wallet: parsed.wallet,
          protocols,
          tokens,
          profitUsd,
          computeUnits: parsed.computeUnits,
          priorityFee: parsed.priorityFee,
          patternHash,
        },
      });

      log.info(
        {
          sig: parsed.signature,
          profitUsd: profitUsd.toFixed(4),
          cu: parsed.computeUnits,
          pf: parsed.priorityFee,
          protocols,
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
