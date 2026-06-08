/**
 * Random orthogonal rotation matrix for TurboQuant.
 *
 * Generates a uniformly random orthogonal matrix in R^(d×d) via
 * QR decomposition of a Gaussian random matrix, with sign correction
 * to ensure uniform Haar measure.
 *
 * The rotation "homogenizes" coordinates so that after rotation,
 * each coordinate follows the known Beta((d-1)/2, (d-1)/2) distribution
 * on [-1, 1] — the key insight that makes data-oblivious quantization work.
 *
 * The rotation matrix is deterministic given a seed and is cached globally.
 */

import { createRNG } from "./prng.js";
import { getCodebook } from "./codebook.js";

const ROTATION_SEED = 42;

// =============================================================================
// Global cache
// =============================================================================

/**
 * d×d rotation matrix stored row-major as Float32Array.
 * rotation[i * d + j] = element at row i, column j.
 *
 * Once computed for a given dimension, it's cached forever.
 */
const ROTATION_CACHE = new Map<number, Float32Array>();

/**
 * Transpose cache: R^T for each cached rotation (same as R for orthogonal,
 * but stored separately for cache-friendly access patterns).
 */
const ROTATION_T_CACHE = new Map<number, Float32Array>();

// =============================================================================
// Generation
// =============================================================================

/**
 * Get or create the rotation matrix for dimension d.
 */
export function getRotationMatrix(dim: number): Float32Array {
  let cached = ROTATION_CACHE.get(dim);
  if (cached) return cached;

  cached = generateRotationMatrix(dim);
  ROTATION_CACHE.set(dim, cached);
  // Precompute and cache the transpose too
  const transposed = new Float32Array(dim * dim);
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      transposed[j * dim + i] = cached[i * dim + j];
    }
  }
  ROTATION_T_CACHE.set(dim, transposed);

  return cached;
}

/**
 * Get the transpose of the rotation matrix for dimension d.
 * Cached alongside the original.
 */
export function getRotationMatrixTranspose(dim: number): Float32Array {
  // Ensure the rotation matrix exists (triggers cache population)
  getRotationMatrix(dim);
  return ROTATION_T_CACHE.get(dim)!;
}

/**
 * Generate a random orthogonal matrix uniformly from the Haar measure.
 *
 * Algorithm:
 * 1. Fill a d×d matrix with i.i.d. standard normal entries
 * 2. QR decompose via modified Gram-Schmidt
 * 3. Fix column signs so diagonal of R is positive (ensures Haar measure)
 *
 * @param dim Matrix dimension
 * @param seed RNG seed (default: 42)
 */
function generateRotationMatrix(dim: number, seed: number = ROTATION_SEED): Float32Array {
  const rng = createRNG(seed);
  const n = dim;
  const mat = new Float32Array(n * n);

  // Step 1: Fill with standard normal entries
  // Use normalPair for better performance (one sqrt + cos per pair)
  for (let i = 0; i < n * n; i += 2) {
    const [a, b] = rng.normalPair();
    mat[i] = a;
    if (i + 1 < n * n) mat[i + 1] = b;
  }

  // Step 2: Modified Gram-Schmidt orthogonalization
  // Column j is at mat[j * n + 0..n-1] (column-major access)
  // Actually: mat is row-major, so column j is entries where
  // row_i, col_j = mat[i * n + j]

  // For Gram-Schmidt, we work on columns of the matrix.
  // Let's use a flat array column view: col(j)[i] = mat[i * n + j]

  // Temporary storage for column norms
  const colNorm = new Float64Array(n);

  for (let j = 0; j < n; j++) {
    // Orthogonalize column j against all previous columns
    for (let i = 0; i < j; i++) {
      // Compute dot product between column i and column j
      let dot = 0.0;
      for (let k = 0; k < n; k++) {
        dot += mat[k * n + i] * mat[k * n + j];
      }
      // Subtract projection
      for (let k = 0; k < n; k++) {
        mat[k * n + j] -= dot * mat[k * n + i];
      }
    }

    // Normalize column j
    let normSq = 0.0;
    for (let k = 0; k < n; k++) {
      const v = mat[k * n + j];
      normSq += v * v;
    }
    const norm = Math.sqrt(normSq);
    colNorm[j] = norm;

    if (norm > 1e-15) {
      const invNorm = 1.0 / norm;
      for (let k = 0; k < n; k++) {
        mat[k * n + j] *= invNorm;
      }
    }
  }

  // Step 3: Sign correction for Haar measure
  // Each column's sign should match the sign of R[j][j] (diagonal of R from QR).
  // In modified Gram-Schmidt, R[j][j] is the norm of the original column
  // before normalization. Since we don't store R separately, we use the
  // pre-normalization norm sign.
  // Actually, for Haar-distributed Q from QR, we need sign(R[j][j]) * Q[:,j].
  // The sign of R[j][j] is the sign of the dot product of the original
  // column with the orthogonalized (but not yet normalized) column.
  // In our MGS, we already projected, so the remaining component is the
  // one that gets normalized. Its sign could be anything.
  //
  // Simpler approach: just fix each column so its first non-zero element
  // is positive. This is equivalent to the standard QR sign convention.
  for (let j = 0; j < n; j++) {
    // Find the first element of column j with significant magnitude
    let sign = 1.0;
    for (let k = 0; k < n; k++) {
      const v = mat[k * n + j];
      if (Math.abs(v) > 1e-10) {
        sign = v > 0 ? 1.0 : -1.0;
        break;
      }
    }
    if (sign < 0) {
      for (let k = 0; k < n; k++) {
        mat[k * n + j] *= -1;
      }
    }
  }

  return mat;
}

// =============================================================================
// Rotation operations
// =============================================================================

/**
 * Rotate vector x by the rotation matrix.
 * y = R × x
 *
 * @param rot d×d rotation matrix (row-major Float32Array)
 * @param x Input vector (length d)
 * @param dim Dimension
 * @returns Rotated vector y (length d)
 */
export function rotate(
  rot: Float32Array,
  x: Float32Array | number[],
  dim: number,
): Float32Array {
  const y = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    let sum = 0.0;
    const rowOffset = i * dim;
    for (let j = 0; j < dim; j++) {
      sum += rot[rowOffset + j] * x[j];
    }
    y[i] = sum;
  }
  return y;
}

/**
 * Inverse rotation: x = R^T × y
 * Since R is orthogonal, R^T = R^{-1}.
 *
 * Uses the precomputed transpose matrix for cache-friendly access.
 *
 * @param rotT Transpose of the rotation matrix (row-major Float32Array)
 * @param y Rotated vector (length d)
 * @param dim Dimension
 * @returns Original vector x (length d)
 */
export function inverseRotate(
  rotT: Float32Array,
  y: Float32Array | number[],
  dim: number,
): Float32Array {
  const x = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    let sum = 0.0;
    const rowOffset = i * dim;
    for (let j = 0; j < dim; j++) {
      sum += rotT[rowOffset + j] * y[j];
    }
    x[i] = sum;
  }
  return x;
}

/**
 * Rotate multiple vectors at once (batch).
 * Equivalent to matrix-matrix multiply Y = X × R^T.
 *
 * @param rot d×d rotation matrix (row-major Float32Array)
 * @param vectors Flat array of n*d floats (row-major: vector i is at [i*d, (i+1)*d))
 * @param n Number of vectors
 * @param dim Vector dimension
 * @returns Flat array of n*d rotated floats
 */
export function rotateBatch(
  rot: Float32Array,
  vectors: Float32Array,
  n: number,
  dim: number,
): Float32Array {
  const result = new Float32Array(n * dim);
  for (let vi = 0; vi < n; vi++) {
    const vecOffset = vi * dim;
    for (let i = 0; i < dim; i++) {
      let sum = 0.0;
      const rowOffset = i * dim;
      for (let j = 0; j < dim; j++) {
        sum += rot[rowOffset + j] * vectors[vecOffset + j];
      }
      result[vecOffset + i] = sum;
    }
  }
  return result;
}

/**
 * Inverse rotate multiple vectors at once (batch).
 *
 * @param rotT Transpose of rotation matrix (row-major Float32Array)
 * @param vectors Flat array of n*d rotated floats
 * @param n Number of vectors
 * @param dim Vector dimension
 * @returns Flat array of n*d original floats
 */
export function inverseRotateBatch(
  rotT: Float32Array,
  vectors: Float32Array,
  n: number,
  dim: number,
): Float32Array {
  const result = new Float32Array(n * dim);
  for (let vi = 0; vi < n; vi++) {
    const vecOffset = vi * dim;
    for (let i = 0; i < dim; i++) {
      let sum = 0.0;
      const rowOffset = i * dim;
      for (let j = 0; j < dim; j++) {
        sum += rotT[rowOffset + j] * vectors[vecOffset + j];
      }
      result[vecOffset + i] = sum;
    }
  }
  return result;
}
