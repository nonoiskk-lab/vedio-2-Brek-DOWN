import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRouteError, jsonError, requireUser } from "@/lib/server/http";
import {
  SourceError,
  extractArticle,
  extractDocx,
  extractPdf,
  extractPlainText,
  extractTranscriptText,
  extractYouTube,
  kindFromFilename,
  type ExtractedSource,
} from "@/lib/ingest/extract";
import { buildChunks } from "@/lib/ingest/chunk";
import { LEARNING_STYLES } from "@/lib/content/types";

export const maxDuration = 60;

const styleIds = LEARNING_STYLES.map((s) => s.id) as [string, ...string[]];

const BodySchema = z.object({
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("youtube"), url: z.string().min(5), transcript: z.string().max(2_000_000).optional() }),
    z.object({ type: z.literal("file"), storagePath: z.string().min(3), filename: z.string().min(1) }),
    z.object({ type: z.literal("text"), text: z.string().min(1).max(2_000_000), title: z.string().max(200).optional() }),
    z.object({ type: z.literal("article"), url: z.string().url() }),
  ]),
  settings: z.object({
    styles: z.array(z.enum(styleIds)).min(1).max(9),
    language: z.enum(["en", "hi", "hinglish"]),
    customInstruction: z.string().max(2000).optional(),
    aiExamples: z.boolean(),
  }),
});

function titleFromText(text: string): string {
  const firstLine =
    text
      .trim()
      .split("\n")
      .find((l) => l.trim())
      ?.replace(/^#+\s*/, "")
      .trim() ?? "Pasted content";
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "…" : firstLine;
}

export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("projects")
      .select("id, title, emoji, status, stage, progress_percent, updated_at, last_opened_at, sources(kind)")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ projects: data });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Invalid request: " + parsed.error.issues.map((i) => i.message).join(", "));
    const { source, settings } = parsed.data;

    let extracted: ExtractedSource;
    let storagePath: string | null = null;
    try {
      switch (source.type) {
        case "youtube":
          extracted = await extractYouTube(source.url, source.transcript);
          break;
        case "article":
          extracted = await extractArticle(source.url);
          break;
        case "text":
          extracted = extractPlainText(source.text, source.title?.trim() || titleFromText(source.text), "text");
          break;
        case "file": {
          if (!source.storagePath.startsWith(`${user.id}/`)) return jsonError("Invalid file path.", 403);
          const kind = kindFromFilename(source.filename);
          if (!kind) return jsonError("Unsupported file type. Use PDF, DOCX, TXT, MD, SRT or VTT.");
          const { data: blob, error } = await supabase.storage.from("sources").download(source.storagePath);
          if (error || !blob) return jsonError("Uploaded file not found. Please upload it again.", 404);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const title = source.filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
          storagePath = source.storagePath;
          if (kind === "pdf") extracted = await extractPdf(bytes, title);
          else if (kind === "docx") extracted = await extractDocx(bytes, title);
          else {
            const text = new TextDecoder("utf-8").decode(bytes);
            extracted = kind === "transcript" ? extractTranscriptText(text, title) : extractPlainText(text, title, kind as "txt" | "md");
          }
          break;
        }
      }
    } catch (e) {
      if (e instanceof SourceError) return jsonError(e.message, e.status);
      throw e;
    }

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .insert({
        user_id: user.id,
        title: extracted.title,
        status: "processing",
        stage: "analyze",
        settings: { ...settings, customInstruction: settings.customInstruction?.trim() || undefined },
      })
      .select("id")
      .single();
    if (pErr) throw new Error(pErr.message);

    try {
      const { data: src, error: sErr } = await supabase
        .from("sources")
        .insert({
          project_id: project.id,
          user_id: user.id,
          kind: extracted.kind,
          title: extracted.title,
          url: extracted.url,
          storage_path: storagePath,
          language: extracted.language,
          word_count: extracted.wordCount,
          meta: extracted.meta,
        })
        .select("id")
        .single();
      if (sErr) throw new Error(sErr.message);

      const rows = extracted.segments.map((s) => ({ ...s, project_id: project.id, source_id: src.id, user_id: user.id }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from("source_segments").insert(rows.slice(i, i + 500));
        if (error) throw new Error(error.message);
      }
      const chunks = buildChunks(extracted.segments);
      const { error: cErr } = await supabase.from("chunks").insert(chunks.map((c) => ({ ...c, project_id: project.id, user_id: user.id })));
      if (cErr) throw new Error(cErr.message);
      await supabase
        .from("projects")
        .update({ stage_detail: { analyzed: 0, totalChunks: chunks.length } })
        .eq("id", project.id);
    } catch (e) {
      await supabase.from("projects").delete().eq("id", project.id);
      throw e;
    }

    return NextResponse.json({ id: project.id, words: extracted.wordCount, segments: extracted.segments.length });
  } catch (e) {
    return handleRouteError(e);
  }
}
