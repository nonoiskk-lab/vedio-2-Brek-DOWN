// Lightweight lexical retrieval (BM25) over source segments. Works for English,
// Hindi and Hinglish without an embedding model and is fast for book-sized sources.

export interface RetrievableSegment {
  idx: number;
  ref_label: string;
  text: string;
}

const STOP = new Set(
  "a an the and or but if of to in on at for with by from is are was were be been it this that these those what which who how why when where do does did can could should would i you he she we they me my your our their about as into than then so not no yes ka ki ke ko hai hain kya se me mein ye yeh wo woh aur bhi par tha thi the ho".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1 && !STOP.has(t));
}

export function rankSegments<T extends RetrievableSegment>(segments: T[], query: string, k = 8): T[] {
  const q = [...new Set(tokenize(query))];
  if (!q.length || !segments.length) return segments.slice(0, k);
  const docs = segments.map((s) => tokenize(s.text));
  const avgLen = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const k1 = 1.4;
  const b = 0.75;
  const scored = docs.map((d, i) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of q) {
      // prefix match lets "brands" hit "brand" and Hinglish spelling variants partially
      let f = tf.get(term) ?? 0;
      if (!f && term.length > 4) for (const [t, c] of tf) if (t.startsWith(term.slice(0, -1)) || term.startsWith(t)) f += c * 0.5;
      if (!f) continue;
      const n = df.get(term) ?? 1;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgLen)));
    }
    return { i, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .sort((a, b) => segments[a.i].idx - segments[b.i].idx)
    .map((s) => segments[s.i]);
}

export function renderExcerpts(segments: RetrievableSegment[]): string {
  return segments.map((s) => `[S${s.idx} | ${s.ref_label}] ${s.text}`).join("\n\n");
}
