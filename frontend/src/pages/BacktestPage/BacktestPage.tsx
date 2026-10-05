import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { GlassPanel } from "../../components/ui/GlassPanel";
import { Button } from "../../components/ui/Button";
import { fairnessApi } from "../../api/fairness";
import { verifyDemoHand } from "../../lib/fairness/demoVerifier";
import { verifyPracticeGame } from "../../lib/fairness/practiceVerifier";
import { verifyLiveHand } from "../../lib/fairness/liveVerifier";
import type { DemoHandRecord, LiveHandRecord, VerificationResult } from "../../types/fairness";
import { DEFAULT_CASH_TABLE_ID } from "../../types/cashgame";
import styles from "./BacktestPage.module.css";

/**
 * opendeck.ca/backtest - lets anyone independently confirm the shuffle
 * protocol was followed, without trusting anything this site says about
 * itself. Every check below runs in the browser via Web Crypto
 * (src/lib/fairness/*.ts, ported line-for-line from the backend's real
 * shuffle code) and recomputes from scratch - it never just echoes back a
 * server-reported "verified: true".
 *
 * Two modes, because two different backend engines are involved today:
 *
 *  - "demo": reads back the last hand actually dealt at /cashgame-demo and
 *    reconstructs the whole deal (shuffle, seating order, burns) from the
 *    revealed seed alone.
 *  - "live": reads back the last hand actually dealt at a real cash-game
 *    table (services/game/liveHandEngine.js) and does the same
 *    reconstruction against the real deckService.js pipeline (shuffle +
 *    cut), tolerant of folded players' hole cards staying hidden.
 *  - "practice": drives the generic /rng + /game commit-reveal endpoints -
 *    useful for confirming the underlying cryptography on demand without
 *    waiting for a hand to be dealt anywhere.
 */

type Mode = "demo" | "live" | "practice";

function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className={styles.tabs}>
      <button
        className={mode === "demo" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
        onClick={() => onChange("demo")}
      >
        Demo Table Hand
      </button>
      <button
        className={mode === "live" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
        onClick={() => onChange("live")}
      >
        Live Table Hand
      </button>
      <button
        className={mode === "practice" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
        onClick={() => onChange("practice")}
      >
        Practice Shuffle
      </button>
    </div>
  );
}

function VerificationBanner({ result }: { result: VerificationResult }) {
  return (
    <GlassPanel className={result.verified ? `${styles.banner} ${styles.bannerOk}` : `${styles.banner} ${styles.bannerFail}`}>
      <span className={styles.bannerTitle}>{result.verified ? "Verified ✓" : "Verification failed ✗"}</span>
      <ul className={styles.stepList}>
        {result.steps.map((step) => (
          <li key={step.label} className={step.passed ? styles.stepOk : styles.stepFail}>
            <span>{step.passed ? "✓" : "✗"}</span> {step.label}
            {step.detail && <div className={styles.stepDetail}>{step.detail}</div>}
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}

function formatCards(cards: { rank: string; suit: string }[]): string {
  return cards.map((c) => `${c.rank}${c.suit}`).join(" ");
}

function DemoBacktest({ room }: { room: string }) {
  const [hand, setHand] = useState<DemoHandRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    fairnessApi
      .getLastDemoHand(room)
      .then((h) => {
        if (!cancelled) setHand(h);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load last hand");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [room]);

  const handleVerify = async () => {
    if (!hand) return;
    setVerifying(true);
    setResult(null);
    try {
      const r = await verifyDemoHand(hand);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed unexpectedly");
    } finally {
      setVerifying(false);
    }
  };

  if (loading) return <p className={styles.muted}>Loading the last dealt hand…</p>;
  if (error) return <p className={styles.error}>{error}</p>;
  if (!hand) {
    return (
      <GlassPanel className={styles.panel}>
        <p className={styles.muted}>
          No hand has been dealt at the {room === "heads-up" ? "heads-up demo" : "cash game demo"} table yet. Head
          to the demo table, deal a hand, then come back here to backtest it.
        </p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className={styles.panel}>
      <h2 className={styles.panelTitle}>Hand #{hand.handNumber}</h2>
      <p className={styles.muted}>{hand.winnerText}</p>

      <div className={styles.dataGrid}>
        <div>
          <span className={styles.dataLabel}>Deck commit (published before dealing)</span>
          <code className={styles.dataValue}>{hand.commitHash}</code>
        </div>
        <div>
          <span className={styles.dataLabel}>Revealed seed</span>
          <code className={styles.dataValue}>{hand.revealSeed}</code>
        </div>
        <div>
          <span className={styles.dataLabel}>Community cards</span>
          <code className={styles.dataValue}>{formatCards(hand.communityCards)}</code>
        </div>
        <div>
          <span className={styles.dataLabel}>Hole cards</span>
          <code className={styles.dataValue}>
            {hand.seats.map((s) => `${s.username}: ${formatCards(s.holeCards)}`).join("  ·  ")}
          </code>
        </div>
      </div>

      <Button onClick={handleVerify} disabled={verifying}>
        {verifying ? "Recomputing shuffle…" : "Backtest this hand"}
      </Button>

      {result && <VerificationBanner result={result} />}
    </GlassPanel>
  );
}

function LiveBacktest({ tableId }: { tableId: string }) {
  const [hand, setHand] = useState<LiveHandRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fairnessApi
      .getLastLiveHand(tableId)
      .then((h) => {
        if (!cancelled) setHand(h);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load last hand");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tableId]);

  const handleVerify = async () => {
    if (!hand) return;
    setVerifying(true);
    setResult(null);
    try {
      const r = await verifyLiveHand(hand);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed unexpectedly");
    } finally {
      setVerifying(false);
    }
  };

  if (loading) return <p className={styles.muted}>Loading the last completed hand at table "{tableId}"…</p>;
  if (error) return <p className={styles.error}>{error}</p>;
  if (!hand) {
    return (
      <GlassPanel className={styles.panel}>
        <p className={styles.muted}>
          No hand has completed yet at table "{tableId}". Get at least two players seated and start a hand, then
          come back here to backtest it.
        </p>
      </GlassPanel>
    );
  }

  const shownSeats = hand.seats.filter((s) => s.holeCards.length > 0);

  return (
    <GlassPanel className={styles.panel}>
      <h2 className={styles.panelTitle}>Hand #{hand.handNumber}</h2>
      <p className={styles.muted}>
        {shownSeats.length > 0
          ? `Hole cards shown for: ${shownSeats.map((s) => s.username).join(", ")}. Folded players' cards stay hidden, same as at a real table.`
          : "Everyone folded before showdown - no hole cards were shown for this hand."}
      </p>

      <div className={styles.dataGrid}>
        <div>
          <span className={styles.dataLabel}>Deck commit (published before dealing)</span>
          <code className={styles.dataValue}>{hand.deckCommit}</code>
        </div>
        <div>
          <span className={styles.dataLabel}>Revealed seed</span>
          <code className={styles.dataValue}>{hand.revealSeed}</code>
        </div>
        <div>
          <span className={styles.dataLabel}>Cut index</span>
          <code className={styles.dataValue}>{hand.cutIndex}</code>
        </div>
        <div>
          <span className={styles.dataLabel}>Community cards</span>
          <code className={styles.dataValue}>{formatCards(hand.communityCards)}</code>
        </div>
        {shownSeats.length > 0 && (
          <div>
            <span className={styles.dataLabel}>Hole cards shown</span>
            <code className={styles.dataValue}>
              {shownSeats.map((s) => `${s.username}: ${formatCards(s.holeCards)}`).join("  ·  ")}
            </code>
          </div>
        )}
      </div>

      <Button onClick={handleVerify} disabled={verifying}>
        {verifying ? "Recomputing shuffle…" : "Backtest this hand"}
      </Button>

      {result && <VerificationBanner result={result} />}
    </GlassPanel>
  );
}

function PracticeBacktest() {
  const [step, setStep] = useState<"idle" | "started" | "cut" | "revealed">("idle");
  const [gameId, setGameId] = useState<string | number | null>(null);
  const [deckCommit, setDeckCommit] = useState<string>("");
  const [cutIndex, setCutIndex] = useState<number>(13);
  const [seed, setSeed] = useState<string>("");
  const [deckOriginal, setDeckOriginal] = useState<string[]>([]);
  const [deckAfterCut, setDeckAfterCut] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);

  const handleStart = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await fairnessApi.startPracticeGame();
      setGameId(r.gameId);
      setDeckCommit(r.deckCommit);
      setStep("started");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start a practice shuffle");
    } finally {
      setBusy(false);
    }
  };

  const handleCut = async () => {
    if (gameId == null) return;
    setBusy(true);
    setError(null);
    try {
      await fairnessApi.cutPracticeGame(gameId, cutIndex);
      setStep("cut");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit the cut");
    } finally {
      setBusy(false);
    }
  };

  const handleReveal = async () => {
    if (gameId == null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fairnessApi.revealPracticeGame(gameId);
      setSeed(r.seed);
      setDeckOriginal(r.deckOriginal);
      setDeckAfterCut(r.deckAfterCut);
      setStep("revealed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reveal the seed");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await verifyPracticeGame({ seed, deckCommit, cutIndex, deckOriginal, deckAfterCut });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed unexpectedly");
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassPanel className={styles.panel}>
      <p className={styles.muted}>
        This mode drives the same commit/shuffle/cut/reveal engine that powers real cash-game hands
        (services/rng/deckService.js), without waiting for an actual hand to be dealt anywhere. To check a specific
        hand that was actually played, use the "Demo Table Hand" or "Live Table Hand" tab instead.
      </p>

      <ol className={styles.stepsFlow}>
        <li>
          <Button onClick={handleStart} disabled={busy || step !== "idle"}>
            1. Commit a fresh shuffle
          </Button>
          {deckCommit && (
            <div className={styles.dataGrid}>
              <span className={styles.dataLabel}>Deck commit</span>
              <code className={styles.dataValue}>{deckCommit}</code>
            </div>
          )}
        </li>
        <li>
          <label className={styles.cutLabel}>
            Cut index:{" "}
            <input
              type="number"
              min={0}
              max={51}
              value={cutIndex}
              onChange={(e) => setCutIndex(Number(e.target.value))}
              disabled={step !== "started"}
              className={styles.cutInput}
            />
          </label>
          <Button onClick={handleCut} disabled={busy || step !== "started"}>
            2. Submit your cut
          </Button>
        </li>
        <li>
          <Button onClick={handleReveal} disabled={busy || step !== "cut"}>
            3. Reveal the seed
          </Button>
        </li>
        <li>
          <Button onClick={handleVerify} disabled={busy || step !== "revealed"}>
            4. Backtest it
          </Button>
        </li>
      </ol>

      {error && <p className={styles.error}>{error}</p>}
      {result && <VerificationBanner result={result} />}
    </GlassPanel>
  );
}

export function BacktestPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode: Mode = searchParams.get("mode") === "practice" ? "practice" : searchParams.get("mode") === "live" ? "live" : "demo";
  const [mode, setMode] = useState<Mode>(initialMode);
  const tableId = searchParams.get("tableId") || DEFAULT_CASH_TABLE_ID;
  // Which demo room to backtest against (see routers/demoTableRouter.js) -
  // "cashgame-demo" (default) or "heads-up". Only read, never written here:
  // it arrives as a link parameter from the demo table itself
  // (public/cashgame-demo/index.html and public/heads-up/index.html's
  // "Backtest your hand?" links), not something this page's own tabs set.
  const demoRoom = searchParams.get("room") === "heads-up" ? "heads-up" : "cashgame-demo";

  const handleModeChange = (m: Mode) => {
    setMode(m);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("mode", m);
      return next;
    });
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Backtest your hand</h1>
      <p className={styles.subtitle}>
        Independently confirm the shuffle protocol was followed - every check below runs in your browser, not on our
        servers.
      </p>
      <ModeTabs mode={mode} onChange={handleModeChange} />
      {mode === "demo" && <DemoBacktest room={demoRoom} />}
      {mode === "live" && <LiveBacktest tableId={tableId} />}
      {mode === "practice" && <PracticeBacktest />}
    </div>
  );
}
