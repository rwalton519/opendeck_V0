import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { authApi } from "../api/auth";
import { AUTH_EXPIRED_EVENT } from "../api/client";

export interface AuthState {
  userId: string | null;
  // ADDED: needed by the Stripe Connect onboarding flow (creating a
  // connected account requires an email). Previously discarded entirely -
  // see api/auth.ts's normalizeLoginResponse.
  email: string | null;
  username: string | null;
  // Optional role claim (e.g. "admin") from /auth/login, if the backend
  // ever sends one. NOTE: no longer used to gate anything - the backend's
  // real admin identity system (POST /admin/login, a distinct `admins`
  // table and JWT) was never reachable through this claim in the first
  // place, and admin access is now handled entirely outside this app by
  // the static dashboard at /admin/ (spec v3.0, issue 7.1) rather than by
  // any session this SPA holds. Retained here only in case some other
  // feature wants to read it later; isAdmin below is unused by the app
  // today.
  role: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * The Flutter source never actually had a login screen -- every screen
 * hardcoded its own literal ("demo-user", userId: 1, user_id: 1...) which
 * would have been a real bug against a real backend. This context is the
 * single place a user id now lives, ready for a real login screen; until
 * one exists, it falls back to a stable local guest id so every other
 * screen can be built against a real (if temporary) identity.
 */
function loadInitialUserId(): string | null {
  return localStorage.getItem("tp_user_id");
}

function loadInitialEmail(): string | null {
  return localStorage.getItem("tp_user_email");
}

function loadInitialUsername(): string | null {
  return localStorage.getItem("tp_user_username");
}

function loadInitialRole(): string | null {
  return localStorage.getItem("tp_user_role");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(loadInitialUserId);
  const [email, setEmail] = useState<string | null>(loadInitialEmail);
  const [username, setUsername] = useState<string | null>(loadInitialUsername);
  const [role, setRole] = useState<string | null>(loadInitialRole);

  const logout = useCallback(() => {
    authApi.logout();
    localStorage.removeItem("tp_user_id");
    localStorage.removeItem("tp_user_email");
    localStorage.removeItem("tp_user_username");
    localStorage.removeItem("tp_user_role");
    setUserId(null);
    setEmail(null);
    setUsername(null);
    setRole(null);
  }, []);

  const login = useCallback(async (loginEmail: string, password: string) => {
    const result = await authApi.login(loginEmail, password);
    localStorage.setItem("tp_user_id", result.userId);
    setUserId(result.userId);

    // Prefer the backend's own record of the email (result.email) over the
    // value the user just typed, but fall back to what they typed if the
    // backend response didn't include one for some reason - either way,
    // something usable ends up stored rather than nothing.
    const resolvedEmail = result.email ?? loginEmail;
    localStorage.setItem("tp_user_email", resolvedEmail);
    setEmail(resolvedEmail);
    const resolvedUsername = result.username ?? null;
    if (resolvedUsername) localStorage.setItem("tp_user_username", resolvedUsername);
    else localStorage.removeItem("tp_user_username");
    setUsername(resolvedUsername);

    if (result.role) {
      localStorage.setItem("tp_user_role", result.role);
      setRole(result.role);
    } else {
      localStorage.removeItem("tp_user_role");
      setRole(null);
    }
  }, []);

  // A 401 anywhere in the app means the token apiClient is attaching is no
  // longer valid (expired/revoked) - clear the stale session rather than
  // keep silently resending a rejected token on every subsequent request.
  // See api/client.ts's AUTH_EXPIRED_EVENT.
  useEffect(() => {
    window.addEventListener(AUTH_EXPIRED_EVENT, logout);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, logout);
  }, [logout]);

  const value = useMemo<AuthState>(
    () => ({
      userId,
      email,
      username,
      role,
      isAuthenticated: userId !== null,
      isAdmin: role === "admin",
      login,
      logout,
    }),
    [userId, email, username, role, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
