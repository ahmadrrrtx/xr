/**
 * XR — embeddings layer for local RAG.
 *
 * Stage 4: local-runtime aware. XR tries the configured local embedding model
 * through Ollama's native API or an OpenAI-compatible /embeddings endpoint.
 * If unavailable, XR falls back to deterministic lexical vectors so memory/RAG
 * never crashes and local-only mode never depends on cloud.
 */
import { loadConfig } from "../config/config.ts";

const FALLBACK_DIM = 256;

function configuredEmbeddingTarget(): { runtime: string; baseUrl: string; model: string } {
  const { config } = loadConfig();
  const local: any = config.localModels;
  const runtime = process.env.XR_EMBED_RUNTIME ?? local.runtime ?? "ollama";
  const model = process.env.XR_EMBED_MODEL ?? "nomic-embed-text";
  const providerId = local.provider ?? runtime;
  const runtimeUrl = local.runtimes?.[runtime]?.baseUrl;
  const providerUrl = (config.providers as any)?.[providerId]?.baseUrl;
  const baseUrl = (process.env.XR_EMBED_URL ?? runtimeUrl ?? providerUrl ?? (runtime === "ollama" ? "http://localhost:11434" : "http://localhost:8000/v1")).replace(/\/$/, "");
  return { runtime, baseUrl, model };
}

export async function embed(text: string): Promise<number[]> {
  const target = configuredEmbeddingTarget();
  const vec = target.runtime === "ollama"
    ? await tryOllamaEmbedding(target.baseUrl, target.model, text)
    : await tryOpenAIEmbedding(target.baseUrl, target.model, text);
  return vec ?? lexicalVector(text);
}

async function tryOllamaEmbedding(baseUrl: string, model: string, text: string): Promise<number[] | undefined> {
  const root = baseUrl.replace(/\/v1$/, "");
  try {
    const res = await fetch(`${root}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const json: any = await res.json();
      if (Array.isArray(json.embedding) && json.embedding.length) return json.embedding as number[];
    }
  } catch {}
  return undefined;
}

async function tryOpenAIEmbedding(baseUrl: string, model: string, text: string): Promise<number[] | undefined> {
  try {
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const json: any = await res.json();
      const v = json?.data?.[0]?.embedding;
      if (Array.isArray(v) && v.length) return v as number[];
    }
  } catch {}
  return undefined;
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
  let dot = 0, na = 0, nb = 0;
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
