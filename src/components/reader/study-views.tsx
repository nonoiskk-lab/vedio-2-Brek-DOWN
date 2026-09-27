"use client";
import { useMemo, useState } from "react";
import {
  Bookmark,
  BookmarkX,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Layers,
  RotateCcw,
  Shuffle,
  StickyNote,
  Trophy,
  X,
} from "lucide-react";
import { api } from "@/lib/client/api";
import type { FlashcardRow, QuizQuestionRow } from "@/lib/content/types";
import { Badge, Button, Card, EmptyState, ProgressBar, cx, useToast } from "@/components/ui";
import { RichText } from "@/components/ui/rich-text";
import { RefChips } from "./ref-chips";
import { useReader } from "./context";
import { NoteCard } from "./notes";

function ChapterFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { book } = useReader();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filter by chapter"
      className="border-line bg-surface h-9 rounded-lg border px-2 text-sm"
    >
      <option value="all">All chapters</option>
      {book.chapters.map((c, i) => (
        <option key={c.id} value={c.id}>
          {i + 1}. {c.title}
        </option>
      ))}
    </select>
  );
}

function chapterTitle(book: ReturnType<typeof useReader>["book"], id: string | null) {
  const i = book.chapters.findIndex((c) => c.id === id);
  return i >= 0 ? `Chapter ${i + 1}: ${book.chapters[i].title}` : null;
}

// ---------------------------------------------------------------------------
// Revision
// ---------------------------------------------------------------------------
export function RevisionView() {
  const { book, goTo } = useReader();
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const r = book.document.revision;
  return (
    <div className="space-y-10 font-sans">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Quick Revision</h1>
        <p className="text-muted mt-1">The most important points — a five-minute refresher.</p>
      </header>
      <ol className="space-y-3">
        {r.quick_revision.map((p, i) => (
          <li key={i} className="border-line bg-surface flex gap-3 rounded-xl border p-4">
            <span className="bg-accent-soft text-accent flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
              {i + 1}
            </span>
            <span className="pt-0.5">
              <RichText text={p} />
            </span>
          </li>
        ))}
      </ol>
      <section>
        <h2 className="text-lg font-semibold">Key Takeaways</h2>
        <ul className="mt-3 space-y-2">
          {r.key_takeaways.map((t, i) => (
            <li key={i} className="flex gap-2">
              <Check className="text-ok mt-1 size-4 shrink-0" /> <RichText text={t} />
            </li>
          ))}
        </ul>
      </section>
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Revision Questions</h2>
          <button onClick={() => setRevealed(new Set(book.questions.map((q) => q.id)))} className="text-accent text-sm hover:underline">
            Reveal all
          </button>
        </div>
        <ol className="mt-3 space-y-3">
          {book.questions.map((q, i) => {
            const open = revealed.has(q.id);
            return (
              <li key={q.id} className="border-line bg-surface rounded-xl border p-4">
                <p className="font-medium">
                  {i + 1}. <RichText text={q.question} />
                </p>
                {open ? (
                  <div className="text-ink-2 mt-2 space-y-2">
                    <p>
                      <RichText text={q.answer} />
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {q.chapter_id && (
                        <button onClick={() => goTo(q.chapter_id!)} className="text-accent text-xs hover:underline">
                          {chapterTitle(book, q.chapter_id)}
                        </button>
                      )}
                      <RefChips refs={q.source_refs} />
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setRevealed((s) => new Set(s).add(q.id))}
                    className="text-accent mt-2 inline-flex items-center gap-1 text-sm hover:underline"
                  >
                    <Eye className="size-3.5" /> Think first, then reveal the answer
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flashcards
// ---------------------------------------------------------------------------
export function FlashcardsView() {
  const { book, setProgressPercent } = useReader();
  const toast = useToast();
  const [filter, setFilter] = useState("all");
  const [order, setOrder] = useState<string[] | null>(null);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [cards, setCards] = useState<FlashcardRow[]>(book.flashcards);

  const deck = useMemo(() => {
    const base = cards.filter((c) => filter === "all" || c.chapter_id === filter);
    if (!order) return base;
    return order.map((id) => base.find((c) => c.id === id)).filter((c): c is FlashcardRow => !!c);
  }, [cards, filter, order]);

  if (!book.flashcards.length) return <EmptyState icon={<Layers className="size-10" />} title="No flashcards for this book" />;
  const card = deck[Math.min(i, deck.length - 1)];
  const reviewed = cards.filter((c) => c.review_count > 0).length;

  async function grade(result: "again" | "good" | "easy") {
    if (!card) return;
    setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, review_count: c.review_count + 1, last_result: result } : c)));
    setFlipped(false);
    setI((n) => (n + 1 < deck.length ? n + 1 : 0));
    try {
      const res = await api<{ progress: number }>(`/api/projects/${book.project.id}/progress`, {
        method: "POST",
        json: { type: "flashcard", flashcardId: card.id, result },
      });
      setProgressPercent(res.progress);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="font-sans">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Flashcards</h1>
          <p className="text-muted mt-1">
            {reviewed} of {cards.length} reviewed
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ChapterFilter
            value={filter}
            onChange={(v) => {
              setFilter(v);
              setI(0);
              setFlipped(false);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setOrder(cards.map((c) => c.id).sort(() => Math.random() - 0.5));
              setI(0);
              setFlipped(false);
            }}
          >
            <Shuffle className="size-4" /> Shuffle
          </Button>
        </div>
      </header>
      <ProgressBar value={(reviewed / cards.length) * 100} className="mt-4" label="Flashcards reviewed" />
      {card ? (
        <div className="mt-8">
          <p className="text-muted mb-2 text-center text-sm">
            Card {Math.min(i, deck.length - 1) + 1} of {deck.length}
          </p>
          <button
            className="card-flip block w-full"
            onClick={() => setFlipped((f) => !f)}
            aria-label={flipped ? "Show question" : "Show answer"}
          >
            <div className={cx("card-flip-inner relative min-h-64", flipped && "flipped")}>
              <Card className="card-face absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
                <Badge tone="accent">Question</Badge>
                <p className="mt-4 font-serif text-2xl leading-snug">
                  <RichText text={card.front} />
                </p>
                <p className="text-muted mt-6 text-xs">Tap to flip</p>
              </Card>
              <Card className="card-face card-back absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
                <Badge tone="ok">Answer</Badge>
                <p className="mt-4 text-lg leading-relaxed">
                  <RichText text={card.back} />
                </p>
                <p className="text-muted mt-4 text-xs">{chapterTitle(book, card.chapter_id)}</p>
              </Card>
            </div>
          </button>
          <div className="mt-4 flex justify-center">
            <RefChips refs={card.source_refs} />
          </div>
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Previous card"
              onClick={() => {
                setI((n) => Math.max(0, n - 1));
                setFlipped(false);
              }}
            >
              <ChevronLeft className="size-4" />
            </Button>
            {flipped ? (
              <>
                <Button variant="secondary" onClick={() => grade("again")}>
                  <RotateCcw className="size-4" /> Again
                </Button>
                <Button variant="secondary" onClick={() => grade("good")}>
                  Good
                </Button>
                <Button onClick={() => grade("easy")}>Easy</Button>
              </>
            ) : (
              <Button onClick={() => setFlipped(true)}>Show answer</Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-label="Next card"
              onClick={() => {
                setI((n) => Math.min(deck.length - 1, n + 1));
                setFlipped(false);
              }}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : (
        <EmptyState icon={<Layers className="size-10" />} title="No cards in this chapter" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------
const KIND_LABEL: Record<QuizQuestionRow["kind"], string> = {
  mcq: "Multiple choice",
  true_false: "True / False",
  short: "Short answer",
  concept: "Concept question",
};

interface Result {
  response: string;
  isCorrect: boolean;
}

export function QuizView() {
  const { book, setProgressPercent, goTo } = useReader();
  const toast = useToast();
  const [filter, setFilter] = useState("all");
  const [results, setResults] = useState<Record<string, Result>>(() => {
    const out: Record<string, Result> = {};
    for (const a of book.attempts) out[a.question_id] = { response: a.response, isCorrect: a.is_correct };
    return out;
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const questions = book.quiz.filter((q) => filter === "all" || q.chapter_id === filter);
  const answered = questions.filter((q) => results[q.id]);
  const correct = answered.filter((q) => results[q.id].isCorrect).length;

  if (!book.quiz.length) return <EmptyState icon={<Trophy className="size-10" />} title="No quiz for this book" />;

  async function submit(q: QuizQuestionRow, response: string, selfAssessedCorrect?: boolean) {
    const local = q.kind === "mcq" || q.kind === "true_false" ? response === q.answer : !!selfAssessedCorrect;
    setResults((r) => ({ ...r, [q.id]: { response, isCorrect: local } }));
    try {
      const res = await api<{ progress: number; isCorrect: boolean }>(`/api/projects/${book.project.id}/progress`, {
        method: "POST",
        json: { type: "quiz", questionId: q.id, response, selfAssessedCorrect },
      });
      setResults((r) => ({ ...r, [q.id]: { response, isCorrect: res.isCorrect } }));
      setProgressPercent(res.progress);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function reset() {
    if (!confirm("Clear all your quiz answers and start again?")) return;
    setResults({});
    setDrafts({});
    setRevealed(new Set());
    try {
      const res = await api<{ progress: number }>(`/api/projects/${book.project.id}/progress`, {
        method: "POST",
        json: { type: "reset-quiz" },
      });
      setProgressPercent(res.progress);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="font-sans">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Quiz</h1>
          <p className="text-muted mt-1">
            Score: <strong className="text-ink">{correct}</strong> / {answered.length} answered · {questions.length} questions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ChapterFilter value={filter} onChange={setFilter} />
          <Button variant="secondary" size="sm" onClick={reset}>
            <RotateCcw className="size-4" /> Reset
          </Button>
        </div>
      </header>
      <ProgressBar value={(answered.length / Math.max(questions.length, 1)) * 100} className="mt-4" label="Quiz progress" />
      {answered.length === questions.length && questions.length > 0 && (
        <Card className="mt-6 flex items-center gap-4 p-5">
          <Trophy className="text-warn size-8" />
          <div>
            <p className="font-semibold">
              You scored {correct} out of {questions.length} ({Math.round((correct / questions.length) * 100)}%)
            </p>
            <p className="text-muted text-sm">Review the explanations below, then revisit the chapters for anything you missed.</p>
          </div>
        </Card>
      )}
      <ol className="mt-6 space-y-5">
        {questions.map((q, n) => {
          const res = results[q.id];
          const objective = q.kind === "mcq" || q.kind === "true_false";
          return (
            <li key={q.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge>{KIND_LABEL[q.kind]}</Badge>
                  {res && (res.isCorrect ? <Badge tone="ok">Correct</Badge> : <Badge tone="danger">Not quite</Badge>)}
                </div>
                <p className="mt-3 font-medium">
                  {n + 1}. <RichText text={q.prompt} />
                </p>

                {objective ? (
                  <div className="mt-3 grid gap-2">
                    {q.options.map((opt) => {
                      const chosen = res?.response === opt;
                      const isAnswer = res && opt === q.answer;
                      return (
                        <button
                          key={opt}
                          disabled={!!res}
                          onClick={() => submit(q, opt)}
                          className={cx(
                            "flex items-center justify-between rounded-xl border px-4 py-2.5 text-left text-sm transition",
                            !res && "border-line hover:border-accent hover:bg-accent-soft",
                            isAnswer && "border-ok bg-ok-soft",
                            chosen && !res?.isCorrect && "border-danger bg-danger-soft",
                            res && !isAnswer && !chosen && "border-line opacity-60",
                          )}
                        >
                          <RichText text={opt} />
                          {isAnswer && <Check className="text-ok size-4" />}
                          {chosen && !res?.isCorrect && <X className="text-danger size-4" />}
                        </button>
                      );
                    })}
                  </div>
                ) : res ? (
                  <p className="bg-surface-2 mt-3 rounded-lg p-3 text-sm">
                    <span className="text-muted">Your answer: </span>
                    {res.response || <em>(no answer)</em>}
                  </p>
                ) : revealed.has(q.id) ? (
                  <div className="mt-3 space-y-3">
                    <p className="bg-surface-2 rounded-lg p-3 text-sm">
                      <span className="text-muted">Your answer: </span>
                      {drafts[q.id] || <em>(no answer)</em>}
                    </p>
                    <div className="border-ok/30 bg-ok-soft/50 rounded-lg border p-3 text-sm">
                      <p className="text-ok text-xs font-semibold">Model answer</p>
                      <RichText text={q.answer} />
                    </div>
                    <p className="text-sm">Did you get it?</p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => submit(q, drafts[q.id] ?? "", true)}>
                        <Check className="size-4" /> Yes, I got it
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => submit(q, drafts[q.id] ?? "", false)}>
                        Not yet
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={drafts[q.id] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                      rows={3}
                      placeholder="Write your answer in your own words…"
                      aria-label="Your answer"
                      className="border-line bg-surface focus:border-accent w-full rounded-xl border p-3 text-sm outline-none"
                    />
                    <Button size="sm" onClick={() => setRevealed((s) => new Set(s).add(q.id))}>
                      Check answer
                    </Button>
                  </div>
                )}

                {res && (
                  <div className="border-line mt-4 space-y-2 border-t pt-3 text-sm">
                    {objective && (
                      <p>
                        <span className="text-muted">Correct answer: </span>
                        <strong>{q.answer}</strong>
                      </p>
                    )}
                    {!objective && (
                      <div>
                        <span className="text-muted">Model answer: </span>
                        <RichText text={q.answer} />
                      </div>
                    )}
                    <p className="text-ink-2">
                      <span className="text-muted">Explanation: </span>
                      <RichText text={q.explanation} />
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {q.chapter_id && (
                        <button onClick={() => goTo(q.chapter_id!)} className="text-accent text-xs hover:underline">
                          Source section: {chapterTitle(book, q.chapter_id)}
                        </button>
                      )}
                      <RefChips refs={q.source_refs} />
                    </div>
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bookmarks & notes
// ---------------------------------------------------------------------------
export function BookmarksView() {
  const r = useReader();
  const items = r.book.bookmarks;
  const typeLabel = { chapter: "Chapter", paragraph: "Paragraph", question: "Question", concept: "Concept" };
  return (
    <div className="font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">My Bookmarks</h1>
      <p className="text-muted mt-1">Chapters, paragraphs, questions and concepts you saved.</p>
      {!items.length ? (
        <EmptyState icon={<Bookmark className="size-10" />} title="No bookmarks yet">
          Hover over any paragraph, question or concept and click the bookmark icon.
        </EmptyState>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map((b) => (
            <li key={b.id}>
              <Card className="flex items-start gap-3 p-4">
                <button className="min-w-0 flex-1 text-left" onClick={() => jumpToAnchor(r, b.anchor, b.chapter_id)}>
                  <div className="flex items-center gap-2">
                    <Badge tone="accent">{typeLabel[b.target_type]}</Badge>
                    <span className="text-muted truncate text-xs">{chapterTitle(r.book, b.chapter_id)}</span>
                  </div>
                  <p className="mt-2 font-medium">{b.label}</p>
                  {b.excerpt && <p className="text-muted mt-1 line-clamp-2 text-sm">{b.excerpt}</p>}
                </button>
                <button
                  onClick={() => r.toggleBookmark(b)}
                  className="text-muted hover:bg-surface-2 hover:text-danger rounded-lg p-2"
                  aria-label="Remove bookmark"
                >
                  <BookmarkX className="size-4" />
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function jumpToAnchor(r: ReturnType<typeof useReader>, anchor: string, chapterId: string | null) {
  if (anchor.startsWith("chapter:")) return r.goTo(anchor.slice(8));
  const [sectionId, idx] = anchor.split(":");
  if (chapterId) r.goTo(chapterId, idx !== undefined ? `blk-${sectionId}-${idx}` : `sec-${sectionId}`);
}

export function NotesView() {
  const r = useReader();
  const notes = r.book.notes;
  return (
    <div className="font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">My Notes</h1>
      <p className="text-muted mt-1">Everything you wrote beside this book. Notes save automatically.</p>
      {!notes.length ? (
        <EmptyState icon={<StickyNote className="size-10" />} title="No notes yet">
          Use the note icon beside any paragraph, or &ldquo;Create notes&rdquo; on selected text.
        </EmptyState>
      ) : (
        <div className="mt-6 space-y-6">
          {notes.map((n) => (
            <div key={n.id}>
              <button
                onClick={() => (n.anchor ? jumpToAnchor(r, n.anchor, n.chapter_id) : n.chapter_id && r.goTo(n.chapter_id))}
                className="text-accent text-xs hover:underline"
              >
                {chapterTitle(r.book, n.chapter_id) ?? "General"}
              </button>
              {n.quote && <p className="border-line text-muted mt-1 line-clamp-2 border-l-2 pl-3 text-sm">{n.quote}</p>}
              <NoteCard note={n} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
