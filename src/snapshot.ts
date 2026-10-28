import { createHash } from 'node:crypto';
import type { AccountItem, Holder, Snapshot, SnapshotInput } from './types.js';

const DIGITS = /^\d+$/;

/** Returns [owner, amount] for an item that counts, or null. Pure. */
export function countable(item: AccountItem, mint: string): [string, bigint] | null {
  const data = item?.account?.data as { parsed?: { type?: string; info?: Record<string, unknown> } } | undefined;
  if (!data || typeof data !== 'object' || !data.parsed) return null;
  if (data.parsed.type !== 'account') return null;
  const info = data.parsed.info as { mint?: string; owner?: string; tokenAmount?: { amount?: unknown } } | undefined;
  if (!info || info.mint !== mint || typeof info.owner !== 'string' || info.owner === '') return null;
  const raw = info.tokenAmount?.amount;
  if (typeof raw !== 'string' || !DIGITS.test(raw)) return null;
  const amount = BigInt(raw);
  if (amount <= 0n) return null;
  return [info.owner, amount];
}

/** sha256 hex of "rank,owner,amount" lines joined by \n, no trailing newline. */
export function hashHolders(holders: Holder[]): string {
  const text = holders.map((h) => `${h.rank},${h.owner},${h.amount}`).join('\n');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function buildSnapshot(input: SnapshotInput): Snapshot {
  const { mint, slot, accounts } = input;
  if (typeof mint !== 'string' || mint === '') throw new Error('mint is required');
  if (!Array.isArray(accounts)) throw new Error('accounts must be a list');
  const top = input.top ?? 100;
  if (!Number.isInteger(top) || top < 1) throw new Error('top must be a positive integer');
  const exOwners = new Set(input.exclusions?.owners ?? []);
  const exAccounts = new Set(input.exclusions?.token_accounts ?? []);

  const perOwner = new Map<string, bigint>();
  const seen = new Set<string>();
  for (const item of accounts) {
    if (!item || typeof item.pubkey !== 'string') continue;
    if (seen.has(item.pubkey)) continue; // the same token account listed twice counts once
    const c = countable(item, mint);
    if (!c) continue;
    seen.add(item.pubkey);
    const [owner, amount] = c;
    if (exOwners.has(owner) || exAccounts.has(item.pubkey)) continue;
    perOwner.set(owner, (perOwner.get(owner) ?? 0n) + amount);
  }

  const ranked = [...perOwner.entries()].sort((a, b) => {
    if (a[1] !== b[1]) return a[1] > b[1] ? -1 : 1;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  let total = 0n;
  for (const [, v] of ranked) total += v;
  const holders: Holder[] = ranked.slice(0, top).map(([owner, amount], i) => ({ rank: i + 1, owner, amount: amount.toString() }));
  return { mint, slot, total: total.toString(), holders, hash: hashHolders(holders) };
}
