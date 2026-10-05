import React, { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { GlassPanel } from "../../components/ui/GlassPanel";
import { Button } from "../../components/ui/Button";
import styles from "./LoginPage.module.css";

/**
 * The previously-missing counterpart to RegisterPage. AuthContext.login()
 * (POST /auth/login, session persistence, email/role capture) already
 * existed and was fully implemented - this page is the missing UI that
 * calls it; no auth business logic changes here.
 *
 * CHANGED: reads an optional ?redirect= query param (e.g. set by
 * CashGameTablePage when an unauthenticated visitor clicks "+ Take Seat")
 * and returns there after a successful login, instead of always bouncing
 * to "/". Falls back to "/" if absent, same as before.
 */
export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";

  // Prefilled when arriving from the landing-page email screener (?email=...).
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const registerParams = new URLSearchParams();
  if (redirectTo !== "/") registerParams.set("redirect", redirectTo);
  if (email.trim()) registerParams.set("email", email.trim());
  const registerQuery = registerParams.toString();
  const registerHref = registerQuery ? `/register?${registerQuery}` : "/register";

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate(redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <GlassPanel className={styles.panel}>
        <h2 className={styles.title}>Sign In</h2>
        <p className={styles.subtitle}>Welcome back to OpenDeck</p>

        {error && <p className={styles.messageError}>{error}</p>}

        <form onSubmit={handleLogin} className={styles.form}>
          <label className={styles.label}>
            Email Address
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className={styles.label}>
            Password
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          <Button type="submit" disabled={loading} className={styles.submitButton}>
            {loading ? "Signing in…" : "Sign In"}
          </Button>

          <p className={styles.footer}>
            Don't have an account?{" "}
            <Link
              to={registerHref}
              className={styles.footerLink}
            >
              Create one
            </Link>
          </p>
        </form>
      </GlassPanel>
    </div>
  );
};
