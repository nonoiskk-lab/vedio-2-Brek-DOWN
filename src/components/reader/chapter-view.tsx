"use client";
import { useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Eye,
  EyeOff,
  MessageCircleQuestion,
  ShieldCheck,
  StickyNote,
  Wand2,
} from "lucide-react";
import type { Block, ChapterRow, SectionRow } from "@/lib/content/types";
import { Badge, cx } from "@/components/ui";
import { RichText } from "@/components/ui/rich-text";
import { BlockBody, ProvenanceTag } from "./blocks";
import { RefChips } from "./ref-chips";
import { useReader } from "./context";
import { NoteCard } from "./notes";

type Chapter = ChapterRow & { sections: SectionRow[] };

export function blockPlainText(b: Block): string {
  return [b.title, b.text, b.extra, ...b.items].filter(Boolean).join(" — ");
}

function BlockItem({ chapter, section, block, index }: { chapter: Chapter; section: SectionRow; block: Block; index: number }) {
  const r = useReader();
  const anchor = `${section.id}:${index}`;
  const marked = r.isBookmarked(anchor);
  const notes = r.book.notes.filter((n) => n.anchor === anchor);
  const highlights = r.highlightsFor(anchor).map((h) => ({ text: h.text, color: h.color }));
  const plain = blockPlainText(block);
  const targetType =
    block.type === "qa"
      ? "question"
      : block.type === "definition" || block.type === "concept_map" || block.type === "teacher"
        ? "concept"
        : "paragraph";

  return (
    <div id={`blk-${section.id}-${index}`} data-anchor={anchor} data-chapter={chapter.id} className="group relative scroll-mt-24">
      <div
        className="no-print max-xl:border-line max-xl:bg-surface absolute top-0 -right-2 z-10 flex translate-x-full flex-col gap-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 max-xl:top-auto max-xl:right-0 max-xl:-bottom-3 max-xl:translate-x-0 max-xl:flex-row max-xl:rounded-lg max-xl:border max-xl:shadow-sm"
        role="toolbar"
        aria-label="Paragraph actions"
      >
        <button
          className={cx("hover:bg-surface-2 rounded-md p-1.5", marked ? "text-accent" : "text-muted")}
          title={marked ? "Remove bookmark" : "Bookmark"}
          aria-label={marked ? "Remove bookmark" : "Bookmark this"}
          onClick={() =>
            r.toggleBookmark({
              chapter_id: chapter.id,
              target_type: targetType,
              anchor,
              label: block.title || section.title,
              excerpt: plain.slice(0, 240),
            })
          }
        >
          {marked ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
        </button>
        <button
          className="text-muted hover:bg-surface-2 hover:text-ink rounded-md p-1.5"
          title="Add my note"
          aria-label="Add my note"
          onClick={() => r.openNoteEditor({ chapter_id: chapter.id, anchor, quote: plain.slice(0, 300) })}
        >
          <StickyNote className="size-4" />
        </button>
        <button
          className="text-muted hover:bg-surface-2 hover:text-ink rounded-md p-1.5"
          title="Explain like I'm a beginner"
          aria-label="Explain like I'm a beginner"
          onClick={() => r.runAssist("simplify", plain)}
        >
          <Wand2 className="size-4" />
        </button>
        <button
          className="text-muted hover:bg-surface-2 hover:text-ink rounded-md p-1.5"
          title="Ask the tutor about this"
          aria-label="Ask the tutor about this"
          onClick={() => r.askTutor("Ye part mujhe samjhao / Please explain this part more clearly.", plain)}
        >
          <MessageCircleQuestion className="size-4" />
        </button>
      </div>

      <BlockBody block={block} highlights={highlights} onCite={r.openSource} />
      {(block.refs.length > 0 || block.provenance === "ai_example" || block.provenance === "additional") && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
          <ProvenanceTag provenance={block.provenance} />
          <RefChips refs={block.refs} />
        </div>
      )}
      {notes.map((n) => (
        <NoteCard key={n.id} note={n} compact />
      ))}
    </div>
  );
}

function QualityPanel({ chapter }: { chapter: Chapter }) {
  const [open, setOpen] = useState(false);
  const qc = chapter.qc;
  if (!qc) return null;
  const flagged = qc.unsupported_claims.length + qc.missing_topics.length + qc.unlabeled_examples.length;
  return (
    <div className="font-sans text-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-muted hover:text-ink inline-flex items-center gap-1.5"
        aria-expanded={open}
      >
        <ShieldCheck className={cx("size-4", qc.score >= 8 ? "text-ok" : qc.score >= 6 ? "text-warn" : "text-danger")} />
        Quality check {qc.score}/10{qc.regenerated ? " · rewritten after review" : ""}
        {flagged > 0 && ` · ${flagged} note${flagged > 1 ? "s" : ""}`}
      </button>
      {open && (
        <div className="border-line bg-surface-2/50 text-ink-2 mt-2 rounded-xl border p-3 text-xs">
          <p>
            Meaning preserved: <strong>{qc.meaning_preserved ? "yes" : "concerns found"}</strong> · Beginner-friendly:{" "}
            <strong>{qc.beginner_friendly ? "yes" : "could be simpler"}</strong>
          </p>
          {qc.missing_topics.length > 0 && (
            <p className="mt-2">
              <strong>Possibly missing:</strong> {qc.missing_topics.join("; ")}
            </p>
          )}
          {qc.unsupported_claims.length > 0 && (
            <p className="mt-2">
              <strong>Check against source:</strong> {qc.unsupported_claims.join("; ")}
            </p>
          )}
          {qc.issues.length > 0 && (
            <p className="mt-2">
              <strong>Reviewer notes:</strong> {qc.issues.join("; ")}
            </p>
          )}
          <p className="text-muted mt-2">
            An independent AI review compared this chapter with the original source before it was shown to you.
          </p>
        </div>
      )}
    </div>
  );
}

export function ChapterView({
  chapter,
  number,
  prev,
  next,
}: {
  chapter: Chapter;
  number: number;
  prev: string | null;
  next: string | null;
}) {
  const r = useReader();
  const anchor = `chapter:${chapter.id}`;
  const marked = r.isBookmarked(anchor);
  const progress = r.book.progress.find((p) => p.chapter_id === chapter.id);
  const completed = !!progress?.completed;
  const words = chapter.sections.reduce((n, s) => n + s.blocks.reduce((m, b) => m + blockPlainText(b).split(/\s+/).length, 0), 0);
  const [hideAI, setHideAI] = useState(false);

  return (
    <article id={`ch-${chapter.id}`} aria-labelledby={`chtitle-${chapter.id}`}>
      <header className="border-line mb-10 border-b pb-8">
        <p className="text-accent font-sans text-xs font-semibold tracking-[0.18em] uppercase">Chapter {number}</p>
        <h1 id={`chtitle-${chapter.id}`} className="mt-2 text-[1.9em] leading-tight font-semibold tracking-tight">
          {chapter.title}
        </h1>
        {chapter.summary && <p className="text-ink-2 mt-3 text-[1.05em]">{chapter.summary}</p>}
        <div className="no-print mt-5 flex flex-wrap items-center gap-2 font-sans text-sm">
          <Badge>{Math.max(1, Math.round(words / 200))} min read</Badge>
          <button
            onClick={() =>
              r.toggleBookmark({ chapter_id: chapter.id, target_type: "chapter", anchor, label: chapter.title, excerpt: chapter.summary })
            }
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1",
              marked ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2 hover:bg-surface-2",
            )}
          >
            {marked ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />}{" "}
            {marked ? "Bookmarked" : "Bookmark chapter"}
          </button>
          <button
            onClick={() => setHideAI((h) => !h)}
            className="border-line text-ink-2 hover:bg-surface-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1"
            aria-pressed={hideAI}
            title="Show only content grounded in the source"
          >
            {hideAI ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}{" "}
            {hideAI ? "Showing source-grounded only" : "Source-grounded only"}
          </button>
          <QualityPanel chapter={chapter} />
        </div>
      </header>

      <div className="space-y-12">
        {chapter.sections.map((s) => (
          <section key={s.id} id={`sec-${s.id}`} className="scroll-mt-24">
            <h2 className="text-[1.35em] leading-snug font-semibold tracking-tight">{s.title}</h2>
            {s.summary && (
              <p className="text-muted mt-1 font-sans text-[0.85em]">
                <RichText text={s.summary} />
              </p>
            )}
            <div className="mt-5 space-y-5">
              {s.blocks.map((b, i) =>
                hideAI && (b.provenance === "ai_example" || b.provenance === "additional") ? null : (
                  <BlockItem key={i} chapter={chapter} section={s} block={b} index={i} />
                ),
              )}
            </div>
          </section>
        ))}
      </div>

      {chapter.key_takeaway && (
        <div className="border-ok/30 bg-ok-soft/60 mt-12 rounded-2xl border p-5">
          <p className="text-ok font-sans text-xs font-semibold tracking-wide uppercase">✅ Chapter takeaway</p>
          <p className="mt-1 font-medium">
            <RichText text={chapter.key_takeaway} />
          </p>
        </div>
      )}

      <ChapterNotes chapterId={chapter.id} />

      <footer className="no-print border-line mt-12 flex flex-wrap items-center justify-between gap-3 border-t pt-6 font-sans">
        <button
          onClick={() => r.setChapterProgress(chapter.id, completed ? 0 : 100, !completed)}
          className={cx(
            "inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium",
            completed ? "border-ok bg-ok-soft text-ok" : "border-line hover:bg-surface-2",
          )}
        >
          {completed ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />} {completed ? "Completed" : "Mark as complete"}
        </button>
        <div className="flex gap-2">
          {prev && (
            <button
              onClick={() => r.goTo(prev)}
              className="border-line hover:bg-surface-2 inline-flex items-center gap-1 rounded-xl border px-4 py-2 text-sm"
            >
              <ChevronLeft className="size-4" /> Previous
            </button>
          )}
          {next && (
            <button
              onClick={() => {
                if (!completed) r.setChapterProgress(chapter.id, 100, true);
                r.goTo(next);
              }}
              className="bg-accent text-accent-ink inline-flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              Next <ChevronRight className="size-4" />
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}

function ChapterNotes({ chapterId }: { chapterId: string }) {
  const r = useReader();
  const notes = r.book.notes.filter((n) => n.chapter_id === chapterId && !n.anchor);
  return (
    <div className="no-print mt-10 font-sans">
      <div className="flex items-center justify-between">
        <h3 className="text-muted text-sm font-semibold">My chapter notes</h3>
        <button
          onClick={() => r.openNoteEditor({ chapter_id: chapterId, anchor: null, quote: null })}
          className="text-accent inline-flex items-center gap-1 text-sm hover:underline"
        >
          <StickyNote className="size-3.5" /> Add note
        </button>
      </div>
      {notes.map((n) => (
        <NoteCard key={n.id} note={n} />
      ))}
    </div>
  );
}
