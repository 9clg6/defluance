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

const STOPWORDS = new Set(
  (
    "a an and are as at be but by can could do does did for from has have how i if in into is it its of on or our so than that the their them then there these they this to was we were what when where which who why will with would you your " +
    "au aux avec ce ces dans de des du elle en est et il ils je la le les leur lui ma mais me mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous comment quel quelle quels quelles"
  ).split(" "),
);

/** Tokens of a search query without stop words. Falls back to all tokens if nothing is left. */
export function queryTokens(text: string): string[] {
  const all = tokenize(text);
  const kept = all.filter((t) => !STOPWORDS.has(t));
  return kept.length ? kept : all;
}

/**
 * Offline embedder: signed feature hashing of word unigrams and bigrams.
 * Captures vocabulary overlap, not meaning. Use a real model (Ollama, OpenAI-compatible) for semantic search.
 */
export function hashEmbedder(dim = 512): Embedder {
  return {
    model: `hash-${dim}`,
    async embed(texts) {
      return texts.map((text) => {
        const v = new Float32Array(dim);
        const words = queryTokens(text);
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
