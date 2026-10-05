const engine = require('./cashGameDemoEngine');
const betting = require('./bettingRound');
const DemoHandHistory = require('../../models/demo_hand_history');

/**
 * Factory for a single shared, in-memory, unauthenticated demo table.
 * Instantiated once per demo variant (see cashGameDemoRoom.js - 7 seats,
 * 3 bots - and headsUpDemoRoom.js - 2 seats, no bots), so every visitor
 * hitting that route talks to the same room. Deliberately separate from
 * every real-money system in this backend:
 *  - live table STATE has no database (server restart == fresh table, by
 *    design) and no auth/JWT.
 *  - HAND HISTORY *is* database-backed (see DemoHandHistory /
 *    migrations/1745000900000_demo-hand-history.js) - that's the one
 *    thing about a demo room that's meant to be a permanent record rather
 *    than a throwaway session artifact. Every room created by this
 *    factory writes into the SAME `demo_hand_history` table, distinguished
 *    only by `roomKey` - that's what makes /cashgame-demo and /heads-up
 *    share one ledger instead of keeping two.
 *
 * Betting: a real four-street no-limit structure (preflop/flop/turn/river)
 * via services/demo/bettingRound.js, the same nextToAct/bettingRoundComplete/
 * buildPots algorithm the real live-money engine
 * (services/game/liveHandEngine.js) uses - see that file's header comment.
 * Bot seats (if any) auto-act with a short delay so a table isn't stuck
 * waiting on a bot forever.
 */

const HISTORY_TAIL_LENGTH = 50; // how many entries ride along in every SSE snapshot
const HISTORY_FETCH_LIMIT = 200; // cap for GET /:room/history

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function createDemoRoom(options) {
  const {
    roomKey,
    seatCount,
    botSeats = [],
    botNames = [],
    minPlayersToStart = 2,
    smallBlind = 1,
    bigBlind = 2,
    startBankroll = 500,
    // Seeded demo logins this room's gate page offers (e.g. cashgame-demo's
    // "Enter as Adam"/"Enter as Ach" cards). Rooms with no seeded-login UI
    // (heads-up - username-only, per its feature spec) should pass {} so
    // those names aren't needlessly reserved from real visitors picking a
    // custom username.
    seedIdentities = { adam: 'Adam', ach: 'Ach' },
    // Opt-in, off by default so every existing room (cashgame-demo) keeps
    // its current "first player to sit down is Dealer" behavior untouched.
    // When true, the very first time the table fills up to
    // minPlayersToStart (dealerSeat is still null), who deals first is
    // decided by a coin flip (engine.coinFlip()) among the seats occupied
    // at that moment instead of defaulting to whichever seat just sat
    // down. Every later hand still rotates the button positionally in
    // finishHand() exactly as before - this only changes how the very
    // first dealer is picked.
    coinFlipDealer = false,
    // Opt-in, off by default. When true, taking the seat that brings the
    // table up to minPlayersToStart immediately starts the first hand
    // (after a short pause so a coinFlipDealer animation has time to play
    // on the client) instead of waiting for the Dealer to click "Deal Next
    // Hand". Existing rooms that don't pass this keep requiring an
    // explicit deal.
    autoDealOnFull = false,
  } = options;

  // How long (ms) an autoDealOnFull room waits after the seat that fills
  // the table before actually dealing - gives the client time to play the
  // coin-flip animation (when coinFlipDealer is also set) before cards
  // start flying. Purely a pacing constant; doesn't affect game logic.
  const AUTO_DEAL_DELAY_MS = 1800;

  const room = {
    roomKey,
    seatCount,
    minPlayersToStart,
    smallBlind,
    bigBlind,
    startBankroll,

    seats: Array(seatCount).fill(null), // { identityId, username, chips, holeCards:[], isBot, busted, joinSeq }
    dealerSeat: null,
    // Monotonic counter stamped onto a seat as `joinSeq` the moment someone
    // sits down (see takeSeat()) - lets us always answer "who of the
    // currently-seated players joined first", independent of seat number,
    // for dealer-button assignment below.
    nextJoinSeq: 0,
    handNumber: 0,
    street: 'idle', // idle | preflop | flop | turn | river | showdown
    handComplete: false, // true once an uncontested (pre-showdown) fold-win has ended the hand
    completedStreet: null, // street label the most recently finished hand ended on
    pot: 0,
    communityCards: [],
    fairness: null, // { commitHash, revealSeed, verified }
    dealing: false,
    lastWinnerText: '',
    // Set once, the moment coinFlipDealer picks the first-ever Dealer (see
    // takeSeat() below) - { result: 'heads'|'tails', dealerSeat, at } so
    // the client can animate/display the toss that decided it. Rooms that
    // don't pass coinFlipDealer never touch this and it stays null.
    lastCoinFlip: null,

    // Live betting-round state (see bettingRound.js). Only meaningful
    // while street is preflop..river.
    bet: null,
    deck: [],
    cursor: 0,

    lastCompletedHand: null,

    // Persistent (DB-backed) ledger - see loadHistoryFromDb() below.
    // Newest-first, mirrors what's in `demo_hand_history` for this
    // roomKey.
    handHistory: [],
    historyLoaded: false,

    identities: new Map(
      Object.entries(seedIdentities).map(([id, username]) => [id, { username, seeded: true }])
    ),
    clientSessions: new Map(), // clientId -> identityId
    subscribers: new Map(), // clientId -> Express Response (open SSE connection)
    clientLastSeen: new Map(), // clientId -> epoch ms; used to reap dead browser sessions
    staleClientSweep: null,
  };

  function ensureBotsSeated() {
    botSeats.forEach((seatIndex, i) => {
      if (!room.seats[seatIndex]) {
        room.seats[seatIndex] = {
          identityId: null,
          username: botNames[i] || `Bot ${i + 1}`,
          chips: startBankroll,
          holeCards: [],
          isBot: true,
          busted: false,
        };
      }
    });
  }
  ensureBotsSeated();

  async function loadHistoryFromDb() {
    try {
      const rows = await DemoHandHistory.findAll({
        where: { room_key: roomKey },
        order: [['id', 'DESC']],
        limit: HISTORY_TAIL_LENGTH,
      });
      room.handHistory = rows.map((r) => r.payload);
    } catch (err) {
      // Non-fatal: the live table works fine without history pre-loaded
      // (e.g. migrations haven't run yet in a fresh dev environment) - the
      // Hand History panel just starts empty until the first hand
      // completes in-process, same as it would after a fresh restart.
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

  function occupiedSeatIndices() {
    const out = [];
    for (let i = 0; i < seatCount; i++) if (room.seats[i] && room.seats[i].chips > 0) out.push(i);
    return out;
  }

  // Dealer-button assignment rule: whoever, of a given set of occupied
  // seats, has been sitting the longest (lowest joinSeq) - i.e. "the first
  // player to join the table". Used to pick the starting dealer and to
  // replace a dealer who leaves; never random. Rotation to the next dealer
  // after a completed hand is handled separately in finishHand() by seat
  // position (the dealer's left), which is the correct rule once a dealer
  // has already been established.
  function earliestJoinedSeat(seatIndices) {
    if (seatIndices.length === 0) return null;
    return seatIndices.reduce((best, i) => (
      room.seats[best] && room.seats[best].joinSeq <= room.seats[i].joinSeq ? best : i
    ));
  }

  // The next occupied seat going clockwise ("to the left") from a given
  // seat number, wrapping around the table. Scans by absolute seat
  // position rather than an index into `occupied`, so it still finds the
  // correct next seat even when `fromSeat` itself is no longer occupied
  // (e.g. the outgoing Dealer busted out on the hand they just dealt).
  function nextOccupiedSeatAfter(fromSeat, occupied) {
    if (occupied.length === 0) return null;
    for (let offset = 1; offset <= seatCount; offset++) {
      const candidate = (fromSeat + offset) % seatCount;
      if (occupied.includes(candidate)) return candidate;
    }
    return null;
  }

  // ---- identity / session ----

  function join(clientId, kind, payload) {
    if (kind === 'seeded') {
      const identityId = payload.identityId;
      if (!room.identities.has(identityId) || !room.identities.get(identityId).seeded) {
        return { ok: false, error: 'Unknown seeded identity.' };
      }
      room.clientSessions.set(clientId, identityId);
      room.clientLastSeen.set(clientId, Date.now());
      return { ok: true, identityId, username: room.identities.get(identityId).username };
    }

    if (kind === 'custom') {
      const raw = String(payload.username || '').trim();
      if (!/^[A-Za-z0-9_]{2,20}$/.test(raw)) {
        return { ok: false, error: 'Usernames are 2-20 characters: letters, numbers, underscore.' };
      }
      const identityId = 'u_' + raw.toLowerCase();
      const existing = room.identities.get(identityId);

      const claimedByThisClient = room.clientSessions.get(clientId) === identityId;
      if (existing && !claimedByThisClient) {
        return { ok: false, error: `"${raw}" is already in use on this table - pick another username.` };
      }
      if (!existing) {
        const seededNameClash = [...room.identities.values()]
          .some((v) => v.seeded && v.username.toLowerCase() === raw.toLowerCase());
        if (seededNameClash) {
          return { ok: false, error: `"${raw}" is reserved - pick another username.` };
        }
      }
      if (!existing) {
        room.identities.set(identityId, { username: raw, seeded: false });
      }
      room.clientSessions.set(clientId, identityId);
      room.clientLastSeen.set(clientId, Date.now());
      return { ok: true, identityId, username: room.identities.get(identityId).username };
    }

    return { ok: false, error: 'Unknown join kind.' };
  }

  function identityOf(clientId) {
    const id = room.clientSessions.get(clientId);
    return id ? { id, ...room.identities.get(id) } : null;
  }

  // ---- seating ----

  function takeSeat(clientId, seatIndex) {
    const idn = identityOf(clientId);
    if (!idn) return { ok: false, error: 'Join first.' };
    if (seatIndex < 0 || seatIndex >= seatCount) return { ok: false, error: 'Invalid seat.' };
    if (room.seats[seatIndex]) return { ok: false, error: 'Seat already taken.' };
    const alreadySeated = room.seats.some((s) => s && s.identityId === idn.id);
    if (alreadySeated) return { ok: false, error: 'You already have a seat at this table.' };

    room.seats[seatIndex] = {
      identityId: idn.id,
      username: idn.username,
      chips: startBankroll,
      holeCards: [],
      isBot: false,
      busted: false,
      joinSeq: room.nextJoinSeq++,
    };

    // Dealer-button assignment: the very first player to join an empty
    // table starts as Dealer (dealerSeat is only null when nobody holds
    // the button yet, which is true exactly until this happens). From
    // then on the button only moves by explicit rotation in finishHand()
    // (to the Dealer's left after each hand) or, if the current Dealer
    // leaves the table, to whichever remaining player joined earliest -
    // see leave() below.
    //
    // coinFlipDealer rooms (heads-up vs. the house bot) replace that
    // default only at this one moment - the instant this seat brings the
    // table up to minPlayersToStart with nobody holding the button yet -
    // with a coin flip among the seats occupied right now, instead of
    // automatically crowning whoever just sat down. Every other room
    // (cashgame-demo) never sets coinFlipDealer and keeps the original
    // "first to sit is Dealer" rule exactly as it was.
    if (room.dealerSeat == null) {
      const nowOccupied = occupiedSeatIndices();
      if (coinFlipDealer && nowOccupied.length >= minPlayersToStart) {
        const toss = engine.coinFlip();
        const dealerIndex = toss.result === 'heads' ? nowOccupied[0] : nowOccupied[1] ?? nowOccupied[0];
        room.dealerSeat = dealerIndex;
        room.lastCoinFlip = {
          result: toss.result,
          dealerSeat: dealerIndex,
          dealerName: room.seats[dealerIndex] ? room.seats[dealerIndex].username : null,
          at: Date.now(),
        };
      } else {
        room.dealerSeat = seatIndex;
      }
    }

    // Never auto-deal when a player sits down, UNLESS this room opted
    // into autoDealOnFull and this seat is what just brought the table up
    // to minPlayersToStart - then start the first hand automatically
    // instead of waiting for the Dealer to click Deal Next Hand. Delayed
    // slightly so a coinFlipDealer animation on the client has time to
    // finish before cards start flying; fire-and-forget the same way
    // every other post-action hand progression in this file is.
    if (autoDealOnFull && !room.dealing && room.street === 'idle' && occupiedSeatIndices().length >= minPlayersToStart) {
      setTimeout(() => {
        dealHand().catch((err) => {
          // eslint-disable-next-line no-console
          console.error(`[demo:${roomKey}] auto-deal failed`, err);
        });
      }, AUTO_DEAL_DELAY_MS);
    }

    return { ok: true };
  }

  function rebuy(clientId) {
    const idn = identityOf(clientId);
    if (!idn) return { ok: false, error: 'Join first.' };
    const seat = room.seats.find((s) => s && s.identityId === idn.id);
    if (!seat) return { ok: false, error: 'You are not seated.' };
    if (seat.chips > 0) return { ok: false, error: 'Not busted.' };
    seat.chips = startBankroll;
    seat.busted = false;
    return { ok: true };
  }

  function heartbeat(clientId) {
    if (!room.clientSessions.has(clientId)) return { ok: false, error: 'Session is not joined.' };
    room.clientLastSeen.set(clientId, Date.now());
    return { ok: true };
  }

  async function leave(clientId, reason = 'left') {
    const identityId = room.clientSessions.get(clientId);
    if (!identityId) {
      room.clientLastSeen.delete(clientId);
      room.subscribers.delete(clientId);
      return { ok: true, removed: false };
    }

    room.clientSessions.delete(clientId);
    room.clientLastSeen.delete(clientId);
    room.subscribers.delete(clientId);

    const seatIndex = room.seats.findIndex((s) => s && !s.isBot && s.identityId === identityId);
    if (seatIndex === -1) {
      room.identities.delete(identityId);
      broadcast();
      return { ok: true, removed: false };
    }

    // If the player is currently involved in a hand, fold them first so
    // their existing contribution remains in the pot and the hand can
    // resolve normally. Otherwise simply free the seat.
    if (room.bet && ['preflop', 'flop', 'turn', 'river'].includes(room.street)) {
      const wasToAct = room.bet.toActSeatIndex === seatIndex;
      if (!room.bet.folded.has(seatIndex) && !room.bet.allIn.has(seatIndex)) {
        try {
          betting.applyAction(room.bet, seatIndexChipsAccessor(), seatIndex, 'fold');
        } catch (_) {
          room.bet.folded.add(seatIndex);
        }
      }
      room.pot = betting.totalPot(room.bet);
      room.seats[seatIndex] = null;
      if (wasToAct) room.bet.toActSeatIndex = betting.nextToAct(room.bet, seatIndex);

      // If this was the last human/player at the table, there is nobody
      // left to contest the hand. Reset the transient hand state completely
      // so a later visitor can start a fresh hand once the dealer deals it.
      if (occupiedSeatIndices().length === 0) {
        room.bet = null;
        room.pot = 0;
        room.communityCards = [];
        room.street = 'idle';
        room.handComplete = false;
        room.completedStreet = null;
        room.dealing = false;
      } else {
        // With a remaining player, finish or advance the hand without
        // requiring another request from the departed browser.
        await maybeAdvanceAfterAction();
      }
    } else {
      room.seats[seatIndex] = null;
    }

    room.identities.delete(identityId);

    // If the dealer left, the button passes to whichever remaining player
    // joined the table earliest (never at random) - i.e. the same rule
    // that assigned it in the first place, re-applied to whoever's left.
    // Do not start a hand automatically.
    if (room.dealerSeat === seatIndex) {
      room.dealerSeat = earliestJoinedSeat(occupiedSeatIndices());
    }

    broadcast();
    return { ok: true, removed: true, reason };
  }

  function startStaleClientSweep() {
    if (room.staleClientSweep) return;
    room.staleClientSweep = setInterval(() => {
      const cutoff = Date.now() - 35000;
      for (const [clientId, lastSeen] of room.clientLastSeen.entries()) {
        if (lastSeen < cutoff) {
          leave(clientId, 'heartbeat-timeout').catch((err) => {
            // eslint-disable-next-line no-console
            console.error(`[demo:${roomKey}] stale client cleanup failed`, err);
          });
        }
      }
    }, 10000);
    if (room.staleClientSweep.unref) room.staleClientSweep.unref();
  }

  startStaleClientSweep();

  // ---- broadcast ----

  function subscribe(clientId, res) {
    room.subscribers.set(clientId, res);
    room.clientLastSeen.set(clientId, Date.now());
  }
  function unsubscribe(clientId, res) {
    if (room.subscribers.get(clientId) === res) room.subscribers.delete(clientId);
  }

  function buildSnapshotFor(clientId) {
    const idn = identityOf(clientId);
    const myIdentityId = idn ? idn.id : null;
    let mySeatIndex = null;

    const seats = room.seats.map((seat, i) => {
      if (!seat) return null;
      const isMine = seat.identityId !== null && seat.identityId === myIdentityId;
      if (isMine) mySeatIndex = i;
      const folded = room.bet ? room.bet.folded.has(i) : false;
      const allIn = room.bet ? room.bet.allIn.has(i) : false;
      const revealCards = room.street === 'showdown' || isMine;
      return {
        username: seat.username,
        chips: seat.chips,
        isBot: seat.isBot,
        busted: seat.busted,
        isMine,
        folded,
        allIn,
        currentBet: room.bet ? (room.bet.streetCommitted[i] || 0) : 0,
        holeCards: revealCards ? seat.holeCards : seat.holeCards.map(() => null),
      };
    });

    return {
      roomKey,
      seatCount,
      seats,
      mySeatIndex,
      dealerSeat: room.dealerSeat,
      coinFlip: room.lastCoinFlip,
      handNumber: room.handNumber,
      street: room.street,
      handComplete: room.handComplete,
      completedStreet: room.completedStreet,
      pot: room.pot,
      communityCards: room.communityCards,
      fairness: room.fairness,
      dealing: room.dealing,
      lastWinnerText: room.lastWinnerText,
      toActSeatIndex: room.bet ? room.bet.toActSeatIndex : null,
      currentBet: room.bet ? room.bet.currentBet : 0,
      minRaise: room.bet ? room.bet.minRaise : bigBlind,
      canDeal:
        !room.dealing
        && (room.street === 'idle' || room.street === 'showdown' || room.handComplete)
        && occupiedSeatIndices().length >= minPlayersToStart
        && mySeatIndex != null
        && mySeatIndex === room.dealerSeat,
      handHistory: room.handHistory.slice(0, HISTORY_TAIL_LENGTH),
    };
  }

  function broadcast() {
    for (const [clientId, res] of room.subscribers.entries()) {
      try {
        res.write(`event: state\ndata: ${JSON.stringify(buildSnapshotFor(clientId))}\n\n`);
      } catch (err) {
        room.subscribers.delete(clientId);
      }
    }
  }

  // ---- dealing ----

  async function dealHand(clientId = null) {
    if (room.dealing) return { ok: false, error: 'Hand is already being dealt.' };
    if (room.street !== 'idle' && room.street !== 'showdown' && !room.handComplete) return { ok: false, error: 'Hand already in progress.' };
    const active = occupiedSeatIndices();
    if (active.length < minPlayersToStart) return { ok: false, error: `Need at least ${minPlayersToStart} players seated.` };

    if (clientId != null) {
      const idn = identityOf(clientId);
      if (!idn) return { ok: false, error: 'Join first.' };
      const requesterSeat = room.seats.findIndex((s) => s && !s.isBot && s.identityId === idn.id);
      if (requesterSeat === -1) return { ok: false, error: 'You are not seated.' };
      if (room.dealerSeat !== requesterSeat) return { ok: false, error: 'Only the designated Dealer can deal the next hand.' };
    }

    // Defensive fallback only - takeSeat()/leave() should already keep
    // dealerSeat pointing at an occupied seat at all times. If it's ever
    // missing anyway, fall back to the same "earliest to join" rule
    // rather than picking at random.
    if (room.dealerSeat == null || !active.includes(room.dealerSeat)) {
      room.dealerSeat = earliestJoinedSeat(active);
    }
    const dealerSeatForHand = room.dealerSeat;
    room.dealing = true;
    room.handComplete = false;
    room.completedStreet = null;
    room.lastWinnerText = '';
    broadcast();

    const dealerSeat = dealerSeatForHand;
    const dealerPos = active.indexOf(dealerSeat);
    let sbSeat;
    let bbSeat;
    if (active.length === 2) {
      sbSeat = dealerSeat;
      bbSeat = active[(dealerPos + 1) % active.length];
    } else {
      sbSeat = active[(dealerPos + 1) % active.length];
      bbSeat = active[(dealerPos + 2) % active.length];
    }

    room.handNumber += 1;
    room.street = 'preflop';
    room.communityCards = [];
    active.forEach((i) => { room.seats[i].holeCards = []; });

    room.bet = {
      order: active.slice().sort((a, b) => a - b),
      folded: new Set(),
      allIn: new Set(),
      committed: {},
      streetCommitted: {},
      actedThisStreet: new Set(),
      currentBet: 0,
      minRaise: bigBlind,
      toActSeatIndex: null,
    };
    active.forEach((i) => { room.bet.committed[i] = 0; room.bet.streetCommitted[i] = 0; });

    const sbAmt = Math.min(smallBlind, room.seats[sbSeat].chips);
    const bbAmt = Math.min(bigBlind, room.seats[bbSeat].chips);
    room.seats[sbSeat].chips -= sbAmt;
    room.seats[bbSeat].chips -= bbAmt;
    room.bet.committed[sbSeat] = sbAmt;
    room.bet.streetCommitted[sbSeat] = sbAmt;
    room.bet.committed[bbSeat] = bbAmt;
    room.bet.streetCommitted[bbSeat] = bbAmt;
    // Posting the blind used the seat's entire remaining stack -> all-in.
    if (room.seats[sbSeat].chips === 0) room.bet.allIn.add(sbSeat);
    if (room.seats[bbSeat].chips === 0) room.bet.allIn.add(bbSeat);
    room.bet.currentBet = bbAmt;
    room.pot = betting.totalPot(room.bet);
    broadcast();
    await sleep(300);

    // Commit phase: publish the hash before any card is dealt.
    const seed = engine.newSeedHex();
    const commitHash = engine.commitHashFor(seed);
    room.fairness = { commitHash, revealSeed: null, verified: null };
    broadcast();
    await sleep(400);

    room.deck = engine.hmacShuffle(engine.buildOrderedDeck(), seed);
    room.cursor = 0;
    const dealOrder = active.slice(active.indexOf(bbSeat) + 1).concat(active.slice(0, active.indexOf(bbSeat) + 1));
    room.dealOrderForHand = dealOrder;
    room.seedForHand = seed;
    room.commitHashForHand = commitHash;
    room.dealerSeatForHand = dealerSeat;
    room.sbSeatForHand = sbSeat;
    room.bbSeatForHand = bbSeat;
    room.activeForHand = active;
    for (let round = 0; round < 2; round++) {
      for (const seatIndex of dealOrder) room.seats[seatIndex].holeCards.push(room.deck[room.cursor++]);
    }
    broadcast();
    await sleep(500);

    // First to act preflop: heads-up special rule (dealer/SB acts first),
    // otherwise the seat left of the big blind. If that seat already
    // posted an all-in blind (very short stack), it has no decision left
    // to make - walk forward to the next seat that can actually act.
    let firstToAct = active.length === 2 ? sbSeat : (betting.nextToAct(room.bet, bbSeat) ?? sbSeat);
    if (room.bet.allIn.has(firstToAct)) firstToAct = betting.nextToAct(room.bet, firstToAct);
    room.bet.toActSeatIndex = firstToAct;

    room.dealing = false;
    broadcast();

    // If the betting round is already complete right out of the gate (e.g.
    // a short-stacked blind posted all-in against everyone else), or there's
    // truly only one seat left who can still act, let it play out instead
    // of waiting on an action nobody can take.
    await maybeAdvanceAfterAction();
    maybeTriggerBot();
    return { ok: true };
  }

  // ---- betting actions ----

  function applyAction(clientId, type, amount) {
    if (room.dealing) return { ok: false, error: 'Hand is being dealt.' };
    if (!room.bet || !['preflop', 'flop', 'turn', 'river'].includes(room.street)) {
      return { ok: false, error: 'No hand in progress.' };
    }
    const idn = identityOf(clientId);
    if (!idn) return { ok: false, error: 'Join first.' };
    const seatIndex = room.seats.findIndex((s) => s && s.identityId === idn.id);
    if (seatIndex === -1) return { ok: false, error: 'You are not seated.' };
    return applyActionForSeat(seatIndex, type, amount);
  }

  // Core action handler, keyed by seat index rather than clientId - shared
  // by the authenticated-by-session human path (applyAction above) and the
  // bot auto-act path (maybeTriggerBot below), since bot seats have no
  // clientId/identity to authenticate through.
  function applyActionForSeat(seatIndex, type, amount) {
    try {
      betting.applyAction(room.bet, seatIndexChipsAccessor(), seatIndex, type, amount);
    } catch (err) {
      return { ok: false, error: err.message };
    }

    room.pot = betting.totalPot(room.bet);

    // If the street isn't over yet, hand the turn to the next live seat
    // right away (synchronously) - the async work below only kicks in once
    // the round genuinely needs to resolve (street change / showdown).
    if (betting.liveNonFolded(room.bet).length > 1 && !betting.bettingRoundComplete(room.bet)) {
      room.bet.toActSeatIndex = betting.nextToAct(room.bet, seatIndex);
    }
    broadcast();
    // Fire-and-forget: the rest of the hand (street advances, showdown,
    // bot turns) plays out asynchronously and is pushed via SSE, same
    // fire-and-forget contract as POST /deal.
    maybeAdvanceAfterAction()
      .then(() => maybeTriggerBot())
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[demo:${roomKey}] post-action advance failed`, err);
      });
    return { ok: true };
  }

  // A tiny Proxy-free accessor object so bettingRound.js can read/write
  // chip counts without knowing about the seats array shape.
  function seatIndexChipsAccessor() {
    return new Proxy(
      {},
      {
        get(_target, prop) {
          const i = Number(prop);
          return room.seats[i] ? room.seats[i].chips : 0;
        },
        set(_target, prop, value) {
          const i = Number(prop);
          if (room.seats[i]) room.seats[i].chips = Math.round(value * 100) / 100;
          return true;
        },
      }
    );
  }

  async function maybeAdvanceAfterAction() {
    if (!room.bet) return;

    if (betting.liveNonFolded(room.bet).length === 1) {
      await finishHand({ uncontested: true });
      return;
    }

    if (betting.bettingRoundComplete(room.bet)) {
      if (room.street === 'river') {
        await finishHand({ uncontested: false });
        return;
      }
      await sleep(500);
      advanceStreet();
      broadcast();
      if (betting.liveActionable(room.bet).length === 0) {
        // Everyone remaining is all-in - run out the board with no more
        // betting, same animated pacing as the old auto-play version.
        while (room.street !== 'river') {
          await sleep(700);
          advanceStreet();
          broadcast();
        }
        await sleep(700);
        await finishHand({ uncontested: false });
      }
    }
  }

  function advanceStreet() {
    if (room.street === 'preflop') {
      room.cursor += 1; // burn
      room.communityCards.push(room.deck[room.cursor], room.deck[room.cursor + 1], room.deck[room.cursor + 2]);
      room.cursor += 3;
      room.street = 'flop';
    } else if (room.street === 'flop') {
      room.cursor += 1;
      room.communityCards.push(room.deck[room.cursor]);
      room.cursor += 1;
      room.street = 'turn';
    } else if (room.street === 'turn') {
      room.cursor += 1;
      room.communityCards.push(room.deck[room.cursor]);
      room.cursor += 1;
      room.street = 'river';
    }
    betting.resetStreetTracking(room.bet, bigBlind, room.dealerSeatForHand);
  }

  function maybeTriggerBot() {
    if (room.dealing) return;
    if (!room.bet || !['preflop', 'flop', 'turn', 'river'].includes(room.street)) return;
    const seatIndex = room.bet.toActSeatIndex;
    if (seatIndex == null) return;
    const seat = room.seats[seatIndex];
    if (!seat || !seat.isBot) return;

    setTimeout(() => {
      // Re-check nothing changed while we were waiting (e.g. the hand
      // already finished some other way).
      if (room.dealing || !room.bet || room.bet.toActSeatIndex !== seatIndex) return;
      // Simple, predictable bot policy: check if free, otherwise call
      // (capped to an automatic all-in if short-stacked) - never folds,
      // never raises. Keeps demo hands moving without adding bot "skill"
      // that would need its own tuning/testing.
      const toCall = room.bet.currentBet - (room.bet.streetCommitted[seatIndex] || 0);
      const type = toCall > 0 ? 'call' : 'check';
      applyActionForSeat(seatIndex, type);
    }, 650);
  }

  // ---- hand completion ----

  async function finishHand({ uncontested }) {
    const active = room.activeForHand;
    const bet = room.bet;
    const endedOnStreet = room.street;

    let winnerSeats; // seatIndex[]
    let seatWinnings = {}; // seatIndex -> amount won

    if (uncontested) {
      const winner = betting.liveNonFolded(bet)[0];
      winnerSeats = [winner];
      seatWinnings[winner] = betting.totalPot(bet);
    } else {
      const nonFolded = betting.liveNonFolded(bet);
      const evaluated = {};
      for (const s of nonFolded) {
        if (!room.seats[s]) continue;
        const { score } = engine.bestHand([...room.seats[s].holeCards, ...room.communityCards]);
        evaluated[s] = score;
      }
      const pots = betting.buildPots(bet);
      active.forEach((s) => { if (room.seats[s]) seatWinnings[s] = 0; });
      let topScoreOverall = null;
      for (const pot of pots) {
        const contenders = pot.eligibleSeats.filter((s) => evaluated[s]);
        if (contenders.length === 0) continue;
        let best = evaluated[contenders[0]];
        let winners = [contenders[0]];
        for (const s of contenders.slice(1)) {
          const cmp = engine.compareScores(evaluated[s], best);
          if (cmp > 0) { best = evaluated[s]; winners = [s]; } else if (cmp === 0) { winners.push(s); }
        }
        if (!topScoreOverall || engine.compareScores(best, topScoreOverall) > 0) topScoreOverall = best;
        const share = Math.floor((pot.amount / winners.length) * 100) / 100;
        const remainder = Math.round((pot.amount - share * winners.length) * 100) / 100;
        winners.forEach((s, i) => {
          seatWinnings[s] = Math.round((seatWinnings[s] + share + (i === 0 ? remainder : 0)) * 100) / 100;
        });
      }
      winnerSeats = Object.keys(seatWinnings).filter((s) => seatWinnings[s] > 0).map(Number);
      room.topScoreForHand = topScoreOverall;
    }

    winnerSeats.forEach((s) => {
      room.seats[s].chips = Math.round((room.seats[s].chips + seatWinnings[s]) * 100) / 100;
    });

    const potWon = betting.totalPot(bet);
    const winnerNames = winnerSeats.map((s) => room.seats[s].username).join(' & ');
    room.lastWinnerText = uncontested
      ? `${winnerNames} won ${fmtMoney(potWon)} - everyone else folded.`
      : `${winnerNames} won ${fmtMoney(potWon)} with ${engine.HAND_NAMES[room.topScoreForHand[0]]}.`;

    room.pot = 0;
    room.fairness = { commitHash: room.commitHashForHand, revealSeed: room.seedForHand, verified: engine.commitHashFor(room.seedForHand) === room.commitHashForHand };
    room.completedStreet = endedOnStreet;

    if (uncontested) {
      // Uncontested wins end mid-street: keep `street` as-is so folded
      // players' hole cards stay hidden (buildSnapshotFor only reveals at
      // street === 'showdown'), and signal completion separately.
      room.handComplete = true;
    } else {
      room.street = 'showdown';
      room.handComplete = true;
    }

    room.lastCompletedHand = {
      handNumber: room.handNumber,
      dealerSeat: room.dealerSeatForHand,
      sbSeat: room.sbSeatForHand,
      bbSeat: room.bbSeatForHand,
      activeSeats: active,
      dealOrder: room.dealOrderForHand,
      seats: active.filter((seatIndex) => room.seats[seatIndex]).map((seatIndex) => ({
        seatIndex,
        username: room.seats[seatIndex].username,
        isBot: room.seats[seatIndex].isBot,
        holeCards: room.seats[seatIndex].holeCards.slice(),
      })),
      communityCards: room.communityCards.slice(),
      potWon,
      winnerText: room.lastWinnerText,
      commitHash: room.commitHashForHand,
      revealSeed: room.seedForHand,
    };

    const historyEntry = {
      handNumber: room.handNumber,
      winnerText: room.lastWinnerText,
      pot: potWon,
      endedOnStreet,
      uncontested: !!uncontested,
      commitHash: room.commitHashForHand,
      revealSeed: room.seedForHand,
      at: new Date().toISOString(),
    };
    room.handHistory.unshift(historyEntry);
    room.handHistory = room.handHistory.slice(0, HISTORY_TAIL_LENGTH);

    // Persist to the shared, permanent ledger. Best-effort: a DB hiccup
    // should never take the live table down, since the in-memory tail
    // above already keeps this hand visible in the panel for this
    // process's lifetime.
    DemoHandHistory.create({ room_key: roomKey, hand_number: room.handNumber, payload: historyEntry }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[demo:${roomKey}] failed to persist hand history`, err.message);
    });

    active.forEach((seatIndex) => {
      const seat = room.seats[seatIndex];
      if (!seat) return;
      if (seat.chips <= 0) {
        seat.busted = true;
        if (seat.isBot) { seat.chips = startBankroll; seat.busted = false; }
      }
    });

    room.dealing = false;
    const occupiedAfterHand = occupiedSeatIndices();
    // Rotate the button to the seat immediately to the outgoing Dealer's
    // left, wrapping around occupied seats only (busted-out and empty
    // seats are skipped). Uses seat *position*, not join order - once a
    // Dealer is established, rotation is always positional, never random
    // or join-order based.
    room.dealerSeat = occupiedAfterHand.length >= minPlayersToStart
      ? nextOccupiedSeatAfter(room.dealerSeatForHand, occupiedAfterHand)
      : null;
    broadcast();
  }

  function fmtMoney(n) {
    return `$${Number(n).toFixed(2)}`;
  }

  function getLastCompletedHand() {
    return room.lastCompletedHand;
  }

  return {
    roomKey,
    seatCount,
    minPlayersToStart,
    join,
    identityOf,
    takeSeat,
    rebuy,
    heartbeat,
    leave,
    subscribe,
    unsubscribe,
    buildSnapshotFor,
    broadcast,
    dealHand,
    applyAction,
    getLastCompletedHand,
    getHandHistory,
    historyReady,
  };
}

module.exports = createDemoRoom;
