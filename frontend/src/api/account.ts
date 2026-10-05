import { apiClient } from './client';

export interface AccountDeposit {
  id: string;
  amount: number;
  status: string;
  provider?: string | null;
  timestamp: string | null;
  reference: string | null;
}

// ADDED (USDC/Polygon integration + req #3 ledger-visibility fix): mirrors
// routers/account.js's now-populated `ledger` array (previously fetched on
// the backend but never returned) and the merged on-chain wallet summary.
export interface AccountLedgerEntry {
  id: string;
  amount: number;
  type: string;
  reference: string | null;
  timestamp: string | null;
}

export interface AccountOnchainTransaction {
  id: string;
  tableId: number | null;
  type: string;
  amount: number;
  txHash: string | null;
  handId: string | null;
  timestamp: string | null;
}

export interface AccountOnchainSummary {
  address: string | null;
  linkedAt: string | null;
  transactions: AccountOnchainTransaction[];
}

export interface AccountDashboard {
  user: {
    id: string;
    username: string;
    email: string;
  };
  balance: {
    available: number;
    locked: number;
    total: number;
  };
  deposits: AccountDeposit[];
  totalDeposited: number;
  ledger: AccountLedgerEntry[];
  onchain: AccountOnchainSummary;
}

export const accountApi = {
  async getDashboard(): Promise<AccountDashboard> {
    return apiClient.get<AccountDashboard>('/account/dashboard');
  },
};
