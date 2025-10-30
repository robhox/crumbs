import { BorshInstructionCoder, Idl } from "@coral-xyz/anchor";
import jupIdl from "../idl/jup_v6.json";
import BN from "bn.js";

export function encodeInstruction(
  swapId: number,
  inputAmount: number,
  outputAmount: number,
): Buffer {
  const coder = new BorshInstructionCoder(jupIdl as Idl);
  return coder.encode("route", {
    in_amount: new BN(inputAmount),
    quoted_out_amount: new BN(outputAmount),
    slippage_bps: 0,
    platform_fee_bps: 0,
    positive_slippage_bps: 0,
    route_plan: [
      {
        swap: {
          HumidiFi: {
            swap_id: new BN(swapId),
            is_base_to_quote: false,
          },
        },
        percent: 100,
        input_index: 0,
        output_index: 1,
      },
      {
        swap: {
          TesseraV: {
            side: { Ask: {} },
          },
        },
        percent: 100,
        input_index: 1,
        output_index: 0,
      },
    ],
  });
}
