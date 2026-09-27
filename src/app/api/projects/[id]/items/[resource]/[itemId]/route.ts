import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRouteError, jsonError, requireProject } from "@/lib/server/http";
import { isResource } from "@/lib/server/items";

type Ctx = { params: Promise<{ id: string; resource: string; itemId: string }> };

const Patch = z.object({ content: z.string().max(20000).optional(), color: z.enum(["yellow", "green", "blue", "pink"]).optional() });

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id, resource, itemId } = await params;
    if (resource !== "notes" && resource !== "highlights") return jsonError("Not editable", 405);
    const { supabase } = await requireProject(id);
    const body = Patch.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError("Invalid data");
    const update =
      resource === "notes" ? { content: body.data.content ?? "", updated_at: new Date().toISOString() } : { color: body.data.color };
    const { data, error } = await supabase.from(resource).update(update).eq("id", itemId).eq("project_id", id).select().single();
    if (error) throw new Error(error.message);
    return NextResponse.json(data);
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id, resource, itemId } = await params;
    if (!isResource(resource)) return jsonError("Unknown resource", 404);
    const { supabase } = await requireProject(id);
    const { error } = await supabase.from(resource).delete().eq("id", itemId).eq("project_id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
