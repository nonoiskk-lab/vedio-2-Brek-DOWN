import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeDb } from "@/test/fake-supabase";
import { segmentsFromText } from "@/lib/ingest/segment";
import { buildChunks } from "@/lib/ingest/chunk";
import { ChapterSchema, ChunkAnalysisSchema, PlanSchema, QualitySchema, RevisionSchema } from "./schemas";

const calls: { schema: string; prompt: string }[] = [];
let qcRejectFirst = true;
let failNext: Error | null = null;

vi.mock("./client", async (orig) => {
  const actual = await orig<typeof import("./client")>();
  return {
    ...actual,
    generateStructured: vi.fn(async (opts: { schema: unknown; prompt: string }) => {
      if (failNext) {
        const e = failNext;
        failNext = null;
        throw e;
      }
      const name =
        opts.schema === ChunkAnalysisSchema
          ? "analysis"
          : opts.schema === PlanSchema
            ? "plan"
            : opts.schema === ChapterSchema
              ? "chapter"
              : opts.schema === QualitySchema
                ? "qc"
                : opts.schema === RevisionSchema
                  ? "revision"
                  : "unknown";
      calls.push({ schema: name, prompt: opts.prompt });
      switch (name) {
        case "analysis":
          return {
            summary: "s",
            topics: [{ name: "Customer", description: "d", refs: ["S1", "S400"] }],
            concepts: [{ name: "Positioning", definition: "a place in the mind", importance: 5, refs: ["S2"] }],
            examples: [{ title: "Greek yogurt", description: "brand example", concept: "Positioning", refs: ["S3"] }],
            key_facts: [],
            beginner_questions: ["What is a brand?"],
            noise_notes: "",
          };
        case "plan":
          return {
            title: "Marketing Fundamentals",
            subtitle: "From customer to brand",
            overview: "Overview",
            detected_language: "English",
            glossary: [{ term: "Brand", meaning: "promise", refs: ["S1"] }],
            concept_tree: [{ name: "Marketing", children: ["Customer", "Positioning"] }],
            chapters: [
              { key: "intro", title: "Introduction", goal: "g", kind: "introduction", concepts: [], chunk_indexes: [0] },
              {
                key: "customer",
                title: "Understanding the Customer",
                goal: "g",
                kind: "core",
                concepts: ["Customer"],
                chunk_indexes: [0, 1],
              },
              { key: "positioning", title: "Positioning", goal: "g", kind: "core", concepts: ["Positioning"], chunk_indexes: [] },
            ],
          };
        case "chapter":
          return {
            title: "Chapter",
            summary: "sum",
            key_takeaway: "take",
            sections: [
              {
                title: "Topic",
                summary: "simple",
                refs: ["S1"],
                blocks: [
                  {
                    type: "paragraph",
                    title: "",
                    text: "Explained **simply**.",
                    extra: "",
                    items: [],
                    provenance: "explanation",
                    refs: ["S1", "S2"],
                  },
                  {
                    type: "qa",
                    title: "Brand kya hota hai?",
                    text: "A promise.",
                    extra: "",
                    items: [],
                    provenance: "source",
                    refs: ["S2"],
                  },
                  { type: "example", title: "AI example: cafe", text: "t", extra: "lesson", items: [], provenance: "ai_example", refs: [] },
                  { type: "bullets", title: "", text: "", extra: "", items: [], provenance: "source", refs: [] },
                ],
              },
            ],
          };
        case "qc": {
          const reject = qcRejectFirst && opts.prompt.includes('"title":"Chapter"');
          qcRejectFirst = false;
          return {
            score: reject ? 4 : 9,
            meaning_preserved: !reject,
            missing_topics: reject ? ["competition"] : [],
            unsupported_claims: [],
            unlabeled_examples: [],
            beginner_friendly: true,
            issues: [],
            verdict: reject ? "regenerate" : "pass",
          };
        }
        case "revision":
          return {
            quick_revision: ["p1", "p2"],
            key_takeaways: ["k1"],
            revision_questions: [{ question: "q?", answer: "a", chapter_key: "customer", refs: ["S1"] }],
            flashcards: [{ front: "What is positioning?", back: "A place in the mind", chapter_key: "positioning", refs: ["S2"] }],
            quiz: [
              {
                kind: "mcq",
                prompt: "Pick",
                options: ["A", "B", "C", "D"],
                answer: "b",
                explanation: "e",
                chapter_key: "customer",
                refs: [],
              },
              { kind: "mcq", prompt: "Broken", options: ["A", "B"], answer: "Z", explanation: "e", chapter_key: "customer", refs: [] },
              { kind: "true_false", prompt: "TF", options: [], answer: "true", explanation: "e", chapter_key: "nope", refs: [] },
              { kind: "short", prompt: "Explain", options: ["x"], answer: "model", explanation: "e", chapter_key: "intro", refs: [] },
            ],
          };
      }
      throw new Error("unexpected schema");
    }),
  };
});

const { advancePipeline, retryPipeline } = await import("./pipeline");
const { AIError } = await import("./client");

function seed(db: FakeDb) {
  const projectId = "p1";
  const userId = "u1";
  db.rows("projects").push({
    id: projectId,
    user_id: userId,
    title: "Raw title",
    status: "processing",
    stage: "analyze",
    stage_detail: {},
    error: null,
    lock_until: null,
    settings: { styles: ["book", "beginner", "qa"], language: "hinglish", aiExamples: true },
  });
  db.rows("sources").push({ id: "s1", project_id: projectId, kind: "youtube", title: "Video" });
  const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} about customers, brands and positioning. `.repeat(12)).join("\n\n");
  const segments = segmentsFromText(text);
  segments.forEach((s) => db.rows("source_segments").push({ ...s, project_id: projectId, source_id: "s1", user_id: userId }));
  buildChunks(segments, 1800).forEach((c) => db.rows("chunks").push({ ...c, project_id: projectId, user_id: userId, analysis: null }));
  return { projectId, userId, db, client: db as unknown as SupabaseClient };
}

describe("pipeline", () => {
  beforeEach(() => {
    calls.length = 0;
    qcRejectFirst = true;
    failNext = null;
  });

  it("runs every stage to a complete, source-referenced learning book", async () => {
    const { client, db, projectId, userId } = seed(new FakeDb());
    const chunkCount = db.rows("chunks").length;
    expect(chunkCount).toBeGreaterThan(1);

    let state = await advancePipeline(client, userId, projectId);
    for (let i = 0; i < 10 && state.status === "processing"; i++) state = await advancePipeline(client, userId, projectId);
    expect(state.status).toBe("ready");
    expect(state.stage).toBe("done");

    // Map step analysed every chunk; refs outside the source were dropped.
    expect(calls.filter((c) => c.schema === "analysis")).toHaveLength(chunkCount);
    const analysis = db.rows("chunks")[0].analysis as { topics: { refs: string[] }[] };
    expect(analysis.topics[0].refs).toEqual(["S1"]);

    // Plan normalised: empty chunk list got a fallback, orphan chunks were assigned.
    const doc = db.rows("documents")[0] as { plan: { chapters: { chunk_indexes: number[] }[] } };
    const covered = new Set(doc.plan.chapters.flatMap((c) => c.chunk_indexes));
    expect(covered.size).toBe(chunkCount);
    expect(db.rows("projects")[0].title).toBe("Marketing Fundamentals");

    // Chapters written, checked, one regenerated after a failing review.
    const chapters = db.rows("chapters");
    expect(chapters).toHaveLength(3);
    expect(chapters.every((c) => c.status === "checked")).toBe(true);
    expect(chapters.filter((c) => (c.qc as { regenerated?: boolean }).regenerated)).toHaveLength(1);
    const regenPrompt = calls.filter((c) => c.schema === "chapter").find((c) => c.prompt.includes("A reviewer rejected"));
    expect(regenPrompt?.prompt).toContain("Missing: competition");
    // Style + language instructions reach the writer.
    expect(calls.find((c) => c.schema === "chapter")!.prompt).toContain("Hinglish");
    expect(calls.find((c) => c.schema === "chapter")!.prompt).toContain("AI-generated examples are ENABLED");

    // Sections: empty blocks removed, refs kept.
    const sections = db.rows("sections");
    expect(sections).toHaveLength(3);
    const blocks = sections[0].blocks as { type: string; refs: string[] }[];
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "qa", "example"]);
    expect(sections[0].source_refs).toEqual(["S1", "S2"]);

    // Revision material: invalid MCQ dropped, answers normalised, chapters linked.
    const quiz = db.rows("quiz_questions") as { kind: string; answer: string; options: string[]; chapter_id: string | null }[];
    expect(quiz.map((q) => q.kind)).toEqual(["mcq", "true_false", "short"]);
    expect(quiz[0].answer).toBe("B");
    expect(quiz[1].options).toEqual(["True", "False"]);
    expect(quiz[1].answer).toBe("True");
    expect(quiz[1].chapter_id).toBeNull();
    expect(quiz[2].options).toEqual([]);
    expect(db.rows("flashcards")).toHaveLength(1);
    expect(db.rows("questions")[0].chapter_id).toBe(chapters.find((c) => c.plan_key === "customer")!.id);
    expect((db.rows("documents")[0].quality_report as { regenerated: number }).regenerated).toBe(1);
    expect(db.rows("projects")[0].lock_until).toBeNull();
  });

  it("does not run while another worker holds the lock", async () => {
    const { client, db, projectId, userId } = seed(new FakeDb());
    db.rows("projects")[0].lock_until = new Date(Date.now() + 60_000).toISOString();
    const state = await advancePipeline(client, userId, projectId);
    expect(state.busy).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("retries transient failures, fails after repeated ones, and resumes via retry", async () => {
    const { client, db, projectId, userId } = seed(new FakeDb());
    for (let i = 0; i < 3; i++) {
      failNext = new AIError("rate limited", true);
      const s = await advancePipeline(client, userId, projectId);
      expect(s.status).toBe(i < 2 ? "processing" : "failed");
    }
    expect(db.rows("projects")[0].error).toBe("rate limited");

    await retryPipeline(client, projectId);
    let state = await advancePipeline(client, userId, projectId);
    for (let i = 0; i < 10 && state.status === "processing"; i++) state = await advancePipeline(client, userId, projectId);
    expect(state.status).toBe("ready");
  });

  it("fails immediately on non-retryable errors", async () => {
    const { client, projectId, userId } = seed(new FakeDb());
    failNext = new AIError("bad key", false);
    const s = await advancePipeline(client, userId, projectId);
    expect(s.status).toBe("failed");
  });
});
