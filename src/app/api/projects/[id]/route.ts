import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRouteError, jsonError, requireProject } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { project } = await requireProject(id, "id, title, status, stage, stage_detail, error, progress_percent");
    return NextResponse.json(project);
  } catch (e) {
    return handleRouteError(e);
  }
}

const PatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  emoji: z.string().min(1).max(8).optional(),
  opened: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { supabase } = await requireProject(id);
    const body = PatchSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError("Invalid update");
    const { title, emoji, opened } = body.data;
    const update: Record<string, unknown> = {};
    if (title) update.title = title;
    if (emoji) update.emoji = emoji;
    if (opened) update.last_opened_at = new Date().toISOString();
    if (title || emoji) update.updated_at = new Date().toISOString();
    const { error } = await supabase.from("projects").update(update).eq("id", id);
    if (error) throw new Error(error.message);
    if (title) await supabase.from("documents").update({ title }).eq("project_id", id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { supabase } = await requireProject(id);
    const { data: src } = await supabase.from("sources").select("storage_path").eq("project_id", id).maybeSingle();
    if (src?.storage_path) await supabase.storage.from("sources").remove([src.storage_path]);
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
