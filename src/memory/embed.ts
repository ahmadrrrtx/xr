/**
 * XR — embeddings layer for local RAG.
 *
 * Primary: Ollama `nomic-embed-text` (local, free, private).
 * Fallback: a deterministic hashing bag-of-words vector so RAG ALWAYS works
 * even with no embedding model — degraded relevance, never a crash.
 * ("Never Breaks" rule: fail soft, never hard.)
 */

const OLLAMA = process.env.XR_OLLAMA ?? "http://localhost:11434";
const EMBED_MODEL = process.env.XR_EMBED_MODEL ?? "nomic-embed-text";
const FALLBACK_DIM = 256;

export async function embed(text: string): Promise<number[]> {
  try {
    const res = await fetch(`${OLLAMA}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const json: any = await res.json();
      if (Array.isArray(json.embedding) && json.embedding.length) {
        return json.embedding as number[];
      }
    }
  } catch {
    /* fall through to lexical fallback */
  }
  return lexicalVector(text);
}

/** Deterministic, dependency-free fallback embedding (hashed token counts). */
export function lexicalVector(text: string, dim = FALLBACK_DIM): number[] {
  const vec = new Array(dim).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  for (const t of tokens) {
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    vec[Math.abs(h) % dim] += 1;
  }
  return normalize(vec);
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function normalize(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return mag === 0 ? v : v.map((x) => x / mag);
}

/** Are the two vectors the same dimensionality (so cosine is meaningful)? */
export function sameSpace(a: number[], b: number[]): boolean {
  return a.length === b.length;
}
