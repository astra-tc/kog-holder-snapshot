export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/** One getProgramAccounts item in jsonParsed encoding. */
export interface AccountItem {
  pubkey: string;
  account: {
    owner?: string;
    data:
      | {
          program?: string;
          parsed?: {
            type?: string;
            info?: {
              mint?: string;
              owner?: string;
              state?: string;
              tokenAmount?: { amount?: string; decimals?: number };
              extensions?: unknown[];
            };
          };
        }
      | unknown;
  };
}

export interface Exclusions {
  owners: string[];
  token_accounts: string[];
}

export interface Holder {
  rank: number;
  owner: string;
  amount: string;
}

export interface Snapshot {
  mint: string;
  slot: number;
  total: string;
  holders: Holder[];
  hash: string;
}

export interface SnapshotInput {
  mint: string;
  slot: number;
  accounts: AccountItem[];
  exclusions?: Partial<Exclusions>;
  top?: number;
}
