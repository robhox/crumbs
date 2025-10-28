import { BorshInstructionCoder, Idl } from "@coral-xyz/anchor";
import jupIdl from "../idl/jup_v6.json";

export function decodeInstruction(data: Buffer) {
  const coder = new BorshInstructionCoder(jupIdl as Idl);

  const decoded = coder.decode(data);

  if (!decoded) {
    throw new Error("Unable to decode instruction Buffer: not a known format");
  }

  return decoded;
}
