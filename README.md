# AI Learning Studio

**Turn anything you watch or read into your own AI-powered textbook.**

Paste a YouTube link, upload a PDF/DOCX/TXT/Markdown file, point at an article, or paste any text. The app analyses the whole source and
builds a structured learning book: table of contents, chapters organised by concept, beginner-friendly explanations, examples from the
source, questions a beginner would ask, practical application, key takeaways, and a revision system (quick revision, flashcards, quiz).
Next to the book you get an AI tutor, selection actions (explain simply, example, explain again, important points, create notes), bookmarks,
highlights, personal notes, search, a side-by-side view of the original source, and export.

Output can be in **English, Hindi or Hinglish**, in any combination of learning styles (Book, Beginner, Teacher, Real-Life Examples,
Structured Notes, Story, Q&A, Concept Breakdown, Actionable Guide), plus your own "How should AI teach me?" instruction.

## Source fidelity

Every block the AI writes carries a provenance label and source references:

| Label                  | Meaning                                              |
| ---------------------- | ---------------------------------------------------- |
| From the source        | Directly stated in the uploaded material             |
| AI explanation         | A simplification of something the source says        |
| AI-generated example   | An example the AI created (only if you enable it)    |
| Additional explanation | Knowledge not present in the source — shown visibly  |

References point to the exact part of the original: `02:34–04:18` for videos (with a jump-to-timestamp link), `Page 12` for PDFs,
`¶ 14–18` for text. Clicking one opens the **Original Source** view at that spot. Each chapter is independently reviewed against its source
passages before you see it; chapters that fail review are rewritten once with the reviewer's findings, and the review result is shown on the
chapter.

## Architecture

```
Source ──► extract + clean ──► segments (S1…Sn, with timestamps / pages / ¶)
                                   │
                                   ▼
                              chunks (~1,800 words, never split a segment)
                                   │  map: per-chunk structured analysis (topics, concepts, examples, facts)
                                   ▼
                          reduce: global understanding + concept tree + glossary + chapter plan
                                   │
                                   ▼
                    write each chapter from only its assigned source parts (structured JSON blocks)
                                   │
                                   ▼
               quality check each chapter vs. its source ── fail ──► rewrite with findings (once)
                                   │
                                   ▼
                  revision material: quick revision, takeaways, questions, flashcards, quiz
```

- **Resumable pipeline** (`src/lib/ai/pipeline.ts`). Each call to `POST /api/projects/:id/process` takes a database lock, does as much work
  as fits in its time budget, and persists everything it finishes. A timeout, crash, or closed tab never loses completed work; the next call
  resumes at the same step. The processing screen drives these calls and shows real progress (parts analysed, chapters written/checked) —
  no fake percentages. Transient AI errors are retried; three consecutive failures mark the book failed with a **Retry** button that resumes
  from the failed step.
- **Structured output.** Every model call uses JSON-schema–constrained output validated with Zod (`src/lib/ai/schemas.ts`), with
  source-reference sanitisation (citations outside the source are dropped).
- **Model.** Claude via the official Anthropic SDK (`claude-opus-5` by default, adaptive thinking, streaming). Server-side refusal
  fallbacks (`fallbacks: "default"`) are enabled; set `AI_FALLBACKS=off` on platforms that don't support them.
- **Tutor & selection actions** stream answers grounded in BM25-retrieved source segments plus the current chapter, and cite `[S12]`
  segments inline (clickable).
- **Data** lives in Supabase Postgres with Row Level Security on every table; uploads go straight from the browser to a private Supabase
  Storage bucket under the user's folder.

### Tech stack

Next.js 16 (App Router, route handlers, `proxy.ts`) · React 19 · TypeScript · Tailwind CSS v4 · Supabase (Postgres, Auth, Storage) ·
Anthropic SDK · Zod · unpdf · mammoth · docx · Mozilla Readability · Vitest.

### Project layout

```
src/
  app/                      pages + API routes
    api/projects/…          create, process, retry, chat, assist, progress, export, notes/bookmarks/highlights
    p/[id]/                 reader (or processing screen) and printable study book
  components/reader/        book reader: TOC, chapter view, study panel, tutor, quiz, flashcards, search, source view
  lib/ingest/               YouTube captions, PDF/DOCX/article extraction, cleaning, segmentation, chunking
  lib/ai/                   Claude client, prompts, schemas, pipeline, retrieval
  lib/content/              shared types, reference formatting, Markdown export
  lib/server/               auth helpers, book loader, progress, DOCX export
supabase/migrations/        database schema, RLS policies, storage bucket
```

### Database

`profiles`, `projects`, `sources`, `source_segments`, `chunks`, `documents`, `chapters`, `sections`, `questions`, `flashcards`, `quizzes`,
`quiz_questions`, `quiz_attempts`, `notes`, `bookmarks`, `highlights`, `reading_progress`, `conversations`, `messages`. Every user-owned row
carries `user_id`, so RLS is a single indexed predicate (`user_id = auth.uid()`). Deleting a project cascades to everything derived from it.

## Setup

1. **Supabase**: create a project. Run the files in `supabase/migrations/` in order (SQL editor, or `supabase db push`). This creates tables, RLS
   policies, the signup trigger, and the private `sources` storage bucket.
2. **Auth URLs** (Supabase → Authentication → URL Configuration): set the Site URL to your app URL and add `https://<your-app>/auth/callback`
   (and `http://localhost:3000/auth/callback` for local dev) as a redirect URL.
3. **Environment**: copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
   `ANTHROPIC_API_KEY`. Optional: `AI_MODEL`, `AI_FALLBACKS=off`.
4. `npm install` then `npm run dev`.

### Deploy on Vercel

Import the repository, add the same environment variables, deploy. The processing route declares `maxDuration = 300`; make sure your plan
allows 300-second functions (Fluid compute). Each processing step is time-boxed to fit inside that limit.

## Scripts

| Command             | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `npm run dev`       | Local dev server                                                   |
| `npm run build`     | Production build                                                   |
| `npm test`          | Unit tests + an end-to-end pipeline test (mocked model, in-memory DB) |
| `npm run typecheck` | TypeScript                                                         |
| `npm run lint`      | ESLint                                                             |
| `npm run format`    | Prettier                                                           |

## Known limitations

- **YouTube transcripts** come from the video's captions. Videos without captions can't be analysed automatically — the app says so and
  lets you paste the transcript (timestamps like `02:34` are kept). YouTube sometimes blocks caption requests from cloud-hosting IP ranges;
  the paste fallback covers that too.
- **Processing runs while the processing page is open.** If you leave, it pauses and resumes from the same step when you return.
- **PDF export** uses the browser's print-to-PDF on a print-optimised page (this renders Hindi/Devanagari correctly). DOCX, Markdown, TXT
  and copy-to-clipboard are generated server-side.
- **Scanned PDFs** need OCR first; the app detects when a PDF has almost no extractable text.
- Source limit: 150,000 words per book.
