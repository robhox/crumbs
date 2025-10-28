import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { loadKeypairFromEnv } from "./index3";
import { PublicKey, Connection, Transaction } from "@solana/web3.js";
import { encodeInstruction } from "./encodeInstruction";
import { BorshInstructionCoder, Idl } from "@coral-xyz/anchor";
import jupIdl from "../idl/jup_v6.json";
import BN from "bn.js";

async function main() {
  const coder = new BorshInstructionCoder(jupIdl as Idl);
  const data = coder.encode("route_v2", {
    in_amount: new BN(1039255073),
    quoted_out_amount: new BN(1806572317),
    slippage_bps: 300,
    platform_fee_bps: 10,
    positive_slippage_bps: 0,
    route_plan: [
      {
        swap: {
          TesseraV: {
            side: { Ask: {} },
          },
        },
        bps: 10000,
        input_index: 0,
        output_index: 1,
      },
      {
        swap: {
          HumidiFi: {
            swap_id: new BN("1690530991349513388"),
            is_base_to_quote: false,
          },
        },
        bps: 10000,
        input_index: 1,
        output_index: 2,
      },
    ],
  });

  console.log(Buffer.from(data).toString("hex"));

  // console.log(
  //   encodeInstruction("route_v2", {
  //     in_amount: 1_000_000,
  //     quoted_out_amount: 1_000_500,
  //     slippage_bps: 50,
  //     platform_fee_bps: 0,
  //     positive_slippage_bps: 0,
  //     route_plan: [],
  //   }).toString("hex"),
  // );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
