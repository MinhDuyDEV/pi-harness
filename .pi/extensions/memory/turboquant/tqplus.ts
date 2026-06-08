/**
 * TQ+ Per-coordinate calibration.
 *
 * After random rotation, each coordinate should follow the canonical
 * Beta((d-1)/2, (d-1)/2) marginal on [-1, 1]. In practice, anisotropic
 * data leaves residual deviation per coordinate, and the shared Lloyd-Max
 * codebook then mis-fits.
 *
 * TQ+ corrects this with two free parameters per coordinate — a `shift`
 * and a `scale` — chosen to map the empirical 5/95% quantiles of that
 * coordinate onto the canonical Beta marginal's 5/95% quantiles:
 *
 *   u_calibrated[d] = (u_rot[d] + shift[d]) * scale_tq[d]
 *
 * Quantization runs on u_calibrated; the query side applies the inverse:
 *   q_calib[d] = q_rot[d] / scale_tq[d] - shift[d]
 *
 * Net effect: same kernel, same codebook, better-matched quantization.
 *
 * The calibration is fitted on the first batch of vectors (once enough
 * samples are available) and frozen for subsequent adds.
 */

import { getCodebook } from "./codebook.js";

/** Minimum samples needed for reliable quantile estimates */
const TQPLUS_MIN_SAMPLES = 1000;

/** Quantile pair for fitting */
const P_LO = 0.05;
const P_HI = 0.95;

// =============================================================================
// Types
// =============================================================================

export interface TQPlusCalibration {
  /** Per-coordinate shift (length dim) */
  shift: Float32Array;
  /** Per-coordinate scale (length dim) */
  scale: Float32Array;
  /** Whether this calibration has been fitted (vs identity) */
  fitted: boolean;
}

// =============================================================================
// Streaming quantile estimator (P² algorithm)
// =============================================================================

/**
 * Streaming quantile estimator using the P² algorithm (Jain & Chlamtac).
 *
 * Maintains 5 markers for each quantile without storing all data points.
 * O(1) memory per quantile, O(1) update time.
 */
class P2Quantile {
  private n = 0;
  private markers: Float64Array; // [n, ns, dns, q, dq] for each marker
  private readonly p: number; // Target quantile (e.g., 0.05)
  private readonly initialBuf: number[] = [];
  private readonly initialBufSize: number;

  /**
   * @param p Target quantile (0..1)
   * @param initialBufferSize Buffer data until this many points, then initialize P²
   */
  constructor(p: number, initialBufferSize: number = 20) {
    this.p = p;
    this.initialBufSize = initialBufferSize;
    // 5 markers: each has n (index), ns (desired index), dns (desired increment)
    this.markers = new Float64Array(5 * 5); // 25 entries
  }

  /** Add a data point */
  add(value: number): void {
    this.n++;

    if (this.n <= this.initialBufSize) {
      this.initialBuf.push(value);
      return;
    }

    if (this.n === this.initialBufSize + 1) {
      // Initialize markers from the buffer
      this.initialBuf.sort((a, b) => a - b);
      const buf = this.initialBuf;

      // Marker 0: minimum
      // Marker 1: p/2 quantile
      // Marker 2: p quantile
      // Marker 3: (1+p)/2 quantile
      // Marker 4: maximum
      const m = this.markers;
      const half = this.initialBufSize - 1;

      m[0] = 0; // n[0]
      m[5] = 0; // ns[0]
      m[10] = buf[0]; // q[0] (min)
      m[15] = 0; // dq unused for marker 0

      m[1] = Math.round(2 * this.p * half);
      m[6] = 2 * this.p * this.initialBufSize;
      m[11] = buf[Math.round(m[1])];
      m[16] = m[6] - m[1];

      m[2] = Math.round(4 * this.p * half);
      m[7] = 4 * this.p * this.initialBufSize;
      m[12] = buf[Math.round(m[2])];
      m[17] = m[7] - m[2];

      m[3] = Math.round(2 * (1 + this.p) * half);
      m[8] = 2 * (1 + this.p) * this.initialBufSize;
      m[13] = buf[Math.round(m[3])];

      m[4] = half;
      m[9] = this.initialBufSize - 1;
      m[14] = buf[half]; // max

      this.initialBuf.length = 0;
      return;
    }

    // Find which cell contains the new value and update counts
    const m = this.markers;
    let k = -1;

    if (value < m[10]) {
      k = 0;
      m[10] = value;
    } else if (value < m[11]) {
      k = 0;
    } else if (value < m[12]) {
      k = 1;
    } else if (value < m[13]) {
      k = 2;
    } else if (value < m[14]) {
      k = 3;
    } else {
      k = 3;
      m[14] = value;
    }

    // Increment marker positions for markers > k
    for (let i = k + 1; i < 5; i++) {
      m[i]++; // n[i]
    }

    // Update desired positions
    for (let i = 0; i < 5; i++) {
      m[5 + i] += m[15 + i]; // ns[i] += dns[i]
    }

    // Adjust interior markers if needed
    for (let i = 1; i < 4; i++) {
      const dq = m[5 + i] - m[i]; // desired - actual
      if ((dq >= 1 && m[i + 1] - m[i] > 1) || (dq <= -1 && m[i - 1] - m[i] < -1)) {
        const d = Math.sign(dq);
        const qOld = m[10 + i];
        const qNext = m[10 + i + d];
        const qPrev = m[10 + i - d];
        const nNext = m[i + d];
        const nPrev = m[i - d];
        const nCurr = m[i];

        // Parabolic interpolation
        const qNew = qOld + d * (qNext - qPrev) / (nNext - nPrev) * (nCurr - nPrev + d);

        // Adjust qNew to stay within neighboring markers
        const qAdj = Math.max(Math.min(qNew, qNext), qPrev);
        m[10 + i] = qAdj;
        m[i] += d; // n[i] += d
      }
    }
  }

  /** Get the current quantile estimate */
  estimate(): number | null {
    if (this.n === 0) return null;
    if (this.n <= this.initialBufSize) {
      // Not enough data for P²; return approximate from buffer
      const sorted = [...this.initialBuf].sort((a, b) => a - b);
      const idx = Math.floor((sorted.length - 1) * this.p);
      return sorted[idx] ?? sorted[sorted.length - 1];
    }
    // Marker 2 (index 12 in the flat array) holds the p-quantile
    return this.markers[12];
  }
}

// =============================================================================
// Online quantile tracker per coordinate
// =============================================================================

/**
 * Tracks streaming quantiles for each coordinate.
 * Uses P² algorithm for O(1) memory per coordinate.
 */
class CoordQuantileTracker {
  private trackers: P2Quantile[];

  constructor(dim: number, p: number) {
    this.trackers = [];
    for (let d = 0; d < dim; d++) {
      this.trackers.push(new P2Quantile(p));
    }
  }

  add(rotated: Float32Array | number[], dim: number): void {
    for (let d = 0; d < dim; d++) {
      this.trackers[d].add(rotated[d]);
    }
  }

  getQuantile(d: number): number | null {
    return this.trackers[d].estimate();
  }

  getSampleCount(): number {
    return this.trackers[0]
      ? ((this.trackers[0] as unknown as { n: number }).n as number)
      : 0;
  }
}

// =============================================================================
// TQ+ Calibration fitting
// =============================================================================

/**
 * Fit TQ+ calibration parameters from a batch of rotated vectors.
 *
 * For each coordinate d:
 *   scale = (qc_hi - qc_lo) / (qe_hi - qe_lo)
 *   shift = qc_lo / scale - qe_lo
 *
 * Where qc_lo, qc_hi are the canonical Beta marginal's P_LO/P_HI quantiles,
 * and qe_lo, qe_hi are the empirical quantiles from the data.
 *
 * Falls back to identity calibration when the batch is too small or
 * a coordinate is degenerate (constant).
 *
 * @param rotated Flat array of n*d rotated floats
 * @param n Number of vectors
 * @param dim Vector dimension
 * @returns Calibration parameters
 */
export function fitCalibration(
  rotated: Float32Array,
  n: number,
  dim: number,
): TQPlusCalibration {
  const shift = new Float32Array(dim);
  const scale = new Float32Array(dim).fill(1.0);

  if (n < TQPLUS_MIN_SAMPLES) {
    return { shift, scale, fitted: false };
  }

  const a = (dim - 1) / 2;

  // Compute canonical Beta marginal's quantiles
  const qcLo = betaQuantile(P_LO, a);
  const qcHi = betaQuantile(P_HI, a);
  const qcSpan = qcHi - qcLo;

  // Compute empirical quantiles per coordinate
  const loIdx = Math.floor(n * P_LO);
  const hiIdx = Math.min(Math.ceil(n * P_HI - 1), n - 1);

  for (let d = 0; d < dim; d++) {
    // Extract all values for this coordinate and sort
    const coord = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      coord[i] = rotated[i * dim + d];
    }
    coord.sort();

    const qeLo = coord[loIdx];
    const qeHi = coord[hiIdx];
    const qeSpan = qeHi - qeLo;

    if (qeSpan > 1e-6) {
      scale[d] = qcSpan / qeSpan;
      shift[d] = qcLo / scale[d] - qeLo;
    }
    // else: leave as (shift=0, scale=1) for this coord
  }

  return { shift, scale, fitted: true };
}

/**
 * Fit calibration from a single large batch (pre-sorted approach).
 * More accurate than streaming but requires all data upfront.
 */
export function fitCalibrationBatch(
  rotatedBatch: Float32Array,
  n: number,
  dim: number,
): TQPlusCalibration {
  return fitCalibration(rotatedBatch, n, dim);
}

// =============================================================================
// Apply calibration
// =============================================================================

/**
 * Apply forward calibration to a rotated vector.
 * u_calibrated[d] = (u_rot[d] + shift[d]) * scale[d]
 */
export function applyCalibrationForward(
  rotated: Float32Array | number[],
  shift: Float32Array,
  scale: Float32Array,
  dim: number,
): Float32Array {
  const calibrated = new Float32Array(dim);
  for (let d = 0; d < dim; d++) {
    calibrated[d] = (rotated[d] + shift[d]) * scale[d];
  }
  return calibrated;
}

/**
 * Apply inverse calibration to a query before scoring.
 * q_calibrated[d] = q_rot[d] / scale[d] - shift[d]
 */
export function applyCalibrationInverse(
  queryRotated: Float32Array | number[],
  shift: Float32Array,
  scale: Float32Array,
  dim: number,
): Float32Array {
  const calibrated = new Float32Array(dim);
  for (let d = 0; d < dim; d++) {
    calibrated[d] = queryRotated[d] / scale[d] - shift[d];
  }
  return calibrated;
}

// =============================================================================
// Quantile function for Beta distribution
// =============================================================================

/**
 * Compute quantile of the Beta(a, a) distribution on [-1, 1].
 * Uses inverse transform: find x such that CDF(x) = p.
 *
 * Maps the Beta(a, a) on [0, 1] to [-1, 1] via x = 2t - 1.
 */
function betaQuantile(p: number, a: number): number {
  if (p <= 0) return -1;
  if (p >= 1) return 1;

  // We're computing on [-1, 1] where the distribution is symmetric.
  // Beta(a, a) on [0, 1] has CDF F(t). Our CDF on [-1, 1] is F((x+1)/2).
  // So for quantile p, we find t = F^{-1}(p) and map x = 2t - 1.
  const t = inverseIncBeta(p, a, a);
  return 2 * t - 1;
}

/**
 * Inverse of the regularized incomplete beta function I^{-1}_x(a, b).
 * Newton-Raphson with the continued fraction Beta CDF.
 *
 * This is the quantile function for the Beta distribution.
 */
function inverseIncBeta(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;

  // Initial guess using the normal approximation
  let x: number;
  if (a >= 1 && b >= 1) {
    // Use logistic approximation
    const mu = a / (a + b);
    const sigma = Math.sqrt(mu * (1 - mu) / (a + b + 1));
    x = mu + sigma * normInv(p);
  } else {
    x = a / (a + b);
  }

  // Newton-Raphson: x_{n+1} = x_n - (I_x(a,b) - p) / pdf_x(x)
  for (let iter = 0; iter < 20; iter++) {
    if (x <= 0) { x = 1e-10; }
    if (x >= 1) { x = 1 - 1e-10; }

    const f = regularizedIncompleteBeta(x, a, b) - p;
    if (Math.abs(f) < 1e-14) break;

    // Beta PDF
    const lnPdf = (a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lnBetaFn(a, b);
    const pdf = Math.exp(lnPdf);

    if (pdf < 1e-30) break;

    x -= f / pdf;
  }

  return Math.max(0, Math.min(1, x));
}

// Need these from codebook but can't import (circular isn't an issue, but they're private)
// Let me just reference the same lnGamma implementation

const LN_2PI = Math.log(2 * Math.PI);
const LANCZOS_G = 7;
const LANCZOS_P = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

function lnGammaFn(z: number): number {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGammaFn(1 - z);
  }
  z -= 1;
  let x = LANCZOS_P[0];
  for (let i = 1; i < LANCZOS_G + 2; i++) {
    x += LANCZOS_P[i] / (z + i);
  }
  const t = z + LANCZOS_G + 0.5;
  return 0.5 * LN_2PI + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function lnBetaFn(a: number, b: number): number {
  return lnGammaFn(a) + lnGammaFn(b) - lnGammaFn(a + b);
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x < 0 || x > 1) return NaN;
  if (x === 0 || x === 1) return x;

  // Use symmetry for efficiency
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }

  const lnBeta = lnBetaFn(a, b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

  // Lentz's continued fraction
  const f = betaContinuedFraction(x, a, b);
  return front * f;
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const kMax = 200;
  const fpmin = 1e-30;

  let f = 1.0;
  let C = 1.0;
  let D = 1.0 - (a + b) * x / (a + 1);
  if (Math.abs(D) < fpmin) D = fpmin;
  D = 1.0 / D;
  f = D;

  for (let k = 1; k <= kMax; k++) {
    const k2 = 2 * k;

    // Even step
    let numerator = k * (b - k) * x / ((a + k2 - 1) * (a + k2));
    D = 1.0 + numerator * D;
    if (Math.abs(D) < fpmin) D = fpmin;
    C = 1.0 + numerator / C;
    if (Math.abs(C) < fpmin) C = fpmin;
    D = 1.0 / D;
    f *= D * C;

    // Odd step
    numerator = -(a + k) * (a + b + k) * x / ((a + k2) * (a + k2 + 1));
    D = 1.0 + numerator * D;
    if (Math.abs(D) < fpmin) D = fpmin;
    C = 1.0 + numerator / C;
    if (Math.abs(C) < fpmin) C = fpmin;
    D = 1.0 / D;
    const delta = D * C;
    f *= delta;

    if (Math.abs(delta - 1.0) < 1e-12) break;
  }

  return f;
}

/**
 * Inverse normal CDF (quantile function).
 * Uses the rational approximation (Peter Acklam).
 */
function normInv(p: number): number {
  if (p <= 0) return -8; // Approximate -inf
  if (p >= 1) return 8;  // Approximate +inf

  const a = [
    -3.969683028665376e1, 2.209460984245205e2,
    -2.759285104469687e2, 1.383577518672690e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2,
    -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1,
    -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1,
    2.445134137142996, 3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let x: number;

  if (p < pLow) {
    // Rational approximation for lower region
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    // Rational approximation for central region
    const q = p - 0.5;
    const r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
      / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    // Rational approximation for upper region
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  return x;
}
