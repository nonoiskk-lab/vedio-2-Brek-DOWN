import type { Metadata } from "next";
import { Suspense } from "react";
import { supabaseConfigured } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/app/setup-notice";
import { LoginForm } from "./login-form";

// Auth- and env-dependent: always render per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  if (!supabaseConfigured()) return <SetupNotice />;
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
