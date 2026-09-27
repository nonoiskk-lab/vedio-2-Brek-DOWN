import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getUser, supabaseConfigured } from "@/lib/supabase/server";
import { loadBook } from "@/lib/server/book";
import { SetupNotice } from "@/components/app/setup-notice";
import { ProcessingView } from "@/components/app/processing-view";
import { Reader } from "@/components/reader/reader";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!supabaseConfigured()) return {};
  const { supabase } = await getUser();
  const { data } = await supabase.from("projects").select("title").eq("id", id).maybeSingle();
  return { title: data?.title ?? "Learning book" };
}

export default async function ProjectPage({ params }: Props) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, user } = await getUser();
  if (!user) redirect(`/login?next=/p/${id}`);
  const { data: project } = await supabase
    .from("projects")
    .select("id, title, status, stage, stage_detail, error")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  if (project.status !== "ready") {
    return <ProcessingView key={project.status} projectId={id} initial={project as never} />;
  }
  const book = await loadBook(supabase, id, user.id);
  if (!book) notFound();
  await supabase.from("projects").update({ last_opened_at: new Date().toISOString() }).eq("id", id);
  return <Reader initialBook={book} />;
}
