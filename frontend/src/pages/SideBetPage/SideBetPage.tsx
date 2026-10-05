import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import { GlassPanel } from "../../components/ui/GlassPanel";
import { sideBetApi, type LedgerEntry, type Prediction, type SideBetStatus, type SideBetUser } from "../../api/sidebet";
import styles from "./SideBetPage.module.css";

const TOKEN_KEY = "opendeck_sidebet_token";
const statusCopy: Record<SideBetStatus, string> = {
  OPEN: "Waiting for an opponent",
  MATCHED: "Both stakes are held in escrow",
  DISPUTED: "Participants reported different outcomes; funds stay locked",
  SETTLED: "Both participants agreed; payout completed",
  CANCELLED: "Creator cancelled before a match; stake released",
};

const money = (value: number) => `$${value.toFixed(2)}`;
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString() : "—";

export function SideBetPage() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<SideBetUser | null>(null);
  const [markets, setMarkets] = useState<Prediction[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [filter, setFilter] = useState<SideBetStatus | "ALL">("ALL");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const marketsPromise = sideBetApi.list(filter === "ALL" ? undefined : filter);
      if (token) {
        const [nextMarkets, nextUser, nextLedger] = await Promise.all([marketsPromise, sideBetApi.me(token), sideBetApi.ledger(token)]);
        setMarkets(nextMarkets); setUser(nextUser); setLedger(nextLedger);
      } else {
        setMarkets(await marketsPromise); setUser(null); setLedger([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load SideBet.");
      if (token && err instanceof Error && /token|unauthorized|authentication/i.test(err.message)) signOut();
    } finally { setLoading(false); }
  }, [filter, token]);

  useEffect(() => { void refresh(); }, [refresh]);

  function signOut() { localStorage.removeItem(TOKEN_KEY); setToken(null); setUser(null); setLedger([]); }
  function completeAuth(result: { token: string; user: SideBetUser }) { localStorage.setItem(TOKEN_KEY, result.token); setToken(result.token); setUser(result.user); setNotice("SideBet session ready. Your available and escrowed balances are shown below."); }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setNotice(null);
    const form = new FormData(event.currentTarget);
    try { completeAuth(await (authMode === "login" ? sideBetApi.login(String(form.get("email")), String(form.get("password"))) : sideBetApi.register(String(form.get("email")), String(form.get("password"))))); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not authenticate."); }
  }

  async function createMarket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!token) return;
    const form = new FormData(event.currentTarget); setError(null); setNotice(null);
    try { await sideBetApi.create(token, { title: String(form.get("title")), odds: String(form.get("odds") || "1:1"), stake: Number(form.get("stake")) }); event.currentTarget.reset(); setNotice("Market opened and your stake is now held in escrow."); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not open market."); }
  }

  async function action(work: () => Promise<Prediction>, success: string) {
    setError(null); setNotice(null);
    try { await work(); setNotice(success); await refresh(); } catch (err) { setError(err instanceof Error ? err.message : "Action failed."); }
  }

  return <div className={styles.page}>
    <div className={styles.hero}>
      <div><p className={styles.eyebrow}>SIDE BET</p><h1>Prediction markets, with a visible escrow lifecycle.</h1><p className={styles.lede}>Create a proposition, match another participant, then submit an outcome independently. Funds move only after both reports agree.</p></div>
      <div className={styles.lifecycle} aria-label="Prediction lifecycle"><span>Open</span><i /> <span>Matched</span><i /> <span>Result reports</span><i /> <span>Settled or disputed</span></div>
    </div>

    <p className={styles.safety}>SideBet is a separate service from the poker wallet. This interface makes no deposits, withdrawals, card, crypto, or other payment-rail requests.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice}>{notice}</p>}

    {!user ? <GlassPanel className={styles.auth}><div><p className={styles.eyebrow}>ACCOUNT</p><h2>{authMode === "login" ? "Sign in to SideBet" : "Create a SideBet account"}</h2><p className={styles.muted}>This session is separate from the main OpenDeck account.</p></div><form onSubmit={handleAuth} className={styles.form}><label>Email<input name="email" type="email" required autoComplete="email" /></label><label>Password<input name="password" type="password" required minLength={8} autoComplete={authMode === "login" ? "current-password" : "new-password"} /></label><Button type="submit">{authMode === "login" ? "Sign in" : "Create account"}</Button><button type="button" className={styles.textButton} onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>{authMode === "login" ? "Need an account? Register" : "Already registered? Sign in"}</button></form></GlassPanel> : <>
      <section className={styles.balanceGrid}><GlassPanel className={styles.balanceCard}><span>Available</span><strong>{money(user.balance)}</strong><small>Available to open or accept a market</small></GlassPanel><GlassPanel className={styles.balanceCard}><span>In escrow</span><strong>{money(user.lockedBalance)}</strong><small>Held against active matched markets</small></GlassPanel><GlassPanel className={styles.balanceCard}><span>SideBet account</span><strong className={styles.email}>{user.email}</strong><Button variant="ghost" onClick={signOut}>Sign out</Button></GlassPanel></section>
      <GlassPanel className={styles.create}><div><p className={styles.eyebrow}>OPEN A MARKET</p><h2>Make a prediction</h2><p className={styles.muted}>Your stated stake is locked when the market is created. An opponent must match the same stake.</p></div><form onSubmit={createMarket} className={styles.createForm}><label>Proposition<input name="title" maxLength={200} placeholder="Example: I will finish a 10K under 50 minutes" required /></label><label>Odds<input name="odds" maxLength={40} defaultValue="1:1" /></label><label>Stake<input name="stake" type="number" min="0.01" step="0.01" required /></label><Button type="submit">Open market</Button></form></GlassPanel>
    </>}

    <section className={styles.marketSection}><div className={styles.sectionHeader}><div><p className={styles.eyebrow}>MARKETS</p><h2>Current predictions</h2></div><div className={styles.filters}>{(["ALL", "OPEN", "MATCHED", "DISPUTED", "SETTLED", "CANCELLED"] as const).map((value) => <button key={value} className={filter === value ? styles.filterActive : styles.filter} onClick={() => setFilter(value)}>{value}</button>)}</div></div>
      {loading ? <p className={styles.muted}>Loading markets…</p> : markets.length === 0 ? <GlassPanel><p className={styles.muted}>No markets match this filter.</p></GlassPanel> : <div className={styles.markets}>{markets.map((market) => <MarketCard key={market.id} market={market} user={user} token={token} onAction={action} />)}</div>}
    </section>

    {user && <GlassPanel className={styles.ledger}><div><p className={styles.eyebrow}>AUDIT TRAIL</p><h2>Your ledger</h2></div>{ledger.length === 0 ? <p className={styles.muted}>No SideBet balance movements yet.</p> : <div className={styles.tableWrap}><table><thead><tr><th>When</th><th>Type</th><th>Amount</th><th>Market</th></tr></thead><tbody>{ledger.map((entry) => <tr key={entry.id}><td>{dateTime(entry.createdAt)}</td><td>{entry.type}</td><td className={entry.amount >= 0 ? styles.credit : styles.debit}>{entry.amount >= 0 ? "+" : ""}{money(entry.amount)}</td><td className={styles.mono}>{entry.predictionId?.slice(0, 8) ?? "—"}</td></tr>)}</tbody></table></div>}</GlassPanel>}
  </div>;
}

function MarketCard({ market, user, token, onAction }: { market: Prediction; user: SideBetUser | null; token: string | null; onAction: (work: () => Promise<Prediction>, success: string) => Promise<void> }) {
  const isCreator = user?.id === market.creatorId; const isOpponent = user?.id === market.opponentId; const canReport = Boolean(token && (isCreator || isOpponent) && market.status === "MATCHED");
  return <GlassPanel className={styles.market}><div className={styles.marketTop}><span className={`${styles.status} ${styles[`status${market.status}`]}`}>{market.status}</span><span className={styles.pot}>Pot {money(market.pot)}</span></div><h3>{market.title}</h3><p className={styles.marketMeta}>{market.odds} · {money(market.stake)} per participant</p><p className={styles.lifecycleText}>{statusCopy[market.status]}</p><dl><div><dt>Creator</dt><dd>{market.creatorEmail}</dd></div><div><dt>Opponent</dt><dd>{market.opponentEmail ?? "Not matched"}</dd></div>{market.winnerId && <div><dt>Winner</dt><dd>{market.winnerId === market.creatorId ? market.creatorEmail : market.opponentEmail}</dd></div>}</dl><div className={styles.actions}>{token && market.status === "OPEN" && !isCreator && <Button onClick={() => onAction(() => sideBetApi.accept(token, market.id), "Market matched. Both stakes are now held in escrow.")}>Accept market</Button>}{token && market.status === "OPEN" && isCreator && <Button variant="ghost" onClick={() => onAction(() => sideBetApi.cancel(token, market.id), "Market cancelled and your stake was released.")}>Cancel market</Button>}{canReport && <><Button onClick={() => onAction(() => sideBetApi.reportResult(token!, market.id, market.creatorId), "Your outcome report was recorded.")}>Creator won</Button><Button variant="ghost" onClick={() => onAction(() => sideBetApi.reportResult(token!, market.id, market.opponentId!), "Your outcome report was recorded.")}>Opponent won</Button></>}</div><small>Created {dateTime(market.createdAt)}</small></GlassPanel>;
}
