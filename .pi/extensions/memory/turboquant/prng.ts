/**
 * Seeded PRNG for deterministic random number generation.
 *
 * Uses splitmix32 to seed a xoshiro128** state.
 * xoshiro128** is a fast, high-quality 32-bit PRNG.
 */

// =============================================================================
// xoshiro128**
// =============================================================================

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

function xoshiro128ss(state: Uint32Array): () => number {
  return () => {
    let s0 = state[0];
    let s1 = state[1];
    let s2 = state[2];
    let s3 = state[3];

    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7) >>> 0, 9) >>> 0;
    const t = (s1 << 9) >>> 0;

    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;

    s2 ^= t;
    s3 = rotl(s3, 11);

    state[0] = s0;
    state[1] = s1;
    state[2] = s2;
    state[3] = s3;

    return (result >>> 0);
  };
}

/**
 * Splitmix32 — used to seed the xoshiro128** state from a single u32 seed.
 */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    z = (z ^ (z >>> 16)) >>> 0;
    return z;
  };
}

// =============================================================================
// Seeded PRNG interface
// =============================================================================

export interface SeededRNG {
  /** Uniform float in [0, 1) */
  uniform(): number;
  /** Standard normal via Box-Muller transform */
  normal(): number;
  /** Pair of independent standard normals */
  normalPair(): [number, number];
}

/**
 * Create a seeded pseudo-random number generator.
 */
export function createRNG(seed: number): SeededRNG {
  const sm = splitmix32(seed);
  const state = new Uint32Array([sm(), sm(), sm(), sm()]);
  const xoro = xoshiro128ss(state);

  return {
    uniform(): number {
      return xoro() / 4294967296;
    },
    normal(): number {
      const u1 = this.uniform();
      const u2 = this.uniform();
      return Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
    },
    normalPair(): [number, number] {
      const u1 = this.uniform();
      const u2 = this.uniform();
      const r = Math.sqrt(-2 * Math.log(u1 || 1e-10));
      return [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
    },
  };
}
