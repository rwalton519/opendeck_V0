# Realtime Contract (Cash Game + Live Table) — RETIRED

> **Status: retired, superseded by the note below.** This document
> originally proposed a generic WebSocket channel-multiplexer
> (`GET {VITE_WS_BASE_URL}/realtime?token=...`) for both the cash-game and
> tournament live-table modules. It was explicitly a *draft proposal*, not
> a description of something the backend implemented - see the original
> framing preserved below. That gap was confirmed directly: no route in
> the backend's `server.js` upgrades a connection for this purpose, so the
> socket this contract describes never actually connects.
>
> Both consumers have since moved off this proposal:
>
> - **Cash-game table** (`CashGameTablePage`) uses
>   `hooks/useCashGameStream.ts`, a plain `EventSource` against the
>   backend's real, implemented SSE stream at
>   `GET /cashgame/:tableId/stream`. This is real and working end-to-end.
> - **Tournament table** (`TournamentTablePage`) polls the existing REST
>   endpoint (`GET /tournaments/:id/table_state`,
>   `tournamentsApi.fetchTableState`) on a 4-second interval and diffs
>   consecutive snapshots client-side to drive the same card-deal /
>   pot-pulse cues this document's message types used to trigger from
>   incremental deltas. This isn't push-based, but it doesn't depend on a
>   backend endpoint that doesn't exist, which the WebSocket approach did.
>
> `src/ws/socket.ts` and `src/hooks/useRealtimeChannel.ts` (the generic
> WS client and its React binding) have been removed, since nothing
> consumes them anymore. If the backend ever implements a real push
> transport for tournament tables (WebSocket or SSE), the design below is
> still a reasonable starting point for that contract - it just needs an
> actual server implementation before any frontend code should depend on
> it again, learning from this round: land the backend endpoint first, or
> build the frontend consumer directly against a documented, already-real
> one, rather than the other way around.

---

This document describes the WebSocket contract the frontend now implements
for the cash-game and tournament live-table modules (see project frontend
spec, section 9.1 - previously both were deferred pending "a real-time
message contract the backend hasn't published"). **This is the frontend's
proposal for that contract**, written to be implemented against, not a
description of something that already exists server-side. Endpoint paths,
field names, and message shapes below should be treated as a draft for the
backend team to confirm, adjust, or implement as-is.

Implementation: `src/ws/socket.ts` (transport), `src/hooks/useRealtimeChannel.ts`
(React binding), `src/types/cashgame.ts` / `src/types/liveTable.ts` (payload
shapes).

## Connection

```
GET {VITE_WS_BASE_URL}/realtime?token=<bearer token>
```

One connection per browser tab, shared across every subscribed channel.
`token` is the same value sent as `Authorization: Bearer <token>` on REST
calls (see `api/client.ts`) - passed as a query param here only because
browsers can't set custom headers on a WebSocket handshake.

## Envelope

Every message in both directions is a single JSON object per WS frame.

**Client → Server**
```json
{ "type": "subscribe", "channel": "cash-table:main" }
{ "type": "unsubscribe", "channel": "cash-table:main" }
```

**Server → Client**
```json
{ "channel": "cash-table:main", "type": "seat_taken", "payload": { ... }, "ts": "2026-07-25T12:00:00Z" }
```

The client resubscribes to every channel it cares about automatically on
reconnect (exponential backoff, capped at 15s), so the server doesn't need
to remember subscriptions across a dropped connection.

## Channel: `cash-table:<tableId>`

`<tableId>` defaults to `"main"` today (`DEFAULT_CASH_TABLE_ID` in
`src/types/cashgame.ts`) - the frontend also accepts `/cash-game/:tableId`
for a future multi-table lobby.

| type | payload | when |
|---|---|---|
| `table_state` | `{ seats: { [seatIndex]: CashSeatPlayer \| null }, smallBlind?, bigBlind? }` | full snapshot, e.g. right after subscribe |
| `seat_taken` | `{ seatIndex: number, player: CashSeatPlayer }` | a seat is claimed (via REST `POST /cash-game/:id/seats/:seat/take`, or by anyone else at the table) |
| `seat_left` | `{ seatIndex: number }` | a player leaves/busts |
| `stack_update` | `{ seatIndex: number, chips: number }` | a stack changes outside of taking/leaving a seat |

`CashSeatPlayer = { userId: number, username: string, chips: number }`

Corresponding REST endpoints (`src/api/cashgame.ts`, also new):
- `GET /cash-game/:tableId/state`
- `POST /cash-game/:tableId/seats/:seatIndex/take` — body `{ user_id, buy_in }`
- `POST /cash-game/:tableId/seats/:seatIndex/leave` — body `{ user_id }`

## Channel: `tournament-table:<tournamentId>`

Complements the existing REST `GET /tournaments/:id/table_state`
(`tournamentsApi.fetchTableState`, already implemented), which the client
uses for the initial load and as a fallback poll if the socket is down.

| type | payload | when |
|---|---|---|
| `table_state` | same shape as the REST `table_state` response | full snapshot |
| `hand_started` | `{ handNumber: number, commitHash: string }` | new hand begins; `commitHash` is the pre-shuffle deck commitment |
| `community_card` | `{ card: { rank, suit }, street }` | a community card is dealt |
| `pot_update` | `{ pot: number }` | pot size changes |
| `seat_update` | `{ seatIndex, userId, username, chips, folded }` | a seat's chips/fold status changes |
| `hand_result` | `{ revealSeed: string, verified: boolean }` | hand ends; `revealSeed` lets anyone re-derive the shuffle from `commitHash` |

`verified` in `hand_result` is expected to be computed server-side (does
`revealSeed` actually hash/derive to the `commitHash` published at
`hand_started`?) - the client displays it, it doesn't (yet) independently
recompute it. True client-side re-verification of the commit/reveal pair
is a reasonable next step once the hashing scheme is finalized, but is out
of scope here since it depends on backend cryptographic details this
source tree doesn't define.

## What this intentionally does not cover

- Betting actions (fold/call/raise) - this contract is read-only spectator/
  seating state, matching what the REST layer already exposed. Turning
  this into a playable table is a larger scope than "fix the stub."
- Chat, hand history, multi-table support beyond the `tableId`/`tournamentId`
  channel keys already used.
