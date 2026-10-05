import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { GOOGLE_LOGIN_HREF, LOGIN_PROVIDERS, googleGlyph } from "./loginProviders";
import { useScreenerModal } from "./useScreenerModal";
import styles from "./Screeners.module.css";

interface EmailScreenerProps {
  /** Called with the typed address when the visitor presses Continue. */
  onSubmitEmail: (email: string) => void;
  /** Close button, Escape, backdrop click, or the Terms/Privacy links. */
  onDismiss: () => void;
}

/**
 * Pseudo-screener #2: "Welcome to OpenDeck" sign-in card modeled on the
 * example screenshot - Google button, OR divider, email + Continue, then a
 * 4x2 grid of 8 login tiles (LOGIN_PROVIDERS, most popular first).
 */
export function EmailScreener({ onSubmitEmail, onDismiss }: EmailScreenerProps) {
  const [email, setEmail] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);
  useScreenerModal(cardRef, onDismiss);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (trimmed) onSubmitEmail(trimmed);
  };

  return (
    <div
      className={styles.emailLayer}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        ref={cardRef}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-screener-title"
        tabIndex={-1}
      >
        <button type="button" className={styles.close} onClick={onDismiss} aria-label="Close">
          ×
        </button>

        <h2 id="email-screener-title" className={styles.cardTitle}>
          Welcome to OpenDeck
        </h2>

        <a className={styles.googleButton} href={GOOGLE_LOGIN_HREF}>
          {googleGlyph}
          <span>Continue with Google</span>
        </a>

        <div className={styles.or} role="separator">
          <span>OR</span>
        </div>

        <form className={styles.emailRow} onSubmit={handleSubmit}>
          <input
            className={styles.emailInput}
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            placeholder="Email address"
            aria-label="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button type="submit" className={styles.emailContinue}>
            Continue
          </button>
        </form>

        <div className={styles.providers}>
          {LOGIN_PROVIDERS.map((p) => (
            <a key={p.id} className={styles.provider} href={p.href} aria-label={`Continue with ${p.label}`} title={p.label}>
              {p.icon}
            </a>
          ))}
        </div>

        <p className={styles.legal}>
          <Link to="/legal#tos" onClick={onDismiss}>
            Terms
          </Link>
          <span aria-hidden="true"> • </span>
          <Link to="/legal#privacy" onClick={onDismiss}>
            Privacy
          </Link>
        </p>
      </div>
    </div>
  );
}
