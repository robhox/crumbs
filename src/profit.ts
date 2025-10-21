import { USDC_MINT } from "./constants";
import type { TokenBalance } from "./parser";

/**
 * Profit simple: ΔUSDC (post - pre).
 * (Tu amélioreras ensuite: multi-tokens + conversion Pyth en USD.)
 */
const extractUiAmount = (balance: TokenBalance | undefined): number => {
  if (!balance?.uiTokenAmount) return 0;
  const amount = balance.uiTokenAmount;

  if (typeof amount.uiAmount === "number") {
    return amount.uiAmount;
  }

  if (amount.uiAmount !== null && amount.uiAmount !== undefined) {
    const num = Number(amount.uiAmount);
    if (Number.isFinite(num)) return num;
  }

  if (typeof amount.uiAmountString === "string") {
    const num = Number(amount.uiAmountString);
    if (Number.isFinite(num)) return num;
  }

  if (typeof amount.amount === "string" && typeof amount.decimals === "number") {
    const raw = Number(amount.amount);
    if (Number.isFinite(raw)) {
      return raw / Math.pow(10, amount.decimals);
    }
  }

  return 0;
};

export function calcUsdcDelta(pre: TokenBalance[], post: TokenBalance[]): number {
  const preUsdc = extractUiAmount(pre.find((balance) => balance.mint === USDC_MINT));
  const postUsdc = extractUiAmount(post.find((balance) => balance.mint === USDC_MINT));
  return postUsdc - preUsdc;
}
