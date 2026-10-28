import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSnapshot, fetchAccounts, run, TOKEN_PROGRAM, TOKEN_2022_PROGRAM, parseArgs } from '../src/index.js';
import { acct, MINT } from './helpers.js';

const NOEX = { owners: [], token_accounts: [] };
const PYUSD = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const fixturePath = new URL('./fixtures/mainnet-pyusd-usdc.json', import.meta.url).pathname;
const real = JSON.parse(readFileSync(fixturePath, 'utf8'));

test('A1 groups by owner across both programs; other mints, zero balances and non token accounts ignored', () => {
  const s = buildSnapshot({
    mint: MINT, slot: 7, exclusions: NOEX,
    accounts: [
      acct('ta1', 'alice', '100', { program: 'spl-token' }),
      acct('ta2', 'alice', '250'),
      acct('ta3', 'bob', '300'),
      acct('ta4', 'carol', '0'),
      acct('ta5', 'dave', '999', { mint: 'OtherMint' }),
      acct('ta6', 'erin', '50', { type: 'mint' }),
      { pubkey: 'raw', account: { data: ['AAAA', 'base64'] } },
      { pubkey: 'np', account: { data: { program: 'spl-token' } } },
      acct('ta7', 'frank', 'not-a-number'),
      acct('ta2', 'alice', '250'), // duplicate item counted once
    ],
  });
  assert.deepEqual(s.holders, [
    { rank: 1, owner: 'alice', amount: '350' },
    { rank: 2, owner: 'bob', amount: '300' },
  ]);
  assert.equal(s.total, '650');
  assert.equal(s.slot, 7);
  assert.equal(s.mint, MINT);
});

test('A1 amounts use BigInt math beyond 2^53', () => {
  const s = buildSnapshot({ mint: MINT, slot: 1, exclusions: NOEX, accounts: [acct('a', 'x', '9007199254740993'), acct('b', 'x', '9007199254740993')] });
  assert.equal(s.holders[0]!.amount, '18014398509481986');
});

test('A2 exclusions by owner and by token account', () => {
  const accounts = [acct('ta1', 'alice', '100'), acct('ta2', 'alice', '40'), acct('ta3', 'bob', '300'), acct('ta4', 'treasury', '5000')];
  const s = buildSnapshot({ mint: MINT, slot: 1, accounts, exclusions: { owners: ['treasury'], token_accounts: ['ta2'] } });
  assert.deepEqual(s.holders.map((h) => [h.owner, h.amount]), [['bob', '300'], ['alice', '100']]);
  assert.equal(s.total, '400');
  const none = buildSnapshot({ mint: MINT, slot: 1, accounts, exclusions: {} });
  assert.equal(none.total, '5440');
  assert.equal(buildSnapshot({ mint: MINT, slot: 1, accounts }).holders.length, 3);
});

test('A3 ranking by amount desc, ties by owner ascending, top keeps the first N; total covers all', () => {
  const accounts = [acct('1', 'b', '10'), acct('2', 'a', '10'), acct('3', 'C', '10'), acct('4', 'z', '20'), acct('5', 'm', '5')];
  const s = buildSnapshot({ mint: MINT, slot: 1, accounts, exclusions: NOEX, top: 3 });
  assert.deepEqual(s.holders, [
    { rank: 1, owner: 'z', amount: '20' },
    { rank: 2, owner: 'C', amount: '10' }, // plain string comparison: 'C' < 'a'
    { rank: 3, owner: 'a', amount: '10' },
  ]);
  assert.equal(s.total, '55');
  const many = Array.from({ length: 150 }, (_, i) => acct(`t${i}`, `o${String(i).padStart(3, '0')}`, String(i + 1)));
  assert.equal(buildSnapshot({ mint: MINT, slot: 1, accounts: many, exclusions: NOEX }).holders.length, 100);
  assert.throws(() => buildSnapshot({ mint: MINT, slot: 1, accounts: [], exclusions: NOEX, top: 0 }), /top/);
  assert.throws(() => buildSnapshot({ mint: '', slot: 1, accounts: [], exclusions: NOEX }), /mint/);
  assert.throws(() => buildSnapshot({ mint: MINT, slot: 1, accounts: null as never, exclusions: NOEX }), /list/);
});

test('A4 hash rule and order independence', () => {
  const accounts = [acct('1', 'alice', '100'), acct('2', 'bob', '300'), acct('3', 'alice', '5')];
  const s = buildSnapshot({ mint: MINT, slot: 1, accounts, exclusions: NOEX });
  const expected = createHash('sha256').update('1,bob,300\n2,alice,105').digest('hex');
  assert.equal(s.hash, expected);
  assert.match(s.hash, /^[0-9a-f]{64}$/);
  const shuffled = buildSnapshot({ mint: MINT, slot: 1, accounts: [accounts[2]!, accounts[0]!, accounts[1]!], exclusions: NOEX });
  assert.equal(shuffled.hash, s.hash);
  const empty = buildSnapshot({ mint: MINT, slot: 1, accounts: [], exclusions: NOEX });
  assert.equal(empty.hash, createHash('sha256').update('').digest('hex'));
});

test('A5 Token 2022 accounts with extensions and a frozen state count by amount', () => {
  const s = buildSnapshot({
    mint: MINT, slot: 1, exclusions: NOEX,
    accounts: [
      acct('f', 'frozen', '70', { state: 'frozen', extensions: [{ extension: 'immutableOwner' }] }),
      acct('t', 'fee', '30', { extensions: [{ extension: 'transferFeeAmount', state: { withheldAmount: 999 } }, { extension: 'transferHookAccount', state: { transferring: false } }] }),
    ],
  });
  assert.deepEqual(s.holders.map((h) => [h.owner, h.amount]), [['frozen', '70'], ['fee', '30']]);
});

function mockRpc(slots: Record<string, number>, values: Record<string, unknown[]>) {
  const bodies: any[] = [];
  const urls: string[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    urls.push(url);
    const b = JSON.parse(String(init!.body));
    bodies.push(b);
    const program = b.params[0];
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: b.id, result: { context: { slot: slots[program] }, value: values[program] ?? [] } }));
  };
  return { fetch, bodies, urls };
}

test('A6 fetchAccounts sends one getProgramAccounts per token program and takes the lowest slot', async () => {
  const m = mockRpc({ [TOKEN_PROGRAM]: 105, [TOKEN_2022_PROGRAM]: 100 }, { [TOKEN_PROGRAM]: [acct('a', 'x', '1', { program: 'spl-token' })], [TOKEN_2022_PROGRAM]: [acct('b', 'y', '2')] });
  const r = await fetchAccounts({ rpcUrl: 'https://rpc.example/secret-key', mint: MINT, fetch: m.fetch });
  assert.equal(r.slot, 100);
  assert.equal(r.accounts.length, 2);
  assert.equal(m.bodies.length, 2);
  for (const b of m.bodies) {
    assert.equal(b.method, 'getProgramAccounts');
    assert.equal(b.params[1].encoding, 'jsonParsed');
    assert.equal(b.params[1].withContext, true);
    assert.deepEqual(b.params[1].filters, [{ memcmp: { offset: 0, bytes: MINT } }]);
    assert.equal(b.params[1].minContextSlot, undefined);
  }
  assert.deepEqual(m.bodies.map((b) => b.params[0]).sort(), [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].sort());
  const m2 = mockRpc({ [TOKEN_PROGRAM]: 1, [TOKEN_2022_PROGRAM]: 1 }, {});
  await fetchAccounts({ rpcUrl: 'https://r', mint: MINT, fetch: m2.fetch, minContextSlot: 42 });
  assert.equal(m2.bodies[0].params[1].minContextSlot, 42);
});

test('A6 RPC errors are plain and never contain the RPC URL', async () => {
  const url = 'https://rpc.example/?api-key=SECRET';
  const errFetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32010, message: 'excluded from secondary indexes' } }));
  await assert.rejects(fetchAccounts({ rpcUrl: url, mint: MINT, fetch: errFetch }), (e: Error) => /-32010/.test(e.message) && !e.message.includes('SECRET'));
  await assert.rejects(fetchAccounts({ rpcUrl: url, mint: MINT, fetch: async () => { throw new Error(`connect ${url} refused`); } }), (e: Error) => !e.message.includes('SECRET'));
  await assert.rejects(fetchAccounts({ rpcUrl: url, mint: MINT, fetch: async () => new Response('<html>', { status: 502 }) }), /not JSON/);
  await assert.rejects(fetchAccounts({ rpcUrl: url, mint: MINT, fetch: async () => new Response('{"result":{}}') }), /no context/);
  await assert.rejects(fetchAccounts({ rpcUrl: '', mint: MINT }), /SOLANA_RPC_URL/);
  await assert.rejects(fetchAccounts({ rpcUrl: url, mint: '' }), /mint/);
});

function io(argv: string[], env: Record<string, string> = {}, fetch?: any) {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { argv, env, stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s), fetch }, out, err };
}

test('A6 CLI writes the snapshot from a recorded fixture with no network, exit 1 on bad input', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kog-'));
  const ex = join(dir, 'ex.json');
  writeFileSync(ex, JSON.stringify(NOEX));
  let c = io(['--mint', PYUSD, '--exclusions', ex, '--fixture', fixturePath, '--top', '2']);
  assert.equal(await run(c.io), 0);
  const snap = JSON.parse(c.out.join(''));
  assert.equal(snap.holders.length, 2);
  assert.equal(snap.slot, real.slot);

  const outFile = join(dir, 'snap.json');
  const saved = join(dir, 'saved.json');
  const m = mockRpc({ [TOKEN_PROGRAM]: 9, [TOKEN_2022_PROGRAM]: 8 }, { [TOKEN_2022_PROGRAM]: [acct('b', 'y', '2', { mint: PYUSD })] });
  c = io(['--mint', PYUSD, '--exclusions', ex, '--slot', '5', '--out', outFile, '--save-fixture', saved], { SOLANA_RPC_URL: 'https://rpc.example/KEY' }, m.fetch);
  assert.equal(await run(c.io), 0);
  assert.equal(c.out.length, 0);
  assert.equal(JSON.parse(readFileSync(outFile, 'utf8')).holders[0].owner, 'y');
  assert.equal(JSON.parse(readFileSync(saved, 'utf8')).slot, 8);
  assert.equal(m.bodies[0].params[1].minContextSlot, 5);

  const bad: [string[], RegExp, Record<string, string>?][] = [
    [['--exclusions', ex, '--fixture', fixturePath], /missing --mint/],
    [['--mint', 'nope', '--exclusions', ex, '--fixture', fixturePath], /not a Solana address/],
    [['--mint', PYUSD, '--fixture', fixturePath], /missing --exclusions/],
    [['--mint', PYUSD, '--exclusions', join(dir, 'missing.json'), '--fixture', fixturePath], /cannot read/],
    [['--mint', PYUSD, '--exclusions', ex, '--fixture', join(dir, 'nope.json')], /cannot read/],
    [['--mint', PYUSD, '--exclusions', ex, '--top', '0', '--fixture', fixturePath], /--top/],
    [['--mint', PYUSD, '--exclusions', ex, '--slot', 'x', '--fixture', fixturePath], /--slot/],
    [['--mint', PYUSD, '--exclusions', ex], /SOLANA_RPC_URL/],
    [['--mint', PYUSD, '--exclusions', ex, '--bogus', '1'], /unknown option/],
    [['--mint'], /needs a value/],
  ];
  for (const [argv, re] of bad) {
    c = io(argv);
    assert.equal(await run(c.io), 1, argv.join(' '));
    assert.match(c.err.join(''), re);
  }
  const notJson = join(dir, 'bad.json');
  writeFileSync(notJson, '{nope');
  c = io(['--mint', PYUSD, '--exclusions', notJson, '--fixture', fixturePath]);
  assert.equal(await run(c.io), 1);
  assert.match(c.err.join(''), /not valid JSON/);
  writeFileSync(notJson, '{"owners": "x"}');
  c = io(['--mint', PYUSD, '--exclusions', notJson, '--fixture', fixturePath]);
  assert.equal(await run(c.io), 1);
  writeFileSync(notJson, '{"accounts": 1}');
  c = io(['--mint', PYUSD, '--exclusions', ex, '--fixture', notJson]);
  assert.equal(await run(c.io), 1);
  assert.match(c.err.join(''), /fixture must be/);

  const failing = async () => new Response(JSON.stringify({ error: { code: 429, message: 'too many requests at https://rpc.example/KEY' } }));
  c = io(['--mint', PYUSD, '--exclusions', ex], { SOLANA_RPC_URL: 'https://rpc.example/KEY' }, failing);
  assert.equal(await run(c.io), 1);
  assert.ok(!c.err.join('').includes('KEY'), 'RPC URL never printed');
  assert.ok(!existsSync(join(dir, 'never.json')));
  assert.deepEqual(parseArgs([]), {});
});

test('A7 recorded fixture of a real Token 2022 mint (PYUSD) is committed and snapshots reproducibly', () => {
  assert.match(real._source, /mainnet/);
  const programs = new Set(real.accounts.map((a: any) => a.account.data.program));
  assert.ok(programs.has('spl-token-2022') && programs.has('spl-token'));
  const s = buildSnapshot({ mint: PYUSD, slot: real.slot, accounts: real.accounts, exclusions: NOEX });
  // 3 PYUSD token accounts with transferFeeAmount + transferHookAccount (+ immutableOwner on one); USDC accounts and both mint accounts ignored
  assert.deepEqual(s.holders, [
    { rank: 1, owner: 'DXK4yMpigbTSqv33nJk1tJucXB4E3rDmTXn3yZmiFAXt', amount: '460439372090' },
    { rank: 2, owner: 'CG8vBSopUJE3SvW3bNaerqj2rrtBX2U13AeB1tHTvcrM', amount: '143521252214' },
    { rank: 3, owner: 'EPiX4U2B8g7kyVMmY3Nwxcs6GAQKk4yUT356Bk2dUEae', amount: '1' },
  ]);
  assert.equal(s.total, '603960624305');
  assert.equal(s.hash, createHash('sha256').update(s.holders.map((h) => `${h.rank},${h.owner},${h.amount}`).join('\n')).digest('hex'));
  const usdc = buildSnapshot({ mint: USDC, slot: real.slot, accounts: real.accounts, exclusions: NOEX });
  assert.equal(usdc.holders.length, 3);
  const reversed = buildSnapshot({ mint: PYUSD, slot: real.slot, accounts: [...real.accounts].reverse(), exclusions: NOEX });
  assert.equal(reversed.hash, s.hash);
});
