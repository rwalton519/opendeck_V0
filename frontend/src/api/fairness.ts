import { apiClient } from "./client";
import type {
  DemoCard,
  DemoHandRecord,
  DemoHandSeat,
  LiveHandRecord,
  LiveHandSeat,
  PracticeGameCut,
  PracticeGameReveal,
  PracticeGameStart,
} from "../types/fairness";

function normalizeCard(raw: unknown): DemoCard {
  const c = (raw ?? {}) as Record<string, unknown>;
  return { rank: String(c.rank ?? ""), suit: String(c.suit ?? "") };
}

function normalizeDemoSeat(raw: Record<string, unknown>): DemoHandSeat {
  return {
    seatIndex: Number(raw.seatIndex ?? raw.seat_index ?? 0),
    username: String(raw.username ?? ""),
    isBot: Boolean(raw.isBot ?? raw.is_bot ?? false),
    holeCards: Array.isArray(raw.holeCards ?? raw.hole_cards)
      ? ((raw.holeCards ?? raw.hole_cards) as unknown[]).map(normalizeCard)
      : [],
  };
}

function normalizeDemoHand(raw: Record<string, unknown>): DemoHandRecord {
  return {
    handNumber: Number(raw.handNumber ?? raw.hand_number ?? 0),
    dealerSeat: Number(raw.dealerSeat ?? raw.dealer_seat ?? 0),
    sbSeat: Number(raw.sbSeat ?? raw.sb_seat ?? 0),
    bbSeat: Number(raw.bbSeat ?? raw.bb_seat ?? 0),
    activeSeats: Array.isArray(raw.activeSeats ?? raw.active_seats)
      ? ((raw.activeSeats ?? raw.active_seats) as unknown[]).map(Number)
      : [],
    dealOrder: Array.isArray(raw.dealOrder ?? raw.deal_order)
      ? ((raw.dealOrder ?? raw.deal_order) as unknown[]).map(Number)
      : [],
    seats: Array.isArray(raw.seats) ? (raw.seats as unknown[]).map((s) => normalizeDemoSeat(s as Record<string, unknown>)) : [],
    communityCards: Array.isArray(raw.communityCards ?? raw.community_cards)
      ? ((raw.communityCards ?? raw.community_cards) as unknown[]).map(normalizeCard)
      : [],
    potWon: Number(raw.potWon ?? raw.pot_won ?? 0),
    winnerText: String(raw.winnerText ?? raw.winner_text ?? ""),
    commitHash: String(raw.commitHash ?? raw.commit_hash ?? ""),
    revealSeed: String(raw.revealSeed ?? raw.reveal_seed ?? ""),
  };
}

function normalizeLiveSeat(raw: Record<string, unknown>): LiveHandSeat {
  return {
    seatIndex: Number(raw.seatIndex ?? raw.seat_index ?? 0),
    userId: String(raw.userId ?? raw.user_id ?? ""),
    username: String(raw.username ?? ""),
    holeCards: Array.isArray(raw.holeCards ?? raw.hole_cards)
      ? ((raw.holeCards ?? raw.hole_cards) as unknown[]).map(normalizeCard)
      : [],
  };
}

function normalizeLiveHand(raw: Record<string, unknown>): LiveHandRecord {
  const resultsRaw = (raw.resultsByUserId ?? raw.results_by_user_id ?? {}) as Record<string, unknown>;
  const resultsByUserId: Record<string, number> = {};
  for (const [k, v] of Object.entries(resultsRaw)) resultsByUserId[k] = Number(v);

  return {
    handNumber: Number(raw.handNumber ?? raw.hand_number ?? 0),
    dealerSeatIndex: Number(raw.dealerSeatIndex ?? raw.dealer_seat_index ?? 0),
    sbSeatIndex: Number(raw.sbSeatIndex ?? raw.sb_seat_index ?? 0),
    bbSeatIndex: Number(raw.bbSeatIndex ?? raw.bb_seat_index ?? 0),
    activeSeats: Array.isArray(raw.activeSeats ?? raw.active_seats)
      ? ((raw.activeSeats ?? raw.active_seats) as unknown[]).map(Number)
      : [],
    dealOrder: Array.isArray(raw.dealOrder ?? raw.deal_order)
      ? ((raw.dealOrder ?? raw.deal_order) as unknown[]).map(Number)
      : [],
    seats: Array.isArray(raw.seats) ? (raw.seats as unknown[]).map((s) => normalizeLiveSeat(s as Record<string, unknown>)) : [],
    communityCards: Array.isArray(raw.communityCards ?? raw.community_cards)
      ? ((raw.communityCards ?? raw.community_cards) as unknown[]).map(normalizeCard)
      : [],
    resultsByUserId,
    deckCommit: String(raw.deckCommit ?? raw.deck_commit ?? ""),
    cutIndex: Number(raw.cutIndex ?? raw.cut_index ?? 0),
    revealSeed: String(raw.revealSeed ?? raw.reveal_seed ?? ""),
    settledHandId: (raw.settledHandId ?? raw.settled_hand_id) as number | string | undefined,
  };
}

function normalizeStart(raw: Record<string, unknown>): PracticeGameStart {
  return {
    gameId: (raw.game_id ?? raw.gameId) as string | number,
    deckCommit: String(raw.deck_commit ?? raw.deckCommit ?? ""),
  };
}

function normalizeCut(raw: Record<string, unknown>): PracticeGameCut {
  return {
    gameId: (raw.game_id ?? raw.gameId) as string | number,
    cutIndex: Number(raw.cut_index ?? raw.cutIndex ?? 0),
    deckAfterCutCommit: String(raw.deck_after_cut_commit ?? raw.deckAfterCutCommit ?? ""),
  };
}

function normalizeReveal(raw: Record<string, unknown>): PracticeGameReveal {
  return {
    gameId: (raw.game_id ?? raw.gameId) as string | number,
    seed: String(raw.seed ?? ""),
    deckOriginal: Array.isArray(raw.deck_original ?? raw.deckOriginal)
      ? ((raw.deck_original ?? raw.deckOriginal) as unknown[]).map(String)
      : [],
    deckAfterCut: Array.isArray(raw.deck_after_cut ?? raw.deckAfterCut)
      ? ((raw.deck_after_cut ?? raw.deckAfterCut) as unknown[]).map(String)
      : [],
  };
}

export const fairnessApi = {
  /**
   * GET /:room/last-hand - defaults to the Cash Game Demo table
   * (`cashgame-demo`), but any demo room mounted the same way (e.g.
   * `heads-up` - see routers/demoTableRouter.js) works identically, since
   * every demo room exposes the same last-hand shape.
   * Returns null on 404 (no hand dealt yet) rather than throwing.
   */
  async getLastDemoHand(room: string = "cashgame-demo"): Promise<DemoHandRecord | null> {
    try {
      const raw = await apiClient.get<Record<string, unknown>>(`/${encodeURIComponent(room)}/last-hand`);
      return normalizeDemoHand(raw);
    } catch (err) {
      if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
        return null;
      }
      throw err;
    }
  },

  /** GET /cashgame/:tableId/last-hand. Returns null on 404 (no hand completed yet at this table). */
  async getLastLiveHand(tableId: string): Promise<LiveHandRecord | null> {
    try {
      const raw = await apiClient.get<Record<string, unknown>>(`/cashgame/${encodeURIComponent(tableId)}/last-hand`);
      return normalizeLiveHand(raw);
    } catch (err) {
      if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
        return null;
      }
      throw err;
    }
  },

  /** POST /game/start - begins a fresh practice commit-reveal cycle. */
  async startPracticeGame(): Promise<PracticeGameStart> {
    const raw = await apiClient.post<Record<string, unknown>>("/game/start");
    return normalizeStart(raw);
  },

  /** POST /game/:id/cut */
  async cutPracticeGame(gameId: string | number, cutIndex: number): Promise<PracticeGameCut> {
    const raw = await apiClient.post<Record<string, unknown>>(`/game/${encodeURIComponent(String(gameId))}/cut`, {
      cut_index: cutIndex,
    });
    return normalizeCut(raw);
  },

  /** POST /game/:id/reveal */
  async revealPracticeGame(gameId: string | number): Promise<PracticeGameReveal> {
    const raw = await apiClient.post<Record<string, unknown>>(`/game/${encodeURIComponent(String(gameId))}/reveal`);
    return normalizeReveal(raw);
  },
};
