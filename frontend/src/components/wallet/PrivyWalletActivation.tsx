import { useState } from "react";
import { useLoginWithEmail } from "@privy-io/react-auth";
import { isPrivyConfigured } from "../../config/env";
import { Button } from "../ui/Button";
import styles from "./PrivyWalletActivation.module.css";

/**
 * Drives Privy's headless email-OTP flow (useLoginWithEmail) inline,
 * instead of Privy's own popup login modal - this is what actually
 * connects "register with email" to "get a Polygon wallet", since Privy
 * needs its own verified email identity (separate from this app's
 * username/password account) before embeddedWallets.createOnLogin
 * (providers/PrivyProviders.tsx) will create anything.
 *
 * Sends the code automatically on mount using the email the player just
 * registered with, so the only thing they have to do is type the 6-digit
 * code from their inbox. Once verified, Privy creates the embedded wallet
 * and usePrivyWalletLink (running app-wide in AppShell) picks it up and
 * links it to their OpenDeck account within a few seconds - this
 * component doesn't need to wait for that part, just report success and
 * let the caller move on.
 */
export function PrivyWalletActivation({ email, onDone }: { email: string; onDone: () => void }) {
  const { sendCode, loginWithCode, state } = useLoginWithEmail({
    onComplete: () => onDone(),
  });
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  if (!isPrivyConfigured()) return null;

  const send = async () => {
    setSendError(null);
    try {
      await sendCode({ email });
      setSent(true);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Could not send the verification code.");
    }
  };

  if (!sent && state.status === "initial") {
    void send();
  }

  const submitting = state.status === "submitting-code" || state.status === "sending-code";
  const codeError = state.status === "error" ? state.error?.message ?? "Invalid or expired code." : null;

  return (
    <div className={styles.box}>
      <p className={styles.title}>Activate your Polygon wallet</p>
      <p className={styles.copy}>
        We emailed a verification code to <strong>{email}</strong>. Enter it below to activate your
        auto-created USDC wallet.
      </p>

      <div className={styles.row}>
        <input
          className={styles.input}
          type="text"
          inputMode="numeric"
          placeholder="6-digit code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={8}
        />
        <Button
          type="button"
          disabled={submitting || code.length === 0}
          onClick={() => loginWithCode({ code })}
        >
          {submitting ? "Verifying…" : "Verify"}
        </Button>
      </div>

      {(sendError || codeError) && <p className={styles.error}>{sendError ?? codeError}</p>}

      <button type="button" className={styles.skip} onClick={onDone}>
        Skip for now
      </button>
    </div>
  );
}
