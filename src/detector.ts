import crypto from "crypto";

export function hasFlashloan(logs: string[]): boolean {
  const t = logs.join(" ").toLowerCase();
  return t.includes("flashloan") || t.includes("flash_loan");
}

export function hasRepay(logs: string[]): boolean {
  const t = logs.join(" ").toLowerCase();
  return t.includes("repay") || t.includes("repaid");
}

export function hashPattern(programIds: string[]): string {
  const s = programIds.join(">");
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

export function numberOfSwap(logs: string[]): number {
  const t = logs.join(" ").toLowerCase();
  return t.split("transfer").length - 1;
}
