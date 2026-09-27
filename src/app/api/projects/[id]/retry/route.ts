import { NextResponse } from "next/server";
import { handleRouteError, requireProject } from "@/lib/server/http";
import { retryPipeline } from "@/lib/ai/pipeline";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase } = await requireProject(id);
    await retryPipeline(supabase, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
