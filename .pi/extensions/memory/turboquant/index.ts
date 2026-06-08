/**
 * TurboQuant — data-oblivious vector quantization for TypeScript.
 *
 * Compresses high-dimensional float32 vectors to 2-4 bits per coordinate
 * with near-optimal distortion, using Google Research's TurboQuant algorithm.
 *
 * No training data required. Works on any embedding model.
 *
 * Pipeline:
 *   normalize → random rotation → TQ+ calibration → scalar quantize → bit-pack
 *
 * Key features:
 *   - 8x compression at 4-bit (384-dim: 1536B → 192B)
 *   - 16x compression at 2-bit (384-dim: 1536B → 96B)
 *   - TQ+ per-coordinate calibration for better recall at low dimensions
 *   - Deterministic rotation (seed-based, cached globally)
 *   - Length-renormalized scale correction for unbiased inner products
 */

import { getCodebook, Codebook } from "./codebook.js";
import {
  getRotationMatrix,
  getRotationMatrixTranspose,
  rotate,
  rotateBatch,
  inverseRotate,
  inverseRotateBatch,
} from "./rotation.js";
import { packCodes, unpackCodes, packedByteLength } from "./pack.js";
import {
  encode,
  encodeOne,
  normalizeAndRotate,
  quantizeAndPack,
  type PackedBatch,
} from "./encode.js";
import { decode, decodeOne, scorePacked } from "./decode.js";
import {
  fitCalibration,
  fitCalibrationBatch,
  applyCalibrationForward,
  applyCalibrationInverse,
  type TQPlusCalibration,
} from "./tqplus.js";

// =============================================================================
// TurboQuant class — stateful compressor with managed calibration
// =============================================================================

export class TurboQuant {
  private _dim: number;
  private _bitWidth: 2 | 3 | 4;
  private _calibration: TQPlusCalibration | null = null;
  private _calibrationCommitted = false;

  /**
   * @param dim Vector dimension (must be > 0, ideally multiple of 2)
   * @param bitWidth Bits per coordinate (2, 3, or 4). 4 recommended for best quality.
   */
  constructor(dim: number, bitWidth: 2 | 3 | 4 = 4) {
    this._dim = dim;
    this._bitWidth = bitWidth;
  }

  // =========================================================================
  // Properties
  // =========================================================================

  get dim(): number { return this._dim; }
  get bitWidth(): 2 | 3 | 4 { return this._bitWidth; }
  get calibration(): TQPlusCalibration | null { return this._calibration; }
  get isCalibrationCommitted(): boolean { return this._calibrationCommitted; }

  /** Compression ratio vs float32 (e.g. 8x for 4-bit) */
  get compressionRatio(): number {
    return 32 / this._bitWidth;
  }

  /** Packed byte length per vector */
  get bytesPerVector(): number {
    return packedByteLength(1, this._dim, this._bitWidth);
  }

  // =========================================================================
  // Compress / decompress
  // =========================================================================

  /**
   * Compress a batch of vectors.
   *
   * On the first call, fits TQ+ calibration from the batch data.
   * Subsequent calls reuse the same calibration for cross-batch consistency.
   *
   * @param vectors Flat Float32Array of n * dim values
   * @param n Number of vectors
   * @returns Packed batch
   */
  compress(vectors: Float32Array, n: number): PackedBatch {
    // Phase 1: Normalize + Rotate (we need rotated data for calibration)
    const { norms, rotated } = normalizeAndRotate(vectors, n, this._dim);

    // Fit or reuse calibration
    if (!this._calibrationCommitted) {
      this._calibration = fitCalibration(rotated, n, this._dim);
      this._calibrationCommitted = this._calibration.fitted;
    }

    // Phase 2: Quantize + Pack with committed calibration
    return quantizeAndPack(rotated, norms, n, this._dim, this._bitWidth, this._calibration!);
  }

  /**
   * Compress a single vector.
   */
  compressOne(vector: Float32Array | number[]): PackedBatch {
    const vec = vector instanceof Float32Array ? vector : new Float32Array(vector);
    return this.compress(vec, 1);
  }

  /**
   * Decompress a packed batch back to approximate float32 vectors.
   */
  decompress(packed: PackedBatch): Float32Array {
    if (!this._calibration) {
      throw new Error(
        "Cannot decompress: no TQ+ calibration available. " +
        "Compress at least one batch first, or set calibration manually.",
      );
    }
    return decode(packed, this._calibration);
  }

  /**
   * Decompress a single packed vector.
   */
  decompressOne(packed: PackedBatch, vectorIndex: number): Float32Array {
    if (!this._calibration) {
      throw new Error("Cannot decompress: no TQ+ calibration available.");
    }
    return decodeOne(packed, this._calibration, vectorIndex);
  }

  /**
   * Compute inner product between a query and a single packed vector
   * without fully decompressing.
   */
  score(query: Float32Array | number[], packedCodes: Uint8Array, vectorIndex: number): number {
    if (!this._calibration) {
      throw new Error("Cannot score: no TQ+ calibration available.");
    }

    const codebook = getCodebook(this._bitWidth, this._dim);
    const rot = getRotationMatrix(this._dim);

    // Rotate query once
    const queryVec = query instanceof Float32Array ? query : new Float32Array(query);
    const queryRotated = rotate(rot, queryVec, this._dim);

    const offset = vectorIndex * this.bytesPerVector;

    return scorePacked(
      queryRotated,
      packedCodes,
      offset,
      this._dim,
      this._bitWidth,
      codebook,
      this._calibration,
    );
  }

  // =========================================================================
  // Calibration management
  // =========================================================================

  /**
   * Manually set TQ+ calibration (e.g., loaded from disk).
   */
  setCalibration(calibration: TQPlusCalibration): void {
    this._calibration = calibration;
    this._calibrationCommitted = calibration.fitted;
  }

  /**
   * Fit TQ+ calibration from a batch of raw vectors and commit it.
   * All subsequent compress() calls will use this calibration.
   */
  fitAndCommitCalibration(vectors: Float32Array, n: number): void {
    const { rotated } = normalizeAndRotate(vectors, n, this._dim);
    this._calibration = fitCalibration(rotated, n, this._dim);
    this._calibrationCommitted = this._calibration.fitted;
  }

  /**
   * Reset calibration (forces re-fit on next compress).
   */
  resetCalibration(): void {
    this._calibration = null;
    this._calibrationCommitted = false;
  }
}

// =============================================================================
// Module-level cache
// =============================================================================

const INSTANCE_CACHE = new Map<string, TurboQuant>();

/**
 * Get or create a globally-cached TurboQuant instance.
 */
export function getTurboQuant(dim: number, bitWidth: 2 | 3 | 4 = 4): TurboQuant {
  const key = `${dim}_${bitWidth}`;
  let instance = INSTANCE_CACHE.get(key);
  if (!instance) {
    instance = new TurboQuant(dim, bitWidth);
    INSTANCE_CACHE.set(key, instance);
  }
  return instance;
}

// =============================================================================
// Re-exports
// =============================================================================

export type { PackedBatch } from "./encode.js";
export type { TQPlusCalibration } from "./tqplus.js";
export type { Codebook } from "./codebook.js";

export {
  getCodebook,
  getRotationMatrix,
  getRotationMatrixTranspose,
  rotate,
  rotateBatch,
  inverseRotate,
  inverseRotateBatch,
  packCodes,
  unpackCodes,
  packedByteLength,
  encode,
  encodeOne,
  decode,
  decodeOne,
  scorePacked,
  normalizeAndRotate,
  quantizeAndPack,
  fitCalibration,
  fitCalibrationBatch,
  applyCalibrationForward,
  applyCalibrationInverse,
};
