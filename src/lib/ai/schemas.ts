import { z } from "zod";
import { BLOCK_TYPES } from "@/lib/content/types";

const refs = z
  .array(z.string())
  .describe('Source segment ids that support this item, e.g. ["S3","S4"]. Empty only for AI-generated content.');
const provenance = z
  .enum(["source", "explanation", "ai_example", "additional"])
  .describe(
    "source = stated in the source; explanation = your simplification of source content; ai_example = an example you invented; additional = knowledge not present in the source",
  );

// --- Map step: one call per chunk -------------------------------------------
export const ChunkAnalysisSchema = z.object({
  summary: z.string().describe("4-8 sentence faithful summary of this part of the source"),
  topics: z.array(z.object({ name: z.string(), description: z.string(), refs })),
  concepts: z.array(
    z.object({
      name: z.string(),
      definition: z.string().describe("What the source says it means (or how it is used), in plain words"),
      importance: z.number().int().describe("1 (minor) to 5 (central)"),
      refs,
    }),
  ),
  examples: z.array(
    z.object({
      title: z.string(),
      description: z.string().describe("The example/story/case exactly as the source presents it"),
      concept: z.string().describe("Which concept it illustrates"),
      refs,
    }),
  ),
  key_facts: z.array(
    z.object({
      kind: z.enum(["statistic", "name", "framework", "definition", "argument", "quote", "step", "other"]),
      text: z.string(),
      refs,
    }),
  ),
  beginner_questions: z.array(z.string()).describe("Questions a beginner would naturally ask about this part"),
  noise_notes: z.string().describe("Brief note of repetition, filler, off-topic chatter or transcription errors you noticed"),
});
export type ChunkAnalysis = z.infer<typeof ChunkAnalysisSchema>;

// --- Reduce step: global understanding + chapter plan -------------------------
export const PlanSchema = z.object({
  title: z.string().describe("Book title for the learning material (not clickbait)"),
  subtitle: z.string(),
  overview: z.string().describe("Introduction for the learner: what this material covers and why it matters (2 short paragraphs)"),
  detected_language: z.string().describe("Language of the source, e.g. English, Hindi, Hinglish"),
  glossary: z.array(z.object({ term: z.string(), meaning: z.string(), refs })),
  concept_tree: z.array(
    z.object({ name: z.string().describe("A big concept"), children: z.array(z.string()).describe("Smaller concepts it breaks into") }),
  ),
  chapters: z.array(
    z.object({
      key: z.string().describe("short stable slug, e.g. ch-customer"),
      title: z.string(),
      goal: z.string().describe("What the learner will understand after this chapter"),
      kind: z.enum(["introduction", "core", "examples", "practical", "summary"]),
      concepts: z.array(z.string()),
      chunk_indexes: z.array(z.number().int()).describe("Indexes of the source parts whose content belongs in this chapter"),
    }),
  ),
});
export type Plan = z.infer<typeof PlanSchema>;

// --- Chapter generation -------------------------------------------------------
export const BlockSchema = z.object({
  type: z.enum(BLOCK_TYPES),
  title: z.string(),
  text: z.string(),
  extra: z.string(),
  items: z.array(z.string()),
  provenance,
  refs,
});

export const ChapterSchema = z.object({
  title: z.string(),
  summary: z.string().describe("1-2 sentence chapter summary"),
  sections: z.array(
    z.object({
      title: z.string().describe("Topic name"),
      summary: z.string().describe("One-line simple explanation of the topic"),
      blocks: z.array(BlockSchema),
      refs,
    }),
  ),
  key_takeaway: z.string(),
});
export type GeneratedChapter = z.infer<typeof ChapterSchema>;

// --- Quality control -----------------------------------------------------------
export const QualitySchema = z.object({
  score: z.number().int().describe("Overall quality 1-10"),
  meaning_preserved: z.boolean(),
  missing_topics: z.array(z.string()).describe("Important source points for this chapter that are missing"),
  unsupported_claims: z.array(z.string()).describe("Statements presented as from the source that the source does not support"),
  unlabeled_examples: z.array(z.string()).describe("Invented examples not labelled ai_example"),
  beginner_friendly: z.boolean(),
  issues: z.array(z.string()).describe("Other concrete problems: repetition, disorder, dropped terminology, missing refs"),
  verdict: z.enum(["pass", "regenerate"]),
});

// --- Revision material ---------------------------------------------------------
export const RevisionSchema = z.object({
  quick_revision: z.array(z.string()).describe("5-10 most important points"),
  key_takeaways: z.array(z.string()),
  revision_questions: z.array(z.object({ question: z.string(), answer: z.string(), chapter_key: z.string(), refs })),
  flashcards: z.array(z.object({ front: z.string(), back: z.string(), chapter_key: z.string(), refs })),
  quiz: z.array(
    z.object({
      kind: z.enum(["mcq", "true_false", "short", "concept"]),
      prompt: z.string(),
      options: z.array(z.string()).describe('4 options for mcq, ["True","False"] for true_false, empty otherwise'),
      answer: z.string().describe("For mcq/true_false: exactly one of the options. Otherwise a model answer."),
      explanation: z.string(),
      chapter_key: z.string(),
      refs,
    }),
  ),
});
export type Revision = z.infer<typeof RevisionSchema>;
