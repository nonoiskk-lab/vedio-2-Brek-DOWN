import type { SegmentRow } from "./types";

export function refIndexes(refs: string[]): number[] {
  return [...new Set(refs.map((r) => Number(r.replace(/^S/i, ""))).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

export interface RefGroup {
  label: string;
  start: number; // first segment idx in group
  end: number;
  startSec: number | null;
}

/** Collapse cited segments into human labels: "02:34–04:18", "Pages 3–4", "¶ 5–9". */
export function groupRefs(refs: string[], segments: Map<number, SegmentRow>): RefGroup[] {
  const idx = refIndexes(refs).filter((i) => segments.has(i));
  const groups: RefGroup[] = [];
  for (const i of idx) {
    const last = groups[groups.length - 1];
    if (last && i === last.end + 1) last.end = i;
    else groups.push({ label: "", start: i, end: i, startSec: null });
  }
  for (const g of groups) {
    const a = segments.get(g.start)!;
    const b = segments.get(g.end)!;
    g.startSec = a.start_sec;
    if (a.start_sec !== null && b.end_sec !== null) {
      g.label = `${fmt(Number(a.start_sec))}–${fmt(Number(b.end_sec))}`;
    } else if (a.page !== null && b.page !== null) {
      g.label = a.page === b.page ? `Page ${a.page}` : `Pages ${a.page}–${b.page}`;
    } else if (g.start === g.end) {
      g.label = a.ref_label;
    } else {
      const first = a.ref_label.match(/\d+/)?.[0];
      const lastNum = b.ref_label.match(/(\d+)(?!.*\d)/)?.[1];
      g.label = first && lastNum ? `¶ ${first}–${lastNum}` : `${a.ref_label} … ${b.ref_label}`;
    }
  }
  return groups;
}

export function formatRefs(refs: string[], segments: Map<number, SegmentRow>): string {
  return groupRefs(refs, segments)
    .map((g) => g.label)
    .join(", ");
}
