import { NextResponse } from "next/server";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { handleRouteError, jsonError, requireProject } from "@/lib/server/http";
import { loadTutorContext, textStream } from "@/lib/server/context";
import { tutorSystem } from "@/lib/ai/prompts";
import { streamText } from "@/lib/ai/client";

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/** Latest conversation with its messages. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireProject(id);
    const { data: conv } = await supabase
      .from("conversations")
      .select("id")
      .eq("project_id", id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conv) return NextResponse.json({ conversationId: null, messages: [] });
    const { data: messages } = await supabase
      .from("messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", conv.id)
      .order("created_at");
    return NextResponse.json({ conversationId: conv.id, messages: messages ?? [] });
  } catch (e) {
    return handleRouteError(e);
  }
}

const Body = z.object({
  message: z.string().min(1).max(8000),
  conversationId: z.string().uuid().nullish(),
  chapterId: z.string().uuid().nullish(),
  selection: z.string().max(8000).nullish(),
});

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireProject(id);
    const body = Body.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError("Invalid request");
    const { message, chapterId, selection } = body.data;

    let conversationId = body.data.conversationId ?? null;
    if (conversationId) {
      const { data } = await supabase.from("conversations").select("id").eq("id", conversationId).eq("project_id", id).maybeSingle();
      if (!data) conversationId = null;
    }
    if (!conversationId) {
      const { data, error } = await supabase
        .from("conversations")
        .insert({ project_id: id, user_id: user.id, title: message.slice(0, 80) })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      conversationId = data.id as string;
    }

    const { data: history } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(16);
    const prior = ((history ?? []) as { role: "user" | "assistant"; content: string }[]).reverse();

    await supabase
      .from("messages")
      .insert({ conversation_id: conversationId, project_id: id, user_id: user.id, role: "user", content: message });

    const ctx = await loadTutorContext(
      supabase,
      id,
      [
        message,
        selection,
        prior
          .slice(-2)
          .map((m) => m.content)
          .join(" "),
      ]
        .filter(Boolean)
        .join(" "),
      chapterId,
    );
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...prior.map((m) => ({ role: m.role, content: m.content })),
      {
        role: "user",
        content: `${ctx.contextBlock}${selection ? `\n<learner_selected_text>\n${selection}\n</learner_selected_text>` : ""}

Learner's question: ${message}`,
      },
    ];
    // The API requires the first message to be from the user.
    while (messages.length && messages[0].role !== "user") messages.shift();

    const gen = streamText({ system: tutorSystem(ctx.settings, ctx.bookTitle), messages, effort: "medium", maxTokens: 8000 });
    const convId = conversationId;
    return textStream(
      gen,
      async (full) => {
        if (full.trim()) {
          await supabase.from("messages").insert({
            conversation_id: convId,
            project_id: id,
            user_id: user.id,
            role: "assistant",
            content: full,
            meta: { cited: ctx.citedSegments },
          });
        }
      },
      { "X-Conversation-Id": convId },
    );
  } catch (e) {
    return handleRouteError(e);
  }
}

/** Start a fresh conversation. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireProject(id);
    await supabase.from("conversations").delete().eq("project_id", id).eq("user_id", user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
