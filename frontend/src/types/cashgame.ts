/**
 * Cash-game types. Previously this module didn't exist at all - seating
 * was local-only React state inside CashGameTablePage (see the project
 * frontend spec, section 6.5 / 9.1). This is the real domain shape now,
 * following the same normalization pattern as api/tournaments.ts and
 * api/wallet.ts (tolerate snake_case or camelCase from the backend,
 * coerce types defensively at the boundary).
 *
 * CHANGED: added the in-progress-hand shape (CashHandState) alongside the
 * seating shape that already existed - see services/game/liveHandEngine.js
 * on the backend, which is what actually produces this now.
 */

export const DEFAULT_CASH_TABLE_ID = "main";

/** Every cash table is 6-handed (same seat layout as the Random Shuffle Test table). */
export const CASH_SEAT_COUNT = 6;

export interface CashSeatPlayer {
  userId: string;
  username: string;
  chips: number;
  /** Portion of `chips` currently backed by a verified on-chain USDC rebuy
   * (see services/game/buyinManager.js's cashgameRebuyOnChain on the
   * backend). 0 for a seat funded entirely from the off-chain wallet.
   * Defaults to 0 when absent so older/demo table snapshots that predate
   * this field don't need special-casing at call sites. */
  onchainStack?: number;
}

/** Keyed by seat index (0-5 for the 6-max layout in CashGameTablePage). */
export type CashSeatMap = Record<number, CashSeatPlayer | null>;

export interface CashCard {
  rank: string;
  suit: string;
}

export type CashHandPhase = "idle" | "preflop" | "flop" | "turn" | "river" | "showdown";

export interface CashHandState {
  handNumber: number;
  phase: CashHandPhase;
  dealerSeatIndex: number | null;
  communityCards: CashCard[];
  pot: number;
  currentBet: number;
  /** Minimum legal raise-over-current-bet, enforced server-side (services/game/liveHandEngine.js).
   * Needed to build a raise input that doesn't let the player submit an amount the backend will reject. */
  minRaise: number;
  toActSeatIndex: number | null;
  folded: number[];
  allIn: number[];
  streetCommitted: Record<number, number>;
  committed: Record<number, number>;
  /** Only the requesting viewer's own hole cards (and everyone's, post-showdown) - never other live players' cards. */
  holeCards: Record<number, CashCard[]>;
  deckCommit: string | null;
}

export interface CashTableState {
  tableId: string;
  smallBlind: number;
  bigBlind: number;
  seats: CashSeatMap;
  hand: CashHandState | null;
  /** Seat index allowed to click "Deal Next Hand" right now. Null until at
   * least 2 seats are occupied. Same designated-dealer rule the demo table
   * enforces - see backend services/game/liveHandEngine.js's
   * previewDealerSeatIndex(). */
  nextDealerSeatIndex: number | null;
}

export function emptySeatMap(seatCount = CASH_SEAT_COUNT): CashSeatMap {
  const seats: CashSeatMap = {};
  for (let i = 0; i < seatCount; i++) seats[i] = null;
  return seats;
}
