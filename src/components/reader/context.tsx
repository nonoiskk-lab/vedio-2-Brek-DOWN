"use client";
import { createContext, useContext } from "react";
import type { BookmarkRow, HighlightRow, LearningBook, NoteRow, SegmentRow } from "@/lib/content/types";
import type { AssistAction } from "@/lib/ai/prompts";

export type ReaderView = "learn" | "source" | "revise" | "flashcards" | "quiz" | "bookmarks" | "notes";
export type Page = "about" | "takeaways" | "questions" | string; // string = chapter id
export type RightTab = "ask" | "notes" | "highlights" | "questions";

export interface ReaderApi {
  book: LearningBook;
  segments: Map<number, SegmentRow>;
  view: ReaderView;
  setView: (v: ReaderView) => void;
  page: Page;
  goTo: (page: Page, anchor?: string) => void;
  openSource: (segmentIdx: number) => void;
  sourceFocus: number | null;
  // study layer
  toggleBookmark: (b: Omit<BookmarkRow, "id" | "created_at">) => Promise<void>;
  isBookmarked: (anchor: string) => boolean;
  addNote: (n: { chapter_id: string | null; anchor: string | null; quote: string | null; content: string }) => Promise<NoteRow | null>;
  updateNote: (id: string, content: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  addHighlight: (h: { chapter_id: string | null; anchor: string | null; text: string; color?: string }) => Promise<void>;
  deleteHighlight: (id: string) => Promise<void>;
  highlightsFor: (anchor: string) => HighlightRow[];
  // AI
  askTutor: (message: string, selection?: string) => void;
  runAssist: (action: AssistAction, text: string) => void;
  // progress
  setChapterProgress: (chapterId: string, percent: number, completed: boolean) => void;
  setProgressPercent: (p: number) => void;
  rightTab: RightTab;
  setRightTab: (t: RightTab) => void;
  openNoteEditor: (target: { chapter_id: string | null; anchor: string | null; quote: string | null }) => void;
}

export const ReaderContext = createContext<ReaderApi | null>(null);
export function useReader(): ReaderApi {
  const ctx = useContext(ReaderContext);
  if (!ctx) throw new Error("useReader outside Reader");
  return ctx;
}
