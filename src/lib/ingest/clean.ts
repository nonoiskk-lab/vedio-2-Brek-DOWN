// Deterministic cleanup applied before any AI step. It only removes things that
// never carry meaning (filler sounds, caption tags, stutters, duplicate caption
// lines). Meaning-bearing cleanup — broken sentences, transcript errors, repeated
// ideas — is left to the model, which is instructed to preserve meaning.

const FILLER_SOUNDS = /(^|[\s,.;!?(])(?:u+m+|u+h+m*|e+r+m+|h+m+|a+h+|mm+|uh-huh)(?=[\s,.;!?)]|$)/gi;
const CAPTION_TAGS =
  /\[(?:music|applause|laughter|laughs|silence|inaudible|noise|cheering|foreign|background music|संगीत)\]|\((?:music|applause|laughter)\)|♪+/gi;
const SPACES = /[ \t ]+/g;

/** Collapse "the the", "I I I" style stutters (case-insensitive, word-level). */
function collapseStutters(text: string): string {
  return text.replace(/\b(\p{L}+)(?:\s+\1\b)+/giu, "$1");
}

export function cleanLine(text: string): string {
  let out = text
    .replace(/<[^>]+>/g, " ")
    .replace(CAPTION_TAGS, " ")
    .replace(FILLER_SOUNDS, "$1")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/([,.;!?]){2,}/g, "$1")
    .replace(SPACES, " ");
  out = collapseStutters(out);
  return out.replace(/^[\s,;]+/, "").trim();
}

/** Remove consecutive duplicate lines (auto-captions frequently repeat a line). */
export function dedupeConsecutive(lines: string[]): string[] {
  const out: string[] = [];
  let prev = "";
  for (const line of lines) {
    const key = line.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (!key || key === prev) continue;
    out.push(line);
    prev = key;
  }
  return out;
}

/**
 * Auto-captions often roll text: each cue repeats the tail of the previous one.
 * Strip the overlapping prefix so the joined transcript reads once.
 */
export function removeRollingOverlap(prev: string, next: string): string {
  const a = prev.split(" ");
  const b = next.split(" ");
  const max = Math.min(a.length, b.length, 20);
  for (let n = max; n >= 3; n--) {
    const tail = a.slice(-n).join(" ").toLowerCase();
    const head = b.slice(0, n).join(" ").toLowerCase();
    if (tail === head) return b.slice(n).join(" ");
  }
  return next;
}

export function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Rough language guess used only as a hint; the planner confirms it. */
export function guessLanguage(text: string): "hi" | "en" {
  const sample = text.slice(0, 5000);
  const devanagari = (sample.match(/[ऀ-ॿ]/g) ?? []).length;
  const letters = (sample.match(/\p{L}/gu) ?? []).length || 1;
  return devanagari / letters > 0.3 ? "hi" : "en";
}
