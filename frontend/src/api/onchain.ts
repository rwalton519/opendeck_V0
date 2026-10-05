import { apiClient } from "./client";

export interface OnchainTransactionRecord {
  id: string;
  tableId: number | null;
  type: string;
  amount: number;
  txHash: string | null;
  handId: string | null;
  timestamp: string | null;
}

export interface OnchainWalletSummary {
  address: string | null;
  linkedAt: string | null;
  transactions: OnchainTransactionRecord[];
}

export interface OnchainTableBalance {
  address: string | null;
  balance: number;
}

export const onchainApi = {
  /** The exact message the player's wallet must sign to link `address` - see
   * services/blockchain/onchainRakeService.js's buildLinkMessage on the backend. */
  async getLinkMessage(address: string): Promise<string> {
    const res = await apiClient.get<{ message: string }>(
      `/wallet/onchain/link-message?address=${encodeURIComponent(address)}`,
    );
    return res.message;
  },

  async linkWallet(address: string, signature: string): Promise<{ address: string; linked_at: string }> {
    return apiClient.post("/wallet/onchain/link", { address, signature });
  },

  async getSummary(): Promise<OnchainWalletSummary> {
    return apiClient.get<OnchainWalletSummary>("/wallet/onchain/summary");
  },

  async getTableBalance(tableId: string | number): Promise<OnchainTableBalance> {
    return apiClient.get<OnchainTableBalance>(`/wallet/onchain/table-balance/${tableId}`);
  },
};
