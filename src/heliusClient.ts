import axios from "axios";

const H_API = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_KEY}`;

type JsonRpcParams = {
  method: string;
  params: any[];
};

export async function rpc<T>({ method, params }: JsonRpcParams): Promise<T> {
  const { data } = await axios.post(H_API, {
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result as T;
}

export async function getSignaturesForAddress(address: string, limit: number) {
  return rpc<any[]>({
    method: "getSignaturesForAddress",
    params: [address, { limit }],
  });
}

export async function getTransaction(signature: string) {
  return rpc<any>({
    method: "getTransaction",
    params: [
      signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
    ],
  });
}
