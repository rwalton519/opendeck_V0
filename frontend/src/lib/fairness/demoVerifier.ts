import type { DemoCard, DemoHandRecord, VerificationResult, VerificationStep } from "../../types/fairness";
import { readUint32BE } from "./webCrypto";

/**
 * Byte-for-byte port of backend/services/demo/cashGameDemoEngine.js. Any
 * change to that file's shuffle/deal logic must be mirrored here or this
 * verifier will (correctly) start reporting real hands as unverified.
 */

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS = ["s", "h", "d", "c"];

function buildOrderedDeck(): DemoCard[] {
  const deck: DemoCard[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

/** sha256(seedHex-as-bytes) - matches Node's sha256HexOfHex (digests the decoded seed bytes, not the hex text). */
async function commitHashFor(seedHex: string): Promise<string> {
  const bytes = hexToBytes(seedHex);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/**
 * HMAC-SHA256-seeded Fisher-Yates - matches hmacShuffle() exactly: one
 * HMAC(seedBytes, "shuffle:<i>") call per swap index, first 4 bytes as a
 * big-endian uint32 mod (i+1). Note: unlike the "practice" engine, this has
 * NO rejection sampling - that's a real, small modulo-bias in the source
 * implementation, faithfully reproduced here rather than "fixed", since the
 * whole point is to check the actual algorithm that ran, not a nicer one.
 */
async function hmacShuffle(deck: DemoCard[], seedHex: string): Promise<DemoCard[]> {
  const arr = deck.slice();
  const keyBytes = hexToBytes(seedHex);
  for (let i = arr.length - 1; i > 0; i--) {
    const sig = await hmacRawKeyBytes(keyBytes, `shuffle:${i}`);
    const rand = readUint32BE(sig, 0);
    const j = rand % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** HMAC-SHA256 with a raw byte-array key (not a UTF-8 string key) - needed because the demo engine's key is `Buffer.from(seedHex, 'hex')`, i.e. the decoded seed bytes. */
async function hmacRawKeyBytes(keyBytes: Uint8Array<ArrayBuffer>, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

function cardEquals(a: DemoCard, b: DemoCard): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

function cardsEqual(a: DemoCard[], b: DemoCard[]): boolean {
  return a.length === b.length && a.every((c, i) => cardEquals(c, b[i]));
}

function formatCards(cards: DemoCard[]): string {
  return cards.map((c) => `${c.rank}${c.suit}`).join(" ");
}

/**
 * Independently reconstructs the entire hand from `hand.revealSeed` alone -
 * the shuffle, the seating-order deal, and the flop/turn/river burns - and
 * compares every card against what the server reported was actually dealt.
 * Mirrors services/demo/cashGameDemoRoom.js's dealHand() dealing logic.
 */
export async function verifyDemoHand(hand: DemoHandRecord): Promise<VerificationResult> {
  const steps: VerificationStep[] = [];

  // Step 1: commitment check - sha256(seed) must equal the hash published
  // BEFORE any card was dealt.
  const recomputedCommit = await commitHashFor(hand.revealSeed);
  const commitMatches = recomputedCommit === hand.commitHash;
  steps.push({
    label: "Deck commit matches revealed seed",
    passed: commitMatches,
    detail: commitMatches ? undefined : `expected ${hand.commitHash}, got ${recomputedCommit}`,
  });

  // Step 2: re-run the exact same seeded shuffle.
  const deck = await hmacShuffle(buildOrderedDeck(), hand.revealSeed);

  // Step 3: reconstruct dealing order from public info (dealerSeat + active
  // seats), independently of the `dealOrder` the server reported, then
  // cross-check the two agree.
  const { activeSeats, dealerSeat } = hand;
  const dealerPos = activeSeats.indexOf(dealerSeat);
  let sbSeat: number;
  let bbSeat: number;
  if (activeSeats.length === 2) {
    sbSeat = dealerSeat;
    bbSeat = activeSeats[(dealerPos + 1) % activeSeats.length];
  } else {
    sbSeat = activeSeats[(dealerPos + 1) % activeSeats.length];
    bbSeat = activeSeats[(dealerPos + 2) % activeSeats.length];
  }
  const bbPos = activeSeats.indexOf(bbSeat);
  const recomputedDealOrder = activeSeats.slice(bbPos + 1).concat(activeSeats.slice(0, bbPos + 1));
  const dealOrderMatches =
    sbSeat === hand.sbSeat &&
    bbSeat === hand.bbSeat &&
    recomputedDealOrder.length === hand.dealOrder.length &&
    recomputedDealOrder.every((s, i) => s === hand.dealOrder[i]);
  steps.push({
    label: "Seating/blind/deal order matches table rules",
    passed: dealOrderMatches,
  });

  // Step 4: deal hole cards in the same 2-rounds-robin order, and community
  // cards with the same burn pattern, then compare every card.
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
  for (const seat of hand.seats) {
    const expected = holeCardsBySeat.get(seat.seatIndex) ?? [];
    if (!cardsEqual(expected, seat.holeCards)) {
      holeCardsMatch = false;
      mismatchedSeats.push(seat.seatIndex);
    }
  }
  steps.push({
    label: "Hole cards match for every seat",
    passed: holeCardsMatch,
    detail: holeCardsMatch ? undefined : `seat(s) ${mismatchedSeats.join(", ")} did not match the recomputed deal`,
  });

  const streets = [
    { burn: 1, deal: 3 },
    { burn: 1, deal: 1 },
    { burn: 1, deal: 1 },
  ];
  const recomputedCommunity: DemoCard[] = [];
  for (const s of streets) {
    cursor += s.burn;
    for (let k = 0; k < s.deal; k++) recomputedCommunity.push(deck[cursor++]);
  }
  const communityMatches = cardsEqual(recomputedCommunity, hand.communityCards);
  steps.push({
    label: "Community cards (flop/turn/river) match",
    passed: communityMatches,
    detail: communityMatches
      ? undefined
      : `recomputed ${formatCards(recomputedCommunity)}, table reported ${formatCards(hand.communityCards)}`,
  });

  const verified = steps.every((s) => s.passed);
  return { verified, steps };
}
