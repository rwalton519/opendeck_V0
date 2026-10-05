import { apiClient } from "./client";
import type { Tournament, Ticket } from "../types/tournament";
import type { LiveTableState } from "../types/liveTable";
import { normalizeLiveTableState } from "../types/liveTable";

/**
 * The Flutter source read blinds off a nested `current_blinds: { small, big }`
 * object but flattened everything else. Backend field-naming conventions
 * (snake_case vs camelCase, nesting) are exactly the kind of thing that
 * differs between a Python and a Node service, so all of that normalization
 * is kept in this one function rather than spread across pages.
 */
function normalizeTournament(raw: Record<string, unknown>): Tournament {
  const blinds = (raw.current_blinds ?? raw.currentBlinds ?? {}) as Record<string, unknown>;

  return {
    id: Number(raw.id),
    name: String(raw.name ?? ""),
    size: (raw.size as Tournament["size"]) ?? "STANDARD",
    stake: (raw.stake as Tournament["stake"]) ?? "MICRO",
    state: (raw.state as Tournament["state"]) ?? "WAITING",
    currentLevel: Number(raw.current_level ?? raw.currentLevel ?? 0),
    maxPlayers: Number(raw.max_players ?? raw.maxPlayers ?? 0),
    maxPlayersPerTable: Number(raw.max_players_per_table ?? raw.maxPlayersPerTable ?? 0),
    buyinTotal: Number(raw.buyin_total ?? raw.buyinTotal ?? 0),
    buyinPrizePool: Number(raw.buyin_prize_pool ?? raw.buyinPrizePool ?? 0),
    buyinHouseFee: Number(raw.buyin_house_fee ?? raw.buyinHouseFee ?? 0),
    buyinStaffTip: Number(raw.buyin_staff_tip ?? raw.buyinStaffTip ?? 0),
    levelStartTime: (raw.level_start_time as string) ?? (raw.levelStartTime as string) ?? null,
    levelEndTime: (raw.level_end_time as string) ?? (raw.levelEndTime as string) ?? null,
    playersRemaining: Number(raw.players_remaining ?? raw.playersRemaining ?? 0),
    totalPlayers: Number(raw.total_players ?? raw.totalPlayers ?? 0),
    smallBlind: Number(blinds.small ?? raw.small_blind ?? 0),
    bigBlind: Number(blinds.big ?? raw.big_blind ?? 0),
  };
}

function normalizeTicket(raw: Record<string, unknown>): Ticket {
  return {
    id: String(raw.id ?? raw.ticket_id ?? crypto.randomUUID()),
    tournamentId: raw.tournament_id != null ? Number(raw.tournament_id) : null,
    stake: (raw.stake as Ticket["stake"]) ?? "MICRO",
    createdAt: String(raw.created_at ?? raw.createdAt ?? ""),
  };
}

export const tournamentsApi = {
  async fetchTournaments(): Promise<Tournament[]> {
    const res = await apiClient.get<Record<string, unknown>[]>("/tournaments");
    return (res ?? []).map(normalizeTournament);
  },

  async fetchTournament(id: number): Promise<Tournament> {
    const res = await apiClient.get<Record<string, unknown>>(`/tournaments/${id}`);
    return normalizeTournament(res);
  },

  async register(tournamentId: number, userId: string): Promise<void> {
    await apiClient.post(`/tournaments/${tournamentId}/register`, { user_id: userId });
  },

  async fetchTableState(tournamentId: number): Promise<LiveTableState> {
    const raw = await apiClient.get<Record<string, unknown>>(`/tournaments/${tournamentId}/table_state`);
    return normalizeLiveTableState(raw, tournamentId);
  },

  async rebuy(tournamentId: number, userId: string): Promise<void> {
    await apiClient.post(`/tournaments/${tournamentId}/rebuy`, { user_id: userId });
  },

  async addon(tournamentId: number, userId: string): Promise<void> {
    await apiClient.post(`/tournaments/${tournamentId}/addon`, { user_id: userId });
  },

  // Folds in MyTicketsScreen's separately-hardcoded host; same apiClient now.
  async fetchUserTickets(userId: string): Promise<Ticket[]> {
    const res = await apiClient.get<Record<string, unknown>[]>(`/tournaments/user/${encodeURIComponent(userId)}/tickets`);
    return (res ?? []).map(normalizeTicket);
  },
};
