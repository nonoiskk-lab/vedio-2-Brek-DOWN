// Shared domain types used by the pipeline, API routes and the reader UI.

export const LEARNING_STYLES = [
  { id: "book", label: "Book Reading", emoji: "📖", hint: "Flows like a well-written chapter" },
  { id: "beginner", label: "Beginner Friendly", emoji: "🧠", hint: "Every term explained simply" },
  { id: "teacher", label: "Teacher Explanation", emoji: "🎓", hint: "What / why / how / where / example" },
  { id: "examples", label: "Real-Life Examples", emoji: "💡", hint: "Unpacks every example in the source" },
  { id: "notes", label: "Structured Notes", emoji: "📝", hint: "Headings, bullets, definitions" },
  { id: "story", label: "Story Mode", emoji: "🔄", hint: "Concepts connected as one narrative" },
  { id: "qa", label: "Q&A", emoji: "❓", hint: "Questions a beginner would ask" },
  { id: "concepts", label: "Concept Breakdown", emoji: "🧩", hint: "Big ideas split into small ones" },
  { id: "actionable", label: "Actionable Guide", emoji: "🚀", hint: "What to actually do next" },
] as const;

export type LearningStyle = (typeof LEARNING_STYLES)[number]["id"];
export type OutputLanguage = "en" | "hi" | "hinglish";

export const LANGUAGE_LABELS: Record<OutputLanguage, string> = {
  en: "English",
  hi: "Hindi",
  hinglish: "Hinglish",
};

export interface ProjectSettings {
  styles: LearningStyle[];
  language: OutputLanguage;
  customInstruction?: string;
  aiExamples: boolean;
}

export type SourceKind = "youtube" | "pdf" | "docx" | "txt" | "md" | "text" | "article" | "transcript";

/** Where a statement comes from — rendered as a visible label in the reader. */
export type Provenance = "source" | "explanation" | "ai_example" | "additional";

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  source: "From the source",
  explanation: "AI explanation",
  ai_example: "AI-generated example",
  additional: "Additional explanation — not in the source",
};

export const BLOCK_TYPES = [
  "paragraph",
  "definition",
  "qa",
  "example",
  "why_it_matters",
  "practical",
  "takeaway",
  "bullets",
  "steps",
  "teacher",
  "story",
  "concept_map",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/**
 * A single renderable unit of a section. The shape is intentionally flat so the
 * model can emit it reliably through structured output; unused fields are empty.
 *
 * - paragraph:       text
 * - definition:      title=term, text=simple meaning, extra=why it matters, items[0]=example
 * - qa:              title=question, text=answer
 * - example:         title, text=explanation of the example, extra=why this example matters
 * - why_it_matters / practical / takeaway / story: text
 * - bullets / steps: title?, items
 * - teacher:         title=concept, items=[what, why, how, where, example]
 * - concept_map:     title=root concept, items=["Child — one-line meaning", ...]
 */
export interface Block {
  type: BlockType;
  title: string;
  text: string;
  extra: string;
  items: string[];
  provenance: Provenance;
  refs: string[];
}

export interface SectionRow {
  id: string;
  chapter_id: string;
  idx: number;
  title: string;
  summary: string | null;
  blocks: Block[];
  source_refs: string[];
}

export interface ChapterRow {
  id: string;
  idx: number;
  plan_key: string;
  title: string;
  summary: string | null;
  kind: string;
  key_takeaway: string | null;
  source_refs: string[];
  status: string;
  qc: QualityResult | null;
}

export interface QualityResult {
  score: number;
  meaning_preserved: boolean;
  missing_topics: string[];
  unsupported_claims: string[];
  unlabeled_examples: string[];
  beginner_friendly: boolean;
  issues: string[];
  verdict: "pass" | "regenerate";
  regenerated?: boolean;
}

export interface SegmentRow {
  idx: number;
  ref_label: string;
  start_sec: number | null;
  end_sec: number | null;
  page: number | null;
  heading: string | null;
  text: string;
}

export interface QuizQuestionRow {
  id: string;
  chapter_id: string | null;
  idx: number;
  kind: "mcq" | "true_false" | "short" | "concept";
  prompt: string;
  options: string[];
  answer: string;
  explanation: string;
  source_refs: string[];
}

export interface FlashcardRow {
  id: string;
  chapter_id: string | null;
  idx: number;
  front: string;
  back: string;
  source_refs: string[];
  review_count: number;
  last_result: "again" | "good" | "easy" | null;
}

export interface QuestionRow {
  id: string;
  chapter_id: string | null;
  idx: number;
  question: string;
  answer: string;
  source_refs: string[];
}

export interface NoteRow {
  id: string;
  chapter_id: string | null;
  anchor: string | null;
  quote: string | null;
  content: string;
  updated_at: string;
}

export interface BookmarkRow {
  id: string;
  chapter_id: string | null;
  target_type: "chapter" | "paragraph" | "question" | "concept";
  anchor: string;
  label: string;
  excerpt: string | null;
  created_at: string;
}

export interface HighlightRow {
  id: string;
  chapter_id: string | null;
  anchor: string | null;
  text: string;
  color: string;
  created_at: string;
}

export interface ProgressRow {
  chapter_id: string;
  percent: number;
  completed: boolean;
}

export interface QuizAttemptRow {
  question_id: string;
  response: string;
  is_correct: boolean;
  created_at: string;
}

export interface RevisionData {
  quick_revision: string[];
  key_takeaways: string[];
}

export interface DocumentPlan {
  title: string;
  subtitle: string;
  overview: string;
  detected_language: string;
  glossary: { term: string; meaning: string; refs: string[] }[];
  concept_tree: { name: string; children: string[] }[];
  chapters: PlannedChapter[];
}

export interface PlannedChapter {
  key: string;
  title: string;
  goal: string;
  kind: "introduction" | "core" | "examples" | "practical" | "summary";
  concepts: string[];
  chunk_indexes: number[];
}

export type PipelineStage = "analyze" | "plan" | "write" | "quality" | "revision" | "finalize" | "done";

export interface StageDetail {
  analyzed?: number;
  totalChunks?: number;
  written?: number;
  totalChapters?: number;
  checked?: number;
  regenerated?: number;
  message?: string;
}

/** Everything the reader needs, loaded once per project page. */
export interface LearningBook {
  project: {
    id: string;
    title: string;
    emoji: string;
    settings: ProjectSettings;
    progress_percent: number;
  };
  source: {
    kind: SourceKind;
    title: string | null;
    url: string | null;
    language: string | null;
    meta: Record<string, unknown>;
  };
  document: {
    id: string;
    title: string;
    subtitle: string | null;
    plan: DocumentPlan;
    revision: RevisionData;
    quality_report: { average?: number; regenerated?: number; checked?: number };
  };
  chapters: (ChapterRow & { sections: SectionRow[] })[];
  segments: SegmentRow[];
  questions: QuestionRow[];
  flashcards: FlashcardRow[];
  quiz: QuizQuestionRow[];
  attempts: QuizAttemptRow[];
  notes: NoteRow[];
  bookmarks: BookmarkRow[];
  highlights: HighlightRow[];
  progress: ProgressRow[];
}
