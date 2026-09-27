import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIError, describeAIError, generateStructured, mapWithConcurrency } from "./client";
import {
  ANALYST_SYSTEM,
  PLANNER_SYSTEM,
  QC_SYSTEM,
  REVISION_SYSTEM,
  WRITER_SYSTEM,
  languageInstruction,
  styleInstructions,
} from "./prompts";
import {
  ChapterSchema,
  ChunkAnalysisSchema,
  PlanSchema,
  QualitySchema,
  RevisionSchema,
  type ChunkAnalysis,
  type GeneratedChapter,
  type Plan,
} from "./schemas";
import { renderSegmentsForPrompt } from "@/lib/ingest/chunk";
import type { Block, PipelineStage, ProjectSettings, QualityResult, StageDetail } from "@/lib/content/types";

/**
 * Resumable map-reduce pipeline. Each call to `advancePipeline` does as much work
 * as fits in its time budget and persists everything it finishes, so a request
 * timeout, a crash or a closed tab never loses completed work: the next call
 * resumes exactly where the last one stopped.
 *
 *   analyze  – map: one structured analysis per chunk (topics, concepts, examples, facts)
 *   plan     – reduce: global understanding, concept tree, glossary, chapter plan
 *   write    – one chapter per call, fed only the source parts assigned to it
 *   quality  – per-chapter QC against the source; regenerate once when it fails
 *   revision – quick revision, takeaways, questions, flashcards, quiz
 *   finalize – aggregate quality report, mark ready
 */

const TIME_BUDGET_MS = 240_000; // route maxDuration is 300s
// Minimum time left before *starting* a long model call; a started call must finish before the route timeout.
const START_MARGIN_MS = 110_000;
const LOCK_MS = 290_000;
const MAX_CONSECUTIVE_FAILURES = 3;

interface Ctx {
  supabase: SupabaseClient;
  userId: string;
  projectId: string;
  settings: ProjectSettings;
  deadline: number;
  source: { kind: string; title: string | null };
  maxSegment: number;
}

interface ProjectState {
  status: "processing" | "ready" | "failed";
  stage: PipelineStage;
  stage_detail: StageDetail & { failures?: number };
  error: string | null;
  title: string;
}

type StepResult = { done: boolean; detail?: Partial<StageDetail> };

const NEXT_STAGE: Record<PipelineStage, PipelineStage> = {
  analyze: "plan",
  plan: "write",
  write: "quality",
  quality: "revision",
  revision: "finalize",
  finalize: "done",
  done: "done",
};

export async function advancePipeline(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<ProjectState & { busy?: boolean }> {
  const now = new Date();
  // Atomic lock: only one worker advances a project at a time.
  const { data: locked, error: lockErr } = await supabase
    .from("projects")
    .update({ lock_until: new Date(now.getTime() + LOCK_MS).toISOString() })
    .eq("id", projectId)
    .eq("status", "processing")
    .or(`lock_until.is.null,lock_until.lt.${now.toISOString()}`)
    .select("status, stage, stage_detail, error, title, settings")
    .maybeSingle();
  if (lockErr) throw new Error(lockErr.message);
  if (!locked) {
    const { data } = await supabase.from("projects").select("status, stage, stage_detail, error, title").eq("id", projectId).single();
    return { ...(data as ProjectState), busy: data?.status === "processing" };
  }

  const state = locked as ProjectState & { settings: ProjectSettings };
  const { data: source } = await supabase.from("sources").select("kind, title").eq("project_id", projectId).single();
  const { count } = await supabase.from("source_segments").select("idx", { count: "exact", head: true }).eq("project_id", projectId);

  const ctx: Ctx = {
    supabase,
    userId,
    projectId,
    settings: state.settings,
    deadline: Date.now() + TIME_BUDGET_MS,
    source: source ?? { kind: "text", title: null },
    maxSegment: count ?? 0,
  };

  let stage = state.stage;
  let detail: StageDetail & { failures?: number } = { ...state.stage_detail, message: undefined };
  try {
    let first = true;
    while (stage !== "done" && (first || stage === "finalize" || Date.now() < ctx.deadline - START_MARGIN_MS)) {
      first = false;
      const result = await runStage(stage, ctx);
      detail = { ...detail, ...result.detail, failures: 0 };
      if (!result.done) break;
      stage = NEXT_STAGE[stage];
      await supabase.from("projects").update({ stage, stage_detail: detail }).eq("id", projectId);
    }
    const finished = stage === "done";
    const update = {
      stage,
      stage_detail: detail,
      status: finished ? "ready" : "processing",
      error: null,
      lock_until: null,
      updated_at: new Date().toISOString(),
    };
    await supabase.from("projects").update(update).eq("id", projectId);
    const { data: fresh } = await supabase.from("projects").select("title").eq("id", projectId).single();
    return { ...update, title: fresh?.title ?? state.title } as ProjectState;
  } catch (err) {
    const e = describeAIError(err);
    const failures = (detail.failures ?? 0) + 1;
    const fatal = !e.retryable || failures >= MAX_CONSECUTIVE_FAILURES;
    console.error(`[pipeline] ${projectId} stage=${stage} failure ${failures}:`, err);
    const update = {
      stage,
      stage_detail: { ...detail, failures, message: e.message },
      status: fatal ? "failed" : "processing",
      error: fatal ? e.message : null,
      lock_until: null,
    };
    await supabase.from("projects").update(update).eq("id", projectId);
    return { ...update, title: state.title } as ProjectState;
  }
}

/** Put a failed project back into the queue at the stage where it failed. */
export async function retryPipeline(supabase: SupabaseClient, projectId: string) {
  await supabase
    .from("projects")
    .update({ status: "processing", error: null, lock_until: null, stage_detail: {} })
    .eq("id", projectId)
    .eq("status", "failed");
}

function runStage(stage: PipelineStage, ctx: Ctx): Promise<StepResult> {
  switch (stage) {
    case "analyze":
      return analyzeChunks(ctx);
    case "plan":
      return planDocument(ctx);
    case "write":
      return writeChapters(ctx);
    case "quality":
      return qualityCheck(ctx);
    case "revision":
      return buildRevision(ctx);
    case "finalize":
      return finalize(ctx);
    default:
      return Promise.resolve({ done: true });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadSegments(ctx: Ctx, from: number, to: number) {
  const { data, error } = await ctx.supabase
    .from("source_segments")
    .select("idx, ref_label, heading, text")
    .eq("project_id", ctx.projectId)
    .gte("idx", from)
    .lte("idx", to)
    .order("idx");
  if (error) throw new Error(error.message);
  return data as { idx: number; ref_label: string; heading: string | null; text: string }[];
}

function cleanRefs(refs: string[] | undefined, max: number): string[] {
  const out = new Set<string>();
  for (const r of refs ?? []) {
    for (const m of r.matchAll(/S(\d+)/gi)) {
      const n = Number(m[1]);
      if (n >= 1 && n <= max) out.add(`S${n}`);
    }
  }
  return [...out].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

function sourceLabel(ctx: Ctx) {
  const kind =
    ctx.source.kind === "youtube"
      ? "YouTube video transcript (segment labels are timestamps)"
      : ctx.source.kind === "pdf"
        ? "PDF document (segment labels are page numbers)"
        : ctx.source.kind === "transcript"
          ? "transcript"
          : "text document (segment labels are paragraph numbers)";
  return `"${ctx.source.title ?? "Untitled"}" — ${kind}`;
}

// ---------------------------------------------------------------------------
// Stage: analyze (map)
// ---------------------------------------------------------------------------

async function analyzeChunks(ctx: Ctx): Promise<StepResult> {
  const { data: all, error } = await ctx.supabase
    .from("chunks")
    .select("idx, segment_start, segment_end, analysis")
    .eq("project_id", ctx.projectId)
    .order("idx");
  if (error) throw new Error(error.message);
  const chunks = all as { idx: number; segment_start: number; segment_end: number; analysis: unknown }[];
  const pending = chunks.filter((c) => !c.analysis);
  const total = chunks.length;

  await mapWithConcurrency(
    pending,
    4,
    async (chunk) => {
      const segs = await loadSegments(ctx, chunk.segment_start, chunk.segment_end);
      const analysis = await generateStructured({
        system: ANALYST_SYSTEM,
        schema: ChunkAnalysisSchema,
        effort: "medium",
        maxTokens: 16000,
        prompt: `Source: ${sourceLabel(ctx)}
This is part ${chunk.idx + 1} of ${total} (segments S${chunk.segment_start}–S${chunk.segment_end}).

Analyse this part. Write the analysis in English (it is an internal working document), but keep original-language terms, names and quotes as they appear.

<source_part>
${renderSegmentsForPrompt(segs)}
</source_part>`,
      });
      const cleaned = sanitizeAnalysis(analysis, ctx.maxSegment);
      const { error: upErr } = await ctx.supabase
        .from("chunks")
        .update({ analysis: cleaned })
        .eq("project_id", ctx.projectId)
        .eq("idx", chunk.idx);
      if (upErr) throw new Error(upErr.message);
      chunk.analysis = cleaned;
    },
    ctx.deadline - START_MARGIN_MS,
  );

  const analyzed = chunks.filter((c) => c.analysis).length;
  await ctx.supabase
    .from("projects")
    .update({ stage_detail: { analyzed, totalChunks: total } })
    .eq("id", ctx.projectId);
  return { done: analyzed === total, detail: { analyzed, totalChunks: total } };
}

function sanitizeAnalysis(a: ChunkAnalysis, max: number): ChunkAnalysis {
  return {
    ...a,
    topics: a.topics.map((t) => ({ ...t, refs: cleanRefs(t.refs, max) })),
    concepts: a.concepts.map((c) => ({ ...c, refs: cleanRefs(c.refs, max) })),
    examples: a.examples.map((e) => ({ ...e, refs: cleanRefs(e.refs, max) })),
    key_facts: a.key_facts.map((f) => ({ ...f, refs: cleanRefs(f.refs, max) })),
  };
}

// ---------------------------------------------------------------------------
// Stage: plan (reduce)
// ---------------------------------------------------------------------------

async function planDocument(ctx: Ctx): Promise<StepResult> {
  const { data, error } = await ctx.supabase
    .from("chunks")
    .select("idx, segment_start, segment_end, analysis")
    .eq("project_id", ctx.projectId)
    .order("idx");
  if (error) throw new Error(error.message);
  const chunks = data as { idx: number; segment_start: number; segment_end: number; analysis: ChunkAnalysis }[];

  const digest = chunks.map((c) => `### Part ${c.idx} (S${c.segment_start}–S${c.segment_end})\n${JSON.stringify(c.analysis)}`).join("\n\n");

  const plan = await generateStructured({
    system: PLANNER_SYSTEM,
    schema: PlanSchema,
    effort: "high",
    maxTokens: 24000,
    prompt: `Source: ${sourceLabel(ctx)}
The source was split into ${chunks.length} parts (indexes 0–${chunks.length - 1}). Below are structured analyses of every part, in order.

${digest}

Build the global understanding and the chapter plan.
- Title, subtitle, overview, glossary and chapter titles must be in the learner's output language: ${languageInstruction(ctx.settings.language)}
- Learning styles requested (shape the plan accordingly): ${ctx.settings.styles.join(", ") || "book, beginner"}.
${ctx.settings.customInstruction ? `- Learner's instruction: "${ctx.settings.customInstruction}"` : ""}`,
  });

  const normalized = normalizePlan(plan, chunks.length, ctx.maxSegment);

  const { data: doc, error: docErr } = await ctx.supabase
    .from("documents")
    .upsert(
      {
        project_id: ctx.projectId,
        user_id: ctx.userId,
        title: normalized.title,
        subtitle: normalized.subtitle,
        language: ctx.settings.language,
        plan: normalized,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" },
    )
    .select("id")
    .single();
  if (docErr) throw new Error(docErr.message);

  await ctx.supabase.from("chapters").delete().eq("project_id", ctx.projectId);
  const { error: chErr } = await ctx.supabase.from("chapters").insert(
    normalized.chapters.map((c, i) => ({
      document_id: doc.id,
      project_id: ctx.projectId,
      user_id: ctx.userId,
      idx: i,
      plan_key: c.key,
      title: c.title,
      summary: c.goal,
      kind: c.kind,
      status: "pending",
    })),
  );
  if (chErr) throw new Error(chErr.message);

  await ctx.supabase.from("projects").update({ title: normalized.title }).eq("id", ctx.projectId);
  return { done: true, detail: { written: 0, totalChapters: normalized.chapters.length } };
}

/** Enforce plan invariants the model might miss: unique keys, valid indexes, full coverage. */
export function normalizePlan(plan: Plan, chunkCount: number, maxSegment: number): Plan {
  const seen = new Set<string>();
  let chapters = plan.chapters
    .filter((c) => c.title.trim())
    .map((c, i) => {
      let key =
        (c.key || `ch-${i + 1}`)
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .slice(0, 40) || `ch-${i + 1}`;
      while (seen.has(key)) key = `${key}-${i + 1}`;
      seen.add(key);
      const idx = [...new Set(c.chunk_indexes.filter((n) => Number.isInteger(n) && n >= 0 && n < chunkCount))].sort((a, b) => a - b);
      return { ...c, key, chunk_indexes: idx };
    });
  if (!chapters.length) {
    chapters = [
      {
        key: "ch-1",
        title: plan.title,
        goal: plan.subtitle,
        kind: "core" as const,
        concepts: [],
        chunk_indexes: Array.from({ length: chunkCount }, (_, i) => i),
      },
    ];
  }
  // Every part must feed at least one chapter; attach orphans to the chapter covering a neighbour.
  const covered = new Set(chapters.flatMap((c) => c.chunk_indexes));
  for (let i = 0; i < chunkCount; i++) {
    if (covered.has(i)) continue;
    const home =
      chapters.find((c) => c.kind !== "introduction" && (c.chunk_indexes.includes(i - 1) || c.chunk_indexes.includes(i + 1))) ??
      chapters.find((c) => c.kind === "core") ??
      chapters[chapters.length - 1];
    home.chunk_indexes = [...home.chunk_indexes, i].sort((a, b) => a - b);
    covered.add(i);
  }
  // A chapter with no parts (e.g. an introduction) is written from the opening part.
  for (const c of chapters) if (!c.chunk_indexes.length) c.chunk_indexes = [0];
  return {
    ...plan,
    glossary: plan.glossary.map((g) => ({ ...g, refs: cleanRefs(g.refs, maxSegment) })),
    chapters,
  };
}

// ---------------------------------------------------------------------------
// Stage: write chapters
// ---------------------------------------------------------------------------

async function loadPlanContext(ctx: Ctx) {
  const { data: doc, error } = await ctx.supabase.from("documents").select("id, plan").eq("project_id", ctx.projectId).single();
  if (error) throw new Error(error.message);
  const { data: chunkRows } = await ctx.supabase
    .from("chunks")
    .select("idx, segment_start, segment_end, analysis")
    .eq("project_id", ctx.projectId)
    .order("idx");
  return {
    docId: doc.id as string,
    plan: doc.plan as Plan,
    chunks: (chunkRows ?? []) as { idx: number; segment_start: number; segment_end: number; analysis: ChunkAnalysis }[],
  };
}

async function sourceTextForChapter(ctx: Ctx, chunks: { idx: number; segment_start: number; segment_end: number }[], indexes: number[]) {
  const parts: string[] = [];
  for (const i of indexes) {
    const c = chunks.find((x) => x.idx === i);
    if (!c) continue;
    const segs = await loadSegments(ctx, c.segment_start, c.segment_end);
    parts.push(renderSegmentsForPrompt(segs));
  }
  return parts.join("\n\n");
}

async function generateChapter(
  ctx: Ctx,
  planCtx: Awaited<ReturnType<typeof loadPlanContext>>,
  chapterKey: string,
  feedback?: string[],
): Promise<GeneratedChapter> {
  const { plan, chunks } = planCtx;
  const chapter = plan.chapters.find((c) => c.key === chapterKey);
  if (!chapter) throw new AIError(`Chapter ${chapterKey} missing from plan`);
  const position = plan.chapters.findIndex((c) => c.key === chapterKey);
  const sourceText = await sourceTextForChapter(ctx, chunks, chapter.chunk_indexes);
  const analyses = chapter.chunk_indexes
    .map((i) => chunks.find((c) => c.idx === i)?.analysis)
    .filter(Boolean)
    .map((a) =>
      JSON.stringify({ concepts: a!.concepts, examples: a!.examples, key_facts: a!.key_facts, beginner_questions: a!.beginner_questions }),
    )
    .join("\n");

  const outline = plan.chapters
    .map((c, i) => `${i + 1}. ${c.title}${c.key === chapterKey ? "   ← WRITE THIS ONE" : ""} — ${c.goal}`)
    .join("\n");

  return generateStructured({
    system: WRITER_SYSTEM,
    schema: ChapterSchema,
    effort: "high",
    maxTokens: 48000,
    prompt: `Book: "${plan.title}" — ${plan.subtitle}
Source: ${sourceLabel(ctx)}

Book outline (write ONLY the marked chapter; leave topics that clearly belong to other chapters for them):
${outline}

Chapter to write: #${position + 1} "${chapter.title}" (${chapter.kind})
Goal: ${chapter.goal}
Concepts to cover: ${chapter.concepts.join(", ") || "as found in the source"}
${chapter.kind === "introduction" ? "This is the introduction: orient the learner — what the material is about, why it matters, and the big picture of what comes next. Keep it shorter than core chapters." : ""}
${chapter.kind === "practical" ? "This chapter is about practical application: turn the source's guidance into concrete, ordered action steps." : ""}
${chapter.kind === "examples" ? "This chapter walks through the source's real-life examples one by one, each with the concept it illustrates and why it matters." : ""}

Glossary (for consistency): ${JSON.stringify(plan.glossary.slice(0, 40).map((g) => ({ term: g.term, meaning: g.meaning })))}

${styleInstructions(ctx.settings)}

Analyst notes for the relevant source parts:
${analyses}

Source text for this chapter (cite segment ids in refs):
<source>
${sourceText}
</source>
${
  feedback?.length
    ? `\nA reviewer rejected the previous draft of this chapter. Fix every one of these problems:\n- ${feedback.join("\n- ")}`
    : ""
}`,
  });
}

function sanitizeBlocks(blocks: Block[], max: number): Block[] {
  return blocks
    .map((b) => ({
      type: b.type,
      title: (b.title ?? "").trim(),
      text: (b.text ?? "").trim(),
      extra: (b.extra ?? "").trim(),
      items: (b.items ?? []).map((i) => i.trim()).filter(Boolean),
      provenance: b.provenance,
      refs: cleanRefs(b.refs, max),
    }))
    .filter((b) => b.text || b.items.length || b.title);
}

async function saveChapter(ctx: Ctx, chapterId: string, gen: GeneratedChapter, status: "written" | "checked", qc?: QualityResult) {
  const sections = gen.sections
    .map((s, i) => ({
      chapter_id: chapterId,
      project_id: ctx.projectId,
      user_id: ctx.userId,
      idx: i,
      title: s.title.trim() || `Part ${i + 1}`,
      summary: s.summary,
      blocks: sanitizeBlocks(s.blocks as Block[], ctx.maxSegment),
      source_refs: cleanRefs([...s.refs, ...s.blocks.flatMap((b) => b.refs)], ctx.maxSegment),
    }))
    .filter((s) => s.blocks.length);
  const chapterRefs = cleanRefs(
    sections.flatMap((s) => s.source_refs),
    ctx.maxSegment,
  );

  await ctx.supabase.from("sections").delete().eq("chapter_id", chapterId);
  if (sections.length) {
    const { error } = await ctx.supabase.from("sections").insert(sections);
    if (error) throw new Error(error.message);
  }
  const { error } = await ctx.supabase
    .from("chapters")
    .update({
      title: gen.title,
      summary: gen.summary,
      key_takeaway: gen.key_takeaway,
      source_refs: chapterRefs,
      status,
      ...(qc ? { qc } : {}),
    })
    .eq("id", chapterId);
  if (error) throw new Error(error.message);
}

async function writeChapters(ctx: Ctx): Promise<StepResult> {
  const planCtx = await loadPlanContext(ctx);
  const { data } = await ctx.supabase.from("chapters").select("id, plan_key, status").eq("project_id", ctx.projectId).order("idx");
  const chapters = (data ?? []) as { id: string; plan_key: string; status: string }[];
  const pending = chapters.filter((c) => c.status === "pending");

  await mapWithConcurrency(
    pending,
    3,
    async (ch) => {
      const gen = await generateChapter(ctx, planCtx, ch.plan_key);
      await saveChapter(ctx, ch.id, gen, "written");
      ch.status = "written";
      const written = chapters.filter((c) => c.status !== "pending").length;
      await ctx.supabase
        .from("projects")
        .update({ stage_detail: { written, totalChapters: chapters.length } })
        .eq("id", ctx.projectId);
    },
    ctx.deadline - START_MARGIN_MS,
  );

  const written = chapters.filter((c) => c.status !== "pending").length;
  return { done: written === chapters.length, detail: { written, totalChapters: chapters.length } };
}

// ---------------------------------------------------------------------------
// Stage: quality check (and targeted regeneration)
// ---------------------------------------------------------------------------

async function reviewChapter(ctx: Ctx, planCtx: Awaited<ReturnType<typeof loadPlanContext>>, chapterKey: string, chapterJson: string) {
  const chapter = planCtx.plan.chapters.find((c) => c.key === chapterKey)!;
  const sourceText = await sourceTextForChapter(ctx, planCtx.chunks, chapter.chunk_indexes);
  return generateStructured({
    system: QC_SYSTEM,
    schema: QualitySchema,
    effort: "medium",
    maxTokens: 12000,
    prompt: `Chapter goal: ${chapter.goal}
Concepts it should cover: ${chapter.concepts.join(", ")}
Other chapters cover: ${planCtx.plan.chapters
      .filter((c) => c.key !== chapterKey)
      .map((c) => c.title)
      .join("; ")}
AI-generated examples allowed: ${ctx.settings.aiExamples ? "yes (must have provenance ai_example)" : "no"}
Target output language: ${ctx.settings.language}

Check: preserved meaning? missed major topics for this chapter? invented information presented as source? logical order? beginner-friendly? examples labelled? repetition removed? important terms preserved? source refs present?

<generated_chapter>
${chapterJson}
</generated_chapter>

<source>
${sourceText}
</source>`,
  });
}

async function qualityCheck(ctx: Ctx): Promise<StepResult> {
  const planCtx = await loadPlanContext(ctx);
  const { data } = await ctx.supabase
    .from("chapters")
    .select("id, plan_key, status, title, summary, key_takeaway")
    .eq("project_id", ctx.projectId)
    .order("idx");
  const chapters = (data ?? []) as { id: string; plan_key: string; status: string; title: string; summary: string; key_takeaway: string }[];
  const pending = chapters.filter((c) => c.status === "written");
  let regenerated = 0;

  await mapWithConcurrency(
    pending,
    3,
    async (ch) => {
      const { data: secs } = await ctx.supabase.from("sections").select("title, summary, blocks").eq("chapter_id", ch.id).order("idx");
      const json = JSON.stringify({ title: ch.title, summary: ch.summary, key_takeaway: ch.key_takeaway, sections: secs });
      let qc: QualityResult = await reviewChapter(ctx, planCtx, ch.plan_key, json);
      const needsRegen = qc.verdict === "regenerate" || qc.score < 6;
      if (needsRegen && Date.now() < ctx.deadline - START_MARGIN_MS) {
        const feedback = [
          ...qc.unsupported_claims,
          ...qc.unlabeled_examples,
          ...qc.missing_topics.map((t) => `Missing: ${t}`),
          ...qc.issues,
        ];
        const gen = await generateChapter(ctx, planCtx, ch.plan_key, feedback);
        // Re-review the new draft when there is time; otherwise record the original findings.
        const second = Date.now() < ctx.deadline - 30_000 ? await reviewChapter(ctx, planCtx, ch.plan_key, JSON.stringify(gen)) : qc;
        qc = { ...second, regenerated: true };
        regenerated++;
        await saveChapter(ctx, ch.id, gen, "checked", qc);
      } else {
        await ctx.supabase.from("chapters").update({ status: "checked", qc }).eq("id", ch.id);
      }
      ch.status = "checked";
    },
    ctx.deadline - START_MARGIN_MS,
  );

  const checked = chapters.filter((c) => c.status === "checked").length;
  return { done: checked === chapters.length, detail: { checked, regenerated } };
}

// ---------------------------------------------------------------------------
// Stage: revision material
// ---------------------------------------------------------------------------

async function buildRevision(ctx: Ctx): Promise<StepResult> {
  const { data: doc } = await ctx.supabase.from("documents").select("id, title").eq("project_id", ctx.projectId).single();
  const { data: chapterRows } = await ctx.supabase
    .from("chapters")
    .select("id, plan_key, title, summary, key_takeaway")
    .eq("project_id", ctx.projectId)
    .order("idx");
  const chapters = (chapterRows ?? []) as { id: string; plan_key: string; title: string; summary: string; key_takeaway: string }[];
  const { data: sectionRows } = await ctx.supabase
    .from("sections")
    .select("chapter_id, title, summary, blocks")
    .eq("project_id", ctx.projectId)
    .order("idx");
  const sections = (sectionRows ?? []) as { chapter_id: string; title: string; summary: string; blocks: Block[] }[];

  const digest = chapters
    .map((c) => {
      const secs = sections
        .filter((s) => s.chapter_id === c.id)
        .map((s) => {
          const keyBlocks = s.blocks
            .filter((b) => ["definition", "qa", "takeaway", "example", "steps", "bullets", "paragraph"].includes(b.type))
            .map(
              (b) => `  - [${b.type}] ${b.title ? b.title + ": " : ""}${(b.text || b.items.join("; ")).slice(0, 500)} ${b.refs.join(",")}`,
            )
            .join("\n");
          return ` ## ${s.title} — ${s.summary}\n${keyBlocks}`;
        })
        .join("\n");
      return `# [${c.plan_key}] ${c.title}\n${c.summary}\nTakeaway: ${c.key_takeaway}\n${secs}`;
    })
    .join("\n\n");

  const size = Math.min(Math.max(chapters.length * 3, 10), 30);
  const rev = await generateStructured({
    system: REVISION_SYSTEM,
    schema: RevisionSchema,
    effort: "medium",
    maxTokens: 32000,
    prompt: `Learning book: "${doc?.title}"
${languageInstruction(ctx.settings.language)}

Create: 5-10 quick revision points; key takeaways (one per chapter, max 10); about ${Math.ceil(size * 0.6)} open revision questions; about ${size} flashcards; a quiz of about ${size} questions mixing mcq, true_false, short and concept questions. Use the chapter keys in [brackets] for chapter_key and keep refs from the book.

${digest}`,
  });

  const chapterId = (key: string) => chapters.find((c) => c.plan_key === key)?.id ?? null;
  const max = ctx.maxSegment;
  const base = { project_id: ctx.projectId, user_id: ctx.userId };

  await Promise.all([
    ctx.supabase.from("questions").delete().eq("project_id", ctx.projectId),
    ctx.supabase.from("flashcards").delete().eq("project_id", ctx.projectId),
    ctx.supabase.from("quizzes").delete().eq("project_id", ctx.projectId),
  ]);

  const { data: quiz, error: qErr } = await ctx.supabase
    .from("quizzes")
    .insert({ ...base, title: `${doc?.title ?? "Book"} — Quiz` })
    .select("id")
    .single();
  if (qErr) throw new Error(qErr.message);

  const quizRows = rev.quiz
    .map((q, i) => {
      let options = q.options.map((o) => o.trim()).filter(Boolean);
      if (q.kind === "true_false") options = ["True", "False"];
      let answer = q.answer.trim();
      if (q.kind === "true_false") answer = /^(true|sahi|सही|haan|yes)/i.test(answer) ? "True" : "False";
      if (q.kind === "mcq") {
        const match = options.find((o) => o.toLowerCase() === answer.toLowerCase());
        if (!match || options.length < 2) return null; // unusable question
        answer = match;
      }
      return {
        ...base,
        quiz_id: quiz.id,
        chapter_id: chapterId(q.chapter_key),
        idx: i,
        kind: q.kind,
        prompt: q.prompt,
        options: q.kind === "mcq" || q.kind === "true_false" ? options : [],
        answer,
        explanation: q.explanation,
        source_refs: cleanRefs(q.refs, max),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((r, i) => ({ ...r, idx: i }));

  const results = await Promise.all([
    ctx.supabase.from("questions").insert(
      rev.revision_questions.map((q, i) => ({
        ...base,
        chapter_id: chapterId(q.chapter_key),
        idx: i,
        question: q.question,
        answer: q.answer,
        source_refs: cleanRefs(q.refs, max),
      })),
    ),
    ctx.supabase.from("flashcards").insert(
      rev.flashcards.map((f, i) => ({
        ...base,
        chapter_id: chapterId(f.chapter_key),
        idx: i,
        front: f.front,
        back: f.back,
        source_refs: cleanRefs(f.refs, max),
      })),
    ),
    quizRows.length ? ctx.supabase.from("quiz_questions").insert(quizRows) : Promise.resolve({ error: null }),
    ctx.supabase
      .from("documents")
      .update({ revision: { quick_revision: rev.quick_revision, key_takeaways: rev.key_takeaways } })
      .eq("project_id", ctx.projectId),
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
  return { done: true };
}

// ---------------------------------------------------------------------------
// Stage: finalize
// ---------------------------------------------------------------------------

async function finalize(ctx: Ctx): Promise<StepResult> {
  const { data } = await ctx.supabase.from("chapters").select("qc").eq("project_id", ctx.projectId);
  const qcs = (data ?? []).map((r) => r.qc as QualityResult | null).filter((q): q is QualityResult => !!q);
  const average = qcs.length ? Math.round((qcs.reduce((n, q) => n + q.score, 0) / qcs.length) * 10) / 10 : null;
  await ctx.supabase
    .from("documents")
    .update({
      quality_report: {
        average,
        checked: qcs.length,
        regenerated: qcs.filter((q) => q.regenerated).length,
        flagged: qcs.filter((q) => q.unsupported_claims.length || q.missing_topics.length).length,
      },
    })
    .eq("project_id", ctx.projectId);
  return { done: true };
}
