import { z } from "zod";
import { handleRouteError, jsonError, requireProject } from "@/lib/server/http";
import { loadTutorContext, textStream } from "@/lib/server/context";
import { ASSIST_ACTIONS, tutorSystem } from "@/lib/ai/prompts";
import { streamText } from "@/lib/ai/client";

export const maxDuration = 120;

const Body = z.object({
  action: z.enum(Object.keys(ASSIST_ACTIONS) as [keyof typeof ASSIST_ACTIONS, ...(keyof typeof ASSIST_ACTIONS)[]]),
  text: z.string().min(1).max(12000),
  chapterId: z.string().uuid().nullish(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase } = await requireProject(id);
    const body = Body.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError("Invalid request");
    const { action, text, chapterId } = body.data;
    const ctx = await loadTutorContext(supabase, id, text, chapterId);
    const gen = streamText({
      system: tutorSystem(ctx.settings, ctx.bookTitle),
      effort: "medium",
      maxTokens: 6000,
      messages: [
        {
          role: "user",
          content: `${ctx.contextBlock}

<selected_passage>
${text}
</selected_passage>

Task: ${ASSIST_ACTIONS[action].instruction}
Respond in the same language as the selected passage. Use Markdown. Be concise.`,
        },
      ],
    });
    return textStream(gen);
  } catch (e) {
    return handleRouteError(e);
  }
}
