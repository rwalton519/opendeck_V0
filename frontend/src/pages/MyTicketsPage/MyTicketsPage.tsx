import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { tournamentsApi } from "../../api/tournaments";
import { useAuth } from "../../hooks/useAuth";
import { GlassPanel } from "../../components/ui/GlassPanel";
import type { Ticket } from "../../types/tournament";
import styles from "./MyTicketsPage.module.css";

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function MyTicketsPage() {
  const { userId } = useAuth();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    setLoading(true);
    setError(null);
    tournamentsApi
      .fetchUserTickets(userId)
      .then((res) => {
        if (!cancelled) setTickets(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load tickets");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId) {
    return (
      <GlassPanel className={styles.notice}>
        <p>Sign in to view your tickets.</p>
      </GlassPanel>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>My Tickets</h1>

      {loading && <p className={styles.muted}>Loading…</p>}
      {error && <p className={styles.messageError}>{error}</p>}
      {!loading && !error && tickets.length === 0 && <p className={styles.muted}>No tickets.</p>}

      <ul className={styles.list}>
        {tickets.map((t) => (
          <li key={t.id}>
            <GlassPanel className={styles.row}>
              <span className={styles.stake}>{t.stake}</span>
              <span className={styles.created}>Created {formatTimestamp(t.createdAt)}</span>
            </GlassPanel>
          </li>
        ))}
      </ul>

      <Link to="/tournaments" className={styles.lobbyLink}>
        Browse tournaments →
      </Link>
    </div>
  );
}
