import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { tournamentsApi } from "../../api/tournaments";
import { useAuth } from "../../hooks/useAuth";
import { GlassPanel } from "../../components/ui/GlassPanel";
import { Button } from "../../components/ui/Button";
import { SIZE_LABELS, STAKE_LABELS, type Tournament } from "../../types/tournament";
import styles from "./TournamentLobbyPage.module.css";

function buyinBreakdown(t: Tournament): string {
  return `$${t.buyinTotal.toFixed(0)} ($${t.buyinPrizePool.toFixed(0)} + $${t.buyinHouseFee.toFixed(0)} + $${t.buyinStaffTip.toFixed(0)})`;
}

export function TournamentLobbyPage() {
  // Fixed: the original TournamentLobbyScreen required a `userId` constructor
  // arg, but main.dart's '/tournament-lobby' route never supplied one — that
  // would throw at runtime. userId now comes from auth context like every
  // other page, so this route needs no param at all.
  const { userId } = useAuth();
  const navigate = useNavigate();

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registeringId, setRegisteringId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTournaments(await tournamentsApi.fetchTournaments());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tournaments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRegister(t: Tournament) {
    if (!userId) {
      setMessage({ text: "Sign in to register", ok: false });
      return;
    }
    setRegisteringId(t.id);
    setMessage(null);
    try {
      await tournamentsApi.register(t.id, userId);
      setMessage({ text: `Registered for ${t.name}`, ok: true });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Registration failed", ok: false });
    } finally {
      setRegisteringId(null);
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Tournaments</h1>

      {message && <p className={message.ok ? styles.messageOk : styles.messageError}>{message.text}</p>}
      {loading && <p className={styles.muted}>Loading…</p>}
      {error && <p className={styles.messageError}>{error}</p>}
      {!loading && !error && tournaments.length === 0 && <p className={styles.muted}>No tournaments available.</p>}

      <div className={styles.list}>
        {tournaments.map((t) => (
          <GlassPanel key={t.id} className={styles.card}>
            <button className={styles.cardMain} onClick={() => navigate(`/tournaments/${t.id}`)}>
              <h2 className={styles.cardTitle}>{t.name}</h2>
              <p className={styles.cardMeta}>
                {STAKE_LABELS[t.stake]} · {SIZE_LABELS[t.size]} ({t.maxPlayers} players)
              </p>
              <p className={styles.cardMeta}>
                State: {t.state} · Level {t.currentLevel}
              </p>
              <p className={styles.cardMeta}>Buy-in: {buyinBreakdown(t)}</p>
            </button>

            <Button
              onClick={() => handleRegister(t)}
              disabled={t.state !== "WAITING" || registeringId === t.id}
            >
              {registeringId === t.id ? "Registering…" : "Register"}
            </Button>
          </GlassPanel>
        ))}
      </div>

      <Link to="/tickets" className={styles.ticketsLink}>
        View my tickets →
      </Link>
    </div>
  );
}
