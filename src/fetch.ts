import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM, type AccountItem } from './types.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface FetchAccountsInput {
  rpcUrl: string;
  mint: string;
  fetch?: FetchLike;
  minContextSlot?: number;
}

/** Error whose message never contains the RPC URL. */
export class RpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RpcError';
  }
}

export function programAccountsRequest(program: string, mint: string, id: number, minContextSlot?: number) {
  const config: Record<string, unknown> = {
    encoding: 'jsonParsed',
    withContext: true,
    filters: [{ memcmp: { offset: 0, bytes: mint } }],
  };
  if (minContextSlot !== undefined) config.minContextSlot = minContextSlot;
  return { jsonrpc: '2.0', id, method: 'getProgramAccounts', params: [program, config] };
}

export async function fetchAccounts(input: FetchAccountsInput): Promise<{ slot: number; accounts: AccountItem[] }> {
  const { rpcUrl, mint } = input;
  if (!rpcUrl) throw new RpcError('SOLANA_RPC_URL is not set');
  if (!mint) throw new RpcError('mint is required');
  const f: FetchLike = input.fetch ?? ((u, i) => globalThis.fetch(u, i));
  const programs = [TOKEN_PROGRAM, TOKEN_2022_PROGRAM];
  const answers = await Promise.all(
    programs.map(async (program, i) => {
      let res: Response;
      try {
        res = await f(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(programAccountsRequest(program, mint, i + 1, input.minContextSlot)),
        });
      } catch (e) {
        throw new RpcError(`RPC request failed: ${e instanceof Error ? e.message.replace(rpcUrl, '<rpc>') : 'network error'}`);
      }
      let body: { result?: { context?: { slot?: number }; value?: AccountItem[] }; error?: { code?: number; message?: string } };
      try {
        body = await res.json();
      } catch {
        throw new RpcError(`RPC answer is not JSON (HTTP ${res.status})`);
      }
      if (body.error) throw new RpcError(`RPC error ${body.error.code ?? ''}: ${body.error.message ?? 'unknown'}`.replace(rpcUrl, '<rpc>'));
      const slot = body.result?.context?.slot;
      const value = body.result?.value;
      if (typeof slot !== 'number' || !Array.isArray(value)) throw new RpcError('RPC answer has no context slot or value');
      return { slot, value };
    }),
  );
  return { slot: Math.min(...answers.map((a) => a.slot)), accounts: answers.flatMap((a) => a.value) };
}
