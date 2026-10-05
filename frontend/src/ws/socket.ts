import { env } from "../config/env";
import { authApi } from "../api/auth";

/**
 * Realtime transport shared by the cash-game and tournament live-table
 * modules. Both were previously stubbed pending "a real-time message
 * contract the backend hasn't published" - this file (plus
 * REALTIME_CONTRACT.md at the repo root) IS that contract now: one
 * WebSocket endpoint, channel-based subscriptions, a small envelope.
 * Mirrors the same shape choices already used elsewhere in this codebase
 * (apiClient's Bearer-token auth, ApiError-style typed errors) so the
 * backend team is implementing something consistent with the REST layer,
 * not a second unrelated protocol.
 *
 * Wire envelope (both directions), one JSON object per WS message:
 *   Client -> Server: { type: "subscribe" | "unsubscribe", channel: string }
 *   Server -> Client: { channel: string, type: string, payload: unknown, ts?: string }
 *
 * Channels used today:
 *   "cash-table:<tableId>"        - see api/cashgame.ts / types/cashgame.ts
 *   "tournament-table:<tournamentId>" - see types/liveTable.ts
 */

export interface RealtimeMessage<T = unknown> {
  channel: string;
  type: string;
  payload: T;
  ts?: string;
}

type Listener = (message: RealtimeMessage) => void;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

class RealtimeClient {
  private socket: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connecting = false;
  private closedByCaller = false;

  private connect() {
    if (this.connecting || (this.socket && this.socket.readyState === WebSocket.OPEN)) return;
    this.connecting = true;
    this.closedByCaller = false;

    // The REST layer sends the token as an Authorization header
    // (api/client.ts); browsers can't set custom headers on a WebSocket
    // handshake, so it goes as a query param instead - same token, same
    // localStorage source (authApi.getToken()), just a different place to
    // put it because the transport requires that.
    const token = authApi.getToken();
    const url = `${env.wsBaseUrl}/realtime${token ? `?token=${encodeURIComponent(token)}` : ""}`;

    const ws = new WebSocket(url);
    this.socket = ws;

    ws.onopen = () => {
      this.connecting = false;
      this.reconnectAttempt = 0;
      // Re-subscribe to every channel a caller has registered interest in
      // - covers the reconnect-after-drop case transparently.
      for (const channel of this.listeners.keys()) {
        this.send({ type: "subscribe", channel });
      }
    };

    ws.onmessage = (event) => {
      let message: RealtimeMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        return; // Not a JSON envelope - ignore rather than throw in a socket callback.
      }
      const channelListeners = this.listeners.get(message.channel);
      if (channelListeners) {
        for (const listener of channelListeners) listener(message);
      }
    };

    ws.onclose = () => {
      this.connecting = false;
      this.socket = null;
      if (!this.closedByCaller && this.listeners.size > 0) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose fires right after onerror for a failed connection attempt;
      // reconnect scheduling lives there so it isn't duplicated here.
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private send(data: unknown) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
    // If the socket isn't open yet, ws.onopen re-subscribes every
    // registered channel once it connects, so a subscribe call made
    // while offline isn't lost - just deferred.
  }

  /** Subscribe to a channel; returns an unsubscribe function. */
  subscribe(channel: string, listener: Listener): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(listener);
    this.connect();
    this.send({ type: "subscribe", channel });

    return () => {
      const set = this.listeners.get(channel);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(channel);
        this.send({ type: "unsubscribe", channel });
      }
      if (this.listeners.size === 0) {
        this.closedByCaller = true;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.socket?.close();
      }
    };
  }
}

/**
 * One shared connection for the whole app (a poker client only ever needs
 * to watch one table at a time today, but this supports multiple
 * concurrent channel subscriptions if that changes).
 */
export const realtimeClient = new RealtimeClient();
