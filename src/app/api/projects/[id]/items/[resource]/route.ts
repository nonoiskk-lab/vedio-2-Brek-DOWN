import { NextResponse } from "next/server";
import { CREATE_SCHEMAS, isResource } from "@/lib/server/items";
import { handleRouteError, jsonError, requireProject } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string; resource: string }> };

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id, resource } = await params;
    if (!isResource(resource)) return jsonError("Unknown resource", 404);
    const { supabase, user } = await requireProject(id);
    const body = CREATE_SCHEMAS[resource].safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError("Invalid data: " + body.error.issues[0]?.message);
    const row: Record<string, unknown> = { ...body.data, project_id: id, user_id: user.id };
    const query =
      resource === "bookmarks"
        ? supabase.from(resource).upsert(row, { onConflict: "user_id,project_id,anchor" })
        : supabase.from(resource).insert(row);
    const { data, error } = await query.select().single();
    if (error) throw new Error(error.message);
    return NextResponse.json(data);
  } catch (e) {
    return handleRouteError(e);
  }
}
