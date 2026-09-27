import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRouteError, jsonError, requireProject } from "@/lib/server/http";
import { recomputeProgress } from "@/lib/server/book";

const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reading"), chapterId: z.string().uuid(), percent: z.number().int().min(0).max(100), completed: z.boolean() }),
  z.object({
    type: z.literal("quiz"),
    questionId: z.string().uuid(),
    response: z.string().max(4000),
    selfAssessedCorrect: z.boolean().optional(),
  }),
  z.object({ type: z.literal("flashcard"), flashcardId: z.string().uuid(), result: z.enum(["again", "good", "easy"]) }),
  z.object({ type: z.literal("reset-quiz") }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireProject(id);
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Invalid data");
    const body = parsed.data;
    let result: Record<string, unknown> = {};

    if (body.type === "reading") {
      const { data: existing } = await supabase
        .from("reading_progress")
        .select("percent, completed")
        .eq("user_id", user.id)
        .eq("chapter_id", body.chapterId)
        .maybeSingle();
      // Scroll progress only moves forward; completion can be toggled explicitly.
      const percent = body.completed ? 100 : Math.min(99, Math.max(body.percent, existing?.percent ?? 0));
      const { error } = await supabase.from("reading_progress").upsert(
        {
          project_id: id,
          user_id: user.id,
          chapter_id: body.chapterId,
          percent,
          completed: body.completed,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,chapter_id" },
      );
      if (error) throw new Error(error.message);
    } else if (body.type === "quiz") {
      const { data: q, error } = await supabase
        .from("quiz_questions")
        .select("kind, answer, explanation")
        .eq("id", body.questionId)
        .eq("project_id", id)
        .single();
      if (error || !q) return jsonError("Question not found", 404);
      const objective = q.kind === "mcq" || q.kind === "true_false";
      const isCorrect = objective
        ? body.response.trim().toLowerCase() === String(q.answer).trim().toLowerCase()
        : Boolean(body.selfAssessedCorrect);
      const { error: aErr } = await supabase.from("quiz_attempts").insert({
        project_id: id,
        user_id: user.id,
        question_id: body.questionId,
        response: body.response,
        is_correct: isCorrect,
      });
      if (aErr) throw new Error(aErr.message);
      result = { isCorrect, answer: q.answer, explanation: q.explanation };
    } else if (body.type === "flashcard") {
      const { data: card } = await supabase
        .from("flashcards")
        .select("review_count")
        .eq("id", body.flashcardId)
        .eq("project_id", id)
        .single();
      const { error } = await supabase
        .from("flashcards")
        .update({ review_count: (card?.review_count ?? 0) + 1, last_result: body.result, last_reviewed_at: new Date().toISOString() })
        .eq("id", body.flashcardId)
        .eq("project_id", id);
      if (error) throw new Error(error.message);
    } else {
      await supabase.from("quiz_attempts").delete().eq("project_id", id).eq("user_id", user.id);
    }

    const progress = await recomputeProgress(supabase, id, user.id);
    return NextResponse.json({ ...result, progress });
  } catch (e) {
    return handleRouteError(e);
  }
}
