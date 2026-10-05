import type { VerificationResult, VerificationStep } from "../../types/fairness";
import { hmacSha256Bytes, readUint32BE, sha256Hex } from "./webCrypto";

/**
 * Byte-for-byte port of backend/services/rng/deckService.js - the real
 * commit/shuffle/cut/reveal engine behind /rng and /game (and, once the
 * live cash-game hand-dealing integration lands, real cash tables). Any
 * change to that file must be mirrored here.
 */

const SUITS = ["S", "H", "D", "C"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function freshDeck(): string[] {
  const deck: string[] = [];
  for (const rank of RANKS) for (const suit of SUITS) deck.push(`${rank}${suit}`);
  return deck;
}

/** Deterministic byte stream: HMAC-SHA256(seed, "0"), HMAC-SHA256(seed, "1"), ... concatenated. */
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

/** Unbiased Fisher-Yates with rejection sampling to avoid modulo bias - matches seededShuffle(). */
export async function seededShuffle(deck: string[], seed: string): Promise<string[]> {
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

export function cutDeck(deck: string[], cutIndex: number): string[] {
  const n = deck.length;
  const idx = ((cutIndex % n) + n) % n;
  return deck.slice(idx).concat(deck.slice(0, idx));
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export interface PracticeVerifyInput {
  seed: string;
  deckCommit: string;
  cutIndex: number;
  deckOriginal: string[];
  deckAfterCut: string[];
}

/**
 * Full independent verification, run entirely client-side: recompute
 * sha256(seed), re-run the exact seeded shuffle, apply the revealed cut
 * index, and compare against both the original commitment and the actual
 * post-cut deck the server used.
 */
export async function verifyPracticeGame(input: PracticeVerifyInput): Promise<VerificationResult> {
  const steps: VerificationStep[] = [];

  const recomputedCommit = await sha256Hex(input.seed);
  const commitMatches = recomputedCommit === input.deckCommit;
  steps.push({
    label: "Deck commit matches revealed seed",
    passed: commitMatches,
    detail: commitMatches ? undefined : `expected ${input.deckCommit}, got ${recomputedCommit}`,
  });

  const recomputedDeck = await seededShuffle(freshDeck(), input.seed);
  const deckMatches = arraysEqual(recomputedDeck, input.deckOriginal);
  steps.push({
    label: "Pre-cut shuffle matches the revealed deck",
    passed: deckMatches,
  });

  const recomputedAfterCut = cutDeck(recomputedDeck, input.cutIndex);
  const cutMatches = arraysEqual(recomputedAfterCut, input.deckAfterCut);
  steps.push({
    label: "Post-cut deck matches what was actually used",
    passed: cutMatches,
  });

  const verified = steps.every((s) => s.passed);
  return { verified, steps };
}
