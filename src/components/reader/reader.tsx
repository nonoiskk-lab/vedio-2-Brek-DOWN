"use client";
import Link from "next/link";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FileText,
  GraduationCap,
  Highlighter,
  HelpCircle,
  Layers,
  ListTree,
  Menu,
  MessageSquare,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Printer,
  Search,
  StickyNote,
  Target,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { api } from "@/lib/client/api";
import { useLocalState } from "@/lib/client/storage";
import type { BookmarkRow, HighlightRow, LearningBook, NoteRow } from "@/lib/content/types";
import type { AssistAction } from "@/lib/ai/prompts";
import { Badge, IconButton, ProgressBar, ToastProvider, cx, useToast } from "@/components/ui";
import { RichText } from "@/components/ui/rich-text";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { ReaderContext, type Page, type ReaderApi, type ReaderView, type RightTab } from "./context";
import { ChapterView } from "./chapter-view";
import { SourceView } from "./source-view";
import { BookmarksView, FlashcardsView, NotesView, QuizView, RevisionView, jumpToAnchor } from "./study-views";
import { TutorChat, type TutorRequest } from "./tutor-chat";
import { SearchDialog } from "./search-dialog";
import { AssistDialog, SelectionToolbar, type AssistRequest } from "./selection-toolbar";
import { NoteCard } from "./notes";
import { RefChips } from "./ref-chips";

const FONT_SIZES = [15, 17, 18, 20, 22, 25];

export function Reader({ initialBook }: { initialBook: LearningBook }) {
  return (
    <ToastProvider>
      <ReaderInner initialBook={initialBook} />
    </ToastProvider>
  );
}

function ReaderInner({ initialBook }: { initialBook: LearningBook }) {
  const toast = useToast();
  const [book, setBook] = useState(initialBook);
  const pid = book.project.id;
  const [view, setView] = useState<ReaderView>("learn");
  const [page, setPage] = useLocalState<Page>(`als-page-${pid}`, "about");
  const [sourceFocus, setSourceFocus] = useState<number | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("ask");
  const [rightOpen, setRightOpen] = useLocalState("als-right-open", true);
  const [leftOpen, setLeftOpen] = useState(false); // mobile drawer
  const [rightMobile, setRightMobile] = useState(false);
  const [fontIdx, setFontIdx] = useLocalState("als-font", 2);
  const [mode, setMode] = useLocalState<"book" | "clean">("als-mode", "book");
  const [focusMode, setFocusMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [tutorRequest, setTutorRequest] = useState<TutorRequest | null>(null);
  const [assist, setAssist] = useState<AssistRequest | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingAnchor = useRef<string | null>(null);

  const segments = useMemo(() => new Map(book.segments.map((s) => [s.idx, s])), [book.segments]);
  const chapter = book.chapters.find((c) => c.id === page) ?? null;
  const validPage = page === "about" || page === "takeaways" || page === "questions" || !!chapter;

  useEffect(() => {
    if (!validPage) setPage("about");
  }, [validPage, setPage]);

  // Keyboard: Ctrl/Cmd+K search, Escape closes drawers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setLeftOpen(false);
        setRightMobile(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const goTo = useCallback(
    (p: Page, anchor?: string) => {
      setView("learn");
      setPage(p);
      setLeftOpen(false);
      pendingAnchor.current = anchor ?? null;
      if (!anchor) scroller.current?.scrollTo({ top: 0 });
    },
    [setPage],
  );

  // Scroll to a pending anchor after the target page renders.
  useEffect(() => {
    const anchor = pendingAnchor.current;
    if (!anchor || view !== "learn") return;
    const t = setTimeout(() => {
      const el = document.getElementById(anchor);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("flash-target");
        setTimeout(() => el.classList.remove("flash-target"), 1700);
      }
      pendingAnchor.current = null;
    }, 80);
    return () => clearTimeout(t);
  }, [page, view]);

  const openSource = useCallback((idx: number) => {
    setSourceFocus(idx);
    setView("source");
    scroller.current?.scrollTo({ top: 0 });
  }, []);

  // ---- progress -----------------------------------------------------------
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setChapterProgress = useCallback(
    (chapterId: string, percent: number, completed: boolean) => {
      setBook((b) => {
        const others = b.progress.filter((p) => p.chapter_id !== chapterId);
        const prev = b.progress.find((p) => p.chapter_id === chapterId);
        const next = completed ? 100 : Math.max(percent, prev && !prev.completed ? prev.percent : 0);
        return { ...b, progress: [...others, { chapter_id: chapterId, percent: Math.min(next, completed ? 100 : 99), completed }] };
      });
      api<{ progress: number }>(`/api/projects/${pid}/progress`, {
        method: "POST",
        json: { type: "reading", chapterId, percent, completed },
      })
        .then((r) => setBook((b) => ({ ...b, project: { ...b.project, progress_percent: r.progress } })))
        .catch((e) => toast((e as Error).message, "error"));
    },
    [pid, toast],
  );

  // Track scroll depth within the current chapter; auto-complete at the end.
  useEffect(() => {
    const el = scroller.current;
    if (!el || view !== "learn" || !chapter) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      const pct = Math.round((el.scrollTop / max) * 100);
      const current = book.progress.find((p) => p.chapter_id === chapter.id);
      if (current?.completed) return;
      if (progressTimer.current) clearTimeout(progressTimer.current);
      progressTimer.current = setTimeout(() => {
        if (pct >= 97) setChapterProgress(chapter.id, 100, true);
        else if (pct > (current?.percent ?? 0) + 10) setChapterProgress(chapter.id, pct, false);
      }, 1200);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (progressTimer.current) clearTimeout(progressTimer.current);
    };
  }, [view, chapter, book.progress, setChapterProgress]);

  // ---- study layer ----------------------------------------------------------
  const isBookmarked = useCallback((anchor: string) => book.bookmarks.some((b) => b.anchor === anchor), [book.bookmarks]);

  const toggleBookmark = useCallback(
    async (bm: Omit<BookmarkRow, "id" | "created_at">) => {
      const existing = book.bookmarks.find((b) => b.anchor === bm.anchor);
      try {
        if (existing) {
          setBook((b) => ({ ...b, bookmarks: b.bookmarks.filter((x) => x.id !== existing.id) }));
          await api(`/api/projects/${pid}/items/bookmarks/${existing.id}`, { method: "DELETE" });
        } else {
          const row = await api<BookmarkRow>(`/api/projects/${pid}/items/bookmarks`, {
            method: "POST",
            json: {
              chapter_id: bm.chapter_id,
              target_type: bm.target_type,
              anchor: bm.anchor,
              label: bm.label.slice(0, 300),
              excerpt: bm.excerpt?.slice(0, 1000),
            },
          });
          setBook((b) => ({ ...b, bookmarks: [...b.bookmarks, row] }));
          toast("Bookmarked", "ok");
        }
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    [book.bookmarks, pid, toast],
  );

  const addNote = useCallback(
    async (n: { chapter_id: string | null; anchor: string | null; quote: string | null; content: string }) => {
      try {
        const row = await api<NoteRow>(`/api/projects/${pid}/items/notes`, { method: "POST", json: n });
        setBook((b) => ({ ...b, notes: [...b.notes, row] }));
        return row;
      } catch (e) {
        toast((e as Error).message, "error");
        return null;
      }
    },
    [pid, toast],
  );

  const updateNote = useCallback(
    async (id: string, content: string) => {
      setBook((b) => ({ ...b, notes: b.notes.map((n) => (n.id === id ? { ...n, content } : n)) }));
      try {
        await api(`/api/projects/${pid}/items/notes/${id}`, { method: "PATCH", json: { content } });
      } catch (e) {
        toast(`Note not saved: ${(e as Error).message}`, "error");
      }
    },
    [pid, toast],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      setBook((b) => ({ ...b, notes: b.notes.filter((n) => n.id !== id) }));
      await api(`/api/projects/${pid}/items/notes/${id}`, { method: "DELETE" }).catch((e) => toast((e as Error).message, "error"));
    },
    [pid, toast],
  );

  const addHighlight = useCallback(
    async (h: { chapter_id: string | null; anchor: string | null; text: string; color?: string }) => {
      try {
        const row = await api<HighlightRow>(`/api/projects/${pid}/items/highlights`, {
          method: "POST",
          json: { ...h, color: h.color ?? "yellow" },
        });
        setBook((b) => ({ ...b, highlights: [...b.highlights, row] }));
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    [pid, toast],
  );

  const deleteHighlight = useCallback(
    async (id: string) => {
      setBook((b) => ({ ...b, highlights: b.highlights.filter((h) => h.id !== id) }));
      await api(`/api/projects/${pid}/items/highlights/${id}`, { method: "DELETE" }).catch((e) => toast((e as Error).message, "error"));
    },
    [pid, toast],
  );

  const highlightsFor = useCallback((anchor: string) => book.highlights.filter((h) => h.anchor === anchor), [book.highlights]);

  const openNoteEditor = useCallback(
    async (target: { chapter_id: string | null; anchor: string | null; quote: string | null }) => {
      await addNote({ ...target, content: "" });
    },
    [addNote],
  );

  const askTutor = useCallback(
    (message: string, selection?: string) => {
      setRightOpen(true);
      setRightMobile(true);
      setRightTab("ask");
      setTutorRequest({ id: Date.now(), message, selection });
    },
    [setRightOpen],
  );

  const runAssist = useCallback(
    (action: AssistAction, text: string) => setAssist({ id: Date.now(), action, text, chapterId: chapter?.id ?? null }),
    [chapter],
  );

  const apiValue: ReaderApi = {
    book,
    segments,
    view,
    setView,
    page,
    goTo,
    openSource,
    sourceFocus,
    toggleBookmark,
    isBookmarked,
    addNote,
    updateNote,
    deleteNote,
    addHighlight,
    deleteHighlight,
    highlightsFor,
    askTutor,
    runAssist,
    setChapterProgress,
    setProgressPercent: (p) => setBook((b) => ({ ...b, project: { ...b.project, progress_percent: p } })),
    rightTab,
    setRightTab,
    openNoteEditor,
  };

  const chapterIndex = chapter ? book.chapters.findIndex((c) => c.id === chapter.id) : -1;
  const order: Page[] = ["about", ...book.chapters.map((c) => c.id), "takeaways", "questions"];
  const pos = order.indexOf(page);
  const prevPage = pos > 0 ? order[pos - 1] : null;
  const nextPage = pos >= 0 && pos < order.length - 1 ? order[pos + 1] : null;
  const completedCount = book.progress.filter((p) => p.completed && book.chapters.some((c) => c.id === p.chapter_id)).length;

  async function copyMarkdown() {
    try {
      const res = await fetch(`/api/projects/${pid}/export?format=md&inline=1&notes=1`);
      if (!res.ok) throw new Error("Export failed");
      await navigator.clipboard.writeText(await res.text());
      toast("Copied the whole book as Markdown", "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setExportOpen(false);
  }

  const showRight = rightOpen && !focusMode;

  return (
    <ReaderContext.Provider value={apiValue}>
      <div className="flex h-dvh flex-col">
        {/* Top bar */}
        <header className="no-print border-line bg-surface/90 flex h-14 shrink-0 items-center gap-2 border-b px-2 backdrop-blur sm:px-3">
          <span className="contents lg:hidden">
            <IconButton label="Table of contents" onClick={() => setLeftOpen(true)}>
              <Menu className="size-4" />
            </IconButton>
          </span>
          <Link
            href="/dashboard"
            className="text-muted hover:bg-surface-2 hover:text-ink hidden items-center gap-1 rounded-lg px-2 py-1.5 text-sm sm:inline-flex"
          >
            <ArrowLeft className="size-4" /> Library
          </Link>
          <div className="min-w-0 flex-1 px-1">
            <p className="truncate text-sm font-semibold">{book.document.title}</p>
            <div className="flex items-center gap-2">
              <ProgressBar value={book.project.progress_percent} className="h-1 w-24 sm:w-40" label="Learning progress" />
              <span className="text-muted text-[11px] whitespace-nowrap">Learning Progress: {book.project.progress_percent}%</span>
            </div>
          </div>

          <div className="border-line hidden items-center rounded-xl border p-0.5 text-sm md:flex" role="tablist" aria-label="Content">
            <button
              role="tab"
              aria-selected={view !== "source"}
              onClick={() => setView("learn")}
              className={cx(
                "rounded-lg px-3 py-1",
                view !== "source" ? "bg-accent-soft text-accent font-medium" : "text-muted hover:text-ink",
              )}
            >
              AI Learning Material
            </button>
            <button
              role="tab"
              aria-selected={view === "source"}
              onClick={() => setView("source")}
              className={cx(
                "rounded-lg px-3 py-1",
                view === "source" ? "bg-accent-soft text-accent font-medium" : "text-muted hover:text-ink",
              )}
            >
              Original Source
            </button>
          </div>

          <IconButton label="Search (Ctrl+K)" onClick={() => setSearchOpen(true)}>
            <Search className="size-4" />
          </IconButton>
          <div className="hidden items-center sm:flex">
            <IconButton label="Smaller text" onClick={() => setFontIdx((i) => Math.max(0, i - 1))} disabled={fontIdx === 0}>
              <Minus className="size-4" />
            </IconButton>
            <span className="text-muted w-6 text-center text-xs" aria-label={`Font size ${FONT_SIZES[fontIdx]}px`}>
              Aa
            </span>
            <IconButton
              label="Larger text"
              onClick={() => setFontIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1))}
              disabled={fontIdx === FONT_SIZES.length - 1}
            >
              <Plus className="size-4" />
            </IconButton>
          </div>
          <span className="hidden sm:contents">
            <IconButton
              label={mode === "book" ? "Reading mode: Book (serif) — switch to Clean" : "Reading mode: Clean — switch to Book"}
              onClick={() => setMode(mode === "book" ? "clean" : "book")}
            >
              <BookOpen className="size-4" />
            </IconButton>
          </span>
          <span className="hidden lg:contents">
            <IconButton label={focusMode ? "Exit focus mode" : "Focus mode"} active={focusMode} onClick={() => setFocusMode((f) => !f)}>
              <Target className="size-4" />
            </IconButton>
          </span>
          <ThemeToggle withSepia />
          <div className="relative">
            <IconButton label="Export" onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen}>
              <Download className="size-4" />
            </IconButton>
            {exportOpen && (
              <div
                className="border-line bg-surface absolute right-0 z-40 mt-1 w-60 rounded-xl border p-1 text-sm shadow-xl"
                onMouseLeave={() => setExportOpen(false)}
              >
                <a href={`/p/${pid}/print`} target="_blank" className="hover:bg-surface-2 flex items-center gap-2 rounded-lg px-3 py-2">
                  <Printer className="size-4" /> PDF / printable study book
                </a>
                <a
                  href={`/api/projects/${pid}/export?format=docx`}
                  className="hover:bg-surface-2 flex items-center gap-2 rounded-lg px-3 py-2"
                >
                  <FileText className="size-4" /> Word (.docx)
                </a>
                <a
                  href={`/api/projects/${pid}/export?format=md&notes=1`}
                  className="hover:bg-surface-2 flex items-center gap-2 rounded-lg px-3 py-2"
                >
                  <FileText className="size-4" /> Markdown (with my notes)
                </a>
                <a
                  href={`/api/projects/${pid}/export?format=txt`}
                  className="hover:bg-surface-2 flex items-center gap-2 rounded-lg px-3 py-2"
                >
                  <FileText className="size-4" /> Plain text (.txt)
                </a>
                <button onClick={copyMarkdown} className="hover:bg-surface-2 flex w-full items-center gap-2 rounded-lg px-3 py-2">
                  <ClipboardCopy className="size-4" /> Copy to clipboard
                </button>
              </div>
            )}
          </div>
          <span className="hidden xl:contents">
            <IconButton label={showRight ? "Hide study panel" : "Show study panel"} onClick={() => setRightOpen(!rightOpen)}>
              {showRight ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            </IconButton>
          </span>
          <span className="contents xl:hidden">
            <IconButton label="Ask AI" onClick={() => setRightMobile(true)}>
              <MessageSquare className="size-4" />
            </IconButton>
          </span>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* Left sidebar */}
          {!focusMode && (
            <>
              {leftOpen && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setLeftOpen(false)} />}
              <nav
                aria-label="Table of contents"
                className={cx(
                  "no-print border-line bg-surface w-72 shrink-0 scrollbar-thin overflow-y-auto border-r lg:static lg:block",
                  leftOpen ? "fixed inset-y-0 left-0 z-40 block shadow-2xl" : "hidden",
                )}
              >
                <div className="flex items-center justify-between p-4 pb-2 lg:hidden">
                  <span className="font-semibold">Contents</span>
                  <IconButton label="Close" onClick={() => setLeftOpen(false)}>
                    <X className="size-4" />
                  </IconButton>
                </div>
                <TocSidebar
                  book={book}
                  page={page}
                  view={view}
                  completedCount={completedCount}
                  onPage={goTo}
                  onView={(v) => {
                    setView(v);
                    setLeftOpen(false);
                    scroller.current?.scrollTo({ top: 0 });
                  }}
                />
              </nav>
            </>
          )}

          {/* Main */}
          <main ref={scroller} className="min-w-0 flex-1 scrollbar-thin overflow-y-auto" id="main">
            <div className="mx-auto max-w-[44rem] px-5 py-10 sm:px-8">
              <div className="border-line mb-6 flex rounded-xl border p-0.5 text-sm md:hidden" role="tablist">
                <button
                  role="tab"
                  aria-selected={view !== "source"}
                  onClick={() => setView("learn")}
                  className={cx("flex-1 rounded-lg px-3 py-1.5", view !== "source" && "bg-accent-soft text-accent font-medium")}
                >
                  AI Material
                </button>
                <button
                  role="tab"
                  aria-selected={view === "source"}
                  onClick={() => setView("source")}
                  className={cx("flex-1 rounded-lg px-3 py-1.5", view === "source" && "bg-accent-soft text-accent font-medium")}
                >
                  Original Source
                </button>
              </div>
              <div
                ref={contentRef}
                className="reader-content"
                data-mode={mode}
                style={{ ["--reader-size" as string]: `${FONT_SIZES[fontIdx] ?? 18}px` }}
              >
                {view === "source" ? (
                  <SourceView />
                ) : view === "revise" ? (
                  <RevisionView />
                ) : view === "flashcards" ? (
                  <FlashcardsView />
                ) : view === "quiz" ? (
                  <QuizView />
                ) : view === "bookmarks" ? (
                  <BookmarksView />
                ) : view === "notes" ? (
                  <NotesView />
                ) : chapter ? (
                  <ChapterView key={chapter.id} chapter={chapter} number={chapterIndex + 1} prev={prevPage} next={nextPage} />
                ) : page === "takeaways" ? (
                  <TakeawaysPage next={nextPage} />
                ) : page === "questions" ? (
                  <QuestionsPage />
                ) : (
                  <AboutPage next={nextPage} />
                )}
              </div>
            </div>
          </main>

          {/* Right panel */}
          {rightMobile && <div className="fixed inset-0 z-30 bg-black/30 xl:hidden" onClick={() => setRightMobile(false)} />}
          <aside
            aria-label="Study panel"
            className={cx(
              "no-print border-line bg-surface flex w-[22rem] shrink-0 flex-col border-l",
              rightMobile ? "fixed inset-y-0 right-0 z-40 max-w-[92vw] shadow-2xl" : "hidden",
              showRight && "xl:static xl:flex",
            )}
          >
            <div className="border-line flex items-center gap-1 border-b p-2" role="tablist" aria-label="Study panel">
              {(
                [
                  ["ask", "Ask AI", <GraduationCap key="a" className="size-4" />],
                  ["notes", "Notes", <StickyNote key="n" className="size-4" />],
                  ["highlights", "Highlights", <Highlighter key="h" className="size-4" />],
                  ["questions", "Questions", <HelpCircle key="q" className="size-4" />],
                ] as const
              ).map(([id, label, icon]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={rightTab === id}
                  onClick={() => setRightTab(id)}
                  className={cx(
                    "flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px]",
                    rightTab === id ? "bg-accent-soft text-accent font-medium" : "text-muted hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  {icon}
                  {label}
                </button>
              ))}
              <IconButton label="Close panel" className="xl:hidden" onClick={() => setRightMobile(false)}>
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden pt-3">
              <div className={cx("h-full", rightTab !== "ask" && "hidden")}>
                <TutorChat request={tutorRequest} chapterId={chapter?.id ?? null} />
              </div>
              {rightTab === "notes" && <NotesPanel chapterId={chapter?.id ?? null} />}
              {rightTab === "highlights" && <HighlightsPanel />}
              {rightTab === "questions" && <QuestionsPanel chapterId={chapter?.id ?? null} />}
            </div>
          </aside>
        </div>
      </div>

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} book={book} onPick={(p, a) => goTo(p, a)} />
      <SelectionToolbar container={contentRef} />
      <AssistDialog request={assist} onClose={() => setAssist(null)} />
    </ReaderContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Left sidebar
// ---------------------------------------------------------------------------
function TocSidebar({
  book,
  page,
  view,
  completedCount,
  onPage,
  onView,
}: {
  book: LearningBook;
  page: Page;
  view: ReaderView;
  completedCount: number;
  onPage: (p: Page, anchor?: string) => void;
  onView: (v: ReaderView) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const item = (active: boolean) =>
    cx(
      "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
      active ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-surface-2",
    );
  const learn = view === "learn";
  const done = (id: string) => book.progress.some((p) => p.chapter_id === id && p.completed);

  return (
    <div className="p-3">
      <p className="text-muted px-3 pt-2 pb-1 text-[11px] font-semibold tracking-[0.14em] uppercase">Table of Contents</p>
      <p className="text-muted px-3 pb-2 text-xs">
        {completedCount} of {book.chapters.length} chapters completed
      </p>
      <ol className="space-y-0.5">
        <li>
          <button className={item(learn && page === "about")} onClick={() => onPage("about")}>
            <ListTree className="mt-0.5 size-4 shrink-0" /> Introduction & overview
          </button>
        </li>
        {book.chapters.map((c, i) => {
          const active = learn && page === c.id;
          return (
            <li key={c.id}>
              <button
                className={item(active)}
                onClick={() => {
                  onPage(c.id);
                  setExpanded(c.id);
                }}
                aria-current={active ? "page" : undefined}
              >
                {done(c.id) ? (
                  <CheckCircle2 className="text-ok mt-0.5 size-4 shrink-0" aria-label="Completed" />
                ) : (
                  <span className="text-muted mt-0.5 flex size-4 shrink-0 items-center justify-center text-[11px] tabular-nums">
                    {i + 1}
                  </span>
                )}
                <span>{c.title}</span>
              </button>
              {(active || expanded === c.id) && c.sections.length > 1 && (
                <ol className="border-line mt-0.5 mb-1 ml-9 space-y-0.5 border-l pl-2">
                  {c.sections.map((s) => (
                    <li key={s.id}>
                      <button
                        className="text-muted hover:bg-surface-2 hover:text-ink w-full rounded-md px-2 py-1 text-left text-xs"
                        onClick={() => onPage(c.id, `sec-${s.id}`)}
                      >
                        {s.title}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
        <li>
          <button className={item(learn && page === "takeaways")} onClick={() => onPage("takeaways")}>
            <Check className="mt-0.5 size-4 shrink-0" /> Key Takeaways
          </button>
        </li>
        <li>
          <button className={item(learn && page === "questions")} onClick={() => onPage("questions")}>
            <HelpCircle className="mt-0.5 size-4 shrink-0" /> Revision Questions
          </button>
        </li>
      </ol>

      <p className="text-muted mt-6 px-3 pb-1 text-[11px] font-semibold tracking-[0.14em] uppercase">Study</p>
      <ul className="space-y-0.5">
        {(
          [
            ["revise", "Quick Revision", <Check key="r" className="size-4" />, null],
            ["flashcards", "Flashcards", <Layers key="f" className="size-4" />, book.flashcards.length],
            ["quiz", "Quiz", <Trophy key="q" className="size-4" />, book.quiz.length],
            ["bookmarks", "My Bookmarks", <Bookmark key="b" className="size-4" />, book.bookmarks.length],
            ["notes", "My Notes", <StickyNote key="n" className="size-4" />, book.notes.length],
          ] as const
        ).map(([v, label, icon, count]) => (
          <li key={v}>
            <button className={item(view === v)} onClick={() => onView(v)}>
              <span className="mt-0.5 shrink-0">{icon}</span>
              <span className="flex-1">{label}</span>
              {count ? <span className="text-muted text-xs tabular-nums">{count}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {book.bookmarks.length > 0 && (
        <>
          <p className="text-muted mt-6 px-3 pb-1 text-[11px] font-semibold tracking-[0.14em] uppercase">Recent bookmarks</p>
          <BookmarkShortcuts />
        </>
      )}
    </div>
  );
}

function BookmarkShortcuts() {
  const r = useReaderSafe();
  if (!r) return null;
  return (
    <ul className="space-y-0.5">
      {r.book.bookmarks
        .slice(-5)
        .reverse()
        .map((b) => (
          <li key={b.id}>
            <button
              className="text-ink-2 hover:bg-surface-2 w-full truncate rounded-md px-3 py-1.5 text-left text-xs"
              onClick={() => jumpToAnchor(r, b.anchor, b.chapter_id)}
            >
              🔖 {b.label}
            </button>
          </li>
        ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Special pages
// ---------------------------------------------------------------------------
function useReaderSafe() {
  return useContext(ReaderContext);
}

function NextButton({ next, label }: { next: Page | null; label?: string }) {
  const r = useReaderSafe();
  if (!next || !r) return null;
  const title = r.book.chapters.find((c) => c.id === next)?.title ?? (next === "takeaways" ? "Key Takeaways" : "Revision Questions");
  return (
    <div className="border-line mt-12 flex justify-end border-t pt-6 font-sans">
      <button
        onClick={() => r.goTo(next)}
        className="bg-accent text-accent-ink rounded-xl px-5 py-2.5 text-sm font-medium hover:opacity-90"
      >
        {label ?? "Continue"}: {title} →
      </button>
    </div>
  );
}

function AboutPage({ next }: { next: Page | null }) {
  const r = useReaderSafe()!;
  const { book } = r;
  const plan = book.document.plan;
  const q = book.document.quality_report;
  return (
    <article>
      <p className="text-accent font-sans text-xs font-semibold tracking-[0.18em] uppercase">Your learning book</p>
      <h1 className="mt-2 text-[2.1em] leading-tight font-semibold tracking-tight">{book.document.title}</h1>
      {book.document.subtitle && <p className="text-ink-2 mt-3 text-[1.1em]">{book.document.subtitle}</p>}
      <div className="mt-5 flex flex-wrap gap-2 font-sans text-sm">
        <Badge>Based on: {book.source.title}</Badge>
        <Badge>{book.chapters.length} chapters</Badge>
        {q.average != null && <Badge tone="ok">Quality check {q.average}/10</Badge>}
        <Badge tone="accent">
          {book.project.settings.language === "hinglish" ? "Hinglish" : book.project.settings.language === "hi" ? "Hindi" : "English"}
        </Badge>
      </div>

      <div className="mt-8 space-y-4">
        {plan.overview.split(/\n+/).map((p, i) => (
          <p key={i}>
            <RichText text={p} />
          </p>
        ))}
      </div>

      <section className="mt-10 font-sans">
        <h2 className="text-lg font-semibold">Table of Contents</h2>
        <ol className="mt-3 space-y-1">
          {book.chapters.map((c, i) => (
            <li key={c.id}>
              <button
                onClick={() => r.goTo(c.id)}
                className="group hover:bg-surface-2 flex w-full items-baseline gap-3 rounded-lg px-2 py-1.5 text-left"
              >
                <span className="text-muted w-6 text-sm tabular-nums">{i + 1}.</span>
                <span className="group-hover:text-accent flex-1 font-medium">{c.title}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              onClick={() => r.goTo("takeaways")}
              className="hover:bg-surface-2 flex w-full items-baseline gap-3 rounded-lg px-2 py-1.5 text-left"
            >
              <span className="text-muted w-6 text-sm">{book.chapters.length + 1}.</span>
              <span className="font-medium">Key Takeaways</span>
            </button>
          </li>
          <li>
            <button
              onClick={() => r.goTo("questions")}
              className="hover:bg-surface-2 flex w-full items-baseline gap-3 rounded-lg px-2 py-1.5 text-left"
            >
              <span className="text-muted w-6 text-sm">{book.chapters.length + 2}.</span>
              <span className="font-medium">Revision Questions</span>
            </button>
          </li>
        </ol>
      </section>

      {plan.concept_tree?.length > 0 && (
        <section className="mt-10 font-sans">
          <h2 className="text-lg font-semibold">🧩 Concept map</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {plan.concept_tree.map((c) => (
              <div key={c.name} className="border-line bg-surface rounded-xl border p-4">
                <p className="font-semibold">{c.name}</p>
                <ul className="text-ink-2 mt-2 space-y-1 text-sm">
                  {c.children.map((ch) => (
                    <li key={ch}>→ {ch}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {plan.glossary?.length > 0 && (
        <section className="mt-10 font-sans">
          <h2 className="text-lg font-semibold">Glossary</h2>
          <dl className="divide-line border-line bg-surface mt-3 divide-y rounded-xl border">
            {plan.glossary.map((g) => (
              <div key={g.term} className="p-3">
                <dt className="font-semibold">{g.term}</dt>
                <dd className="text-ink-2 text-sm">
                  <RichText text={g.meaning} /> <RefChips refs={g.refs} className="ml-1" />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <aside className="border-line bg-surface-2/60 text-ink-2 mt-10 rounded-xl border p-4 font-sans text-sm">
        <p className="text-ink font-semibold">How to read the labels</p>
        <ul className="mt-2 space-y-1">
          <li>
            Source chips (e.g. <em>02:34–04:18</em>, <em>Page 12</em>) link to the exact part of the original.
          </li>
          <li>
            <Badge tone="warn">AI-generated example</Badge> and <Badge tone="violet">Additional explanation</Badge> mark content that is not
            in the source.
          </li>
          <li>Select any text for: explain simply, example, explain again, important points, notes, highlight or ask AI.</li>
        </ul>
      </aside>
      <NextButton next={next} label="Start reading" />
    </article>
  );
}

function TakeawaysPage({ next }: { next: Page | null }) {
  const { book } = useReaderSafe()!;
  const r = book.document.revision;
  return (
    <article>
      <p className="text-accent font-sans text-xs font-semibold tracking-[0.18em] uppercase">Summary</p>
      <h1 className="mt-2 text-[1.9em] font-semibold tracking-tight">Key Takeaways</h1>
      <ul className="mt-8 space-y-4">
        {r.key_takeaways.map((t, i) => (
          <li key={i} className="flex gap-3">
            <CheckCircle2 className="text-ok mt-1 size-5 shrink-0" />
            <span>
              <RichText text={t} />
            </span>
          </li>
        ))}
      </ul>
      <h2 className="mt-12 text-[1.3em] font-semibold">By chapter</h2>
      <ol className="mt-4 space-y-3">
        {book.chapters.map((c, i) =>
          c.key_takeaway ? (
            <li key={c.id} className="border-line bg-surface rounded-xl border p-4">
              <p className="text-muted font-sans text-xs">
                Chapter {i + 1} · {c.title}
              </p>
              <p className="mt-1">
                <RichText text={c.key_takeaway} />
              </p>
            </li>
          ) : null,
        )}
      </ol>
      <NextButton next={next} />
    </article>
  );
}

function QuestionsPage() {
  const r = useReaderSafe()!;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const markAll = () => setOpen(new Set(r.book.questions.map((q) => q.id)));
  return (
    <article>
      <p className="text-accent font-sans text-xs font-semibold tracking-[0.18em] uppercase">Check yourself</p>
      <h1 className="mt-2 text-[1.9em] font-semibold tracking-tight">Revision Questions</h1>
      <p className="text-muted mt-2 font-sans text-sm">
        Try answering each one in your head first. Want more practice?{" "}
        <button className="text-accent hover:underline" onClick={() => r.setView("quiz")}>
          Take the quiz
        </button>{" "}
        or{" "}
        <button className="text-accent hover:underline" onClick={() => r.setView("flashcards")}>
          review flashcards
        </button>
        .
      </p>
      <div className="mt-4 text-right font-sans">
        <button onClick={markAll} className="text-accent text-sm hover:underline">
          Reveal all answers
        </button>
      </div>
      <ol className="mt-4 space-y-4">
        {r.book.questions.map((q, i) => {
          const isOpen = open.has(q.id);
          const bm = `question:${q.id}`;
          return (
            <li key={q.id} id={`q-${q.id}`} className="border-line bg-surface rounded-xl border p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">
                  {i + 1}. <RichText text={q.question} />
                </p>
                <button
                  onClick={() =>
                    r.toggleBookmark({
                      chapter_id: q.chapter_id,
                      target_type: "question",
                      anchor: bm,
                      label: q.question,
                      excerpt: q.answer.slice(0, 240),
                    })
                  }
                  className={cx("rounded p-1", r.isBookmarked(bm) ? "text-accent" : "text-muted hover:text-ink")}
                  aria-label="Bookmark question"
                >
                  <Bookmark className="size-4" />
                </button>
              </div>
              {isOpen ? (
                <div className="mt-3">
                  <p className="text-ink-2">
                    <RichText text={q.answer} />
                  </p>
                  <RefChips refs={q.source_refs} className="mt-2" />
                </div>
              ) : (
                <button onClick={() => setOpen((s) => new Set(s).add(q.id))} className="text-accent mt-2 font-sans text-sm hover:underline">
                  Show answer
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Right panel tabs
// ---------------------------------------------------------------------------
function NotesPanel({ chapterId }: { chapterId: string | null }) {
  const r = useReaderSafe()!;
  const notes = r.book.notes.filter((n) => (chapterId ? n.chapter_id === chapterId : true));
  return (
    <div className="h-full scrollbar-thin overflow-y-auto px-4 pb-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{chapterId ? "Notes for this chapter" : "All notes"}</p>
        <button
          className="text-accent inline-flex items-center gap-1 text-sm hover:underline"
          onClick={() => r.openNoteEditor({ chapter_id: chapterId, anchor: null, quote: null })}
        >
          <Plus className="size-3.5" /> New note
        </button>
      </div>
      {!notes.length && <p className="text-muted mt-6 text-sm">No notes yet. Your notes are saved automatically as you type.</p>}
      {notes.map((n) => (
        <div key={n.id}>
          {n.quote && <p className="border-line text-muted mt-4 line-clamp-2 border-l-2 pl-2 text-xs">{n.quote}</p>}
          <NoteCard note={n} compact />
        </div>
      ))}
    </div>
  );
}

function HighlightsPanel() {
  const r = useReaderSafe()!;
  const items = r.book.highlights;
  return (
    <div className="h-full scrollbar-thin overflow-y-auto px-4 pb-4">
      <p className="text-sm font-semibold">Highlights</p>
      {!items.length && <p className="text-muted mt-6 text-sm">Select text in a chapter and choose the highlighter to save it here.</p>}
      <ul className="mt-3 space-y-2">
        {items.map((h) => (
          <li key={h.id} className="group border-line rounded-xl border p-3 text-sm">
            <button className="text-left" onClick={() => h.anchor && jumpToAnchor(r, h.anchor, h.chapter_id)}>
              <mark className="hl" data-color={h.color}>
                {h.text.length > 240 ? h.text.slice(0, 240) + "…" : h.text}
              </mark>
            </button>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted text-xs">{r.book.chapters.find((c) => c.id === h.chapter_id)?.title}</span>
              <button
                onClick={() => r.deleteHighlight(h.id)}
                className="text-muted hover:text-danger rounded p-1"
                aria-label="Remove highlight"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuestionsPanel({ chapterId }: { chapterId: string | null }) {
  const r = useReaderSafe()!;
  const [open, setOpen] = useState<string | null>(null);
  const chapter = r.book.chapters.find((c) => c.id === chapterId);
  const inChapter = chapter
    ? chapter.sections.flatMap((s) => s.blocks.map((b, i) => ({ b, anchor: `blk-${s.id}-${i}` }))).filter((x) => x.b.type === "qa")
    : [];
  const revision = r.book.questions.filter((q) => !chapterId || q.chapter_id === chapterId);
  return (
    <div className="h-full scrollbar-thin overflow-y-auto px-4 pb-4 text-sm">
      <p className="font-semibold">Related questions</p>
      {!inChapter.length && !revision.length && <p className="text-muted mt-6">Open a chapter to see its questions.</p>}
      {inChapter.length > 0 && (
        <>
          <p className="text-muted mt-3 text-xs font-medium uppercase">In this chapter</p>
          <ul className="mt-1 space-y-1">
            {inChapter.map(({ b, anchor }) => (
              <li key={anchor}>
                <button onClick={() => r.goTo(chapterId!, anchor)} className="hover:bg-surface-2 w-full rounded-lg px-2 py-1.5 text-left">
                  ❓ {b.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {revision.length > 0 && (
        <>
          <p className="text-muted mt-4 text-xs font-medium uppercase">Test yourself</p>
          <ul className="mt-1 space-y-1">
            {revision.map((q) => (
              <li key={q.id} className="border-line rounded-lg border">
                <button
                  onClick={() => setOpen(open === q.id ? null : q.id)}
                  className="w-full px-3 py-2 text-left font-medium"
                  aria-expanded={open === q.id}
                >
                  {q.question}
                </button>
                {open === q.id && (
                  <div className="text-ink-2 px-3 pb-3">
                    <RichText text={q.answer} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <button
        onClick={() => r.askTutor("What other questions should I be able to answer after this chapter? Ask me one at a time.")}
        className="border-line text-muted hover:border-accent hover:text-accent mt-5 w-full rounded-xl border border-dashed px-3 py-2"
      >
        Quiz me with the tutor →
      </button>
    </div>
  );
}
