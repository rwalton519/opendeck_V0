import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { walletApi } from "../../api/wallet";
import { useAuth } from "../../hooks/useAuth";
import { GlassPanel } from "../../components/ui/GlassPanel";
import styles from "./CryptoDepositPage.module.css";

const POLL_INTERVAL_MS = 5000;

export function CryptoDepositPage() {
  const { asset = "" } = useParams<{ asset: string }>();
  const { userId } = useAuth();

  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    walletApi
      .getCryptoDepositAddress(asset, userId)
      .then((res) => {
        if (!cancelled) setAddress(res.address);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load deposit address");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [asset, userId]);

  useEffect(() => {
    if (!userId || !address || confirmed) return;

    pollRef.current = setInterval(async () => {
      try {
        const status = await walletApi.getCryptoDepositStatus(asset, userId);
        if (status.confirmed) {
          setConfirmed(true);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // Transient poll errors shouldn't blow away the address/QR already on screen.
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [asset, userId, address, confirmed]);

  if (!userId) {
    return (
      <GlassPanel className={styles.panel}>
        <p>Sign in to generate a deposit address.</p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className={styles.panel}>
      <h1 className={styles.title}>{asset} Deposit</h1>
      <p className={styles.subtitle}>Send {asset} to this address</p>

      {loading && <p className={styles.muted}>Generating address…</p>}
      {error && (
        <p className={styles.error}>
          {error}. Once the wallet backend exposes <code>/wallet/crypto-deposit-address</code>, this screen will
          work end to end.
        </p>
      )}

      {address && (
        <>
          <div className={styles.qrWrap}>
            <QRCodeSVG value={address} size={220} bgColor="#ffffff" fgColor="#0a0d0c" />
          </div>
          <p className={styles.address}>{address}</p>

          {confirmed ? (
            <div className={styles.statusOk}>
              <span className={styles.statusIcon}>✓</span>
              <span>Deposit confirmed</span>
            </div>
          ) : (
            <div className={styles.statusPending}>
              <span className={styles.spinner} aria-hidden="true" />
              <span>Waiting for blockchain confirmation…</span>
            </div>
          )}
        </>
      )}

      <Link to="/wallet" className={styles.backLink}>
        ← Back to Wallet
      </Link>
    </GlassPanel>
  );
}
