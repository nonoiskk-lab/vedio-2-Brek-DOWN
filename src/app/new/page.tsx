import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser, supabaseConfigured } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/app/setup-notice";
import { AppHeader } from "@/components/app/app-header";
import { Wizard } from "./wizard";

// Auth- and env-dependent: always render per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New Learning Material" };

export default async function NewPage() {
  if (!supabaseConfigured()) return <SetupNotice />;
  const { user } = await getUser();
  if (!user) redirect("/login?next=/new");
  return (
    <>
      <AppHeader email={user.email} />
      <Wizard userId={user.id} />
    </>
  );
}
