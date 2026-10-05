import type { DemoCard, LiveHandRecord, VerificationResult, VerificationStep } from "../../types/fairness";
import { hmacSha256Bytes, readUint32BE, sha256Hex } from "./webCrypto";

/**
 * Verifier for real live cash-game hands (services/game/liveHandEngine.js).
 * This is the union of the other two verifiers, not a third algorithm:
 *
 *  - Shuffle + cut: identical to practiceVerifier.ts (the real
 *    services/rng/deckService.js pipeline - live hands use the audited
 *    engine, not the demo's simplified one).
 *  - Dealing-order reconstruction: identical approach to demoVerifier.ts
 *    (derive seating/blind/deal order from dealerSeatIndex + activeSeats,
 *    which are public, then deal off the recomputed deck and compare).
 *
 * Two things a real table needs that the demo/practice verifiers don't:
 *
 *  - Folded players' hole cards are legitimately never revealed (the
 *    backend withholds them - see liveHandEngine.js's finishHand), so this
 *    verifier only checks hole cards for seats the record actually
 *    includes, and reports the rest as "not shown" rather than a mismatch.
 *  - A hand that ended before the river only has 0/3/4/5 community cards
 *    on record - this verifier deals exactly that many rather than always
 *    expecting a full board.
 */

const SUITS = ["S", "H", "D", "C"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function freshDeck(): string[] {
  const deck: string[] = [];
  for (const rank of RANKS) for (const suit of SUITS) deck.push(`${rank}${suit}`);
  return deck;
}

function makeSeededByteStream(seed: string) {
  let counter = 0;
  let buffer: Uint8Array = new Uint8Array(0);
  let offset = 0;

  async function refill() {
    buffer = await hmacSha256Bytes(seed, String(counter));
    counter += 1;
    offset = 0;
  }

  return {
    async nextUint32(): Promise<number> {
      if (offset + 4 > buffer.length) await refill();
      const value = readUint32BE(buffer, offset);
      offset += 4;
      return value;
    },
  };
}

async function seededShuffle(deck: string[], seed: string): Promise<string[]> {
  const cards = deck.slice();
  const stream = makeSeededByteStream(seed);
  for (let i = cards.length - 1; i > 0; i--) {
    const range = i + 1;
    const limit = Math.floor(0xffffffff / range) * range;
    let rand = await stream.nextUint32();
    while (rand >= limit) rand = await stream.nextUint32();
    const j = rand % range;
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function cutDeck(deck: string[], cutIndex: number): string[] {
  const n = deck.length;
  const idx = ((cutIndex % n) + n) % n;
  return deck.slice(idx).concat(deck.slice(0, idx));
}

/** deckService cards are rank+suit concatenated ("AS","10H") - matches liveHandEngine.js's own parseCard(). */
function parseCard(cardStr: string): DemoCard {
  const suit = cardStr.slice(-1);
  const rank = cardStr.slice(0, -1);
  return { rank, suit: suit.toLowerCase() };
}

function cardEquals(a: DemoCard, b: DemoCard): boolean {
  return a.rank === b.rank && a.suit.toLowerCase() === b.suit.toLowerCase();
}

function cardsEqual(a: DemoCard[], b: DemoCard[]): boolean {
  return a.length === b.length && a.every((c, i) => cardEquals(c, b[i]));
}

function formatCards(cards: DemoCard[]): string {
  return cards.map((c) => `${c.rank}${c.suit}`).join(" ") || "(none shown)";
}

export async function verifyLiveHand(hand: LiveHandRecord): Promise<VerificationResult> {
  const steps: VerificationStep[] = [];

  // Step 1: commitment check.
  const recomputedCommit = await sha256Hex(hand.revealSeed);
  const commitMatches = recomputedCommit === hand.deckCommit;
  steps.push({
    label: "Deck commit matches revealed seed",
    passed: commitMatches,
    detail: commitMatches ? undefined : `expected ${hand.deckCommit}, got ${recomputedCommit}`,
  });

  // Step 2: re-run the real shuffle + cut.
  const shuffled = await seededShuffle(freshDeck(), hand.revealSeed);
  const deck = cutDeck(shuffled, hand.cutIndex).map(parseCard);

  // Step 3: reconstruct seating/blind/deal order from public info.
  const { activeSeats, dealerSeatIndex } = hand;
  const dealerPos = activeSeats.indexOf(dealerSeatIndex);
  let sbSeat: number;
  let bbSeat: number;
  if (activeSeats.length === 2) {
    sbSeat = dealerSeatIndex;
    bbSeat = activeSeats[(dealerPos + 1) % activeSeats.length];
  } else {
    sbSeat = activeSeats[(dealerPos + 1) % activeSeats.length];
    bbSeat = activeSeats[(dealerPos + 2) % activeSeats.length];
  }
  const bbPos = activeSeats.indexOf(bbSeat);
  const recomputedDealOrder = activeSeats.slice(bbPos + 1).concat(activeSeats.slice(0, bbPos + 1));
  const dealOrderMatches =
    sbSeat === hand.sbSeatIndex &&
    bbSeat === hand.bbSeatIndex &&
    recomputedDealOrder.length === hand.dealOrder.length &&
    recomputedDealOrder.every((s, i) => s === hand.dealOrder[i]);
  steps.push({
    label: "Seating/blind/deal order matches table rules",
    passed: dealOrderMatches,
  });

  // Step 4: deal hole cards (all active seats get cards, folded or not -
  // they just might not be shown in the record), then compare only the
  // seats the record actually reveals.
  let cursor = 0;
  const holeCardsBySeat = new Map<number, DemoCard[]>();
  recomputedDealOrder.forEach((seatIndex) => holeCardsBySeat.set(seatIndex, []));
  for (let round = 0; round < 2; round++) {
    for (const seatIndex of recomputedDealOrder) {
      holeCardsBySeat.get(seatIndex)!.push(deck[cursor++]);
    }
  }

  let holeCardsMatch = true;
  const mismatchedSeats: number[] = [];
  let anyShown = false;
  for (const seat of hand.seats) {
    if (seat.holeCards.length === 0) continue; // folded, never revealed - nothing to check
    anyShown = true;
    const expected = holeCardsBySeat.get(seat.seatIndex) ?? [];
    if (!cardsEqual(expected, seat.holeCards)) {
      holeCardsMatch = false;
      mismatchedSeats.push(seat.seatIndex);
    }
  }
  steps.push({
    label: "Hole cards match for every seat that showed cards",
    passed: holeCardsMatch,
    detail: !anyShown
      ? "No hole cards were shown for this hand (everyone folded before showdown) - nothing to check here."
      : holeCardsMatch
        ? undefined
        : `seat(s) ${mismatchedSeats.join(", ")} did not match the recomputed deal`,
  });

  // Step 5: community cards - deal exactly as many as the record shows
  // (a hand that ended preflop/on the flop won't have a full board).
  const streets = [
    { burn: 1, deal: 3 },
    { burn: 1, deal: 1 },
    { burn: 1, deal: 1 },
  ];
  const recomputedCommunity: DemoCard[] = [];
  for (const s of streets) {
    if (recomputedCommunity.length >= hand.communityCards.length) break;
    cursor += s.burn;
    for (let k = 0; k < s.deal; k++) recomputedCommunity.push(deck[cursor++]);
  }
  const communityMatches = cardsEqual(recomputedCommunity, hand.communityCards);
  steps.push({
    label: "Community cards match",
    passed: communityMatches,
    detail: communityMatches
      ? undefined
      : `recomputed ${formatCards(recomputedCommunity)}, table reported ${formatCards(hand.communityCards)}`,
  });

  const verified = steps.every((s) => s.passed);
  return { verified, steps };
}
