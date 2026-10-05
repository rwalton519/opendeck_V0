import { env } from "../config/env";

/**
 * Thrown for any non-2xx response. Deliberately generic -- it reads
 * whatever JSON error shape the backend sends (`detail`, `message`,
 * `error`, or nothing) rather than assuming a specific framework's
 * error envelope (e.g. FastAPI's `{"detail": ...}`). This is what makes
 * the same client work unmodified against a future Node.js backend.
 */
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Name of the window CustomEvent dispatched whenever a *regular user*
 * request comes back 401. Nothing in this file decides what to do about
 * it (this module has no route/session knowledge) - AuthContext listens
 * for it and clears the session so a stale/expired token doesn't linger
 * in localStorage and get silently resent forever. See AuthContext.tsx.
 */
export const AUTH_EXPIRED_EVENT = "tp:auth-expired";

function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const candidate = record.detail ?? record.message ?? record.error;
    if (typeof candidate === "string") return candidate;
  }
  return fallback;
}

export interface ApiClient {
  get: <T>(path: string, signal?: AbortSignal) => Promise<T>;
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
  put: <T>(path: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
  delete: <T>(path: string, signal?: AbortSignal) => Promise<T>;
}

/**
 * Builds a REST client bound to a token source and a 401 event. Only one
 * caller remains today (`apiClient`, regular users, tp_auth_token) - a
 * second admin-scoped client used to be produced from this same factory
 * (spec v3.0, issue 7.1) but was removed along with the rest of this SPA's
 * admin surface. Kept as a factory rather than inlined in case another
 * independently-scoped client is ever needed again.
 */
function createApiClient(tokenStorageKey: string, unauthorizedEvent: string): ApiClient {
  function getToken(): string | null {
    return localStorage.getItem(tokenStorageKey);
  }

  async function request<T>(
    path: string,
    options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    const { method = "GET", body, signal } = options;
    const token = getToken();

    const res = await fetch(`${env.apiBaseUrl}${path}`, {
      method,
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Some endpoints (e.g. 204 No Content on delete) have no body at all.
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        // FIXED: this used to be a bare `JSON.parse(text)` with no try/catch,
        // so any non-JSON response (most commonly nginx returning its own
        // HTML 404/502 page because VITE_API_BASE_URL points somewhere that
        // doesn't actually reach the backend) surfaced as a cryptic browser
        // error - "JSON.parse: unexpected character at line 1 column 1 of
        // the JSON data" - on every single API call, with no indication of
        // what was actually wrong or which URL was hit. This is that same
        // failure, but named: it tells you the request DID leave the
        // browser and get a response, just not from the API - which is
        // exactly what you want to know first when every page is broken at
        // once, as opposed to one endpoint failing.
        throw new ApiError(
          res.status,
          `Got a non-JSON response from ${env.apiBaseUrl}${path} (status ${res.status}). This usually means VITE_API_BASE_URL is misconfigured or the backend isn't reachable at that path - check the Network tab for the actual response body.`,
          text.slice(0, 500),
        );
      }
    }

    if (!res.ok) {
      if (res.status === 401 && typeof window !== "undefined") {
        // Let the matching auth context know a token was rejected so it
        // can clear the stale session. Dispatched, not handled here, so
        // this stays backend/framework-agnostic like the rest of this
        // file - it still throws below exactly as before, so callers see
        // no change.
        window.dispatchEvent(new CustomEvent(unauthorizedEvent));
      }
      throw new ApiError(res.status, extractErrorMessage(data, res.statusText), data);
    }

    return data as T;
  }

  return {
    get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { method: "GET", signal }),
    post: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
      request<T>(path, { method: "POST", body, signal }),
    put: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
      request<T>(path, { method: "PUT", body, signal }),
    delete: <T>(path: string, signal?: AbortSignal) => request<T>(path, { method: "DELETE", signal }),
  };
}

/** Regular user REST client - attaches tp_auth_token, fires AUTH_EXPIRED_EVENT on 401. */
export const apiClient: ApiClient = createApiClient(env.authTokenStorageKey, AUTH_EXPIRED_EVENT);

// FIXED (spec v3.0, issue 7.1): adminApiClient (a second fetch client bound
// to tp_admin_token / ADMIN_AUTH_EXPIRED_EVENT) has been removed along with
// the rest of this SPA's admin surface - see AdminRedirect.tsx. Nothing
// under src/ calls a /admin/* endpoint anymore; the static dashboard at
// /admin/ manages its own session and its own requests entirely outside
// this codebase.
