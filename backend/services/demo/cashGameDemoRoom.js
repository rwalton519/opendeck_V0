const createDemoRoom = require('./createDemoRoom');

/**
 * Cash Game Demo table - mounted at /cashgame-demo (see
 * routers/cashGameDemoRouter.js, which does
 * `require('../services/demo/cashGameDemoRoom')` - this file was missing
 * entirely, so that require threw "Cannot find module" and took the whole
 * router (and, since server.js requires it at the top level, the whole
 * process) down before it ever got a chance to serve /join, /take-seat,
 * /stream, etc. That's why taking a seat failed: there was no room object
 * for the router to call `.takeSeat()` on in the first place. createDemoRoom.js
 * already does the real work correctly (assigns the identity's username and
 * a full `startBankroll` stack to the seat) - this file just supplies this
 * room's parameters, the same way headsUpDemoRoom.js does for /heads-up.
 *
 * 7 seats, all open to real players only - no house bots. Any visitor can
 * take a seat by joining with a seeded identity ("Adam"/"Ach") or a
 * custom username; the table simply waits (idle) until enough real
 * players are seated to deal a hand.
 *
 * REMOVED: this table used to auto-seat 3 house bots ("Ace"/"Nova"/"Duke")
 * at seats 2/4/6 via botSeats/botNames below, so the table was never
 * empty. Bot-player fixtures have been removed per product decision - the
 * table now only ever seats real players. createDemoRoom.js's bot-support
 * code (isBot handling, auto-act on bot turns) is untouched and still
 * generic infrastructure; it simply never activates now that no room
 * passes botSeats/botNames.
 */
module.exports = createDemoRoom({
  roomKey: 'cashgame-demo',
  seatCount: 7,
  botSeats: [],
  botNames: [],
  minPlayersToStart: 2,
  smallBlind: 1,
  bigBlind: 2,
  startBankroll: 500,
  seedIdentities: { adam: 'Adam', ach: 'Ach' },
});
