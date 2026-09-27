import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getUser } from "@/lib/supabase/server";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Resolves the signed-in user and verifies they own the project (RLS enforces it too). */
export async function requireProject(
  projectId: string,
  columns = "id",
): Promise<{ supabase: SupabaseClient; user: User; project: Record<string, unknown> }> {
  const { supabase, user } = await getUser();
  if (!user) throw new HttpError("Please sign in.", 401);
  const { data, error } = await supabase.from("projects").select(columns).eq("id", projectId).maybeSingle();
  if (error) throw new HttpError(error.message, 500);
  if (!data) throw new HttpError("Learning book not found.", 404);
  return { supabase, user, project: data as unknown as Record<string, unknown> };
}

export async function requireUser(): Promise<{ supabase: SupabaseClient; user: User }> {
  const { supabase, user } = await getUser();
  if (!user) throw new HttpError("Please sign in.", 401);
  return { supabase, user };
}

export function handleRouteError(err: unknown) {
  if (err instanceof HttpError) return jsonError(err.message, err.status);
  console.error(err);
  return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
}
