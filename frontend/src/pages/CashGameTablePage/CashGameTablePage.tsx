import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { GlassPanel } from "../../components/ui/GlassPanel";
import { cashGameApi } from "../../api/cashgame";
import { onchainApi } from "../../api/onchain";
import { isChainConfigured } from "../../config/chain";
import { connectWallet, ensureCorrectNetwork, fundTableWithUsdc, signMessage } from "../../lib/blockchain/browserWallet";
import { useAuth } from "../../hooks/useAuth";
import { useCashGameStream } from "../../hooks/useCashGameStream";
import {
  CASH_SEAT_COUNT,
  DEFAULT_CASH_TABLE_ID,
  emptySeatMap,
  type CashCard,
  type CashSeatMap,
  type CashTableState,
} from "../../types/cashgame";
import { cashTableLabel } from "../CashGameLobbyPage/cashTables";
import styles from "./CashGameTablePage.module.css";

// Six seats evenly spaced around the oval, seat 0 bottom-centre - the exact
// coordinates used by the Random Shuffle Test table (public/RNG-shuffle-tester).
// Percentages are of the table canvas (tableShell), which is also what
// pointForSeat() measures against for the chip-flight animation.
const SEAT_COORDINATES: Record<number, { top: number; left: number }> = {
  0: { top: 88, left: 50 },
  1: { top: 69, left: 13.6 },
  2: { top: 31, left: 13.6 },
  3: { top: 12, left: 50 },
  4: { top: 31, left: 86.4 },
  5: { top: 69, left: 86.4 },
};


function formatCard(card: CashCard): string {
  const suit = card.suit.toLowerCase();
  const symbol = suit === "s" ? "♠" : suit === "h" ? "♥" : suit === "d" ? "♦" : "♣";
  return `${card.rank}${symbol}`;
}

function Card({ card, small = false }: { card: CashCard; small?: boolean }) {
  const red = ["h", "d"].includes(card.suit.toLowerCase());
  return (
    <span className={small ? `${styles.card} ${styles.cardSmall} ${red ? styles.cardRed : ""}` : `${styles.card} ${red ? styles.cardRed : ""}`}>
      {formatCard(card)}
    </span>
  );
}

function chipCountForBalance(balance: number): number {
  if (balance <= 0) return 0;
  if (balance < 25) return 1;
  if (balance < 100) return 2;
  if (balance < 300) return 3;
  if (balance < 750) return 4;
  return 5;
}

function chipColour(index: number): string {
  return [styles.chipRed, styles.chipBlue, styles.chipBlack, styles.chipGreen, styles.chipGold][index % 5];
}

function ChipStack({ balance, bet = 0 }: { balance: number; bet?: number }) {
  const count = chipCountForBalance(balance);
  if (!count) return null;
  return (
    <div className={styles.chipStackWrap} aria-label={`Stack ${balance.toFixed(2)}`}>
      <div className={styles.chipStack}>
        {Array.from({ length: count }).map((_, i) => (
          <span key={i} className={`${styles.chip} ${chipColour(i)}`} style={{ zIndex: count - i }}>
            <span className={styles.chipEdge} />
          </span>
        ))}
      </div>
      {bet > 0 && <span className={styles.betPill}>Bet ${bet.toFixed(2)}</span>}
    </div>
  );
}

type ChipFlight = {
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  amount: number;
  direction: "to-pot" | "to-player";
};

function flightPieces(amount: number): number {
  if (amount >= 100) return 5;
  if (amount >= 25) return 4;
  if (amount >= 5) return 3;
  return 2;
}

export function CashGameTablePage() {
  const { tableId = DEFAULT_CASH_TABLE_ID } = useParams<{ tableId?: string }>();
  const { userId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const canvasRef = useRef<HTMLDivElement>(null);
  const previousRef = useRef<CashTableState | null>(null);
  const flightIdRef = useRef(0);
  const [seats, setSeats] = useState<CashSeatMap>(emptySeatMap(CASH_SEAT_COUNT));
  const [table, setTable] = useState<CashTableState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimingSeat, setClaimingSeat] = useState<number | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState(0);
  const [flights, setFlights] = useState<ChipFlight[]>([]);
  const autoClaimAttemptedRef = useRef(false);
  // ADDED (USDC/Polygon integration)
  const [linkedWalletAddress, setLinkedWalletAddress] = useState<string | null>(null);
  const [usdcRebuyAmount, setUsdcRebuyAmount] = useState(100);
  const [usdcBusy, setUsdcBusy] = useState<"linking" | "rebuying" | null>(null);
  const [usdcError, setUsdcError] = useState<string | null>(null);
  const [usdcStatus, setUsdcStatus] = useState<string | null>(null);

  const pointForSeat = useCallback((seatIndex: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const p = SEAT_COORDINATES[seatIndex];
    return { x: rect.width * (p.left / 100), y: rect.height * (p.top / 100) };
  }, []);

  const pointForPot = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: rect.width * 0.5, y: rect.height * 0.5 };
  }, []);

  const animateStateChange = useCallback((previous: CashTableState | null, next: CashTableState) => {
    if (!previous || !canvasRef.current || !previous.hand || !next.hand) return;
    const newFlights: ChipFlight[] = [];
    const potPoint = pointForPot();

    for (let i = 0; i < CASH_SEAT_COUNT; i++) {
      const before = previous.seats[i];
      const after = next.seats[i];
      if (!before || !after) continue;
      const delta = before.chips - after.chips;
      if (delta > 0.009) {
        const from = pointForSeat(i);
        for (let p = 0; p < flightPieces(delta); p++) {
          newFlights.push({
            id: ++flightIdRef.current,
            fromX: from.x,
            fromY: from.y,
            toX: potPoint.x,
            toY: potPoint.y,
            amount: delta,
            direction: "to-pot",
          });
        }
      }
    }

    if (next.hand.pot < previous.hand.pot - 0.009) {
      for (let i = 0; i < CASH_SEAT_COUNT; i++) {
        const before = previous.seats[i];
        const after = next.seats[i];
        if (!before || !after) continue;
        const gain = after.chips - before.chips;
        if (gain > 0.009) {
          const to = pointForSeat(i);
          for (let p = 0; p < flightPieces(gain); p++) {
            newFlights.push({
              id: ++flightIdRef.current,
              fromX: potPoint.x,
              fromY: potPoint.y,
              toX: to.x,
              toY: to.y,
              amount: gain,
              direction: "to-player",
            });
          }
        }
      }
    }

    if (!newFlights.length) return;
    setFlights((current) => [...current, ...newFlights]);
    window.setTimeout(() => {
      const ids = new Set(newFlights.map((f) => f.id));
      setFlights((current) => current.filter((f) => !ids.has(f.id)));
    }, 850);
  }, [pointForPot, pointForSeat]);

  const refresh = useCallback(() => {
    cashGameApi.getTableState(tableId).then((state) => {
      animateStateChange(previousRef.current, state);
      previousRef.current = state;
      setTable(state);
      setSeats(state.seats);
      setError(null);
    }).catch((err) => setError(err instanceof Error ? err.message : "Failed to load table"));
  }, [animateStateChange, tableId, userId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    cashGameApi.getTableState(tableId).then((state) => {
      if (cancelled) return;
      previousRef.current = state;
      setTable(state);
      setSeats(state.seats);
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load table");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [tableId, userId]);

  useCashGameStream(tableId, refresh);

  const hand = table?.hand ?? null;
  const phase = hand?.phase;
  const handNumber = hand?.handNumber;

  const mySeatIndex = userId != null ? Object.entries(seats).find(([, p]) => p && p.userId === userId)?.[0] : undefined;
  const mySeatIndexNum = mySeatIndex == null ? null : Number(mySeatIndex);
  const isMyTurn = !!hand && mySeatIndexNum != null && hand.toActSeatIndex === mySeatIndexNum;
  const seatedCount = Object.values(seats).filter((s) => s && s.chips > 0).length;
  // Same designated-dealer rule as opendeck.ca/cashgame-demo: only the
  // player holding the button may deal the next hand.
  const dealerSeatIndex = table?.nextDealerSeatIndex ?? null;
  const isDealer = mySeatIndexNum != null && dealerSeatIndex != null && mySeatIndexNum === dealerSeatIndex;
  const canStartHand = (!hand || hand.phase === "idle") && seatedCount >= 2 && isDealer;
  const myHoleCards = mySeatIndexNum != null ? hand?.holeCards[mySeatIndexNum] ?? [] : [];
  const toCall = hand && mySeatIndexNum != null ? Math.max(0, hand.currentBet - (hand.streetCommitted[mySeatIndexNum] ?? 0)) : 0;
  const myStack = mySeatIndexNum != null ? seats[mySeatIndexNum]?.chips ?? 0 : 0;
  const minRaiseTotal = hand ? hand.currentBet + (hand.minRaise || table?.bigBlind || 2) : 0;

  const handleClaimSeat = useCallback(async (seatIndex: number) => {
    if (!userId) {
      // Preserve which seat was clicked (?seat=N) through
      // register -> auto-login -> dashboard -> "Return to Cash Game", so the
      // visitor lands back in the exact seat they originally picked instead
      // of a bare, unclaimed /cash-game.
      const returnTarget = `${location.pathname}?seat=${seatIndex}`;
      navigate(`/register?redirect=${encodeURIComponent(returnTarget)}`);
      return;
    }

    setClaimingSeat(seatIndex);
    setError(null);
    try {
      // The backend derives the authenticated account and buys the seat in
      // for the user's entire currently available wallet balance. The
      // browser cannot select a different user or an arbitrary chip amount.
      const player = await cashGameApi.takeSeat(tableId, seatIndex);
      setSeats((prev) => ({ ...prev, [seatIndex]: player }));
      refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to take seat";
      if (message.toLowerCase().includes("deposit funds")) {
        setError("Your account has no available funds. Deposit funds first, then return to the table.");
      } else {
        setError(message);
      }
    } finally {
      setClaimingSeat(null);
    }
  }, [userId, location.pathname, navigate, tableId, refresh]);

  // ADDED (USDC/Polygon integration). Loads whether this account already
  // has a linked wallet, once, so the panel below can show "Rebuy with
  // USDC" directly instead of "Link Wallet" first every time.
  useEffect(() => {
    if (!isChainConfigured() || !userId) return;
    let cancelled = false;
    onchainApi.getSummary().then((summary) => {
      if (!cancelled) setLinkedWalletAddress(summary.address);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [userId]);

  // ADDED (USDC/Polygon integration). Two wallet prompts in sequence:
  // signing the link message, then nothing further - linking itself moves
  // no funds. See services/blockchain/onchainRakeService.js's
  // buildLinkMessage for the exact text being signed.
  const handleLinkWallet = async () => {
    setUsdcBusy("linking");
    setUsdcError(null);
    setUsdcStatus(null);
    try {
      const address = await connectWallet();
      await ensureCorrectNetwork();
      const message = await onchainApi.getLinkMessage(address);
      const signature = await signMessage(address, message);
      await onchainApi.linkWallet(address, signature);
      setLinkedWalletAddress(address);
      setUsdcStatus("Wallet linked.");
    } catch (err) {
      setUsdcError(err instanceof Error ? err.message : "Failed to link wallet");
    } finally {
      setUsdcBusy(null);
    }
  };

  // ADDED (USDC/Polygon integration). Two wallet prompts: approve, then
  // fundTable - see src/lib/blockchain/browserWallet.ts's fundTableWithUsdc.
  // The backend independently re-verifies the resulting transaction
  // on-chain before crediting any chips (services/blockchain/onchainRakeService.js),
  // so a "still confirming" error here means the USDC has left the
  // player's wallet but chips aren't credited YET, not that anything failed -
  // surfaced as-is rather than papered over, since retrying too eagerly
  // against an unconfirmed tx would just repeat the same wait.
  const handleRebuyUsdc = async () => {
    if (!(usdcRebuyAmount > 0)) return;
    setUsdcBusy("rebuying");
    setUsdcError(null);
    setUsdcStatus(null);
    try {
      await ensureCorrectNetwork();
      const { txHash } = await fundTableWithUsdc(Number(tableId), usdcRebuyAmount);
      setUsdcStatus("Transaction sent - waiting for the backend to verify it on-chain…");
      const state = await cashGameApi.rebuyOnChain(tableId, txHash);
      setTable(state);
      setSeats(state.seats);
      setUsdcStatus(`Rebought $${usdcRebuyAmount.toFixed(2)} in USDC.`);
    } catch (err) {
      setUsdcError(err instanceof Error ? err.message : "USDC rebuy failed");
    } finally {
      setUsdcBusy(null);
    }
  };

  // Auto-claim the seat named by ?seat=N once we land back here signed in
  // (see handleClaimSeat's redirect above and DashboardPage's "Return to
  // Cash Game" button) - the round trip through registration/login/deposit
  // shouldn't strand the visitor back at an empty table needing to
  // remember and re-click the seat they originally chose.
  useEffect(() => {
    const seatParam = searchParams.get("seat");
    if (seatParam == null || !userId || loading || autoClaimAttemptedRef.current) return;
    const seatIndex = Number(seatParam);
    if (!Number.isInteger(seatIndex)) {
      setSearchParams((prev) => { prev.delete("seat"); return prev; }, { replace: true });
      return;
    }
    autoClaimAttemptedRef.current = true;
    const alreadyMine = seats[seatIndex]?.userId === userId;
    const isOpen = !seats[seatIndex];
    setSearchParams((prev) => { prev.delete("seat"); return prev; }, { replace: true });
    if (isOpen && !alreadyMine) {
      handleClaimSeat(seatIndex);
    }
  }, [searchParams, setSearchParams, userId, loading, seats, handleClaimSeat]);

  const handleStartHand = async () => {
    setActionBusy(true); setError(null);
    try {
      const state = await cashGameApi.startHand(tableId);
      animateStateChange(previousRef.current, state);
      previousRef.current = state;
      setTable(state); setSeats(state.seats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start hand");
    } finally { setActionBusy(false); }
  };

  const sendAction = async (action: string, amount?: number) => {
    if (!userId) return;
    setActionBusy(true); setError(null);
    try {
      const state = await cashGameApi.sendAction(tableId, action, amount);
      animateStateChange(previousRef.current, state);
      previousRef.current = state;
      setTable(state); setSeats(state.seats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally { setActionBusy(false); }
  };

  return (
    <div className={styles.page}>
      {loading && <p className={styles.status}>Loading table…</p>}
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.tableShell} ref={canvasRef}>
        <div className={styles.hudLeft}>
          <div className={styles.hudTitle}>NO LIMIT HOLD'EM · {cashTableLabel(tableId).toUpperCase()}</div>
          <div className={styles.hudHand}>${(table?.smallBlind ?? 1).toFixed(2)} / ${(table?.bigBlind ?? 2).toFixed(2)}</div>
          <div className={styles.hudHand}>{hand?.handNumber ? `Hand #${hand.handNumber} · ${hand.phase}` : "Waiting for the next hand"}</div>
          <Link to="/cash-games" className={styles.hudBack}>← All tables</Link>
        </div>
        <div className={styles.hudRight}>
          <div className={styles.statusBox}><i className={styles.liveDot} /> Live</div>
        </div>

        <div className={styles.rail} />
        <div className={styles.felt} />
        <div className={styles.innerRing} />
        <div className={styles.brandWatermark}>OPENDECK<span>TRANSPARENT POKER</span></div>

        <div className={styles.centerStage}>
          <div className={styles.potLabel}>POT</div>
          <div className={styles.potValue}>${(hand?.pot ?? 0).toFixed(2)}</div>
          <div className={styles.communityRow}>
            {hand?.communityCards.length ? hand.communityCards.map((card, i) => <Card key={i} card={card} />) : <span className={styles.communityPlaceholder}>COMMUNITY CARDS</span>}
          </div>
          {hand?.currentBet ? <div className={styles.currentBet}>Current bet ${hand.currentBet.toFixed(2)}</div> : null}
        </div>

        {Array.from({ length: CASH_SEAT_COUNT }).map((_, index) => {
          const player = seats[index];
          const p = SEAT_COORDINATES[index];
          const isDealer = hand?.dealerSeatIndex === index;
          const isTurn = hand?.toActSeatIndex === index;
          const isFolded = hand?.folded.includes(index) ?? false;
          const holeCards = hand?.holeCards[index] ?? [];
          return (
            <div key={index} className={styles.seat} style={{ top: `${p.top}%`, left: `${p.left}%` }}>
              {player ? (
                <>
                  <ChipStack balance={player.chips} bet={hand?.streetCommitted[index] ?? 0} />
                  <div className={`${styles.playerPlaque} ${isTurn ? styles.turn : ""} ${isFolded ? styles.folded : ""}`}>
                    {isDealer && <span className={styles.dealer}>D</span>}
                    <span className={styles.playerName}>{player.username}{player.userId === userId ? " (you)" : ""}</span>
                    <span className={styles.playerBalance}>${player.chips.toFixed(2)}</span>
                    {holeCards.length > 0 && <div className={styles.holeRow}>{holeCards.map((card, i) => <Card key={i} card={card} small />)}</div>}
                  </div>
                </>
              ) : (
                <Button className={styles.takeSeat} onClick={() => handleClaimSeat(index)} disabled={claimingSeat === index}>
                  {claimingSeat === index ? "Sitting…" : "+ Take Seat"}
                </Button>
              )}
            </div>
          );
        })}

        <div className={styles.dealerButton}>D</div>

        <div className={styles.flightLayer}>
          {flights.map((flight) => {
            const dx = flight.toX - flight.fromX;
            const dy = flight.toY - flight.fromY;
            return (
              <span
                key={flight.id}
                className={`${styles.flightChip} ${flight.direction === "to-player" ? styles.flightToPlayer : ""}`}
                style={{ left: flight.fromX, top: flight.fromY, ["--dx" as string]: `${dx}px`, ["--dy" as string]: `${dy}px` } as CSSProperties}
              >
                <span className={styles.flightChipCore} />
              </span>
            );
          })}
        </div>
      </div>

      {isMyTurn && (
        <GlassPanel className={styles.actionDock}>
          <Button variant="danger" onClick={() => sendAction("fold")} disabled={actionBusy}>Fold</Button>
          <Button onClick={() => sendAction(toCall > 0 ? "call" : "check")} disabled={actionBusy}>{toCall > 0 ? `Call $${toCall.toFixed(2)}` : "Check"}</Button>
          <input className={styles.raiseInput} type="number" min={minRaiseTotal} max={myStack} value={raiseAmount || minRaiseTotal} onChange={(e) => setRaiseAmount(Number(e.target.value))} />
          <Button onClick={() => sendAction("raise", raiseAmount || minRaiseTotal)} disabled={actionBusy}>Raise</Button>
        </GlassPanel>
      )}

      {!hand || hand.phase === "idle" ? (
        <div className={styles.preHandBar}>
          {seatedCount < 2 ? (
            <span>Waiting for at least two funded players.</span>
          ) : canStartHand ? (
            <Button onClick={handleStartHand} disabled={actionBusy}>{actionBusy ? "Dealing…" : "Deal Next Hand"}</Button>
          ) : (
            <span title="Only the designated Dealer can deal the next hand.">
              {dealerSeatIndex != null ? `Waiting for seat ${dealerSeatIndex + 1} (the Dealer) to deal.` : "Waiting for the Dealer to deal."}
            </span>
          )}
        </div>
      ) : null}

      <GlassPanel className={styles.holeCardsPanel}>
        <span className={styles.label}>Your hole cards</span>
        <div className={styles.holeCardsRow}>
          {mySeatIndexNum == null ? (
            <span className={styles.muted}>Take a seat to be dealt in.</span>
          ) : myHoleCards.length === 0 ? (
            <span className={styles.muted}>Waiting for the next hand.</span>
          ) : (
            myHoleCards.map((card, i) => <Card key={i} card={card} />)
          )}
        </div>
      </GlassPanel>

      {/* ADDED (USDC/Polygon integration). Only shown once seated, and only
          when this deployment has a deployed contract configured
          (VITE_OPENDECK_POKER_CONTRACT_ADDRESS - see src/config/chain.ts) -
          otherwise this would be a button that can only ever fail. */}
      {isChainConfigured() && mySeatIndexNum != null && (
        <GlassPanel className={styles.utilityPanel}>
          <h2>Rebuy with USDC (Polygon)</h2>
          <div className={styles.onchainPanelBody}>
            {linkedWalletAddress ? (
              <span className={styles.onchainAddressRow}>Linked wallet: {linkedWalletAddress}</span>
            ) : (
              <>
                <span className={styles.muted}>Link a self-custody wallet (MetaMask) to rebuy this seat with USDC instead of your OpenDeck balance.</span>
                <Button onClick={handleLinkWallet} disabled={usdcBusy !== null}>
                  {usdcBusy === "linking" ? "Linking…" : "Link Wallet"}
                </Button>
              </>
            )}
            {linkedWalletAddress && (
              <div className={styles.onchainRebuyRow}>
                <input
                  className={styles.raiseInput}
                  type="number"
                  min={1}
                  value={usdcRebuyAmount}
                  onChange={(e) => setUsdcRebuyAmount(Number(e.target.value))}
                />
                <Button onClick={handleRebuyUsdc} disabled={usdcBusy !== null}>
                  {usdcBusy === "rebuying" ? "Rebuying…" : `Rebuy $${usdcRebuyAmount.toFixed(2)} USDC`}
                </Button>
              </div>
            )}
            {usdcStatus && <span className={styles.muted}>{usdcStatus}</span>}
            {usdcError && <span className={styles.error}>{usdcError}</span>}
          </div>
        </GlassPanel>
      )}

      <div className={styles.utilityGrid}>
        <GlassPanel className={styles.utilityPanel}>
          <h2>Hand / Pot / Table Info</h2>
          <div className={styles.infoRow}><span>Table</span><b>{table?.tableId ?? tableId}</b></div>
          <div className={styles.infoRow}><span>Hand</span><b>{hand?.handNumber ?? 0}</b></div>
          <div className={styles.infoRow}><span>Street</span><b>{hand?.phase ?? "idle"}</b></div>
          <div className={styles.infoRow}><span>Pot</span><b>${(hand?.pot ?? 0).toFixed(2)}</b></div>
        </GlassPanel>
        <GlassPanel className={styles.utilityPanel}>
          <h2>Fairness Proof</h2>
          {hand?.deckCommit ? <code className={styles.hash}>{hand.deckCommit}</code> : <span className={styles.muted}>Deal a hand to see the deck commit hash.</span>}
          <p className={styles.muted}>Independent verification of the dealt deck is part of OpenDeck's proprietary shuffle protocol and is not included in this public version — the full feature runs at opendeck.ca.</p>
        </GlassPanel>
      </div>
    </div>
  );
}
