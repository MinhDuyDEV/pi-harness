/**
 * Precomputed Lloyd-Max codebooks for TurboQuant.
 *
 * After random rotation, each coordinate of a unit vector on the hypersphere
 * follows Beta((d-1)/2, (d-1)/2) on [-1, 1]. The Lloyd-Max algorithm finds
 * optimal scalar quantization centroids (minimizing MSE) for this distribution.
 *
 * At d >= 256 the Beta converges to Gaussian N(0, 1/d) and the codebook
 * barely changes with dimension. The centroids below are precomputed for
 * this asymptotic regime and work for all d >= 128.
 *
 * For dimensions < 128 we fall back to a numerical Lloyd-Max solver
 * using the Beta CDF.
 */

// =============================================================================
// Precomputed centroids (asymptotic, d → ∞)
// =============================================================================

// 2-bit: 4 centroids
const CENTROIDS_2BIT: Float64Array = new Float64Array([
  -0.06672, -0.01999, 0.01999, 0.06672,
]);

// 4-bit: 16 centroids (symmetric pairs)
const CENTROIDS_4BIT: Float64Array = new Float64Array([
  -0.12066, -0.09136, -0.07143, -0.05547,
  -0.04161, -0.02900, -0.01713, -0.005668,
   0.005668, 0.01713,  0.02900,  0.04161,
   0.05547,  0.07143,  0.09136,  0.12066,
]);

// Corresponding boundaries (midpoints between consecutive centroids)
const BOUNDARIES_2BIT: Float64Array = new Float64Array([
  -0.043355, 0, 0.043355,
]);

const BOUNDARIES_4BIT: Float64Array = new Float64Array([
  -0.10601, -0.081395, -0.06345, -0.04854,
  -0.035305, -0.023065, -0.011399, 0,
  0.011399, 0.023065, 0.035305, 0.04854,
  0.06345, 0.081395, 0.10601,
]);

// =============================================================================
// Codebook interface
// =============================================================================

export interface Codebook {
  bitWidth: 2 | 3 | 4;
  centroids: Float64Array;
  boundaries: Float64Array;
  numLevels: number;
}

const CODEBOOK_CACHE = new Map<string, Codebook>();

/**
 * Get the codebook for the given bit width and dimension.
 * For d >= 128, returns precomputed asymptotic centroids.
 * For d < 128, runs the Lloyd-Max solver.
 */
export function getCodebook(bitWidth: 2 | 3 | 4, dim: number): Codebook {
  const key = `${bitWidth}_${dim}`;
  const cached = CODEBOOK_CACHE.get(key);
  if (cached) return cached;

  let codebook: Codebook;

  if (dim >= 128) {
    codebook = getPrecomputed(bitWidth);
  } else {
    codebook = solveLloydMax(bitWidth, dim);
  }

  CODEBOOK_CACHE.set(key, codebook);
  return codebook;
}

/**
 * Return the precomputed asymptotic codebook for a given bit width.
 */
function getPrecomputed(bitWidth: 2 | 3 | 4): Codebook {
  if (bitWidth === 2) {
    return {
      bitWidth: 2,
      centroids: CENTROIDS_2BIT,
      boundaries: BOUNDARIES_2BIT,
      numLevels: 4,
    };
  }
  if (bitWidth === 3) {
    // 3-bit: 8 centroids
    const cs = new Float64Array([
      -0.09501, -0.05934, -0.03338, -0.01082,
       0.01082,  0.03338,  0.05934,  0.09501,
    ]);
    const boundaries = new Float64Array(7);
    for (let i = 0; i < 7; i++) {
      boundaries[i] = (cs[i] + cs[i + 1]) / 2;
    }
    return { bitWidth: 3, centroids: cs, boundaries, numLevels: 8 };
  }
  // 4-bit
  return {
    bitWidth: 4,
    centroids: CENTROIDS_4BIT,
    boundaries: BOUNDARIES_4BIT,
    numLevels: 16,
  };
}

// =============================================================================
// Lloyd-Max solver (for low dimensions < 128)
// =============================================================================

/**
 * Numerical Lloyd-Max solver for the Beta distribution at a given dimension.
 * Uses the regularized incomplete beta function for CDF computations.
 */
function solveLloydMax(bitWidth: 2 | 3 | 4, dim: number): Codebook {
  const numLevels = 1 << bitWidth;
  const a = (dim - 1) / 2; // Beta(a, a) parameter

  // Initialize centroids spread across [-3σ, 3σ]
  const sigma = 1 / Math.sqrt(dim + 2);
  const spread = 3 * sigma;
  const centroids = new Float64Array(numLevels);
  for (let i = 0; i < numLevels; i++) {
    centroids[i] = -spread + (2 * spread * i) / (numLevels - 1);
  }

  const maxIter = 200;
  const tol = 1e-12;

  for (let iter = 0; iter < maxIter; iter++) {
    // Boundaries = midpoints
    const boundaries = new Float64Array(numLevels - 1);
    for (let i = 0; i < numLevels - 1; i++) {
      boundaries[i] = (centroids[i] + centroids[i + 1]) / 2;
    }

    const newCentroids = new Float64Array(numLevels);
    let maxChange = 0;

    for (let k = 0; k < numLevels; k++) {
      const lo = k === 0 ? -1 : boundaries[k - 1];
      const hi = k === numLevels - 1 ? 1 : boundaries[k];

      // Compute conditional mean via numerical integration
      // E[X | lo < X < hi] = ∫ x * pdf(x) dx / ∫ pdf(x) dx
      const prob = betaCdf(hi, a) - betaCdf(lo, a);

      if (prob < 1e-15) {
        newCentroids[k] = centroids[k];
      } else {
        const mean = integrateBetaX(lo, hi, a, dim);
        newCentroids[k] = mean / prob;
      }

      maxChange = Math.max(maxChange, Math.abs(newCentroids[k] - centroids[k]));
    }

    centroids.set(newCentroids);

    if (maxChange < tol) break;
  }

  const boundaries = new Float64Array(numLevels - 1);
  for (let i = 0; i < numLevels - 1; i++) {
    boundaries[i] = (centroids[i] + centroids[i + 1]) / 2;
  }

  return {
    bitWidth,
    centroids,
    boundaries,
    numLevels,
  };
}

// =============================================================================
// Beta distribution helpers (numeric)
// =============================================================================

/**
 * Regularized incomplete beta function I_x(a, b) for b = a (symmetric case).
 * Uses continued fraction representation (Lentz's method).
 */
function betaCdf(x: number, a: number): number {
  if (x <= -1) return 0;
  if (x >= 1) return 1;

  // Map x ∈ [-1, 1] to t ∈ [0, 1] for standard Beta
  const t = (x + 1) / 2;
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  return regularizedIncompleteBeta(t, a, a);
}

/**
 * Regularized incomplete beta function I_x(a, b) via continued fraction.
 * Uses Lentz's method for the continued fraction representation.
 */
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x < 0 || x > 1) return NaN;
  if (x === 0 || x === 1) return x;

  // Use symmetry: I_x(a, b) = 1 - I_{1-x}(b, a)
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }

  // Beta function: B(a, b) = Gamma(a) * Gamma(b) / Gamma(a + b)
  // Log beta for numerical stability
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

  // Lentz's continued fraction
  const f = continuedFraction(x, a, b);
  return front * f;
}

/**
 * Lentz's continued fraction for the incomplete beta function.
 */
function continuedFraction(x: number, a: number, b: number): number {
  const kMax = 200;
  const eps = 1e-30;
  const fpmin = 1e-30;

  let f = 1.0;
  let C = 1.0;
  let D = 1.0 - (a + b) * x / (a + 1);
  if (Math.abs(D) < fpmin) D = fpmin;
  D = 1.0 / D;
  f = D;

  for (let k = 1; k <= kMax; k++) {
    let numerator: number;
    let denominator: number;

    // Even step
    const k2 = 2 * k;
    numerator = k * (b - k) * x / ((a + k2 - 1) * (a + k2));
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

/** Natural log of Gamma function (Lanczos approximation) */
function lnGamma(z: number): number {
  const g = 7;
  const p = [
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

  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }

  z -= 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) {
    x += p[i] / (z + i);
  }

  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Integrate x * beta_pdf(x) over [lo, hi] using adaptive Simpson's rule.
 * The Beta PDF on [-1, 1] is: f(x) = (1-x²)^((d-3)/2) / B((d-1)/2, (d-1)/2) / 2^(d-2)
 */
function integrateBetaX(lo: number, hi: number, a: number, dim: number): number {
  const f = (x: number): number => {
    const t = (x + 1) / 2;
    if (t <= 0 || t >= 1) return 0;
    // Beta PDF on [0,1]: t^(a-1) * (1-t)^(a-1) / B(a, a)
    const logPdf = (a - 1) * Math.log(t) + (a - 1) * Math.log(1 - t) - lnBeta(a, a);
    // Transform to [-1, 1]: pdf_shifted(x) = beta.pdf((x+1)/2) / 2
    // We want x * pdf_shifted(x)
    return x * Math.exp(logPdf - Math.LN2);
  };

  return adaptiveSimpson(f, lo, hi, 1e-10, 20);
}

/** ln of Beta function B(a, b) */
function lnBeta(a: number, b: number): number {
  return lnGamma(a) + lnGamma(b) - lnGamma(a + b);
}

/**
 * Adaptive Simpson's rule for numerical integration.
 */
function adaptiveSimpson(
  f: (x: number) => number,
  a: number,
  b: number,
  tol: number,
  maxDepth: number,
): number {
  const mid = (a + b) / 2;
  const fa = f(a);
  const fb = f(b);
  const fm = f(mid);
  const whole = ((b - a) / 6) * (fa + 4 * fm + fb);
  return adaptiveSimpsonRec(f, a, b, fa, fb, fm, whole, tol, maxDepth);
}

function adaptiveSimpsonRec(
  f: (x: number) => number,
  a: number,
  b: number,
  fa: number,
  fb: number,
  fm: number,
  whole: number,
  tol: number,
  depth: number,
): number {
  const mid = (a + b) / 2;
  const m1 = (a + mid) / 2;
  const m2 = (mid + b) / 2;
  const fm1 = f(m1);
  const fm2 = f(m2);
  const left = ((mid - a) / 6) * (fa + 4 * fm1 + fm);
  const right = ((b - mid) / 6) * (fm + 4 * fm2 + fb);
  const refined = left + right;

  if (depth <= 0 || Math.abs(refined - whole) < 15 * tol) {
    return refined + (refined - whole) / 15;
  }

  return (
    adaptiveSimpsonRec(f, a, mid, fa, fm, fm1, left, tol / 2, depth - 1) +
    adaptiveSimpsonRec(f, mid, b, fm, fb, fm2, right, tol / 2, depth - 1)
  );
}
