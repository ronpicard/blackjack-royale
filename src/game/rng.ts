/**
 * Deterministic randomness: mulberry32, a small, fast 32-bit PRNG. Nothing in `src/game/` ever
 * calls `Math.random` or `Date`, so the same seed always replays the same game.
 */

/** Mulberry32: returns a generator of numbers in `[0, 1)`, deterministic for a given seed. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A fresh 32-bit seed for a new round, from the browser's CSPRNG (never called from `src/game/`). */
export function randomSeed(): number {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0]!
}
