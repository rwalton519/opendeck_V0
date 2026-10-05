/**
 * Live-table types for the tournament realtime module (see
 * REALTIME_CONTRACT.md). FairnessProof exists specifically to back the
 * product claim already on HomePage - "each hand's deck is committed
 * before the cut and verifiable after the reveal" - with an actual field
 * to render rather than just marketing copy.
 */

export interface LiveTableCard {
  rank: string; // "2".."10","J","Q","K","A"
  suit: "s" | "h" | "d" | "c";
}

export interface LiveTableSeat {
  seatIndex: number;
  userId: number | null;
  username: string | null;
  chips: number;
  folded: boolean;
}

export interface FairnessProof {
  /** Hash of the shuffled deck, published before cards are dealt. */
  commitHash: string;
  /** Seed revealed after the hand completes, letting anyone re-derive and check the shuffle. */
  revealSeed: string | null;
  /** Whether the client (or backend) has confirmed revealSeed actually hashes to commitHash. */
  verified: boolean | null;
}

export type LiveTableStreet = "preflop" | "flop" | "turn" | "river" | "showdown";

export interface LiveTableState {
  tournamentId: number;
  handNumber: number;
  street: LiveTableStreet | string;
  pot: number;
  communityCards: LiveTableCard[];
  seats: LiveTableSeat[];
  fairness: FairnessProof | null;
}

export function emptyLiveTableState(tournamentId: number): LiveTableState {
  return {
    tournamentId,
    handNumber: 0,
    street: "preflop",
    pot: 0,
    communityCards: [],
    seats: [],
    fairness: null,
  };
}

function normalizeCard(raw: Record<string, unknown>): LiveTableCard {
  return {
    rank: String(raw.rank ?? ""),
    suit: (raw.suit as LiveTableCard["suit"]) ?? "s",
  };
}

function normalizeSeat(raw: Record<string, unknown>, index: number): LiveTableSeat {
  return {
    seatIndex: Number(raw.seat_index ?? raw.seatIndex ?? index),
    userId: raw.user_id != null || raw.userId != null ? Number(raw.user_id ?? raw.userId) : null,
    username: (raw.username as string) ?? null,
    chips: Number(raw.chips ?? raw.stack ?? 0),
    folded: Boolean(raw.folded ?? false),
  };
}

/**
 * Shared by api/tournaments.ts's fetchTableState() (REST) and
 * TournamentTablePage's "table_state" realtime handler (WS) - both
 * deliver the same full-snapshot shape, so they normalize it the same
 * way. Same defensive snake_case/camelCase tolerance as normalizeTournament
 * in api/tournaments.ts.
 */
export function normalizeLiveTableState(raw: Record<string, unknown>, tournamentId: number): LiveTableState {
  const fairnessRaw = (raw.fairness ?? raw.fairness_proof ?? raw.fairnessProof) as
    | Record<string, unknown>
    | undefined;

  return {
    tournamentId: Number(raw.tournament_id ?? raw.tournamentId ?? tournamentId),
    handNumber: Number(raw.hand_number ?? raw.handNumber ?? 0),
    street: String(raw.street ?? "preflop"),
    pot: Number(raw.pot ?? 0),
    communityCards: Array.isArray(raw.community_cards ?? raw.communityCards)
      ? ((raw.community_cards ?? raw.communityCards) as Record<string, unknown>[]).map(normalizeCard)
      : [],
    seats: Array.isArray(raw.seats)
      ? (raw.seats as Record<string, unknown>[]).map((seat, i) => normalizeSeat(seat, i))
      : [],
    fairness: fairnessRaw
      ? {
          commitHash: String(fairnessRaw.commit_hash ?? fairnessRaw.commitHash ?? ""),
          revealSeed: (fairnessRaw.reveal_seed as string) ?? (fairnessRaw.revealSeed as string) ?? null,
          verified: fairnessRaw.verified != null ? Boolean(fairnessRaw.verified) : null,
        }
      : null,
  };
}
