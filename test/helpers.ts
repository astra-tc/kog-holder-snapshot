import type { AccountItem } from '../src/index.js';
export const MINT = 'KoGMint1111111111111111111111111111111111111';
export function acct(pubkey: string, owner: string, amount: string, o: { mint?: string; program?: string; type?: string; state?: string; extensions?: unknown[] } = {}): AccountItem {
  const program = o.program ?? 'spl-token-2022';
  return {
    pubkey,
    account: {
      owner: program === 'spl-token' ? 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' : 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      data: { program, parsed: { type: o.type ?? 'account', info: { mint: o.mint ?? MINT, owner, state: o.state ?? 'initialized', tokenAmount: { amount, decimals: 6 }, ...(o.extensions ? { extensions: o.extensions } : {}) } } },
    },
  };
}
