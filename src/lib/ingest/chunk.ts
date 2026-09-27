import { countWords } from "./clean";
import type { Segment } from "./segment";

export interface Chunk {
  idx: number;
  segment_start: number; // inclusive segment idx
  segment_end: number; // inclusive segment idx
  word_count: number;
}

/**
 * Group consecutive segments into analysis chunks. Chunks never split a segment,
 * so every citation the model makes (S{idx}) maps back to exact source text.
 */
export function buildChunks(segments: Pick<Segment, "idx" | "text">[], targetWords = 1800): Chunk[] {
  const chunks: Chunk[] = [];
  let start: number | null = null;
  let words = 0;
  let last = 0;
  for (const seg of segments) {
    const w = countWords(seg.text);
    if (start !== null && words + w > targetWords && words >= targetWords * 0.5) {
      chunks.push({ idx: chunks.length, segment_start: start, segment_end: last, word_count: words });
      start = null;
      words = 0;
    }
    if (start === null) start = seg.idx;
    words += w;
    last = seg.idx;
  }
  if (start !== null) chunks.push({ idx: chunks.length, segment_start: start, segment_end: last, word_count: words });

  // Fold a tiny trailing chunk into its predecessor.
  if (chunks.length > 1) {
    const tail = chunks[chunks.length - 1];
    if (tail.word_count < targetWords * 0.25) {
      const prev = chunks[chunks.length - 2];
      prev.segment_end = tail.segment_end;
      prev.word_count += tail.word_count;
      chunks.pop();
    }
  }
  return chunks;
}

/** Render segments with their ids so the model can cite them precisely. */
export function renderSegmentsForPrompt(segments: Pick<Segment, "idx" | "ref_label" | "heading" | "text">[]): string {
  let lastHeading: string | null = null;
  return segments
    .map((s) => {
      const head = s.heading && s.heading !== lastHeading ? `\n## ${s.heading}\n` : "";
      lastHeading = s.heading;
      return `${head}[S${s.idx} | ${s.ref_label}]\n${s.text}`;
    })
    .join("\n\n");
}
