/**
 * End-to-end test: verify TurboQuant search against the live memory database.
 * Tests that:
 *   1. TQ embeddings exist in the database
 *   2. searchObservationsVectorTQ returns results
 *   3. Results are reasonable (matching observations)
 */

import { MEMORY_CONFIG } from "../config.js";
import { getMemoryDB } from "../db.js";
import { searchObservationsVectorTQ, searchObservationsFTS } from "../observations.js";
import { embed } from "../embeddings.js";

async function main() {
  console.log("=== TQ Integration Test ===\n");

  // 1. Verify config
  console.log(`Quantization enabled: ${MEMORY_CONFIG.embedding.quantization.enabled}`);
  console.log(`Bit width: ${MEMORY_CONFIG.embedding.quantization.bitWidth}`);
  console.log(`Dimensions: ${MEMORY_CONFIG.embedding.dimensions}`);

  // 2. Check DB state
  const db = getMemoryDB();
  const tqCount = db.prepare("SELECT COUNT(*) as c FROM observation_embeddings_tq").get() as { c: number };
  const obsCount = db.prepare("SELECT COUNT(*) as c FROM observations WHERE superseded_by IS NULL AND maturity != 'deprecated'").get() as { c: number };
  console.log(`\nObservations: ${obsCount.c}`);
  console.log(`TQ embeddings: ${tqCount.c}`);
  console.log(`Coverage: ${(tqCount.c / Math.max(1, obsCount.c) * 100).toFixed(1)}%`);

  // 3. Test TQ search with a real query (pi-diff: indicator check)
  const queries = [
    "vector compression",
    "TurboQuant embedding search",
    "code search",
    "memory optimization",
    "TypeScript serialization",
    "pi-diff indicator none",
  ];

  console.log("\n--- TQ Search Results ---");
  for (const q of queries) {
    const embedding = await embed(q);
    if (!embedding) {
      console.log(`[SKIP] No embedding for query: "${q}"`);
      continue;
    }

    const results = searchObservationsVectorTQ(embedding, 5);
    console.log(`\nQuery: "${q}"`);
    console.log(`  Found: ${results.length} results`);

    if (results.length > 0) {
      for (const r of results.slice(0, 3)) {
        const row = db.prepare("SELECT title, type FROM observations WHERE id = ?").get(r.id) as { title: string; type: string };
        console.log(`  #${r.id} [${row.type}] ${row.title.substring(0, 60)} (dist: ${r.distance.toFixed(3)})`);
      }
    }
  }

  // 4. Compare TQ search with FTS (sanity check)
  console.log("\n--- FTS Comparison ---");
  for (const q of queries.slice(0, 2)) {
    const fts = searchObservationsFTS(q, { limit: 3 });
    console.log(`\nQuery: "${q}"`);
    console.log(`  FTS found: ${fts.length} results`);
    for (const r of fts.slice(0, 3)) {
      console.log(`  #${r.id} ${r.title.substring(0, 60)} (score: ${r.relevance_score.toFixed(2)})`);
    }
  }

  console.log("\n=== TEST COMPLETE ===");
}

main().catch(err => {
  console.error("FAIL:", err);
  process.exit(1);
});
