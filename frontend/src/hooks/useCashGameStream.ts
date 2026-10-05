import { useEffect, useRef } from "react";
import { env } from "../config/env";

/**
 * Realtime updates for a cash-game table via Server-Sent Events, mirroring
 * the pattern already proven in public/cashgame-demo/index.html.
 *
 * CHANGED: the live table's existing REALTIME_CONTRACT.md proposed a
 * WebSocket channel (`useRealtimeChannel` + ws/socket.ts), but no WS server
 * is actually implemented on the backend - `ws` is a listed dependency but
 * nothing in server.js upgrades a connection. Standing up a production WS
 * server (auth, reconnect/backoff, fan-out) is substantial infra on its
 * own; SSE already works end-to-end for the demo table, so this reuses
 * that rather than half-building a second realtime transport. The server
 * pushes a lightweight "something changed" ping (see
 * services/game/liveHandEngine.js's broadcast()) rather than full state,
 * since state is per-viewer (a player's own hole cards) in a way one
 * broadcast payload can't serve to every subscriber at once - the caller
 * re-fetches via cashGameApi.getTableState() on each ping.
 */
export function useCashGameStream(tableId: string | null | undefined, onPing: () => void) {
  const handlerRef = useRef(onPing);
  handlerRef.current = onPing;

  useEffect(() => {
    if (!tableId) return;

    const url = `${env.apiBaseUrl}/cashgame/${encodeURIComponent(tableId)}/stream`;
    const source = new EventSource(url);
    source.onmessage = () => handlerRef.current();
    // EventSource retries automatically on error/drop - nothing to do here
    // beyond letting it, same as the demo table's implementation.

    return () => source.close();
  }, [tableId]);
}
