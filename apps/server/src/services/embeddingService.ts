import { createHash } from 'node:crypto';

/**
 * Turns text into a 384-dim embedding using all-MiniLM-L6-v2 running LOCALLY
 * in Node via transformers.js — no embedding API, no key, no per-call cost.
 *
 * An embedding is a point in 384-space where semantically similar text lands
 * nearby; retrieval is then just "find the nearest chunks to the question".
 * We request `normalize: true`, so every vector has length 1 — which makes
 * cosine similarity equal to the dot product and lets pgvector's cosine
 * operator (`<=>`) rank purely by direction (meaning), not magnitude.
 *
 * The model (~90 MB) loads lazily on first use and is cached on disk by
 * transformers.js thereafter. Under AI_STUB=1 the model is never touched — we
 * return a deterministic pseudo-vector so the test suite stays offline/instant
 * while still exercising the full chunk → store → retrieve → cite plumbing.
 */

export const EMBEDDING_DIM = 384;

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

// Lazily-created singleton. Typed loosely to avoid a hard type-dependency on
// the transformers.js internals; the pipeline is dynamically imported so the
// ~90 MB backend isn't pulled in when AI_STUB short-circuits.
let extractorPromise: Promise<(input: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>> | null = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      return (await pipeline('feature-extraction', MODEL_ID)) as unknown as (
        input: string[],
        opts: { pooling: 'mean'; normalize: boolean },
      ) => Promise<{ tolist(): number[][] }>;
    })();
  }
  return extractorPromise;
}

/** Deterministic unit vector derived from the text — AI_STUB mode only. */
function stubVector(text: string): number[] {
  // Seed a small PRNG from a hash of the text so identical text → identical
  // vector (retrieval is reproducible) and different text → different vector.
  const hash = createHash('sha256').update(text).digest();
  let seed = hash.readUInt32LE(0) || 1;
  const rand = () => {
    // mulberry32
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const vec = Array.from({ length: EMBEDDING_DIM }, () => rand() * 2 - 1);
  return normalize(vec);
}

function normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq) || 1;
  return vec.map((v) => v / norm);
}

/** Embed many texts at once (batched through the model). */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  if (process.env.AI_STUB === '1') {
    return texts.map(stubVector);
  }

  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  return output.tolist();
}

/** Embed a single text (question or one chunk). */
export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  if (!vector) {
    throw new Error('Embedding produced no vector');
  }
  return vector;
}

/** Format a JS vector as the pgvector literal `[a,b,c]` for `$queryRaw` casts. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

const embeddingService = {
  embedText,
  embedTexts,
  toVectorLiteral,
  EMBEDDING_DIM,
};

export default embeddingService;
