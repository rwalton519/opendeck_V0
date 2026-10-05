import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { walletApi } from "../../api/wallet";
import { useAuth } from "../../hooks/useAuth";
import { GlassPanel } from "../../components/ui/GlassPanel";
import { Button } from "../../components/ui/Button";
import { PayoutSetup } from "../../components/wallet/PayoutSetup";
import { CardDepositFlow } from "../../components/wallet/CardDepositFlow";
import { PolygonWalletCard } from "../../components/wallet/PolygonWalletCard";
import { PAYMENT_METHOD_LABELS, type PaymentMethodType, type WalletTransaction } from "../../types/wallet";
import styles from "./WalletPage.module.css";

const DEPOSIT_METHODS: PaymentMethodType[] = ["card", "debit", "bankTransfer", "eTransfer", "eWallet", "cryptoBtc", "cryptoEth"];

// These map to Stripe on the backend (see utils/paymentMethods.js's
// METHOD_TO_PROVIDER) and go through the real create-intent -> confirm
// -with-Stripe.js -> webhook-credits flow below. bankTransfer/eTransfer
// map to the ACH provider, which is deliberately not implemented yet
// (see services/payments/providerAch.js) - walletApi.deposit() will
// return a clear error for those rather than this UI pretending they work.
const STRIPE_BACKED_METHODS: PaymentMethodType[] = ["card", "debit", "eWallet"];

type Filter = "all" | "deposit" | "withdrawal";

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function WalletPage() {
  const { userId } = useAuth();
  const navigate = useNavigate();

  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethodType>("card");
  const [depositing, setDepositing] = useState(false);
  const [depositMessage, setDepositMessage] = useState<{ text: string; ok: boolean } | null>(null);
  // FIXED: method=card/debit/eWallet used to call walletApi.deposit()
  // directly and immediately show "Deposit successful" - but that call
  // only ever creates a Stripe PaymentIntent (step 1 of 3). Nothing in
  // this page collected the actual card details or confirmed the
  // PaymentIntent with Stripe (step 2), so the deposit never actually
  // completed and the balance never updated, no matter how many times you
  // clicked Deposit. This flag switches those methods over to
  // CardDepositFlow, which does all three real steps.
  const [showStripeFlow, setShowStripeFlow] = useState(false);

  const [filter, setFilter] = useState<Filter>("all");

  const loadWallet = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const [bal, txs] = await Promise.all([walletApi.getBalance(userId), walletApi.getTransactions(userId)]);
      setBalance(bal);
      setTransactions(txs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load wallet");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  async function handleDeposit() {
    if (!userId) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDepositMessage({ text: "Enter a valid amount", ok: false });
      return;
    }

    // A crypto method needs an address/QR flow, not an instant form submit.
    if (method.startsWith("crypto")) {
      const asset = method.replace("crypto", "").toUpperCase();
      navigate(`/crypto-deposit/${asset}`);
      return;
    }

    // Card/debit/eWallet need Stripe's own payment form to actually
    // collect payment details - see the STRIPE_BACKED_METHODS comment
    // above for why this can't just be a single deposit() call.
    if (STRIPE_BACKED_METHODS.includes(method)) {
      setDepositMessage(null);
      setShowStripeFlow(true);
      return;
    }

    // bankTransfer / eTransfer (ACH): not implemented yet
    // (services/payments/providerAch.js) - this call will fail with a
    // clear 501 message rather than this UI hiding the option. Left in
    // deliberately so the failure is honest and visible, not silently
    // routed around.
    setDepositing(true);
    setDepositMessage(null);
    try {
      const result = await walletApi.deposit(userId, parsed, method);
      setDepositMessage({ text: result.success ? "Deposit successful" : `Deposit failed: ${result.message}`, ok: result.success });
      if (result.success) {
        setAmount("");
        await loadWallet();
      }
    } catch (err) {
      setDepositMessage({ text: err instanceof Error ? err.message : "Deposit failed", ok: false });
    } finally {
      setDepositing(false);
    }
  }

  const filteredTransactions = useMemo(
    () => (filter === "all" ? transactions : transactions.filter((tx) => tx.type === filter)),
    [transactions, filter],
  );

  if (!userId) {
    return (
      <GlassPanel className={styles.notice}>
        <p>Sign in to view your wallet.</p>
      </GlassPanel>
    );
  }

  return (
    <div className={styles.page}>
      <GlassPanel className={styles.balanceCard}>
        <p className={styles.balanceLabel}>Balance</p>
        <h1 className={styles.balanceValue}>{loading ? "—" : formatCurrency(balance ?? 0)}</h1>
        <div className={styles.actions}>
          <Button onClick={() => navigate("/withdraw")} variant="ghost">
            Withdraw Funds
          </Button>
        </div>
      </GlassPanel>

      <PayoutSetup />

      <PolygonWalletCard />

      <GlassPanel>
        <h2 className={styles.sectionTitle}>Deposit</h2>
        <div className={styles.depositForm}>
          <input
            className={styles.input}
            type="number"
            min="0"
            step="0.01"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={showStripeFlow}
          />
          <select
            className={styles.select}
            value={method}
            onChange={(e) => {
              setMethod(e.target.value as PaymentMethodType);
              setShowStripeFlow(false);
              setDepositMessage(null);
            }}
            disabled={showStripeFlow}
          >
            {DEPOSIT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
          {!showStripeFlow && (
            <Button onClick={handleDeposit} disabled={depositing}>
              {depositing ? "Depositing…" : "Deposit"}
            </Button>
          )}
        </div>
        {depositMessage && (
          <p className={depositMessage.ok ? styles.messageOk : styles.messageError}>{depositMessage.text}</p>
        )}
        {showStripeFlow && userId && (STRIPE_BACKED_METHODS as string[]).includes(method) && (
          <CardDepositFlow
            userId={userId}
            method={method as "card" | "debit" | "eWallet"}
            initialAmount={amount}
            onCredited={() => {
              setShowStripeFlow(false);
              setAmount("");
              loadWallet();
            }}
            onCancel={() => setShowStripeFlow(false)}
          />
        )}
      </GlassPanel>

      <GlassPanel>
        <div className={styles.historyHeader}>
          <h2 className={styles.sectionTitle}>Transaction History</h2>
          <div className={styles.filterGroup}>
            {(["all", "deposit", "withdrawal"] as Filter[]).map((f) => (
              <button
                key={f}
                className={f === filter ? `${styles.filterBtn} ${styles.filterBtnActive}` : styles.filterBtn}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : f === "deposit" ? "Deposits" : "Withdrawals"}
              </button>
            ))}
          </div>
        </div>

        {error && <p className={styles.messageError}>{error}</p>}
        {loading && <p className={styles.muted}>Loading…</p>}
        {!loading && filteredTransactions.length === 0 && <p className={styles.muted}>No transactions yet.</p>}

        <ul className={styles.txList}>
          {filteredTransactions.map((tx) => (
            <li key={tx.id} className={styles.txRow}>
              <span className={styles.txType}>{tx.type}</span>
              <span className={styles.txAmount}>{formatCurrency(tx.amount)}</span>
              <span className={styles.txStatus} data-status={tx.status}>
                {tx.status}
              </span>
              <span className={styles.txTime}>{formatTimestamp(tx.timestamp)}</span>
            </li>
          ))}
        </ul>
      </GlassPanel>
    </div>
  );
}
