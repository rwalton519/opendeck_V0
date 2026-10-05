const express = require('express');
const room = require('../services/demo/rngShuffleTesterRoom');

/**
 * HTTP surface for the Random Shuffle Test Table (/RNG-shuffle-tester -
 * see server.js). Deliberately much smaller than routers/demoTableRouter.js
 * (shared by /cashgame-demo and /heads-up): there's no join/take-seat/
 * heartbeat/leave/action/rebuy here, because there's no identity to
 * establish and nothing to act on - see services/demo/rngShuffleTesterRoom.js
 * for why. Just: watch the table over SSE, click Deal, and read the
 * permanent hand-history ledger.
 */
const router = express.Router();

function requireClientId(req, res) {
  const clientId = String(req.query?.clientId || req.body?.clientId || '');
  if (!clientId || clientId.length > 100) {
    res.status(400).json({ detail: 'clientId is required.' });
    return null;
  }
  return clientId;
}

// GET /RNG-shuffle-tester/stream?clientId=... - SSE, same pattern as the
// other demo tables (see demoTableRouter.js's header comment for why SSE
// rather than a websocket upgrade). `clientId` only distinguishes one open
// tab's connection from another for subscribe/unsubscribe bookkeeping -
// there's no per-client personalization of the snapshot itself, since
// everyone watching this table sees exactly the same thing.
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
  // waiting on someone else's next Deal click to see the table.
  res.write(`event: state\ndata: ${JSON.stringify(room.buildSnapshot())}\n\n`);

  const keepAlive = setInterval(() => {
    try { res.write(': keep-alive\n\n'); } catch (err) { clearInterval(keepAlive); }
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    room.unsubscribe(clientId, res);
  });
});

// POST /RNG-shuffle-tester/deal - anyone may click Deal, from any tab, at
// any time the table isn't already mid-deal. No clientId/identity check:
// unlike a real table there's no Dealer seat to gate this behind.
router.post('/deal', async (req, res) => {
  try {
    const result = await room.dealHand();
    if (!result.ok) return res.status(409).json({ detail: result.error });
    res.json({ success: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[demo:rng-shuffle-tester] dealHand failed', err);
    res.status(500).json({ detail: 'Unable to deal the hand.' });
  }
});

// GET /RNG-shuffle-tester/history?limit=50 - the persistent, permanent
// hand-history ledger (models/demo_hand_history.js, room_key
// 'rng-shuffle-tester'). Available with no prior interaction, so the
// running history is there the moment the page loads, per this table's
// whole purpose as "a central hub for a continuous running history of
// randomness."
router.get('/history', async (req, res) => {
  const history = await room.getHandHistory(req.query?.limit);
  res.json({ roomKey: room.roomKey, history });
});

module.exports = router;
