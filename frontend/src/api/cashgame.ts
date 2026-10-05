import { apiClient } from "./client";
import {
  emptySeatMap,
  type CashCard,
  type CashHandState,
  type CashSeatMap,
  type CashSeatPlayer,
  type CashTableState,
} from "../types/cashgame";

/**
 * CHANGED: paths now match the backend's actual mount point (`/cashgame`,
 * see server.js and api/routes/cashgameRouter.js) - this previously called
 * `/cash-game/...`, which 404s against everything the backend exposes.
 * `/cash-game` was this file's own draft convention (see the module
 * docstring in the old REALTIME_CONTRACT.md), never something the backend
 * actually implemented.
 */

function normalizeCard(raw: unknown): CashCard {
  const c = (raw ?? {}) as Record<string, unknown>;
  return { rank: String(c.rank ?? ""), suit: String(c.suit ?? "") };
}

function normalizeSeatPlayer(raw: Record<string, unknown>): CashSeatPlayer {
  return {
    userId: String(raw.userId ?? raw.user_id ?? ""),
    username: String(raw.username ?? ""),
    chips: Number(raw.chips ?? 0),
    onchainStack: Number(raw.onchainStack ?? raw.onchain_stack ?? 0),
  };
}

function normalizeSeatMap(raw: unknown): CashSeatMap {
  const seats = emptySeatMap();
  if (!raw || typeof raw !== "object") return seats;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const seatIndex = Number(key);
    if (Number.isNaN(seatIndex)) continue;
    seats[seatIndex] = value ? normalizeSeatPlayer(value as Record<string, unknown>) : null;
  }
  return seats;
}

function normalizeHandState(raw: unknown): CashHandState | null {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as Record<string, unknown>;

  function normalizeNumberMap(v: unknown): Record<number, number> {
    const out: Record<number, number> = {};
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[Number(k)] = Number(val);
    }
    return out;
  }

  function normalizeHoleCardsMap(v: unknown): Record<number, CashCard[]> {
    const out: Record<number, CashCard[]> = {};
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[Number(k)] = Array.isArray(val) ? val.map(normalizeCard) : [];
      }
    }
    return out;
  }

  return {
    handNumber: Number(h.handNumber ?? h.hand_number ?? 0),
    phase: String(h.phase ?? "idle") as CashHandState["phase"],
    dealerSeatIndex: h.dealerSeatIndex != null ? Number(h.dealerSeatIndex) : (h.dealer_seat_index != null ? Number(h.dealer_seat_index) : null),
    communityCards: Array.isArray(h.communityCards ?? h.community_cards)
      ? ((h.communityCards ?? h.community_cards) as unknown[]).map(normalizeCard)
      : [],
    pot: Number(h.pot ?? 0),
    currentBet: Number(h.currentBet ?? h.current_bet ?? 0),
    minRaise: Number(h.minRaise ?? h.min_raise ?? 0),
    toActSeatIndex: h.toActSeatIndex != null ? Number(h.toActSeatIndex) : (h.to_act_seat_index != null ? Number(h.to_act_seat_index) : null),
    folded: Array.isArray(h.folded) ? (h.folded as unknown[]).map(Number) : [],
    allIn: Array.isArray(h.allIn ?? h.all_in) ? ((h.allIn ?? h.all_in) as unknown[]).map(Number) : [],
    streetCommitted: normalizeNumberMap(h.streetCommitted ?? h.street_committed),
    committed: normalizeNumberMap(h.committed),
    holeCards: normalizeHoleCardsMap(h.holeCards ?? h.hole_cards),
    deckCommit: h.deckCommit != null ? String(h.deckCommit) : (h.deck_commit != null ? String(h.deck_commit) : null),
  };
}

function normalizeTableState(raw: Record<string, unknown>, tableId: string): CashTableState {
  const nextDealer = raw.next_dealer_seat_index ?? raw.nextDealerSeatIndex;
  return {
    tableId: String(raw.table_id ?? raw.tableId ?? tableId),
    smallBlind: Number(raw.small_blind ?? raw.smallBlind ?? 1),
    bigBlind: Number(raw.big_blind ?? raw.bigBlind ?? 2),
    seats: normalizeSeatMap(raw.seats),
    hand: normalizeHandState(raw.hand),
    nextDealerSeatIndex: nextDealer != null ? Number(nextDealer) : null,
  };
}

export const cashGameApi = {
  async getTableState(tableId: string): Promise<CashTableState> {
    // The backend derives the viewer identity from the Authorization header.
    // Do not send a user_id query parameter that a browser could alter.
    const raw = await apiClient.get<Record<string, unknown>>(`/cashgame/${encodeURIComponent(tableId)}/state`);
    return normalizeTableState(raw, tableId);
  },

  async takeSeat(tableId: string, seatIndex: number): Promise<CashSeatPlayer> {
    const raw = await apiClient.post<Record<string, unknown>>(
      `/cashgame/${encodeURIComponent(tableId)}/seats/${seatIndex}/take`,
      {},
    );
    return normalizeSeatPlayer(raw);
  },

  async leaveSeat(tableId: string, seatIndex: number): Promise<void> {
    await apiClient.post(`/cashgame/${encodeURIComponent(tableId)}/seats/${seatIndex}/leave`, {});
  },

  /** Only the seated player currently holding the dealer button (see CashTableState.nextDealerSeatIndex) may trigger the next hand, once >= 2 seats have chips and no hand is in progress. */
  async startHand(tableId: string): Promise<CashTableState> {
    const raw = await apiClient.post<Record<string, unknown>>(`/cashgame/${encodeURIComponent(tableId)}/start-hand`);
    return normalizeTableState(raw, tableId);
  },

  /** action: 'fold' | 'check' | 'call' | 'raise' (raise's amount is the target TOTAL street commitment). */
  async sendAction(tableId: string, action: string, amount?: number): Promise<CashTableState> {
    const raw = await apiClient.post<Record<string, unknown>>(`/cashgame/${encodeURIComponent(tableId)}/action`, {
      action,
      amount,
    });
    return normalizeTableState(raw, tableId);
  },

  /**
   * ADDED (USDC/Polygon integration). `txHash` is the mined fundTable()
   * transaction hash from src/lib/blockchain/browserWallet.ts's
   * fundTableWithUsdc - the backend independently verifies it on-chain
   * (services/blockchain/onchainRakeService.js) before crediting any chips,
   * so this call can legitimately fail (e.g. "not enough confirmations
   * yet") even though the transaction itself already succeeded on-chain -
   * callers should surface that error as "still confirming, try again in a
   * moment" rather than a hard failure.
   */
  async rebuyOnChain(tableId: string, txHash: string): Promise<CashTableState> {
    const raw = await apiClient.post<Record<string, unknown>>(
      `/cashgame/${encodeURIComponent(tableId)}/rebuy-onchain`,
      { tx_hash: txHash },
    );
    return normalizeTableState(raw, tableId);
  },
};
