import { z } from "zod";

const uuid = z.string().uuid();

/** Create schemas for the personal study layer: notes, bookmarks, highlights. */
export const CREATE_SCHEMAS = {
  notes: z.object({
    chapter_id: uuid.nullish(),
    anchor: z.string().max(120).nullish(),
    quote: z.string().max(4000).nullish(),
    content: z.string().max(20000),
  }),
  bookmarks: z.object({
    chapter_id: uuid.nullish(),
    target_type: z.enum(["chapter", "paragraph", "question", "concept"]),
    anchor: z.string().min(1).max(120),
    label: z.string().min(1).max(300),
    excerpt: z.string().max(1000).nullish(),
  }),
  highlights: z.object({
    chapter_id: uuid.nullish(),
    anchor: z.string().max(120).nullish(),
    text: z.string().min(1).max(4000),
    color: z.enum(["yellow", "green", "blue", "pink"]).default("yellow"),
  }),
} as const;

export type Resource = keyof typeof CREATE_SCHEMAS;
export const isResource = (r: string): r is Resource => r in CREATE_SCHEMAS;
