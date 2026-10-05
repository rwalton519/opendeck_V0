import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { accountApi, type AccountDashboard } from '../../api/account';
import { useAuth } from '../../hooks/useAuth';
import { GlassPanel } from '../../components/ui/GlassPanel';
import { Button } from '../../components/ui/Button';
import styles from './DashboardPage.module.css';

function money(value: number): string {
  return `$${Number(value || 0).toFixed(2)}`;
}

// ADDED (USDC/Polygon integration + full-ledger dashboard fix)
function signedMoney(value: number): string {
  const amount = Number(value || 0);
  const sign = amount > 0 ? '+' : '';
  return `${sign}${money(amount)}`;
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/cash-game';
  return value;
}

function dateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function DashboardPage() {
  const { isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnPath(searchParams.get('returnTo'));
  const [data, setData] = useState<AccountDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await accountApi.getDashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load account dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate(`/login?redirect=${encodeURIComponent(`/dashboard?returnTo=${encodeURIComponent(returnTo)}`)}`, { replace: true });
      return;
    }
    load();
  }, [isAuthenticated, navigate, returnTo, load]);

  const deposits = useMemo(() => data?.deposits ?? [], [data]);
  // ADDED (USDC/Polygon integration + full-ledger dashboard fix)
  const ledger = useMemo(() => data?.ledger ?? [], [data]);
  const onchain = data?.onchain ?? null;

  if (!isAuthenticated) return null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>OPENDECK ACCOUNT</p>
          <h1>Dashboard</h1>
          <p className={styles.subheading}>Your account, wallet balance and deposit history.</p>
        </div>
        <Button onClick={() => navigate(returnTo)}>
          Return to Cash Game
        </Button>
      </div>

      {error && <GlassPanel><p className={styles.error}>{error}</p><Button onClick={load}>Try Again</Button></GlassPanel>}

      <div className={styles.grid}>
        <GlassPanel className={styles.card}>
          <span className={styles.label}>Account</span>
          <strong className={styles.username}>{loading ? '—' : data?.user.username}</strong>
          <span className={styles.value}>{loading ? '—' : data?.user.email}</span>
          <span className={styles.muted}>User ID: {loading ? '—' : data?.user.id}</span>
        </GlassPanel>

        <GlassPanel className={styles.card}>
          <span className={styles.label}>Available Balance</span>
          <strong className={styles.balance}>{loading ? '—' : money(data?.balance.available ?? 0)}</strong>
          <span className={styles.muted}>Funds available for a live cash-game seat.</span>
        </GlassPanel>

        <GlassPanel className={styles.card}>
          <span className={styles.label}>Deposited</span>
          <strong className={styles.balance}>{loading ? '—' : money(data?.totalDeposited ?? 0)}</strong>
          <span className={styles.muted}>Total successfully credited deposits.</span>
        </GlassPanel>

        <GlassPanel className={styles.card}>
          <span className={styles.label}>Funds Locked</span>
          <strong className={styles.balance}>{loading ? '—' : money(data?.balance.locked ?? 0)}</strong>
          <span className={styles.muted}>Includes funds committed to active games.</span>
        </GlassPanel>
      </div>

      <GlassPanel className={styles.history}>
        <div className={styles.historyHeader}>
          <div>
            <p className={styles.eyebrow}>WALLET</p>
            <h2>Deposit History</h2>
          </div>
          <Link to="/wallet" className={styles.linkButton}>Deposit / Wallet</Link>
        </div>

        {loading ? <p className={styles.muted}>Loading deposits…</p> : deposits.length === 0 ? (
          <p className={styles.muted}>No completed deposits yet. Deposit funds before taking a live seat.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Date</th><th>Amount</th><th>Status</th><th>Reference</th></tr></thead>
              <tbody>
                {deposits.map((deposit) => (
                  <tr key={deposit.id}>
                    <td>{dateTime(deposit.timestamp)}</td>
                    <td>{money(deposit.amount)}</td>
                    <td><span className={styles.status}>{deposit.status}</span></td>
                    <td className={styles.reference}>{deposit.reference || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>

      {/* ADDED (req #3 - full debit/credit visibility): every wallet
          movement, not just completed Stripe deposits - freezes/unfreezes
          for cash-game seats, admin adjustments, tournament payouts, etc.
          See routers/account.js's `ledger` field, which the backend fetched
          before but never actually returned until now. */}
      <GlassPanel className={styles.history}>
        <div className={styles.historyHeader}>
          <div>
            <p className={styles.eyebrow}>WALLET</p>
            <h2>Transaction History</h2>
          </div>
        </div>

        {loading ? <p className={styles.muted}>Loading transactions…</p> : ledger.length === 0 ? (
          <p className={styles.muted}>No wallet activity yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Reference</th></tr></thead>
              <tbody>
                {ledger.map((entry) => (
                  <tr key={entry.id}>
                    <td>{dateTime(entry.timestamp)}</td>
                    <td className={styles.reference}>{entry.type}</td>
                    <td className={entry.amount >= 0 ? styles.positive : styles.negative}>{signedMoney(entry.amount)}</td>
                    <td className={styles.reference}>{entry.reference || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>

      {/* ADDED (USDC/Polygon integration). Shows the linked self-custody
          wallet (if any) and every recorded on-chain event - verified
          rebuy credits and this account's slice of any on-chain rake
          settlements. Each row's tx hash can be independently checked
          against Polygon; see services/blockchain/onchainRakeService.js's
          doc comment on why on-chain settlement amounts are a disclosed
          accounting convention rather than a literal per-dollar trace. */}
      <GlassPanel className={styles.history}>
        <div className={styles.historyHeader}>
          <div>
            <p className={styles.eyebrow}>ON-CHAIN (USDC / POLYGON)</p>
            <h2>Wallet & Rebuy History</h2>
          </div>
        </div>

        {loading ? (
          <p className={styles.muted}>Loading on-chain wallet…</p>
        ) : !onchain?.address ? (
          <p className={styles.muted}>No wallet linked yet. Link a wallet from a cash-game table to rebuy with USDC.</p>
        ) : (
          <>
            <div className={styles.onchainRow}>
              <span className={styles.walletAddress}>{onchain.address}</span>
              <span className={styles.muted}>Linked {dateTime(onchain.linkedAt)}</span>
            </div>
            {onchain.transactions.length === 0 ? (
              <p className={styles.muted}>No on-chain activity recorded yet.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Date</th><th>Table</th><th>Type</th><th>Amount</th><th>Tx Hash</th></tr></thead>
                  <tbody>
                    {onchain.transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td>{dateTime(tx.timestamp)}</td>
                        <td>{tx.tableId ?? '—'}</td>
                        <td className={styles.reference}>{tx.type}</td>
                        <td className={tx.amount >= 0 ? styles.positive : styles.negative}>{signedMoney(tx.amount)}</td>
                        <td className={styles.txHash}>{tx.txHash ? shortAddress(tx.txHash) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </GlassPanel>

      <div className={styles.actions}>
        <Button onClick={() => navigate(returnTo)}>Take Me Back to the Cash Game</Button>
        <Button variant="ghost" onClick={() => { logout(); navigate('/'); }}>Sign Out</Button>
      </div>
    </div>
  );
}
