import { USDC_MINT } from "./constants";

export type ParsedTx = {
  signature: string;
  slot: number;
  blockTime: number;
  wallet: string;
  protocols: string[];
  tokens: string[];
  computeUnits: number;
  priorityFee: number;
  logs: string[];
  preTokenBalances: any[];
  postTokenBalances: any[];
};

export function parseTx(signature: string, raw: any): ParsedTx | null {
  if (!raw) return null;
  const msg = raw.transaction?.message;
  const meta = raw.meta;
  if (!msg || !meta) return null;

  const wallet = msg.accountKeys?.[0]?.toString?.() ?? "unknown";
  const logs = meta.logMessages ?? [];
  const computeUnits = meta.computeUnitsConsumed ?? 0;

  // Priority fee (approx.): sum of postBalances - preBalances on fee payer (lamports) → convert to SOL?
  // Ici on garde la valeur en SOL approximée, sinon mets juste 0 et affine plus tard.
  const preLamports = meta.preBalances?.[0] ?? 0;
  const postLamports = meta.postBalances?.[0] ?? 0;
  const lamportsSpent = preLamports - postLamports;
  const priorityFee = lamportsSpent / 1e9;

  // Protocols heuristics simples (basé sur programId dans instructions)
  const programIds: string[] = [];
  for (const ix of msg.instructions ?? []) {
    const pid = ix.programId?.toString?.() || ix.programId || "";
    if (pid) programIds.push(pid);
  }

  return {
    signature,
    slot: raw.slot,
    blockTime: raw.blockTime ?? Math.floor(Date.now() / 1000),
    wallet,
    protocols: Array.from(new Set(programIds)),
    tokens: [USDC_MINT], // on initialisera, puis on enrichira plus tard
    computeUnits,
    priorityFee,
    logs,
    preTokenBalances: meta.preTokenBalances ?? [],
    postTokenBalances: meta.postTokenBalances ?? [],
  };
}
