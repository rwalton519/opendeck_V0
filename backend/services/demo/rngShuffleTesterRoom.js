const engine = require('./cashGameDemoEngine');
const DemoHandHistory = require('../../models/demo_hand_history');

/**
 * Random Shuffle Test Table - mounted at /RNG-shuffle-tester (see
 * routers/rngShuffleTesterRouter.js and server.js). Linked from the
 * opendeck.ca landing page as "Random Shuffle Test Table".
 *
 * This is NOT a poker game and deliberately isn't built on
 * createDemoRoom.js (the factory /cashgame-demo and /heads-up share):
 * that factory's whole shape - seats visitors join/leave, blinds, a
 * multi-street betting round, a single Dealer seat that alone may deal -
 * exists to support a real wagering table. None of that applies here.
 * There is nothing to bet, nobody to seat, and no reason to hide a hole
 * card from anyone, since the entire point of this page is to make the
 * shuffle's randomness fully visible and independently checkable.
 *
 * So: six fixed, unclaimable seats ("Player 1".."Player 6") exist purely
 * to give each hand's randomness somewhere recognizable to land. Anyone
 * who loads the page can click Deal - there's no join/take-seat/identity
 * step, since nobody needs to be distinguished from anyone else here.
 * Each click commits a fresh seed, shuffles with the exact same
 * HMAC-SHA256-seeded Fisher-Yates engine used by /cashgame-demo and
 * /heads-up (services/demo/cashGameDemoEngine.js - same shuffle, same
 * hand evaluator), deals two hole cards to each seat plus a full 5-card
 * board, and reveals the seed immediately - there's no adversarial timing
 * concern to protect against by delaying the reveal, since nobody is
 * acting on hidden information here the way a bettor would be. Every
 * dealt hand is written to the same permanent `demo_hand_history` table
 * the other demo rooms use (models/demo_hand_history.js), distinguished
 * by `room_key: 'rng-shuffle-tester'`, so the hand-number ledger is a
 * real, durable, independently-reproducible record rather than a
 * per-session log - which is what makes hand numbers usable as
 * identifiers for revisiting old hands, and what makes this page "a
 * central hub for a continuous running history of randomness that
 * anyone can test and verify."
 */

const SEAT_LABELS = ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5', 'Player 6'];
const SEAT_COUNT = SEAT_LABELS.length;
const HISTORY_TAIL_LENGTH = 50; // how many entries ride along in every SSE snapshot
const HISTORY_FETCH_LIMIT = 200; // cap for GET /RNG-shuffle-tester/history

function createRngShuffleTesterRoom() {
  const roomKey = 'rng-shuffle-tester';

  const room = {
    handNumber: 0,
    dealing: false,
    lastHand: null, // full payload of the most recently dealt hand (or null before the first deal)
    handHistory: [], // newest-first, capped at HISTORY_TAIL_LENGTH - see loadHistoryFromDb()
    historyLoaded: false,
    subscribers: new Map(), // clientId -> Express Response (open SSE connection)
  };

  async function loadHistoryFromDb() {
    try {
      const rows = await DemoHandHistory.findAll({
        where: { room_key: roomKey },
        order: [['id', 'DESC']],
        limit: HISTORY_TAIL_LENGTH,
      });
      room.handHistory = rows.map((r) => r.payload);
      if (room.handHistory.length) room.lastHand = room.handHistory[0];
      // hand_number always increases with id for this room_key (single
      // writer, one INSERT per dealt hand - see dealHand() below), so the
      // newest row's hand_number is exactly what the in-memory counter
      // needs to resume from after a restart.
      room.handNumber = rows.length ? rows[0].hand_number : 0;
    } catch (err) {
      // Non-fatal: the table still works with an empty history panel
      // (e.g. migrations haven't run yet in a fresh dev environment) -
      // it just starts from hand #1 instead of resuming a prior count.
      // eslint-disable-next-line no-console
      console.warn(`[demo:${roomKey}] could not load hand history from DB`, err.message);
    } finally {
      room.historyLoaded = true;
    }
  }
  const historyReady = loadHistoryFromDb();

  async function getHandHistory(limit) {
    const cap = Math.min(Math.max(Number(limit) || HISTORY_TAIL_LENGTH, 1), HISTORY_FETCH_LIMIT);
    if (cap <= room.handHistory.length) return room.handHistory.slice(0, cap);
    // Someone asked for more than the in-memory tail carries - go to the DB.
    try {
      const rows = await DemoHandHistory.findAll({
        where: { room_key: roomKey },
        order: [['id', 'DESC']],
        limit: cap,
      });
      return rows.map((r) => r.payload);
    } catch (err) {
      return room.handHistory;
    }
  }

  function subscribe(clientId, res) {
    room.subscribers.set(clientId, res);
  }
  function unsubscribe(clientId, res) {
    if (room.subscribers.get(clientId) === res) room.subscribers.delete(clientId);
  }

  function buildSnapshot() {
    return {
      roomKey,
      seatCount: SEAT_COUNT,
      seatLabels: SEAT_LABELS,
      handNumber: room.handNumber,
      dealing: room.dealing,
      canDeal: !room.dealing,
      lastHand: room.lastHand,
      handHistory: room.handHistory.slice(0, HISTORY_TAIL_LENGTH),
    };
  }

  function broadcast() {
    const payload = `event: state\ndata: ${JSON.stringify(buildSnapshot())}\n\n`;
    for (const [clientId, res] of room.subscribers.entries()) {
      try {
        res.write(payload);
      } catch (err) {
        room.subscribers.delete(clientId);
      }
    }
  }

  async function dealHand() {
    if (room.dealing) return { ok: false, error: 'A hand is already being dealt.' };
    room.dealing = true;
    broadcast(); // let every open tab flip the Deal button to "Dealing..." immediately
    try {
      await historyReady; // don't race the initial hand-number resume load on a fresh boot

      // ---- commit ----
      const seedHex = engine.newSeedHex();
      const commitHash = engine.commitHashFor(seedHex);

      // ---- shuffle + deal: 2 cards per seat, then a full 5-card board,
      // straight off the top of the same deterministic deck every
      // verifier can rebuild from `seedHex` alone (deckFromSeed-equivalent
      // via buildOrderedDeck + hmacShuffle) ----
      const deck = engine.hmacShuffle(engine.buildOrderedDeck(), seedHex);
      let cursor = 0;
      const seats = SEAT_LABELS.map((label, seatIndex) => {
        const holeCards = [deck[cursor], deck[cursor + 1]];
        cursor += 2;
        return { seatIndex, label, holeCards };
      });
      const communityCards = deck.slice(cursor, cursor + 5);

      // ---- evaluate every seat's best 5-of-7 and find the winner(s) ----
      let bestScore = null;
      for (const seat of seats) {
        const { score } = engine.bestHand([...seat.holeCards, ...communityCards]);
        seat.score = score;
        seat.handName = engine.HAND_NAMES[score[0]];
        if (!bestScore || engine.compareScores(score, bestScore) > 0) bestScore = score;
      }
      const winners = seats.filter((s) => engine.compareScores(s.score, bestScore) === 0);
      const winnerText = winners.length === 1
        ? `${winners[0].label} won with ${winners[0].handName}.`
        : `${winners.map((w) => w.label).join(' & ')} split with ${winners[0].handName}.`;

      // ---- reveal (immediate - see header comment for why there's no
      // reason to delay this the way a betting table would) ----
      room.handNumber += 1;
      const historyEntry = {
        handNumber: room.handNumber,
        seats: seats.map((s) => ({
          seatIndex: s.seatIndex,
          label: s.label,
          holeCards: s.holeCards,
          handName: s.handName,
        })),
        communityCards,
        winnerText,
        winningSeatIndices: winners.map((w) => w.seatIndex),
        commitHash,
        revealSeed: seedHex,
        verified: true,
        at: new Date().toISOString(),
      };

      room.lastHand = historyEntry;
      room.handHistory.unshift(historyEntry);
      if (room.handHistory.length > HISTORY_TAIL_LENGTH) room.handHistory.length = HISTORY_TAIL_LENGTH;

      // Fire-and-forget, same as createDemoRoom.js's equivalent write - a
      // slow/failed DB write should never block the in-memory result
      // that's already been broadcast to every open tab.
      DemoHandHistory.create({ room_key: roomKey, hand_number: room.handNumber, payload: historyEntry }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[demo:${roomKey}] failed to persist hand history`, err.message);
      });

      return { ok: true };
    } finally {
      room.dealing = false;
      broadcast();
    }
  }

  return {
    roomKey,
    subscribe,
    unsubscribe,
    buildSnapshot,
    broadcast,
    dealHand,
    getHandHistory,
  };
}

// Singleton, same convention as headsUpDemoRoom.js / cashGameDemoRoom.js -
// one shared in-memory room per process, so every visitor hitting
// /RNG-shuffle-tester sees the same running history.
module.exports = createRngShuffleTesterRoom();
