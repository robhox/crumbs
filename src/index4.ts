import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { loadKeypairFromEnv } from "./index3";
import { PublicKey, Connection, Transaction } from "@solana/web3.js";

async function main() {
  const WSOL_MINT = new PublicKey(
    "So11111111111111111111111111111111111111112",
  );
  const wallet = loadKeypairFromEnv();
  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) throw new Error("RPC_URL manquant dans .env");

  const connection = new Connection(RPC_URL, "confirmed");

  // ✅ await inside async function now
  const wsolAta = await getAssociatedTokenAddress(WSOL_MINT, wallet.publicKey);

  const ataInfo = await connection.getAccountInfo(wsolAta);
  if (!ataInfo) {
    const createWsolAtaIx = createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      wsolAta,
      wallet.publicKey,
      WSOL_MINT,
    );

    const createTx = new Transaction().add(createWsolAtaIx);
    createTx.feePayer = wallet.publicKey;
    createTx.recentBlockhash = (
      await connection.getLatestBlockhash()
    ).blockhash;
    createTx.sign(wallet);
    await connection.sendRawTransaction(createTx.serialize());
    await connection.confirmTransaction(await connection.getLatestBlockhash());
    console.log("✅ WSOL ATA created:", wsolAta.toBase58());
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
