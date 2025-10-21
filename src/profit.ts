import { USDC_MINT } from "./constants";

/**
 * Profit simple: ΔUSDC (post - pre).
 * (Tu amélioreras ensuite: multi-tokens + conversion Pyth en USD.)
 */
export function calcUsdcDelta(pre: any[], post: any[]): number {
  const preU =
    pre.find((b) => b.mint === USDC_MINT)?.uiTokenAmount?.uiAmount ?? 0;
  const postU =
    post.find((b) => b.mint === USDC_MINT)?.uiTokenAmount?.uiAmount ?? 0;
  return (postU - preU) as number;
}
