const express = require('express');

/**
 * Factory for the unauthenticated demo-table HTTP surface, shared by
 * /cashgame-demo and /heads-up (see server.js for both mounts). Identical
 * route shape for every demo room - only the underlying `room` (from
 * services/demo/createDemoRoom.js) differs.
 *
 * Deliberately not using the `ws` package / api/routes/wsRouter.js's
 * upgrade-handling: that router is wired directly into the httpServer's
 * 'upgrade' event and is DB/auth-authoritative for real cash tables. Adding
 * a second 'upgrade' listener on the same server for an unrelated path
 * would race it (Node calls every 'upgrade' listener for every request;
 * the real router destroys the socket on any path it doesn't recognize,
 * which would kill this demo's connection before it got a chance to
 * attach). Server-Sent Events sidesteps that entirely - it's a plain HTTP
 * GET with a long-lived response, so it composes safely with everything
 * else already mounted on `app`, uses the same port/CORS config as the
 * rest of the API, and is the same mechanism this project already uses in
 * production for the SideBet live activity feed.
 */
function createDemoTableRouter(room) {
  const router = express.Router();

  function requireClientId(req, res) {
    const clientId = String(req.body?.clientId || req.query?.clientId || '');
    if (!clientId || clientId.length > 100) {
      res.status(400).json({ detail: 'clientId is required.' });
      return null;
    }
    return clientId;
  }

  // GET /:room/stream?clientId=... - SSE. Same nginx treatment the
  // SideBet activity feed already needs (proxy_buffering off / equivalent),
  // since a reverse proxy buffering the response defeats SSE's whole point.
  router.get('/stream', (req, res) => {
    const clientId = requireClientId(req, res);
    if (!clientId) return;

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    room.subscribe(clientId, res);
    // Send the current state immediately so a newly-opened tab isn't
    // waiting on someone else's next action to see the table.
    res.write(`event: state\ndata: ${JSON.stringify(room.buildSnapshotFor(clientId))}\n\n`);

    const keepAlive = setInterval(() => {
      try { res.write(': keep-alive\n\n'); } catch (err) { clearInterval(keepAlive); }
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      room.unsubscribe(clientId, res);
    });
  });

  // POST /:room/join  { clientId, kind: 'seeded'|'custom', identityId?, username? }
  router.post('/join', (req, res) => {
    const clientId = requireClientId(req, res);
    if (!clientId) return;
    const { kind } = req.body || {};
    const result = room.join(clientId, kind, req.body || {});
    if (!result.ok) return res.status(409).json({ detail: result.error });
    room.broadcast();
    res.json(result);
  });

  // POST /:room/take-seat  { clientId, seatIndex }
  // Any visitor with a username can take an open seat - no account needed.
  // Once enough seats are filled (room.minPlayersToStart), the room itself
  // auto-starts the hand (see createDemoRoom.js's takeSeat).
  router.post('/take-seat', (req, res) => {
    const clientId = requireClientId(req, res);
    if (!clientId) return;
    const seatIndex = Number(req.body?.seatIndex);
    const result = room.takeSeat(clientId, seatIndex);
    if (!result.ok) return res.status(409).json({ detail: result.error });
    room.broadcast();
    res.json({ success: true });
  });

  // POST /:room/rebuy  { clientId }
  router.post('/rebuy', (req, res) => {
    const clientId = requireClientId(req, res);
    if (!clientId) return;
    const result = room.rebuy(clientId);
    if (!result.ok) return res.status(409).json({ detail: result.error });
    room.broadcast();
    res.json({ success: true });
  });

  // POST /:room/heartbeat { clientId } - keeps an open browser session
  // alive. The room reaps clients that stop heartbeating for ~35 seconds,
  // which covers hard browser/process termination where pagehide/SSE close
  // cannot be delivered.
  router.post('/heartbeat', (req, res) => {
    const clientId = requireClientId(req, res);
    if (!clientId) return;
    const result = room.heartbeat(clientId);
    if (!result.ok) return res.status(409).json({ detail: result.error });
    res.json({ success: true });
  });

  // POST /:room/leave { clientId } - explicit browser/page exit.
  router.post('/leave', async (req, res) => {
    const clientId = requireClientId(req, res);
    if (!clientId) return;
    const result = await room.leave(clientId, 'explicit-leave');
    res.json(result);
  });

  // POST /:room/deal  { clientId }
  // Fire-and-forget from the caller's point of view: the deal plays out over
  // several seconds and is broadcast to every subscriber (including the
  // caller) as it progresses.
  router.post('/deal', async (req, res) => {
    const clientId = requireClientId(req, res);
    if (!clientId) return;
    try {
      const result = await room.dealHand(clientId);
      if (!result.ok) return res.status(409).json({ detail: result.error });
      res.json({ success: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[demo:${room.roomKey}] dealHand failed`, err);
      res.status(500).json({ detail: 'Unable to deal the hand.' });
    }
  });

  // POST /:room/action  { clientId, type: 'fold'|'check'|'call'|'bet'|'raise', amount? }
  // One action per turn, applied synchronously; the rest of the hand (street
  // advances, bot turns, showdown) plays out asynchronously over SSE, same
  // fire-and-forget contract as /deal.
  router.post('/action', (req, res) => {
    const clientId = requireClientId(req, res);
    if (!clientId) return;
    const { type, amount } = req.body || {};
    const result = room.applyAction(clientId, type, amount === undefined ? undefined : Number(amount));
    if (!result.ok) return res.status(409).json({ detail: result.error });
    res.json({ success: true });
  });

  // GET /:room/history?limit=50 - the persistent, permanent hand-history
  // ledger (services/demo/createDemoRoom.js / models/demo_hand_history.js),
  // shared across every demo room. Available without joining/seating, so
  // the Hand History panel can render as a fixture of the page itself
  // rather than only appearing once a visitor has sat down.
  router.get('/history', async (req, res) => {
    const history = await room.getHandHistory(req.query?.limit);
    res.json({ roomKey: room.roomKey, history });
  });

  return router;
}

module.exports = createDemoTableRouter;
