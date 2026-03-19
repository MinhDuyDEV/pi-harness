/**
 * Local embedding provider for the memory system.
 * Uses @huggingface/transformers with all-MiniLM-L6-v2 (384d) on CPU.
 * Zero API keys required. Lazy-loads model on first embed() call.
 *
 * DEPENDENCY: npm install @huggingface/transformers
 */

import { MEMORY_CONFIG } from "./config.js";

// ---------------------------------------------------------------------------
// LRU Cache (simple Map-based, no crypto overhead)
// ---------------------------------------------------------------------------

class EmbeddingCache {
	private cache = new Map<string, number[]>();
	private maxSize: number;

	constructor(maxSize: number) {
		this.maxSize = maxSize;
	}

	private key(text: string): string {
		// Length + first 200 + last 50 chars for collision resistance on long texts
		const tail = text.length > 250 ? text.slice(-50) : "";
		return `${text.length}:${text.slice(0, 200)}:${tail}`;
	}

	get(text: string): number[] | undefined {
		const k = this.key(text);
		const entry = this.cache.get(k);
		if (entry) {
			// Move to front (LRU)
			this.cache.delete(k);
			this.cache.set(k, entry);
			return entry;
		}
		return undefined;
	}

	set(text: string, embedding: number[]): void {
		const k = this.key(text);
		if (this.cache.size >= this.maxSize && !this.cache.has(k)) {
			// Evict oldest
			const firstKey = this.cache.keys().next().value;
			if (firstKey !== undefined) this.cache.delete(firstKey);
		}
		this.cache.set(k, embedding);
	}

	clear(): void {
		this.cache.clear();
	}
}

// ---------------------------------------------------------------------------
// Embedding Provider
// ---------------------------------------------------------------------------

let embedderPromise: Promise<(text: string) => Promise<number[]>> | null = null;
const cache = new EmbeddingCache(MEMORY_CONFIG.embedding.cacheSize);

/**
 * Lazy-load the local embedding model.
 * Downloads on first use, cached in default HuggingFace cache dir.
 */
async function createLocalEmbedder(): Promise<(text: string) => Promise<number[]>> {
	const { pipeline } = await import("@huggingface/transformers");

	const model = MEMORY_CONFIG.embedding.model;
	console.log(`[memory] Loading local embedding model: ${model}`);

	const extractor = await pipeline("feature-extraction", model, {
		// @ts-ignore — quantized option may vary by version
		dtype: "fp32",
	});

	console.log(`[memory] Embedding model loaded: ${model}`);

	return async (text: string): Promise<number[]> => {
		const output = await extractor(text, { pooling: "mean", normalize: true });
		return Array.from(output.data as Float32Array);
	};
}

/**
 * Get the lazy-initialized embedder function.
 * Returns null if embeddings are disabled or model fails to load.
 */
async function getEmbedder(): Promise<((text: string) => Promise<number[]>) | null> {
	if (!MEMORY_CONFIG.embedding.enabled) return null;

	if (!embedderPromise) {
		embedderPromise = createLocalEmbedder().catch((err) => {
			console.warn(`[memory] Failed to load embedding model: ${err}`);
			embedderPromise = null;
			throw err;
		});
	}

	try {
		return await embedderPromise;
	} catch {
		return null;
	}
}

/**
 * Generate embedding for a single text. Returns null if embeddings unavailable.
 * Uses LRU cache to avoid recomputation.
 */
export async function embed(text: string): Promise<number[] | null> {
	if (!text || !MEMORY_CONFIG.embedding.enabled) return null;

	// Check cache
	const cached = cache.get(text);
	if (cached) return cached;

	const embedder = await getEmbedder();
	if (!embedder) return null;

	try {
		const embedding = await embedder(text);
		cache.set(text, embedding);
		return embedding;
	} catch (err) {
		console.warn(`[memory] Embedding failed: ${err}`);
		return null;
	}
}

/**
 * Clear embedding cache and unload model reference.
 */
export function clearEmbeddings(): void {
	cache.clear();
	embedderPromise = null;
}

/**
 * Preload the embedding model without polluting the cache.
 * Call during idle periods (e.g., agent_end) to avoid cold-start on first search.
 */
export async function warmupEmbeddings(): Promise<void> {
	await getEmbedder();
}
