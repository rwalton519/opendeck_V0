import React, { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { authApi } from "../../api/auth";
import { useAuth } from "../../hooks/useAuth";
import { GlassPanel } from "../../components/ui/GlassPanel";
import { Button } from "../../components/ui/Button";
import { PrivyWalletActivation } from "../../components/wallet/PrivyWalletActivation";
import { isPrivyConfigured } from "../../config/env";
import styles from "./RegisterPage.module.css";

/**
 * CHANGED: this used to stop after POST /auth/register and hand the
 * person off to /login to sign in manually. Now: reads an optional
 * ?redirect= query param (set by CashGameTablePage's "+ Take Seat" when
 * clicking it while signed out), and on success calls useAuth().login()
 * with the same credentials right away (POST /auth/register returns the
 * new user but no session token - /auth/login is what actually issues
 * one), then navigates straight to the redirect target. Falls back to
 * "/" if no redirect was given, and falls back to the old manual
 * "Go to Login" flow if the auto-login call itself fails for any reason
 * (e.g. the account needs verification) rather than silently stranding
 * the person on a dead end.
 */
export const RegisterPage: React.FC = () => {
  const [username, setUsername] = useState("");
  // Prefilled from ?email=... (landing-page email screener -> login -> "Create one").
  const [email, setEmail] = useState(() => new URLSearchParams(window.location.search).get("email") ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [autoLoginFailed, setAutoLoginFailed] = useState(false);
  const [showWalletActivation, setShowWalletActivation] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");

  const navigate = useNavigate();
  const { login } = useAuth();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";
  const dashboardReturn = redirectTo !== "/" ? redirectTo : "/cash-game";

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      // Cleanly hitting our centralized API structure
      await authApi.register(username, email, password);
      setSuccess(true);

      try {
        await login(email, password);
        // Auto-create-Polygon-wallet-on-email-registration happens here:
        // Privy needs its own verified email OTP (separate from the
        // password just used above) before embeddedWallets.createOnLogin
        // (PrivyProviders.tsx) will provision anything, so this step asks
        // for that code inline rather than silently skipping wallet setup.
        // If Privy isn't configured for this build, fall straight through
        // to the dashboard exactly as before.
        if (isPrivyConfigured()) {
          setRegisteredEmail(email);
          setShowWalletActivation(true);
          return;
        }
        navigate(`/dashboard?returnTo=${encodeURIComponent(dashboardReturn)}`);
        return;
      } catch {
        // Account was created but auto-login didn't go through (e.g.
        // email verification required) - fall back to the manual
        // "Go to Login" button below rather than leaving the person on a
        // blank screen. Their account still exists either way.
        setAutoLoginFailed(true);
      }
    } catch (err) {
      // apiClient throws ApiError (a flat { status, message, body } shape,
      // not an axios-style err.response.data.error) - this now reads the
      // message the same way every other page's catch block does.
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <GlassPanel className={styles.panel}>
        <h2 className={styles.title}>Create Account</h2>
        <p className={styles.subtitle}>Join OpenDeck Poker Platform</p>

        {error && <p className={styles.messageError}>{error}</p>}

        {success ? (
          <div className={styles.successBox}>
            <p className={styles.messageOk}>Account created successfully.</p>
            {autoLoginFailed ? (
              <>
                <p className={styles.messageError}>Automatic sign-in was not completed. Please sign in to continue.</p>
                <Button
                  onClick={() => navigate(`/login?redirect=${encodeURIComponent(`/dashboard?returnTo=${encodeURIComponent(dashboardReturn)}`)}`)}
                  className={styles.submitButton}
                >
                  Go to Login
                </Button>
              </>
            ) : showWalletActivation ? (
              <PrivyWalletActivation
                email={registeredEmail}
                onDone={() => navigate(`/dashboard?returnTo=${encodeURIComponent(dashboardReturn)}`)}
              />
            ) : (
              <Button
                onClick={() => navigate(`/dashboard?returnTo=${encodeURIComponent(dashboardReturn)}`)}
                className={styles.submitButton}
              >
                Continue to Dashboard
              </Button>
            )}
          </div>
        ) : (
          <form onSubmit={handleRegister} className={styles.form}>
            <label className={styles.label}>
              Username
              <input
                className={styles.input}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </label>

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

            <label className={styles.label}>
              Confirm Password
              <input
                className={styles.input}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </label>

            <Button type="submit" disabled={loading} className={styles.submitButton}>
              {loading ? "Registering Account…" : "Sign Up"}
            </Button>

            <p className={styles.footer}>
              Already have an account?{" "}
              <Link
                to={redirectTo !== "/" ? `/login?redirect=${encodeURIComponent(redirectTo)}` : "/login"}
                className={styles.footerLink}
              >
                Log In
              </Link>
            </p>
          </form>
        )}
      </GlassPanel>
    </div>
  );
};
