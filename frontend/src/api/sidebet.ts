import { env } from "../config/env";

export type SideBetStatus = "OPEN" | "MATCHED" | "DISPUTED" | "SETTLED" | "CANCELLED";

export interface SideBetUser {
  id: string;
  email: string;
  balance: number;
  lockedBalance: number;
  createdAt?: string;
}

export interface Prediction {
  id: string;
  title: string;
  odds: string;
  stake: number;
  pot: number;
  status: SideBetStatus;
  creatorId: string;
  creatorEmail: string;
  opponentId: string | null;
  opponentEmail: string | null;
  winnerId: string | null;
  createdAt: string;
  matchedAt: string | null;
  settledAt: string | null;
  settled?: boolean;
  disputed?: boolean;
}

export interface LedgerEntry {
  id: string;
  predictionId: string | null;
  amount: number;
  type: "LOCK" | "RELEASE" | "PAYOUT";
  createdAt: string;
}

interface AuthResponse {
  token: string;
  user: SideBetUser;
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${env.sideBetApiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? body.message ?? "SideBet request failed.");
  return body as T;
}

export const sideBetApi = {
  register: (email: string, password: string) => request<AuthResponse>("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) => request<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: (token: string) => request<SideBetUser>("/users/me", {}, token),
  ledger: (token: string) => request<LedgerEntry[]>("/users/me/transactions?limit=20", {}, token),
  list: (status?: SideBetStatus) => request<Prediction[]>(`/predictions${status ? `?status=${status}` : ""}`),
  create: (token: string, data: { title: string; odds: string; stake: number }) => request<Prediction>("/predictions", { method: "POST", body: JSON.stringify(data) }, token),
  accept: (token: string, id: string) => request<Prediction>(`/predictions/${id}/accept`, { method: "POST" }, token),
  cancel: (token: string, id: string) => request<Prediction>(`/predictions/${id}/cancel`, { method: "POST" }, token),
  reportResult: (token: string, id: string, winnerId: string) => request<Prediction>(`/predictions/${id}/result`, { method: "POST", body: JSON.stringify({ winnerId }) }, token),
};
