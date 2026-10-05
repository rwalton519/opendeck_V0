/**
 * Shared constants + persistence for the two landing-page pseudo-screeners
 * (AgeScreener -> EmailScreener). See LandingScreeners.tsx for the flow.
 */

/** Minimum age shown in the prompt. Most Canadian provinces set the legal gambling age at 19 (18 in AB/MB/QC) - change this one constant to adjust the copy. */
export const MIN_AGE = 18;

/** How long a "Yes" answer is remembered on this browser. */
const AGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const AGE_KEY = "od_age_verified_at";
const EMAIL_SEEN_KEY = "od_email_screener_seen";

/** Where "No" sends the visitor. */
export const UNVERIFIED_PATH = "/unverified";

/**
 * Storage can throw (private mode, blocked cookies) - a screener must never
 * crash the landing page, so every access is guarded and fails "open to the
 * gate" (i.e. the screener simply shows again).
 */
export function isAgeVerified(): boolean {
  try {
    const raw = localStorage.getItem(AGE_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < AGE_TTL_MS;
  } catch {
    return false;
  }
}

export function rememberAgeVerified(): void {
  try {
    localStorage.setItem(AGE_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/** The email screener is shown at most once per browser session. */
export function hasSeenEmailScreener(): boolean {
  try {
    return sessionStorage.getItem(EMAIL_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberEmailScreenerSeen(): void {
  try {
    sessionStorage.setItem(EMAIL_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}
