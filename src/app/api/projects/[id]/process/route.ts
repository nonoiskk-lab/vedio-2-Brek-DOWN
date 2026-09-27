import { NextResponse } from "next/server";
import { handleRouteError, jsonError, requireProject } from "@/lib/server/http";
import { advancePipeline } from "@/lib/ai/pipeline";

export const maxDuration = 300;

/** Advances the resumable pipeline by one time-boxed step. The client calls this until ready. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      return jsonError("The AI service is not configured (ANTHROPIC_API_KEY is missing).", 503);
    }
    const { supabase, user } = await requireProject(id);
    const state = await advancePipeline(supabase, user.id, id);
    return NextResponse.json(state);
  } catch (e) {
    return handleRouteError(e);
  }
}
