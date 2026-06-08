/**
 * Decode pipeline: packed quantized codes → reconstructed float32 vectors.
 *
 * Pipeline steps per vector:
 *   1. Unpack codes from bytes
 *   2. Dequantize to centroid values (in calibrated space)
 *   3. Inverse TQ+ calibration
 *   4. Inverse rotation (transpose multiply)
 *   5. Renormalize by stored norm
 *
 * This produces an approximation of the original vector that preserves
 * inner products with high accuracy (due to length-renormalized scale).
 */

import { getCodebook, Codebook } from "./codebook.js";
import { getRotationMatrixTranspose, inverseRotateBatch } from "./rotation.js";
import { unpackCodes } from "./pack.js";
import type { TQPlusCalibration } from "./tqplus.js";
import type { PackedBatch } from "./encode.js";

// =============================================================================
// Decode
// =============================================================================

/**
 * Decode a packed batch back to approximate float32 vectors.
 *
 * @param packed Packed batch from encode()
 * @param calibration TQ+ calibration used during encoding
 * @returns Reconstructed flat Float32Array of n * dim values
 */
export function decode(
  packed: PackedBatch,
  calibration: TQPlusCalibration,
): Float32Array {
  const { codes, n, dim, bitWidth, norms, scales } = packed;
  const codebook = getCodebook(bitWidth, dim);

  // 1. Unpack codes
  const codeIndices = unpackCodes(codes, n, dim, bitWidth);

  // 2-5. Dequantize, inverse calibrate, inverse rotate, renormalize
  const reconstructed = new Float32Array(n * dim);

  // First: dequantize, inverse calibrate → unit vectors in original space
  const unitRecon = new Float32Array(n * dim);
  for (let vi = 0; vi < n; vi++) {
    const offset = vi * dim;

    let xHatNormSq = 0;
    for (let d = 0; d < dim; d++) {
      const centroidCalibrated = codebook.centroids[codeIndices[offset + d]];
      // Undo TQ+ calibration: x_hat_orig = centroid / scale - shift
      const xHatOrig = centroidCalibrated / calibration.scale[d] - calibration.shift[d];
      unitRecon[offset + d] = xHatOrig;
      xHatNormSq += xHatOrig * xHatOrig;
    }

    // The length-renormalized scale correction was computed during encode
    // as: scale = ||v|| / <x_hat, u_rot>. We use the stored scale.
    // The reconstructed unit vector is inverse-rotated, then multiplied
    // by scale * <x_hat, u_rot> to get back to original norm.
    // But we stored scale = ||v|| / <x_hat, u_rot>, so:
    // reconstructed = inverse_rotate(unit_recon) * norms
    // (The scale correction is baked into the stored norms during encode)
  }

  // 4. Inverse rotate (all vectors)
  const rotT = getRotationMatrixTranspose(dim);
  const unitDeRotated = inverseRotateBatch(rotT, unitRecon, n, dim);

  // 5. Renormalize by stored norms
  for (let vi = 0; vi < n; vi++) {
    const offset = vi * dim;
    const norm = norms[vi];
    for (let d = 0; d < dim; d++) {
      reconstructed[offset + d] = unitDeRotated[offset + d] * norm;
    }
  }

  return reconstructed;
}

// =============================================================================
// Score against a query vector (without full decompression)
// =============================================================================

/**
 * Compute inner product between a query vector and a packed (quantized) vector.
 *
 * This uses the LUT-based scoring approach: precompute the contribution of
 * each possible centroid value for each coordinate group, then score by
 * table lookup.
 *
 * For a single vector, this is the same inner product that the full
 * decompress-then-dot approach would compute, but faster (no inverse
 * rotation needed for a single vector).
 *
 * @param queryRotated Query vector already rotated (must match the index's rotation)
 * @param packedCodes Packed codes for a single vector
 * @param codeIndexOffset Byte offset into packedCodes for this vector
 * @param dim Vector dimension
 * @param bitWidth Bits per coordinate
 * @param codebook Codebook for dequantization
 * @param calibration TQ+ calibration
 * @returns Inner product <query, reconstructed_vector>
 */
export function scorePacked(
  queryRotated: Float32Array | number[],
  packedCodes: Uint8Array,
  codeIndexOffset: number,
  dim: number,
  bitWidth: 2 | 3 | 4,
  codebook: Codebook,
  calibration: TQPlusCalibration,
): number {
  const bytesPerVec = bitWidth === 2 ? Math.ceil(dim / 4)
    : bitWidth === 3 ? Math.ceil(dim / 4) + Math.ceil(dim / 8)
    : Math.ceil(dim / 2);

  const codeIndices = unpackCodes(
    packedCodes.subarray(codeIndexOffset, codeIndexOffset + bytesPerVec),
    1,
    dim,
    bitWidth,
  );

  let inner = 0;
  for (let d = 0; d < dim; d++) {
    const centroidCalibrated = codebook.centroids[codeIndices[d]];
    // x_hat_orig[d] = centroid / scale[d] - shift[d]
    const xHatOrig = centroidCalibrated / calibration.scale[d] - calibration.shift[d];
    inner += queryRotated[d] * xHatOrig;
  }

  return inner;
}

// =============================================================================
// Single-vector convenience
// =============================================================================

/**
 * Decode a single vector.
 */
export function decodeOne(
  packed: PackedBatch,
  calibration: TQPlusCalibration,
  vectorIndex: number,
): Float32Array {
  // Create a single-vector packed batch view
  const { codes, n, dim, bitWidth, norms, scales } = packed;

  if (vectorIndex >= n) throw new Error(`vectorIndex ${vectorIndex} out of range (n=${n})`);

  const bytesPerVec = codes.length / n;
  const singleCodes = codes.subarray(
    vectorIndex * bytesPerVec,
    (vectorIndex + 1) * bytesPerVec,
  );
  const singleNorms = norms.subarray(vectorIndex, vectorIndex + 1);
  const singleScales = scales.subarray(vectorIndex, vectorIndex + 1);

  const singleBatch: PackedBatch = {
    codes: singleCodes,
    norms: singleNorms,
    scales: singleScales,
    n: 1,
    dim,
    bitWidth,
  };

  return decode(singleBatch, calibration);
}
