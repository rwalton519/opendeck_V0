import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { walletApi } from "../../api/wallet";
import { useAuth } from "../../hooks/useAuth";
import { GlassPanel } from "../../components/ui/GlassPanel";
import { Button } from "../../components/ui/Button";
import {
  CRYPTO_ASSET_BY_METHOD,
  FALLBACK_PAYMENT_METHOD_CAPABILITIES,
  PAYMENT_METHOD_LABELS,
  type PaymentMethodCapabilities,
  type PaymentMethodType,
} from "../../types/wallet";
import styles from "./WithdrawPage.module.css";

/**
 * FIXED: this list used to be hardcoded to
 * ["bankTransfer", "eTransfer", "cryptoBtc", "cryptoEth"] - three of
 * those four are HTTP 501 on the backend (no bank-linking flow, no BTC
 * send logic), while cryptoMonero (the one crypto method that's fully
 * real end-to-end - address, admin-approved on-chain send, tx-hash
 * recording) wasn't offered at all. The method list is now derived from
 * GET /wallet/payment-methods/capabilities (walletApi.getPaymentMethodCapabilities,
 * falling back to the same matrix if that call fails) and filtered to
 * only methods the backend reports as actually supporting withdrawal, so
 * this can't silently drift out of sync with the backend again.
 */
function withdrawableMethods(caps: PaymentMethodCapabilities): PaymentMethodType[] {
  return (Object.keys(caps) as PaymentMethodType[]).filter((m) => caps[m]?.withdraw);
}

export function WithdrawPage() {
  const { userId } = useAuth();

  const [capabilities, setCapabilities] = useState<PaymentMethodCapabilities>(FALLBACK_PAYMENT_METHOD_CAPABILITIES);
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);

  const methods = useMemo(() => withdrawableMethods(capabilities), [capabilities]);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethodType | "">("");
  const [address, setAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    walletApi.getPaymentMethodCapabilities().then((caps) => {
      if (cancelled) return;
      setCapabilities(caps);
      setCapabilitiesLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Once the real capability list is in, default to its first entry
  // instead of leaving the dropdown on a method that may no longer be
  // offered.
  useEffect(() => {
    if (methods.length > 0 && (!method || !methods.includes(method))) {
      setMethod(methods[0]);
    }
  }, [methods, method]);

  // Backend requires a destination address specifically for cryptoMonero
  // withdrawals today; generalized to any method with a known crypto
  // asset so a future real crypto-withdrawal method (e.g. cryptoEth, if
  // that's ever implemented) picks up the same field automatically.
  const requiresAddress = method !== "" && Boolean(CRYPTO_ASSET_BY_METHOD[method]);

  async function handleSubmit() {
    if (!userId || method === "") return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setResult({ text: "Enter a valid amount", ok: false });
      return;
    }
    if (requiresAddress && !address.trim()) {
      setResult({ text: `Enter a destination ${CRYPTO_ASSET_BY_METHOD[method]} address`, ok: false });
      return;
    }

    setSubmitting(true);
    setResult(null);
    try {
      const res = await walletApi.withdraw(userId, parsed, method, requiresAddress ? address.trim() : undefined);
      setResult({
        text: res.success ? "Withdrawal requested — it now sits in the admin approval queue." : `Withdrawal failed: ${res.message}`,
        ok: res.success,
      });
      if (res.success) {
        setAmount("");
        setAddress("");
      }
    } catch (err) {
      setResult({ text: err instanceof Error ? err.message : "Withdrawal failed", ok: false });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <GlassPanel className={styles.panel}>
      <h1 className={styles.title}>Withdraw Funds</h1>
      <p className={styles.subtitle}>Withdrawals are reviewed before payout — see them land in the admin queue once submitted.</p>

      {capabilitiesLoaded === false && <p className={styles.subtitle}>Checking available withdrawal methods…</p>}

      {capabilitiesLoaded && methods.length === 0 && (
        <p className={styles.messageError}>No withdrawal methods are currently available. Please check back later.</p>
      )}

      {methods.length > 0 && (
        <div className={styles.form}>
          <label className={styles.label}>
            Amount
            <input
              className={styles.input}
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>

          <label className={styles.label}>
            Method
            <select
              className={styles.select}
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethodType)}
            >
              {methods.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </label>

          {requiresAddress && (
            <label className={styles.label}>
              Destination {CRYPTO_ASSET_BY_METHOD[method]} Address
              <input
                className={styles.input}
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={`Your ${CRYPTO_ASSET_BY_METHOD[method]} wallet address`}
              />
            </label>
          )}

          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting…" : "Request Withdrawal"}
          </Button>
        </div>
      )}

      {result && <p className={result.ok ? styles.messageOk : styles.messageError}>{result.text}</p>}

      <div className={styles.footer}>
        <Link to="/wallet" className={styles.backLink}>
          ← Back to Wallet
        </Link>
      </div>
    </GlassPanel>
  );
}
