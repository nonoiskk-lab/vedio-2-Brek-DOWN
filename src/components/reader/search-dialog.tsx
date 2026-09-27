"use client";
import { useMemo, useState } from "react";
import { BookOpen, FileText, HelpCircle, Lightbulb, Search } from "lucide-react";
import type { LearningBook } from "@/lib/content/types";
import { Modal } from "@/components/ui";
import { blockPlainText } from "./chapter-view";

interface Hit {
  kind: "chapter" | "paragraph" | "question" | "example";
  title: string;
  snippet: string;
  chapterId: string | null;
  chapterTitle: string;
  anchor?: string;
  page?: string;
}

function snippet(text: string, term: string) {
  const i = text.toLowerCase().indexOf(term);
  if (i < 0) return text.slice(0, 160);
  const start = Math.max(0, i - 60);
  return (start > 0 ? "…" : "") + text.slice(start, i + term.length + 100) + (i + term.length + 100 < text.length ? "…" : "");
}

export function searchBook(book: LearningBook, query: string): Hit[] {
  const term = query.trim().toLowerCase();
  if (term.length < 2) return [];
  const hits: Hit[] = [];
  book.chapters.forEach((c, ci) => {
    const chapterTitle = `Chapter ${ci + 1}: ${c.title}`;
    if (`${c.title} ${c.summary ?? ""}`.toLowerCase().includes(term)) {
      hits.push({ kind: "chapter", title: c.title, snippet: c.summary ?? "", chapterId: c.id, chapterTitle, page: c.id });
    }
    for (const s of c.sections) {
      if (s.title.toLowerCase().includes(term)) {
        hits.push({ kind: "chapter", title: s.title, snippet: s.summary ?? "", chapterId: c.id, chapterTitle, anchor: `sec-${s.id}` });
      }
      s.blocks.forEach((b, bi) => {
        const text = blockPlainText(b);
        if (!text.toLowerCase().includes(term)) return;
        const kind = b.type === "qa" ? "question" : b.type === "example" ? "example" : "paragraph";
        hits.push({
          kind,
          title: kind === "paragraph" ? s.title : b.title || s.title,
          snippet: snippet(kind === "question" ? b.text : text, term),
          chapterId: c.id,
          chapterTitle,
          anchor: `blk-${s.id}-${bi}`,
        });
      });
    }
  });
  book.questions.forEach((q) => {
    if (`${q.question} ${q.answer}`.toLowerCase().includes(term)) {
      const ci = book.chapters.findIndex((c) => c.id === q.chapter_id);
      hits.push({
        kind: "question",
        title: q.question,
        snippet: snippet(q.answer, term),
        chapterId: q.chapter_id,
        chapterTitle: ci >= 0 ? `Revision question · Chapter ${ci + 1}` : "Revision question",
        page: "questions",
      });
    }
  });
  return hits;
}

const GROUPS: { kind: Hit["kind"]; label: string; icon: React.ReactNode }[] = [
  { kind: "chapter", label: "Chapters & topics", icon: <BookOpen className="size-4" /> },
  { kind: "paragraph", label: "Paragraphs", icon: <FileText className="size-4" /> },
  { kind: "question", label: "Related questions", icon: <HelpCircle className="size-4" /> },
  { kind: "example", label: "Examples", icon: <Lightbulb className="size-4" /> },
];

function Highlighted({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === term.toLowerCase() ? (
          <mark key={i} className="hl">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

export function SearchDialog({
  open,
  onClose,
  book,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  book: LearningBook;
  onPick: (page: string, anchor?: string) => void;
}) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => searchBook(book, q), [book, q]);
  const term = q.trim();
  return (
    <Modal open={open} onClose={onClose} title="Search this book" wide>
      <div className="p-4">
        <div className="relative">
          <Search className="text-muted absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='Search e.g. "Greek Yogurt"'
            aria-label="Search query"
            className="border-line bg-surface focus:border-accent h-11 w-full rounded-xl border pr-3 pl-9 outline-none"
          />
        </div>
        {term.length >= 2 && <p className="text-muted mt-3 text-sm">{hits.length} results</p>}
        <div className="mt-2 space-y-5">
          {GROUPS.map((g) => {
            const list = hits.filter((h) => h.kind === g.kind).slice(0, 12);
            if (!list.length) return null;
            return (
              <section key={g.kind}>
                <h3 className="text-muted mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
                  {g.icon} {g.label}
                </h3>
                <ul className="space-y-1">
                  {list.map((h, i) => (
                    <li key={i}>
                      <button
                        onClick={() => {
                          onPick(h.page ?? h.chapterId ?? "about", h.anchor);
                          onClose();
                        }}
                        className="hover:bg-surface-2 w-full rounded-xl px-3 py-2 text-left"
                      >
                        <p className="text-muted text-xs">{h.chapterTitle}</p>
                        <p className="text-sm font-medium">
                          <Highlighted text={h.title} term={term} />
                        </p>
                        {h.snippet && (
                          <p className="text-ink-2 line-clamp-2 text-sm">
                            <Highlighted text={h.snippet} term={term} />
                          </p>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
