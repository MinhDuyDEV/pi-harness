/**
 * Encode pipeline: float32 vectors → packed quantized codes.
 *
 * Pipeline steps per vector:
 *   1. Normalize to unit length (store norm separately)
 *   2. Rotate by random orthogonal matrix
 *   3. TQ+ calibrate (shift + scale per coord)
 *   4. Scalar quantize against Lloyd-Max codebook
 *   5. Bit-pack codes
 *   6. Compute length-renormalized scale correction
 *
 * The stored scale = ||v|| / <x_hat, u_rot> compensates for the
 * systematic underestimation of inner products that scalar quantization
 * introduces (the reconstructed vector is a bit short).
 *
 * Architecture: The pipeline is split into phases so the caller can
 * fit TQ+ calibration between normalize+rotate and quantize+pack,
 * avoiding double rotation.
 */

import { getCodebook, Codebook } from "./codebook.js";
import { getRotationMatrix, rotateBatch } from "./rotation.js";
import { packCodes } from "./pack.js";
import { fitCalibration, TQPlusCalibration } from "./tqplus.js";

// =============================================================================
// Types
// =============================================================================

export interface PackedBatch {
  /** Packed code bytes (n * bytesPerPackedVec) */
  codes: Uint8Array;
  /** Per-vector L2 norms (n float32) */
  norms: Float32Array;
  /** Length-renormalized scale corrections (n float32) */
  scales: Float32Array;
  /** Number of vectors */
  n: number;
  /** Vector dimension */
  dim: number;
  /** Bits per coordinate */
  bitWidth: 2 | 3 | 4;
}

/** Intermediate result after normalize + rotate, before quantization */
export interface NormalizedRotatedBatch {
  /** L2 norms per vector (n float32) */
  norms: Float32Array;
  /** Rotated unit vectors, flat n*d float32 */
  rotated: Float32Array;
  /** Number of vectors */
  n: number;
  /** Dimension */
  dim: number;
}

// =============================================================================
// Phase 1: Normalize + Rotate
// =============================================================================

/**
 * Phase 1: Normalize vectors to unit length and rotate by the
 * random orthogonal matrix.
 *
 * Returns norms and rotated unit vectors separately so the caller
 * can fit TQ+ calibration between this and quantization.
 */
export function normalizeAndRotate(
  vectors: Float32Array,
  n: number,
  dim: number,
): NormalizedRotatedBatch {
  const norms = new Float32Array(n);
  const unitVectors = new Float32Array(n * dim);

  for (let vi = 0; vi < n; vi++) {
    const offset = vi * dim;
    let sumSq = 0;
    for (let d = 0; d < dim; d++) {
      sumSq += vectors[offset + d] ** 2;
    }
    const norm = Math.sqrt(sumSq);
    norms[vi] = norm;
    const invNorm = norm > 1e-10 ? 1 / norm : 0;
    for (let d = 0; d < dim; d++) {
      unitVectors[offset + d] = vectors[offset + d] * invNorm;
    }
  }

  const rot = getRotationMatrix(dim);
  const rotated = rotateBatch(rot, unitVectors, n, dim);

  return { norms, rotated, n, dim };
}

// =============================================================================
// Phase 2: Quantize + Pack (from rotated data + calibration)
// =============================================================================

/**
 * Phase 2: Quantize already-rotated unit vectors against the codebook,
 * apply TQ+ calibration, and bit-pack.
 *
 * @param rotated Rotated unit vectors from normalizeAndRotate()
 * @param norms L2 norms from normalizeAndRotate()
 * @param n Number of vectors
 * @param dim Vector dimension
 * @param bitWidth Bits per coordinate (2, 3, or 4)
 * @param calibration TQ+ calibration (must be fitted)
 * @returns Packed batch
 */
export function quantizeAndPack(
  rotated: Float32Array,
  norms: Float32Array,
  n: number,
  dim: number,
  bitWidth: 2 | 3 | 4,
  calibration: TQPlusCalibration,
): PackedBatch {
  const codebook = getCodebook(bitWidth, dim);
  const codes = new Uint8Array(n * dim);

  // Precompute inverse scale for inner product reconstruction
  const invScaleTQ = new Float32Array(dim);
  for (let d = 0; d < dim; d++) {
    invScaleTQ[d] = calibration.fitted && calibration.scale[d] !== 0
      ? 1 / calibration.scale[d]
      : 1;
  }

  const scales = new Float32Array(n); // Length-renormalized scale correction

  for (let vi = 0; vi < n; vi++) {
    const offset = vi * dim;
    let innerProdOrig = 0; // <u_rot, x_hat_orig>

    for (let d = 0; d < dim; d++) {
      const uRot = rotated[offset + d];

      // Apply TQ+ calibration when fitted
      const calibrated = calibration.fitted
        ? (uRot + calibration.shift[d]) * calibration.scale[d]
        : uRot;

      // Quantize: find the nearest centroid via binary search on boundaries
      const codeIndex = quantize(calibrated, codebook);
      codes[offset + d] = codeIndex;

      // Reconstruct in original space for scale correction:
      // x_hat_orig[d] = centroid / scale[d] - shift[d]
      const centroidCalibrated = codebook.centroids[codeIndex];
      const xHatOrig = calibration.fitted
        ? centroidCalibrated * invScaleTQ[d] - calibration.shift[d]
        : centroidCalibrated;

      innerProdOrig += uRot * xHatOrig;
    }

    // Length-renormalized scale: scale[i] = ||v|| / <x_hat, u_rot>
    if (innerProdOrig > 1e-10) {
      scales[vi] = norms[vi] / innerProdOrig;
    } else {
      scales[vi] = norms[vi];
    }
  }

  // Bit-pack
  const packed = packCodes(codes, n, dim, bitWidth);

  return {
    codes: packed,
    norms,
    scales,
    n,
    dim,
    bitWidth,
  };
}

// =============================================================================
// Full pipeline (convenience)
// =============================================================================

/**
 * Full encode pipeline: normalize → rotate → quantize → pack.
 *
 * When no existingCalibration is provided, fits TQ+ calibration from
 * the batch data and commits it (returned in the calibration result).
 *
 * For finer-grained control (e.g., pre-fitting calibration), use
 * normalizeAndRotate() + quantizeAndPack() separately.
 *
 * @returns Packed batch + the calibration that was used/fitted
 */
export function encode(
  vectors: Float32Array,
  n: number,
  dim: number,
  bitWidth: 2 | 3 | 4,
  existingCalibration?: TQPlusCalibration | null,
): { batch: PackedBatch; calibration: TQPlusCalibration } {
  // Phase 1: Normalize + Rotate
  const { norms, rotated } = normalizeAndRotate(vectors, n, dim);

  // Fit calibration if needed
  let calibration: TQPlusCalibration;
  if (existingCalibration && existingCalibration.fitted) {
    calibration = existingCalibration;
  } else {
    calibration = fitCalibration(rotated, n, dim);
  }

  // Phase 2: Quantize + Pack
  const batch = quantizeAndPack(rotated, norms, n, dim, bitWidth, calibration);

  return { batch, calibration };
}

// =============================================================================
// Quantization Helpers
// =============================================================================

/**
 * Quantize a single scalar value against the codebook.
 * Binary search on boundaries to find nearest centroid index.
 */
export function quantize(value: number, codebook: Codebook): number {
  const boundaries = codebook.boundaries;
  let lo = 0;
  let hi = boundaries.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (value < boundaries[mid]) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  return Math.min(lo, codebook.numLevels - 1);
}

/**
 * Dequantize a scalar code index to its centroid value.
 */
export function dequantize(codeIndex: number, codebook: Codebook): number {
  return codebook.centroids[codeIndex];
}

// =============================================================================
// Single-vector convenience
// =============================================================================

/**
 * Encode a single vector. See encode() for details.
 */
export function encodeOne(
  vector: Float32Array | number[],
  dim: number,
  bitWidth: 2 | 3 | 4,
  existingCalibration?: TQPlusCalibration | null,
): { batch: PackedBatch & { n: 1 }; calibration: TQPlusCalibration } {
  const vec = vector instanceof Float32Array ? vector : new Float32Array(vector);
  const { batch, calibration } = encode(vec, 1, dim, bitWidth, existingCalibration);
  return {
    batch: { ...batch, n: 1 as const },
    calibration,
  };
}
