import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { tournamentsApi } from "../../api/tournaments";
import { useAuth } from "../../hooks/useAuth";
import { GlassPanel } from "../../components/ui/GlassPanel";
import { Button } from "../../components/ui/Button";
import { SIZE_LABELS, STAKE_LABELS, type Tournament } from "../../types/tournament";
import styles from "./TournamentDetailPage.module.css";

export function TournamentDetailPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const { userId } = useAuth();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Rebuy/add-on: tournamentsApi.rebuy/addon already existed and were
  // fully implemented but had no UI trigger anywhere (frontend spec,
  // section 9.1). This wires the existing calls up rather than adding any
  // new backend behavior.
  const [rebuying, setRebuying] = useState(false);
  const [addingOn, setAddingOn] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!tournamentId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    tournamentsApi
      .fetchTournament(Number(tournamentId))
      .then((t) => {
        if (!cancelled) setTournament(t);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load tournament");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  async function handleJoin() {
    if (!tournament || !userId) {
      setJoinError(!userId ? "Sign in to join" : null);
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      await tournamentsApi.register(tournament.id, userId);
      // Fixed: the original always pushed to a fixed '/tournament-table'
      // route regardless of which tournament was joined. The table route
      // now carries the tournament id it belongs to.
      navigate(`/tournaments/${tournament.id}/table`);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Join failed");
    } finally {
      setJoining(false);
    }
  }

  async function handleRebuy() {
    if (!tournament || !userId) {
      setActionMessage({ text: "Sign in to rebuy", ok: false });
      return;
    }
    setRebuying(true);
    setActionMessage(null);
    try {
      await tournamentsApi.rebuy(tournament.id, userId);
      setActionMessage({ text: "Rebuy submitted.", ok: true });
    } catch (err) {
      setActionMessage({ text: err instanceof Error ? err.message : "Rebuy failed", ok: false });
    } finally {
      setRebuying(false);
    }
  }

  async function handleAddon() {
    if (!tournament || !userId) {
      setActionMessage({ text: "Sign in to add on", ok: false });
      return;
    }
    setAddingOn(true);
    setActionMessage(null);
    try {
      await tournamentsApi.addon(tournament.id, userId);
      setActionMessage({ text: "Add-on submitted.", ok: true });
    } catch (err) {
      setActionMessage({ text: err instanceof Error ? err.message : "Add-on failed", ok: false });
    } finally {
      setAddingOn(false);
    }
  }

  if (loading) return <p className={styles.muted}>Loading…</p>;
  if (error) return <p className={styles.messageError}>{error}</p>;
  if (!tournament) return <p className={styles.muted}>Tournament not found.</p>;

  return (
    <GlassPanel className={styles.panel}>
      <h1 className={styles.title}>{tournament.name}</h1>
      <p className={styles.subtitle}>
        {STAKE_LABELS[tournament.stake]} · {SIZE_LABELS[tournament.size]}
      </p>

      <dl className={styles.statGrid}>
        <div>
          <dt>Buy-in</dt>
          <dd>${tournament.buyinTotal.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Players</dt>
          <dd>
            {tournament.totalPlayers} total · {tournament.playersRemaining} remaining
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{tournament.state}</dd>
        </div>
        <div>
          <dt>Blinds</dt>
          <dd>
            {tournament.smallBlind} / {tournament.bigBlind} (Level {tournament.currentLevel})
          </dd>
        </div>
      </dl>

      {tournament.state === "WAITING" && (
        <Button onClick={handleJoin} disabled={joining}>
          {joining ? "Joining…" : "Join Tournament"}
        </Button>
      )}
      {joinError && <p className={styles.messageError}>{joinError}</p>}

      {tournament.state === "RUNNING" && (
        <div className={styles.actionRow}>
          <Button variant="ghost" onClick={handleRebuy} disabled={rebuying}>
            {rebuying ? "Rebuying…" : "Rebuy"}
          </Button>
          <Button variant="ghost" onClick={handleAddon} disabled={addingOn}>
            {addingOn ? "Adding on…" : "Add-On"}
          </Button>
        </div>
      )}
      {actionMessage && (
        <p className={actionMessage.ok ? styles.messageOk : styles.messageError}>{actionMessage.text}</p>
      )}
    </GlassPanel>
  );
}
