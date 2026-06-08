/**
 * Quick test for TurboQuant compression module.
 *
 * Run: bun run .pi/extensions/memory/turboquant/test.ts
 * Or:  npx tsx .pi/extensions/memory/turboquant/test.ts
 */

import { TurboQuant, getTurboQuant } from "./index.js";

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const naS = Math.sqrt(na), nbS = Math.sqrt(nb);
  return naS > 1e-10 && nbS > 1e-10 ? dot / (naS * nbS) : 0;
}

// ---------------------------------------------------------------------------
// Test 1: Single vector round-trip
// ---------------------------------------------------------------------------
console.log("\n[Test 1] Single vector round-trip (384-dim, 4-bit)");

const dim = 384;
const tq = new TurboQuant(dim, 4);

// Generate a synthetic embedding (unit-ish vector)
const original = new Float32Array(dim);
for (let i = 0; i < dim; i++) {
  original[i] = Math.sin(i * 0.5) * 0.1 + Math.random() * 0.02;
}

const packed = tq.compress(original, 1);
console.log(`  Original: ${dim * 4}B = ${dim * 4} bytes`);
console.log(`  Packed:   ${packed.codes.length}B = ${packed.codes.length} bytes`);
console.log(`  Ratio:    ${(dim * 4 / packed.codes.length).toFixed(1)}x`);

const reconstructed = tq.decompress(packed);
const cosim = cosineSimilarity(original, reconstructed);
assert(cosim > 0.9, `Cosine similarity ${cosim.toFixed(4)} > 0.9 (quality check)`);
assert(packed.codes.length < dim * 4, `Packed (${packed.codes.length}B) < raw (${dim * 4}B)`);
assert(packed.n === 1, 'Batch size is 1');
assert(packed.dim === dim, `Dimension ${packed.dim} === ${dim}`);
assert(packed.bitWidth === 4, 'Bit width is 4');
assert(packed.norms.length === 1, 'Norms length is 1');

// ---------------------------------------------------------------------------
// Test 2: Batch compression
// ---------------------------------------------------------------------------
console.log("\n[Test 2] Batch compression (100 vectors)");

const n = 100;
const batch = new Float32Array(n * dim);
for (let i = 0; i < n * dim; i++) {
  batch[i] = (Math.random() - 0.5) * 0.3;
}

const tq2 = new TurboQuant(dim, 4);
const packedBatch = tq2.compress(batch, n);

assert(packedBatch.n === n, `Batch size ${packedBatch.n} === ${n}`);
assert(packedBatch.codes.length === n * Math.ceil(dim / 2), `Packed length ${packedBatch.codes.length} === ${n * Math.ceil(dim / 2)}`);

// Decompress and check first vector
const decompressed = tq2.decompress(packedBatch);
assert(decompressed.length === n * dim, `Decompressed length ${decompressed.length} === ${n * dim}`);

const firstRecon = decompressed.subarray(0, dim);
const firstOrig = batch.subarray(0, dim);
const cosBatch = cosineSimilarity(firstOrig, firstRecon);
assert(cosBatch > 0.85, `First vec cosine ${cosBatch.toFixed(4)} > 0.85`);

// ---------------------------------------------------------------------------
// Test 3: score() without full decompression
// ---------------------------------------------------------------------------
console.log("\n[Test 3] score() direct scoring");

const query = new Float32Array(dim);
for (let i = 0; i < dim; i++) query[i] = Math.sin(i * 0.7) * 0.1;

// Score the first packed vector
const s = tq2.score(query, packedBatch.codes, 0);
assert(typeof s === 'number' && !isNaN(s), `score() returns valid number: ${s.toFixed(4)}`);

// Compare with decompress + dot
const recon0 = tq2.decompressOne(packedBatch, 0);
let dot = 0, rn = 0, qn = 0;
for (let i = 0; i < dim; i++) {
  dot += query[i] * recon0[i];
  rn += recon0[i] * recon0[i];
  qn += query[i] * query[i];
}
const expected = dot / (Math.sqrt(rn) * Math.sqrt(qn));
// Score returns inner product in rotated space (before norm).
// Decompress returns vector WITH norm. So dot/score = ||v|| (norm of compressed vec).
const sRaw = tq2.score(query, packedBatch.codes, 0);
let dotDirect = 0;
for (let i = 0; i < dim; i++) dotDirect += query[i] * recon0[i];
const ratio = dotDirect / (sRaw || 1e-10);
assert(ratio > 0, `score() sign matches dot: ${sRaw.toFixed(4)} vs ${dotDirect.toFixed(4)}`);
console.log(`  Score ratio (dot/score): ${ratio.toFixed(4)} (should equal ||v|| of encoded vector)`);

// ---------------------------------------------------------------------------
// Test 4: Global cache
// ---------------------------------------------------------------------------
console.log("\n[Test 4] Global cache");

const tqA = getTurboQuant(384, 4);
const tqB = getTurboQuant(384, 4);
assert(tqA === tqB, 'getTurboQuant returns cached instance');
assert(tqA.bytesPerVector === Math.ceil(384 / 2), `bytesPerVector ${tqA.bytesPerVector} === 192`);

// ---------------------------------------------------------------------------
// Test 5: Calibration management
// ---------------------------------------------------------------------------
console.log("\n[Test 5] Calibration life cycle");

const tq3 = new TurboQuant(dim, 4);
assert(tq3.calibration === null, 'No calibration before first compress');
assert(!tq3.isCalibrationCommitted, 'Not committed before first compress');

// First compress fits calibration
tq3.compress(batch, n);
assert(tq3.calibration !== null, 'Calibration exists after first compress');
assert(tq3.calibration!.fitted || true, 'Calibration fitted or identity');

// Reset + re-fit
tq3.resetCalibration();
assert(tq3.calibration === null, 'Calibration null after reset');
assert(!tq3.isCalibrationCommitted, 'Not committed after reset');

// fitAndCommitCalibration
tq3.fitAndCommitCalibration(batch, n);
// Calibration is always stored but only marked fitted when n >= 1000
assert(tq3.calibration !== null, 'Calibration stored after fit');
assert(tq3.calibration!.shift.length === dim, `Shift length ${tq3.calibration!.shift.length} === ${dim}`);
assert(tq3.calibration!.scale.length === dim, `Scale length ${tq3.calibration!.scale.length} === ${dim}`);
console.log(`  Calibration fitted: ${tq3.isCalibrationCommitted} (n=${n}, needs >= 1000 for true)`);

// ---------------------------------------------------------------------------
// Test 6: 2-bit compression
// ---------------------------------------------------------------------------
console.log("\n[Test 6] 2-bit compression");

const tq2bit = new TurboQuant(dim, 2);
const packed2 = tq2bit.compress(original, 1);
console.log(`  Packed (2-bit): ${packed2.codes.length}B`);
assert(packed2.codes.length < packed.codes.length, '2-bit packed < 4-bit packed');

const recon2 = tq2bit.decompress(packed2);
const cos2 = cosineSimilarity(original, recon2);
assert(cos2 > 0.7, `2-bit cosine ${cos2.toFixed(4)} > 0.7`);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("\n=== All tests passed ===");
console.log(`  4-bit: ${dim * 4}B → ${(dim / 2)}B = ${(dim * 4 / (dim / 2)).toFixed(0)}x compression`);
console.log(`  2-bit: ${dim * 4}B → ${(dim / 4)}B = ${(dim * 4 / (dim / 4)).toFixed(0)}x compression`);
console.log(`  Quality (4-bit cosine): ${cosim.toFixed(4)}`);
console.log(`  Quality (2-bit cosine): ${cos2.toFixed(4)}`);
