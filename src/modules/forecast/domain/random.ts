/** A uniform draw in [0, 1). */
export type Random = () => number;

/**
 * A small seeded generator (mulberry32). The forecast is a simulation, and the
 * same ledger on the same day must give the same figures on every reload, so
 * nothing in it draws from `Math.random`.
 */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A 32-bit seed from a string (FNV-1a), so a seed can be named by what it is for. */
export function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
