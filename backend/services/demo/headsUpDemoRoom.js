const createDemoRoom = require('./createDemoRoom');

/**
 * Heads Up Demo table - mounted at /heads-up (see
 * routers/headsUpDemoRouter.js). 2 seats: seat 1 is always occupied by the
 * house bot "Mr. Deck" (botSeats/botNames below - createDemoRoom's
 * pre-existing, generic bot-seating/auto-act infrastructure, otherwise
 * unused since cashgame-demo removed its bots), so a visitor only ever
 * needs to fill seat 0. Taking that seat both decides who deals first
 * (coinFlipDealer - a coin flip between the visitor and Mr. Deck, instead
 * of defaulting to whoever just sat down) and starts the hand
 * automatically (autoDealOnFull), so "Take Seat" alone kicks off a full
 * heads-up game against the bot with no further clicks. Both options are
 * opt-in and default to off in createDemoRoom.js, so /cashgame-demo's
 * "first to sit is Dealer, wait for an explicit Deal click" behavior is
 * untouched. Same shuffle/commit/reveal fairness pipeline and the same
 * shared hand-history ledger (roomKey: 'heads-up') as /cashgame-demo. See
 * createDemoRoom.js for everything this actually does; this file is just
 * that factory's parameters for this room.
 */
module.exports = createDemoRoom({
  roomKey: 'heads-up',
  seatCount: 2,
  botSeats: [1],
  botNames: ['Mr. Deck'],
  minPlayersToStart: 2,
  smallBlind: 1,
  bigBlind: 2,
  startBankroll: 500,
  coinFlipDealer: true,
  autoDealOnFull: true,
  // No seeded-login picker on this page (username-only, per the feature
  // spec) - so "Adam"/"Ach" aren't reserved from real visitors here the
  // way they are on /cashgame-demo.
  seedIdentities: {},
});
