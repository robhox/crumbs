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
  const sigs = await getSignaturesForAddress(programAddr, LIMIT);
  for (const s of sigs) {
    const sig = s.signature || s; // compat
    // Skip si déjà connu
    const exists = await prisma.transaction.findUnique({
      where: { signature: sig },
    });
    if (exists) continue;

    const raw = await getTransaction(sig);
    const parsed = parseTx(sig, raw);
    if (!parsed) continue;

    const { logs, preTokenBalances, postTokenBalances, protocols } = parsed;
    const swapCount = parsed.protocols?.length ?? 0;

    const isArbLike =
      (hasFlashloan(logs) && hasRepay(logs) && swapCount >= 2) ||
      swapCount >= 3; // heuristique permissive pour capter + large

    if (!isArbLike) continue;

    // Profit (USDC-only v1)
    const deltaUsdc = calcUsdcDelta(preTokenBalances, postTokenBalances);
    const profitUsd = deltaUsdc; // ~1 USDC ≈ 1 USD

    const patternHash = hashPattern(protocols);

    await prisma.transaction.create({
      data: {
        signature: parsed.signature,
        slot: parsed.slot,
        timestamp: new Date(parsed.blockTime * 1000),
        wallet: parsed.wallet,
        protocols,
        tokens: ["USDC"],
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
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
