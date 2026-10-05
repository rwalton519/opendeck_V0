import { apiClient } from "./client";
import { env } from "../config/env";

export interface LoginResponse {
  token: string;
  userId: string;
  // ADDED: the backend's real /auth/login response already includes this
  // (see backend_new/auth/routerAuth.js), but it was previously discarded -
  // needed now for the Stripe Connect onboarding flow, which requires an
  // email to create a connected account.
  email: string | null;
  username: string | null;
  // ADDED: optional role claim, read if the backend sends one. No longer
  // used to gate anything client-side (spec v3.0, issue 7.1 - admin access
  // is handled entirely outside this app by the static dashboard at
  // /admin/). Retained in case a future feature wants to read it; not
  // every backend response is guaranteed to include this yet.
  role: string | null;
}

export interface RegisterResponse {
  message: string;
  user_id: number;
  email: string;
}

/**
 * Backend-agnostic shape we normalize the login response into.
 * If the future Node backend names fields differently (e.g. `id` instead
 * of `user_id`), only this one mapping function needs to change.
 */
function normalizeLoginResponse(raw: Record<string, unknown>): LoginResponse {
  // Pull fields safely supporting custom or mock authentication signatures
  const token = raw.token ?? raw.access_token; 
  const userId = raw.user_id ?? raw.userId ?? raw.id;
  const email = raw.email;
  const username = raw.username;
  const role = raw.role ?? raw.user_role ?? raw.userRole;

  if (typeof token !== "string") {
    throw new Error("Login response did not include an authentication token.");
  }

  return {
    token,
    userId: userId != null ? String(userId) : "",
    email: typeof email === "string" ? email : null,
    username: typeof username === "string" ? username : null,
    role: typeof role === "string" ? role : null,
  };
}

export const authApi = {
  async login(email: string, password: string): Promise<LoginResponse> {
    const raw = await apiClient.post<Record<string, unknown>>("/auth/login", { email, password });
    const result = normalizeLoginResponse(raw);
    localStorage.setItem(env.authTokenStorageKey, result.token);
    return result;
  },

  /**
   * Dispatches user registration details straight to the authentication backend.
   */
  async register(username: string, email: string, password: string): Promise<RegisterResponse> {
    return await apiClient.post<RegisterResponse>("/auth/register", {
      username,
      email,
      password,
    });
  },

  logout(): void {
    localStorage.removeItem(env.authTokenStorageKey);
  },

  getToken(): string | null {
    return localStorage.getItem(env.authTokenStorageKey);
  },
};