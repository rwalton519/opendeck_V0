import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { tournamentsApi } from "../../api/tournaments";
import type { LiveTableCard, LiveTableState } from "../../types/liveTable";
import styles from "./TournamentTablePage.module.css";

const POLL_INTERVAL_MS = 4000;
const SEAT_COORDINATES: Record<number, { top: number; left: number }> = {
  0: { top: 91, left: 50 }, 1: { top: 76, left: 17 }, 2: { top: 48, left: 8 }, 3: { top: 21, left: 18 },
  4: { top: 9, left: 50 }, 5: { top: 21, left: 82 }, 6: { top: 48, left: 92 }, 7: { top: 76, left: 83 }, 8: { top: 91, left: 67 },
};

function cardLabel(card: LiveTableCard): string {
  const suit = { s: "♠", h: "♥", d: "♦", c: "♣" }[card.suit] ?? card.suit;
  return `${card.rank}${suit}`;
}

function ChipStack({ balance }: { balance: number }) {
  const count = balance <= 0 ? 0 : balance < 25 ? 1 : balance < 100 ? 2 : balance < 300 ? 3 : balance < 750 ? 4 : 5;
  if (!count) return null;
  return <div className={styles.chipStack}>{Array.from({ length: count }).map((_, i) => <span key={i} className={`${styles.chip} ${styles[`chip${i}`]}`} />)}</div>;
}

type Flight = { id: number; fromX: number; fromY: number; toX: number; toY: number };

export function TournamentTablePage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const numericId = tournamentId ? Number(tournamentId) : null;
  const canvasRef = useRef<HTMLDivElement>(null);
  const previousRef = useRef<LiveTableState | null>(null);
  const idRef = useRef(0);
  const [table, setTable] = useState<LiveTableState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);

  const pointFor = (seatIndex: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const p = SEAT_COORDINATES[seatIndex];
    return { x: rect.width * p.left / 100, y: rect.height * p.top / 100 };
  };

  useEffect(() => {
    if (numericId == null) return;
    let cancelled = false;
    async function load() {
      try {
        const state = await tournamentsApi.fetchTableState(numericId!);
        if (cancelled) return;
        const previous = previousRef.current;
        if (previous) {
          const nextFlights: Flight[] = [];
          const rect = canvasRef.current?.getBoundingClientRect();
          const pot = rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 };
          state.seats.forEach((seat) => {
            const before = previous.seats.find((s) => s.seatIndex === seat.seatIndex);
            if (!before) return;
            const delta = before.chips - seat.chips;
            if (delta > 0.01) {
              const from = pointFor(seat.seatIndex);
              const pieces = delta >= 100 ? 5 : delta >= 25 ? 4 : delta >= 5 ? 3 : 2;
              for (let i = 0; i < pieces; i++) nextFlights.push({ id: ++idRef.current, fromX: from.x, fromY: from.y, toX: pot.x, toY: pot.y });
            }
          });
          if (nextFlights.length) {
            setFlights((current) => [...current, ...nextFlights]);
            window.setTimeout(() => {
              const ids = new Set(nextFlights.map((f) => f.id));
              setFlights((current) => current.filter((f) => !ids.has(f.id)));
            }, 850);
          }
        }
        previousRef.current = state;
        setTable(state);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load table state");
      } finally { if (!cancelled) setLoading(false); }
    }
    load();
    const interval = window.setInterval(load, POLL_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [numericId]);

  if (loading && !table) return <p className={styles.muted}>Loading table…</p>;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div><h1 className={styles.title}>LIVE TOURNAMENT</h1><div className={styles.meta}>Tournament #{table?.tournamentId ?? tournamentId}</div><div className={styles.meta}>Hand #{table?.handNumber || "—"} · {table?.street ?? "waiting"}</div></div>
        <span className={styles.liveBadge}><i /> Live</span>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {table && <div className={styles.tableShell} ref={canvasRef}>
        <div className={styles.rail} /><div className={styles.felt}><div className={styles.innerRing} /><div className={styles.brandWatermark}>OPENDECK<span>TRANSPARENT POKER</span></div>
          <div className={styles.centerStage}>
            <div className={styles.potLabel}>POT</div><div className={styles.potValue}>${table.pot.toFixed(2)}</div>
            <div className={styles.communityRow}>{table.communityCards.length ? table.communityCards.map((c, i) => <span key={i} className={`${styles.card} ${c.suit === "h" || c.suit === "d" ? styles.cardRed : ""}`}>{cardLabel(c)}</span>) : <span className={styles.placeholder}>COMMUNITY CARDS</span>}</div>
          </div>
          {Array.from({ length: 9 }).map((_, i) => {
            const seat = table.seats.find((s) => s.seatIndex === i);
            const p = SEAT_COORDINATES[i];
            return <div key={i} className={styles.seat} style={{ top: `${p.top}%`, left: `${p.left}%` }}>{seat?.username ? <><ChipStack balance={seat.chips}/><div className={`${styles.playerPlaque} ${seat.folded ? styles.folded : ""}`}><span className={styles.playerName}>{seat.username}</span><span className={styles.playerBalance}>${seat.chips.toFixed(2)}</span></div></> : <div className={styles.emptySeat}>SEAT {i + 1}</div>}</div>;
          })}
          <div className={styles.dealerButton}>D</div>
          <div className={styles.flightLayer}>{flights.map((f) => <span key={f.id} className={styles.flightChip} style={{ left:f.fromX, top:f.fromY, ["--dx"]:`${f.toX-f.fromX}px`, ["--dy"]:`${f.toY-f.fromY}px` } as CSSProperties}><i/></span>)}</div>
        </div>
      </div>}
      <div className={styles.fairnessPanel}><h2>Fairness Proof</h2>{table?.fairness ? <div className={styles.fairnessBody}><span>Deck commit</span><code>{table.fairness.commitHash}</code>{table.fairness.revealSeed ? <><span>Reveal seed</span><code>{table.fairness.revealSeed}</code><b>{table.fairness.verified ? "Verified ✓" : "Unverified"}</b></> : <p className={styles.muted}>Seed reveals once this hand completes.</p>}</div> : <p className={styles.muted}>Waiting for the next hand to start.</p>}</div>
    </div>
  );
}
