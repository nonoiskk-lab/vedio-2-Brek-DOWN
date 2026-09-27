import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rankSegments, renderExcerpts, type RetrievableSegment } from "@/lib/ai/retrieval";
import type { Block, ProjectSettings } from "@/lib/content/types";

export async function loadTutorContext(supabase: SupabaseClient, projectId: string, query: string, chapterId?: string | null) {
  const [{ data: project }, { data: doc }, { data: segs }, chapter] = await Promise.all([
    supabase.from("projects").select("title, settings").eq("id", projectId).single(),
    supabase.from("documents").select("title, plan").eq("project_id", projectId).single(),
    supabase.from("source_segments").select("idx, ref_label, text").eq("project_id", projectId).order("idx"),
    chapterId
      ? supabase
          .from("chapters")
          .select("title, summary, sections(title, blocks, idx)")
          .eq("id", chapterId)
          .eq("project_id", projectId)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
  ]);
  const segments = (segs ?? []) as RetrievableSegment[];
  const excerpts = rankSegments(segments, query, 10);
  const outline = ((doc?.plan?.chapters ?? []) as { title: string; goal: string }[])
    .map((c, i) => `${i + 1}. ${c.title} — ${c.goal}`)
    .join("\n");
  let chapterText = "";
  if (chapter) {
    const sections = ((chapter.sections ?? []) as { title: string; blocks: Block[]; idx: number }[]).sort((a, b) => a.idx - b.idx);
    chapterText =
      `Current chapter: ${chapter.title}\n${chapter.summary ?? ""}\n` +
      sections
        .map((s) => `## ${s.title}\n` + s.blocks.map((b) => [b.title, b.text, b.items.join("; ")].filter(Boolean).join(": ")).join("\n"))
        .join("\n")
        .slice(0, 20000);
  }
  const contextBlock = `<book_outline title="${doc?.title ?? project?.title ?? ""}">
${outline}
</book_outline>
${chapterText ? `<current_chapter>\n${chapterText}\n</current_chapter>\n` : ""}<source_excerpts>
${excerpts.length ? renderExcerpts(excerpts) : "(no closely matching passages found in the source)"}
</source_excerpts>`;
  return {
    settings: (project?.settings ?? { styles: [], language: "en", aiExamples: false }) as ProjectSettings,
    bookTitle: (doc?.title ?? project?.title ?? "this book") as string,
    contextBlock,
    citedSegments: excerpts.map((e) => e.idx),
  };
}

export function textStream(gen: AsyncGenerator<string>, onDone?: (full: string) => Promise<void>, headers: Record<string, string> = {}) {
  const encoder = new TextEncoder();
  let full = "";
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) {
          if (onDone) await onDone(full);
          controller.close();
          return;
        }
        full += value;
        controller.enqueue(encoder.encode(value));
      } catch (err) {
        console.error(err);
        const msg = "\n\n_(Sorry — the AI tutor hit an error. Please try again.)_";
        controller.enqueue(encoder.encode(msg));
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
