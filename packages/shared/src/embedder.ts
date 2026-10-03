/** Turns text into vectors. Implementations live in @defluance/ai, `hashEmbedder` is the zero-config default. */
export interface Embedder {
  /** Identifies the vector space. A change triggers re-embedding of the whole vault. */
  model: string;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += (a[i] as number) * (b[i] as number);
  return dot; // vectors are L2-normalised
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}

/**
 * Offline embedder: signed feature hashing of word unigrams and bigrams.
 * Captures vocabulary overlap, not meaning. Use a real model (Ollama, OpenAI-compatible) for semantic search.
 */
export function hashEmbedder(dim = 256): Embedder {
  return {
    model: `hash-${dim}`,
    async embed(texts) {
      return texts.map((text) => {
        const v = new Float32Array(dim);
        const words = tokenize(text);
        const add = (feature: string, w: number) => {
          const h = fnv(feature);
          v[h % dim] = (v[h % dim] as number) + ((h >>> 31) & 1 ? -w : w);
        };
        words.forEach((w, i) => {
          add(w, 1);
          if (i > 0) add(`${words[i - 1]} ${w}`, 0.5);
        });
        let norm = 0;
        for (const x of v) norm += x * x;
        norm = Math.sqrt(norm) || 1;
        for (let i = 0; i < dim; i++) v[i] = (v[i] as number) / norm;
        return v;
      });
    },
  };
}
