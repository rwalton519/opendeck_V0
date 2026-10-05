export type TournamentSize = "MICRO" | "STANDARD" | "LARGE";
export type TournamentStake = "NANO" | "MICRO" | "MID" | "MACRO";
export type TournamentState = "WAITING" | "RUNNING" | "COMPLETED" | "CANCELLED";

export interface Tournament {
  id: number;
  name: string;
  size: TournamentSize;
  stake: TournamentStake;
  state: TournamentState;
  currentLevel: number;
  maxPlayers: number;
  maxPlayersPerTable: number;

  buyinTotal: number;
  buyinPrizePool: number;
  buyinHouseFee: number;
  buyinStaffTip: number;

  levelStartTime: string | null;
  levelEndTime: string | null;
  playersRemaining: number;
  totalPlayers: number;
  smallBlind: number;
  bigBlind: number;
}

export interface Ticket {
  id: string;
  tournamentId: number | null;
  stake: TournamentStake | string;
  createdAt: string;
}

export const SIZE_LABELS: Record<TournamentSize, string> = {
  MICRO: "Micro",
  STANDARD: "Standard",
  LARGE: "Large",
};

export const STAKE_LABELS: Record<TournamentStake, string> = {
  NANO: "Nano-Stakes",
  MICRO: "Micro-Stakes",
  MID: "Mid-Stakes",
  MACRO: "Macro-Stakes",
};
