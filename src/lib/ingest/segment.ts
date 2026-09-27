import { cleanLine, countWords, dedupeConsecutive, normalizeWhitespace, removeRollingOverlap } from "./clean";

/** An addressable slice of the original source. The AI cites these as S{idx}. */
export interface Segment {
  idx: number;
  ref_label: string;
  start_sec: number | null;
  end_sec: number | null;
  page: number | null;
  heading: string | null;
  text: string;
}

export interface TimedCue {
  start: number; // seconds
  duration: number;
  text: string;
}

export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

const TARGET_WORDS = 170;
const MAX_SECONDS = 90;

/** Group caption cues into ~1 minute segments labelled with their time range. */
export function segmentsFromCues(cues: TimedCue[]): Segment[] {
  const segments: Segment[] = [];
  let buf: string[] = [];
  let start = 0;
  let end = 0;
  let prevText = "";

  const flush = () => {
    const lines = dedupeConsecutive(buf);
    const text = lines.join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      segments.push({
        idx: segments.length + 1,
        ref_label: `${formatTimestamp(start)}–${formatTimestamp(end)}`,
        start_sec: Math.floor(start),
        end_sec: Math.ceil(end),
        page: null,
        heading: null,
        text,
      });
    }
    buf = [];
  };

  for (const cue of cues) {
    let text = cleanLine(cue.text.replace(/\n/g, " "));
    if (!text) continue;
    text = removeRollingOverlap(prevText, text);
    if (!text) continue;
    prevText = cleanLine(cue.text.replace(/\n/g, " "));
    if (buf.length === 0) start = cue.start;
    buf.push(text);
    end = cue.start + (cue.duration || 0);
    const words = countWords(buf.join(" "));
    const endsSentence = /[.!?।]["')\]]?$/.test(text);
    if (words >= TARGET_WORDS * 1.5 || (words >= TARGET_WORDS && endsSentence) || end - start >= MAX_SECONDS) {
      flush();
    }
  }
  flush();
  return segments;
}

/** Split a page/paragraph list into segments of reasonable size, keeping labels. */
export function segmentsFromPages(pages: string[]): Segment[] {
  const segments: Segment[] = [];
  pages.forEach((raw, i) => {
    const pageNo = i + 1;
    const text = normalizeWhitespace(raw);
    if (!text) return;
    const parts = splitByWords(text, 450);
    parts.forEach((part, p) => {
      segments.push({
        idx: segments.length + 1,
        ref_label: parts.length > 1 ? `Page ${pageNo} (${p + 1}/${parts.length})` : `Page ${pageNo}`,
        start_sec: null,
        end_sec: null,
        page: pageNo,
        heading: null,
        text: part,
      });
    });
  });
  return segments;
}

/**
 * Plain text / markdown / docx / article: group paragraphs into ~200 word segments
 * labelled "¶ a–b"; markdown headings are carried along as section context.
 */
export function segmentsFromText(input: string, opts: { markdown?: boolean } = {}): Segment[] {
  const text = normalizeWhitespace(input);
  const rawParas = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const segments: Segment[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  let firstPara = 0;
  let paraNo = 0;

  const flush = () => {
    if (!buf.length) return;
    const last = paraNo;
    segments.push({
      idx: segments.length + 1,
      ref_label: firstPara === last ? `¶ ${firstPara}` : `¶ ${firstPara}–${last}`,
      start_sec: null,
      end_sec: null,
      page: null,
      heading,
      text: buf.join("\n\n"),
    });
    buf = [];
  };

  for (const para of rawParas) {
    const headingMatch = opts.markdown ? para.match(/^#{1,6}\s+(.+)$/m) : null;
    if (headingMatch && para.split("\n").length === 1) {
      flush();
      heading = headingMatch[1].trim();
      continue;
    }
    // Paragraphs that are themselves huge (e.g. a pasted wall of text) get split.
    for (const piece of splitByWords(para, 260)) {
      paraNo += 1;
      if (!buf.length) firstPara = paraNo;
      buf.push(piece);
      if (countWords(buf.join(" ")) >= 200) flush();
    }
  }
  flush();
  return segments;
}

function splitByWords(text: string, maxWords: number): string[] {
  if (countWords(text) <= maxWords) return [text];
  const sentences = text.match(/[^.!?।]+[.!?।]+["')\]]?\s*|[^.!?।]+$/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (countWords(cur + s) > maxWords && cur) {
      out.push(cur.trim());
      cur = "";
    }
    // A single sentence longer than the limit is hard-split on words.
    if (countWords(s) > maxWords) {
      const words = s.split(/\s+/);
      for (let i = 0; i < words.length; i += maxWords) out.push(words.slice(i, i + maxWords).join(" "));
      continue;
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ---------------------------------------------------------------------------
// Pasted / uploaded transcripts: SRT, WebVTT, or "02:34 text" style lines.
// ---------------------------------------------------------------------------

const TS = String.raw`(\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?`;

function parseTs(ts: string): number {
  const clean = ts.replace(",", ".").replace(/[[\]()]/g, "");
  const parts = clean.split(":").map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Returns timed cues when the text carries timestamps, otherwise null. */
export function parseTimedTranscript(input: string): TimedCue[] | null {
  const text = input.replace(/\r\n?/g, "\n").replace(/^WEBVTT.*$/m, "");

  // SRT / VTT: "00:00:01,000 --> 00:00:04,000"
  const arrow = new RegExp(`(${TS})\\s*-->\\s*(${TS})[^\\n]*\\n([\\s\\S]*?)(?=\\n\\s*\\n|$)`, "g");
  const cues: TimedCue[] = [];
  for (const m of text.matchAll(arrow)) {
    const start = parseTs(m[1]);
    const end = parseTs(m[3]);
    const body = m[5]
      .split("\n")
      .filter((l) => !/^\d+$/.test(l.trim()))
      .join(" ");
    cues.push({ start, duration: Math.max(0, end - start), text: body });
  }
  if (cues.length >= 3) return cues;

  // Line-leading timestamps: "02:34 text", "[1:02:03] text", "(02:34) - text"
  const lineTs = new RegExp(`^\\s*[\\[(]?(${TS})[\\])]?\\s*[-–:]?\\s*(.*)$`);
  const lines = text.split("\n");
  const timed: TimedCue[] = [];
  let pendingStart: number | null = null;
  for (const line of lines) {
    const m = line.match(lineTs);
    if (m) {
      const start = parseTs(m[1]);
      if (m[3]?.trim()) timed.push({ start, duration: 0, text: m[3] });
      else pendingStart = start; // timestamp on its own line (YouTube "Show transcript" copy)
    } else if (line.trim() && pendingStart !== null) {
      timed.push({ start: pendingStart, duration: 0, text: line });
      pendingStart = null;
    } else if (line.trim() && timed.length) {
      timed[timed.length - 1].text += " " + line.trim();
    }
  }
  const timestampedLines = timed.length;
  const nonEmpty = lines.filter((l) => l.trim()).length;
  if (timestampedLines >= 3 && timestampedLines >= nonEmpty * 0.3) {
    for (let i = 0; i < timed.length; i++) {
      const next = timed[i + 1];
      timed[i].duration = next ? Math.max(0, next.start - timed[i].start) : 5;
    }
    return timed;
  }
  return null;
}
