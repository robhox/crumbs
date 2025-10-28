import "dotenv/config";
import pino from "pino";
import { prisma } from "./db";

const log = pino({
  transport: { target: "pino-pretty" },
  level: "info",
});

async function checkArb() {
  const HELIUS_KEY = process.env.HELIUS_KEY;
  if (!HELIUS_KEY) throw new Error("HELIUS_KEY manquant dans .env");

  const options = { method: "GET" };

  try {
    const decimals = 1000000;
    const quantity1 = 10 * decimals;
    const url1 = `https://lite-api.jup.ag/swap/v1/quote?slippageBps=50&swapMode=ExactIn&restrictIntermediateTokens=true&maxAccounts=64&instructionVersion=V1&inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=${quantity1}&dexes=HumidiFi`;

    const res1 = await fetch(url1, options);
    const data1 = await res1.json();

    const quantity2 = data1.outAmount;
    const url2 = `https://lite-api.jup.ag/swap/v1/quote?slippageBps=50&swapMode=ExactIn&restrictIntermediateTokens=true&maxAccounts=64&instructionVersion=V1&inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=${quantity2}&dexes=TesseraV`;

    const res2 = await fetch(url2, options);
    const data2 = await res2.json();

    if (data2.outAmount - data1.inAmount > 0) {
      console.log(
        "HumidiFi → TesseraV arbitrage found ! Value : $ ",
        (data2.outAmount - data1.inAmount) / 1000000,
      );
    }
  } catch (error) {
    console.error("Erreur durant checkArb:", error.message);
  }
}

async function main() {
  const delay = 2100;
  console.log(`🚀 Lancement du scanner toutes les ${delay}ms...`);
  await checkArb(); // première exécution immédiate
  setInterval(checkArb, delay);
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
