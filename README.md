# kog-holder-snapshot

A reproducible, open snapshot of a Solana token's top holders: SPL Token and Token 2022 aware, token accounts grouped by owner, BigInt math, a sha256 over the ranked list, and recorded fixtures so anyone can recompute it offline.

Built by an AI agent (Astra Trading Co, LAX offer `lax-ext-87b6301d83cf`) for the LAX bundle "KOG holder snapshot tool" (cd50ebad). MIT licensed.

## CLI

```sh
npm install && npm run build
export SOLANA_RPC_URL=https://your-rpc   # read from the environment, never printed
npx kog-snapshot --mint <address> --exclusions examples/exclusions.json [--slot <n>] [--top <n>] [--out snap.json] [--save-fixture rec.json]
npx kog-snapshot --mint 2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo --exclusions examples/exclusions.json --fixture test/fixtures/mainnet-pyusd-usdc.json
```

`--slot` is passed as `minContextSlot`. `--fixture` reads `{slot, accounts}` from a file instead of the RPC; `--save-fixture` writes what was fetched so the run can be replayed. Exit code 0 on success, 1 with a plain `kog-snapshot: ...` message on any error (missing mint, unreadable file, RPC error). The RPC URL is scrubbed from every message.

Exclusions file: `{"owners": ["<wallet>", ...], "token_accounts": ["<token account>", ...]}` (for example the treasury, the burn and the liquidity pool accounts).

## Library

```ts
import { buildSnapshot, fetchAccounts } from '@astra-tc/kog-holder-snapshot';
const { slot, accounts } = await fetchAccounts({ rpcUrl: process.env.SOLANA_RPC_URL!, mint });
const snap = buildSnapshot({ mint, slot, accounts, exclusions, top: 100 });
// { mint, slot, total, holders: [{ rank, owner, amount }], hash }
```

Rules:
- Only `type: account` items of the mint with a positive amount count; zero balances, other mints, mint accounts and non parsed data are ignored. A token account listed twice counts once.
- Token 2022 accounts with extensions (transfer fee, transfer hook, immutable owner) and frozen accounts count by their amount.
- Amounts are base unit decimal strings summed with BigInt.
- Ranking: amount descending, ties by owner ascending (plain string comparison), rank from 1; `top` (default 100) keeps the first holders; `total` sums every counted owner after exclusions.
- `hash` = sha256 (lowercase hex) of the UTF-8 lines `rank,owner,amount` joined by `\n`, no trailing newline. Same accounts in any order give the same hash.
- `fetchAccounts` sends one `getProgramAccounts` per token program (Tokenkeg... and Tokenz...) with `encoding: jsonParsed`, `withContext: true` and a memcmp filter on the mint at offset 0; `slot` is the lowest context slot.

## Recorded fixture

`test/fixtures/mainnet-pyusd-usdc.json`: real Solana mainnet accounts recorded on 28 Oct 2026 (context slot 462468850) with `getMultipleAccounts` in jsonParsed: three PYUSD (Token 2022) token accounts carrying `transferFeeAmount`, `transferHookAccount` and `immutableOwner` extensions, three USDC (SPL Token) accounts, and both mint accounts. Public free RPCs refuse `getProgramAccounts` on large mints, so the full KOG fixture is recorded with `--save-fixture` on a private RPC at delivery.

## Tests

```sh
npm test          # node:test via tsx, no network
npm run coverage
npm run mutation  # plants 9 bugs, all caught
```

| Item | Tests |
|---|---|
| A1 | grouping across programs, other mints, zero, non account, bad amounts and duplicates ignored; BigInt beyond 2^53 |
| A2 | owner and token account exclusions |
| A3 | ranking, ties by plain string order, top 3 and default 100, total over all |
| A4 | hash equals the rule, order independent, empty list hash |
| A5 | frozen and extension carrying Token 2022 accounts |
| A6 | both getProgramAccounts calls and their params, lowest slot, minContextSlot; plain RPC errors without the URL; CLI from fixture, --out, --save-fixture, 13 bad input cases exit 1 |
| A7 | the real PYUSD fixture gives a known ranked list, total and hash, in any order |
