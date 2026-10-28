import { readFileSync, writeFileSync } from 'node:fs';
import { buildSnapshot } from './snapshot.js';
import { fetchAccounts, type FetchLike } from './fetch.js';
import type { Exclusions } from './types.js';

export interface CliIo {
  argv: string[];
  env: Record<string, string | undefined>;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  fetch?: FetchLike;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const FLAGS = new Set(['--mint', '--exclusions', '--slot', '--top', '--out', '--fixture', '--save-fixture']);

export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    if (!FLAGS.has(k)) throw new Error(`unknown option ${k}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${k} needs a value`);
    out[k.slice(2)] = v;
    i++;
  }
  return out;
}

function readJson(path: string, what: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`cannot read the ${what} file ${path}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`the ${what} file ${path} is not valid JSON`);
  }
}

function positiveInt(v: string | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v) || Number(v) < 1) throw new Error(`${name} must be a positive integer`);
  return Number(v);
}

/** Runs the CLI; returns the exit code. Never prints the RPC URL. */
export async function run(io: CliIo): Promise<number> {
  try {
    const a = parseArgs(io.argv);
    if (!a.mint) throw new Error('missing --mint <address>');
    if (!BASE58.test(a.mint)) throw new Error('--mint is not a Solana address');
    if (!a.exclusions) throw new Error('missing --exclusions <file>');
    const ex = readJson(a.exclusions, 'exclusions') as Partial<Exclusions>;
    if (!ex || typeof ex !== 'object' || (ex.owners && !Array.isArray(ex.owners)) || (ex.token_accounts && !Array.isArray(ex.token_accounts)))
      throw new Error('exclusions must be {"owners": [...], "token_accounts": [...]}');
    const top = positiveInt(a.top, '--top');
    const minSlot = a.slot !== undefined ? (/^\d+$/.test(a.slot) ? Number(a.slot) : NaN) : undefined;
    if (Number.isNaN(minSlot)) throw new Error('--slot must be a whole number');

    let data: { slot: number; accounts: unknown[] };
    if (a.fixture) {
      data = readJson(a.fixture, 'fixture') as { slot: number; accounts: unknown[] };
      if (!data || typeof data.slot !== 'number' || !Array.isArray(data.accounts)) throw new Error('the fixture must be {"slot": n, "accounts": [...]}');
    } else {
      const rpcUrl = io.env.SOLANA_RPC_URL;
      if (!rpcUrl) throw new Error('set SOLANA_RPC_URL or pass --fixture <file>');
      data = await fetchAccounts({ rpcUrl, mint: a.mint, fetch: io.fetch, minContextSlot: minSlot });
    }
    if (a['save-fixture']) writeFileSync(a['save-fixture'], JSON.stringify({ slot: data.slot, accounts: data.accounts }, null, 1) + '\n');
    const snap = buildSnapshot({ mint: a.mint, slot: data.slot, accounts: data.accounts as never, exclusions: ex, top });
    const text = JSON.stringify(snap, null, 2) + '\n';
    if (a.out) writeFileSync(a.out, text);
    else io.stdout(text);
    return 0;
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    const rpc = io.env.SOLANA_RPC_URL;
    if (rpc) msg = msg.split(rpc).join('<rpc>');
    io.stderr(`kog-snapshot: ${msg}\n`);
    return 1;
  }
}
