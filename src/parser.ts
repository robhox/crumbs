import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { USDC_MINT } from "./constants";

export type TokenBalance = {
  mint?: string | null;
  uiTokenAmount?: {
    uiAmount?: number | null;
    uiAmountString?: string | null;
    amount?: string | null;
    decimals?: number | null;
  } | null;
};

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
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
};

const toStringSafe = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const maybePubkey = (value as { pubkey?: unknown }).pubkey;
    if (maybePubkey) {
      const asString = toStringSafe(maybePubkey);
      if (asString) return asString;
    }

    const withToBase58 = value as { toBase58?: () => string };
    if (typeof withToBase58.toBase58 === "function") {
      const base58 = withToBase58.toBase58();
      if (base58) return base58;
    }

    const withToString = value as { toString?: () => string };
    if (typeof withToString.toString === "function") {
      const str = withToString.toString();
      if (str && str !== "[object Object]") return str;
    }
  }
  return null;
};

const normaliseAccountKeys = (keys: unknown): string[] => {
  if (!Array.isArray(keys)) return [];
  return keys
    .map((key) => toStringSafe(key))
    .filter((key): key is string => Boolean(key));
};

const extractProgramId = (instruction: unknown, accountKeys: string[]): string | null => {
  if (!instruction || typeof instruction !== "object") return null;
  const ix = instruction as Record<string, unknown>;
  const direct = toStringSafe(ix.programId ?? ix.programIdRaw);
  if (direct) return direct;

  if (typeof ix.programIdIndex === "number") {
    return accountKeys[ix.programIdIndex] ?? null;
  }

  if (typeof ix.program === "string" && ix.program) {
    return ix.program;
  }

  return null;
};

const collectProgramIds = (instructions: unknown, accountKeys: string[]): string[] => {
  if (!Array.isArray(instructions)) return [];
  const ids = new Set<string>();
  for (const instruction of instructions) {
    const pid = extractProgramId(instruction, accountKeys);
    if (pid) ids.add(pid);
  }
  return Array.from(ids);
};

const collectTokenMints = (balances: TokenBalance[]): string[] => {
  const mints = new Set<string>();
  for (const balance of balances) {
    const mint = balance?.mint;
    if (typeof mint === "string" && mint) {
      mints.add(mint);
    }
  }
  return Array.from(mints);
};

export function parseTx(signature: string, raw: any): ParsedTx | null {
  if (!raw) return null;
  const message = raw.transaction?.message;
  const meta = raw.meta;
  if (!message || !meta) return null;

  const accountKeys = normaliseAccountKeys(message.accountKeys);
  const wallet = accountKeys[0] ?? "unknown";
  const logs = Array.isArray(meta.logMessages) ? meta.logMessages : [];
  const computeUnits = typeof meta.computeUnitsConsumed === "number" ? meta.computeUnitsConsumed : 0;

  const preBalances = Array.isArray(meta.preBalances) ? meta.preBalances : [];
  const postBalances = Array.isArray(meta.postBalances) ? meta.postBalances : [];
  const lamportsSpent =
    typeof preBalances[0] === "number" && typeof postBalances[0] === "number"
      ? preBalances[0] - postBalances[0]
      : 0;
  const priorityFee = lamportsSpent / LAMPORTS_PER_SOL;

  const parsedProgramIds = collectProgramIds(message.instructions, accountKeys);
  const compiledProgramIds = collectProgramIds(message.compiledInstructions, accountKeys);
  const protocols = Array.from(new Set([...parsedProgramIds, ...compiledProgramIds]));

  const preTokenBalances: TokenBalance[] = Array.isArray(meta.preTokenBalances)
    ? meta.preTokenBalances
    : [];
  const postTokenBalances: TokenBalance[] = Array.isArray(meta.postTokenBalances)
    ? meta.postTokenBalances
    : [];
  const tokenSet = collectTokenMints([...preTokenBalances, ...postTokenBalances]);
  if (tokenSet.length === 0) {
    tokenSet.push(USDC_MINT);
  }

  return {
    signature,
    slot: raw.slot,
    blockTime: raw.blockTime ?? Math.floor(Date.now() / 1000),
    wallet,
    protocols,
    tokens: tokenSet,
    computeUnits,
    priorityFee,
    logs,
    preTokenBalances,
    postTokenBalances,
  };
}
