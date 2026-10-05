/**
 * Types for the "Backtest your hand?" fairness-verification feature
 * (src/pages/BacktestPage). Two distinct backends are involved, and they
 * are NOT the same algorithm - see src/lib/fairness/*.ts for the ported
 * implementations:
 *
 *  - "Demo hand" mode reads back the last hand actually dealt at
 *    /cashgame-demo (services/demo/cashGameDemoEngine.js on the backend:
 *    single HMAC-SHA256 draw per swap, no cut step, lowercase suits).
 *  - "Practice shuffle" mode drives the generic /rng + /game commit-reveal
 *    endpoints (services/rng/deckService.js on the backend: HMAC-SHA256
 *    counter-mode byte stream with rejection sampling, plus a cut step).
 *    This is what the live cash-game table's button uses today, since the
 *    live table doesn't yet persist per-hand deck data server-side (see
 *    the scope note in backend routers/game.js) - it demonstrates the same
 *    cryptographic engine the live table will use once hand-dealing is
 *    wired up, rather than fabricating a "verified" result for a hand that
 *    was never actually dealt.
 */

/** One seat's public data for a completed demo hand. */
export interface DemoHandSeat {
  seatIndex: number;
  username: string;
  isBot: boolean;
  /** Two cards, e.g. { rank: "A", suit: "s" }. Public once the hand reaches showdown. */
  holeCards: DemoCard[];
}

export interface DemoCard {
  rank: string;
  suit: string;
}

/** One seat's public data for a completed live cash-game hand. Folded seats
 * that never reached showdown report an empty holeCards array - those cards
 * were never revealed, by design, same as at a real table. */
export interface LiveHandSeat {
  seatIndex: number;
  userId: string;
  username: string;
  holeCards: DemoCard[];
}

/** GET /cashgame/:tableId/last-hand response shape (services/game/liveHandEngine.js). */
export interface LiveHandRecord {
  handNumber: number;
  dealerSeatIndex: number;
  sbSeatIndex: number;
  bbSeatIndex: number;
  activeSeats: number[];
  dealOrder: number[];
  seats: LiveHandSeat[];
  communityCards: DemoCard[];
  resultsByUserId: Record<string, number>;
  deckCommit: string;
  cutIndex: number;
  revealSeed: string;
  settledHandId?: number | string;
}

/** GET /cashgame-demo/last-hand response shape. */
export interface DemoHandRecord {
  handNumber: number;
  dealerSeat: number;
  sbSeat: number;
  bbSeat: number;
  activeSeats: number[];
  dealOrder: number[];
  seats: DemoHandSeat[];
  communityCards: DemoCard[];
  potWon: number;
  winnerText: string;
  commitHash: string;
  revealSeed: string;
}

/** POST /game/start response. */
export interface PracticeGameStart {
  gameId: string | number;
  deckCommit: string;
}

/** POST /game/:id/cut response. */
export interface PracticeGameCut {
  gameId: string | number;
  cutIndex: number;
  deckAfterCutCommit: string;
}

/** POST /game/:id/reveal response. */
export interface PracticeGameReveal {
  gameId: string | number;
  seed: string;
  deckOriginal: string[];
  deckAfterCut: string[];
}

/** Outcome of an independently-run client-side verification, for display. */
export interface VerificationStep {
  label: string;
  passed: boolean;
  detail?: string;
}

export interface VerificationResult {
  verified: boolean;
  steps: VerificationStep[];
}
