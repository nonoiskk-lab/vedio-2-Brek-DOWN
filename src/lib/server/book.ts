import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChapterRow, LearningBook, SectionRow } from "@/lib/content/types";

/** Loads everything the reader needs in parallel. Returns null if not found/not ready. */
export async function loadBook(supabase: SupabaseClient, projectId: string, userId: string): Promise<LearningBook | null> {
  const byProject = <T>(table: string, columns: string, order = "idx") =>
    supabase
      .from(table)
      .select(columns)
      .eq("project_id", projectId)
      .order(order)
      .then(({ data, error }) => {
        if (error) throw new Error(`${table}: ${error.message}`);
        return (data ?? []) as T[];
      });

  const [projectRes, sourceRes, documentRes] = await Promise.all([
    supabase.from("projects").select("id, title, emoji, settings, progress_percent, status").eq("id", projectId).maybeSingle(),
    supabase.from("sources").select("kind, title, url, language, meta").eq("project_id", projectId).maybeSingle(),
    supabase.from("documents").select("id, title, subtitle, plan, revision, quality_report").eq("project_id", projectId).maybeSingle(),
  ]);
  if (!projectRes.data || !documentRes.data || !sourceRes.data) return null;

  const [chapters, sections, segments, questions, flashcards, quiz, attempts, notes, bookmarks, highlights, progress] = await Promise.all([
    byProject<ChapterRow>("chapters", "id, idx, plan_key, title, summary, kind, key_takeaway, source_refs, status, qc"),
    byProject<SectionRow>("sections", "id, chapter_id, idx, title, summary, blocks, source_refs"),
    byProject<LearningBook["segments"][number]>("source_segments", "idx, ref_label, start_sec, end_sec, page, heading, text"),
    byProject<LearningBook["questions"][number]>("questions", "id, chapter_id, idx, question, answer, source_refs"),
    byProject<LearningBook["flashcards"][number]>("flashcards", "id, chapter_id, idx, front, back, source_refs, review_count, last_result"),
    byProject<LearningBook["quiz"][number]>(
      "quiz_questions",
      "id, chapter_id, idx, kind, prompt, options, answer, explanation, source_refs",
    ),
    supabase
      .from("quiz_attempts")
      .select("question_id, response, is_correct, created_at")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .order("created_at")
      .then(({ data }) => (data ?? []) as LearningBook["attempts"]),
    byProject<LearningBook["notes"][number]>("notes", "id, chapter_id, anchor, quote, content, updated_at", "created_at"),
    byProject<LearningBook["bookmarks"][number]>(
      "bookmarks",
      "id, chapter_id, target_type, anchor, label, excerpt, created_at",
      "created_at",
    ),
    byProject<LearningBook["highlights"][number]>("highlights", "id, chapter_id, anchor, text, color, created_at", "created_at"),
    byProject<LearningBook["progress"][number]>("reading_progress", "chapter_id, percent, completed", "updated_at"),
  ]);

  const doc = documentRes.data;
  return {
    project: projectRes.data as LearningBook["project"],
    source: sourceRes.data as LearningBook["source"],
    document: {
      id: doc.id,
      title: doc.title,
      subtitle: doc.subtitle,
      plan: doc.plan,
      revision: { quick_revision: doc.revision?.quick_revision ?? [], key_takeaways: doc.revision?.key_takeaways ?? [] },
      quality_report: doc.quality_report ?? {},
    },
    chapters: chapters.map((c) => ({ ...c, sections: sections.filter((s) => s.chapter_id === c.id) })),
    segments,
    questions,
    flashcards,
    quiz,
    attempts,
    notes,
    bookmarks,
    highlights,
    progress,
  };
}

/**
 * Overall learning progress: reading (60%), quiz coverage (25%), flashcards reviewed (15%).
 * Stored on the project so the dashboard can show it without loading the whole book.
 */
export async function recomputeProgress(supabase: SupabaseClient, projectId: string, userId: string): Promise<number> {
  const count = (table: string) => supabase.from(table).select("id", { count: "exact", head: true }).eq("project_id", projectId);
  const [chapters, done, quizTotal, attemptsRes, cards, reviewed] = await Promise.all([
    count("chapters"),
    supabase
      .from("reading_progress")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .eq("completed", true),
    count("quiz_questions"),
    supabase.from("quiz_attempts").select("question_id").eq("project_id", projectId).eq("user_id", userId),
    count("flashcards"),
    supabase.from("flashcards").select("id", { count: "exact", head: true }).eq("project_id", projectId).gt("review_count", 0),
  ]);
  const ratio = (a: number, b: number) => (b > 0 ? Math.min(1, a / b) : 0);
  const answered = new Set((attemptsRes.data ?? []).map((a) => a.question_id)).size;
  const hasQuiz = (quizTotal.count ?? 0) > 0;
  const hasCards = (cards.count ?? 0) > 0;
  const weights = { read: 0.6, quiz: hasQuiz ? 0.25 : 0, cards: hasCards ? 0.15 : 0 };
  const totalWeight = weights.read + weights.quiz + weights.cards;
  const score =
    (weights.read * ratio(done.count ?? 0, chapters.count ?? 0) +
      weights.quiz * ratio(answered, quizTotal.count ?? 0) +
      weights.cards * ratio(reviewed.count ?? 0, cards.count ?? 0)) /
    totalWeight;
  const percent = Math.round(score * 100);
  await supabase.from("projects").update({ progress_percent: percent }).eq("id", projectId);
  return percent;
}
