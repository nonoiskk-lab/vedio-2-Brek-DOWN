import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser, supabaseConfigured } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/app/setup-notice";
import { AppHeader } from "@/components/app/app-header";
import { Dashboard, type ProjectCard } from "./dashboard";

// Auth- and env-dependent: always render per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My Learning" };

export default async function DashboardPage() {
  if (!supabaseConfigured()) return <SetupNotice />;
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const { data } = await supabase
    .from("projects")
    .select("id, title, emoji, status, stage, progress_percent, updated_at, last_opened_at, sources(kind, word_count)")
    .order("updated_at", { ascending: false });
  return (
    <>
      <AppHeader email={user.email} />
      <Dashboard projects={(data ?? []) as unknown as ProjectCard[]} />
    </>
  );
}
