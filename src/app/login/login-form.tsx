"use client";
import Image from "next/image";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button, Card } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const [mode, setMode] = useState<"signin" | "signup" | "magic">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") ? "That sign-in link is invalid or expired." : null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    const supabase = supabaseBrowser();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    try {
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        setInfo("Check your inbox — we sent you a sign-in link.");
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        if (data.session) router.replace(next);
        else setInfo("Account created. Confirm your email to continue.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm p-7">
      <div className="mb-6 flex items-center gap-2 font-semibold">
        <Image src="/icon.svg" alt="" width={28} height={28} className="size-7" /> AI Learning
      </div>
      <h1 className="text-xl font-semibold">{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
      <p className="text-muted mt-1 text-sm">Your personal AI textbook library.</p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-line bg-surface focus:border-accent mt-1 h-11 w-full rounded-xl border px-3 outline-none"
          />
        </label>
        {mode !== "magic" && (
          <label className="block">
            <span className="text-sm font-medium">Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-line bg-surface focus:border-accent mt-1 h-11 w-full rounded-xl border px-3 outline-none"
            />
          </label>
        )}
        {error && (
          <p role="alert" className="bg-danger-soft text-danger rounded-lg px-3 py-2 text-sm">
            {error}
          </p>
        )}
        {info && (
          <p role="status" className="bg-ok-soft text-ok rounded-lg px-3 py-2 text-sm">
            {info}
          </p>
        )}
        <Button type="submit" className="w-full" size="lg" loading={loading}>
          {mode === "signup" ? "Create account" : mode === "magic" ? "Email me a link" : "Sign in"}
        </Button>
      </form>
      <div className="mt-4 flex flex-col gap-1 text-sm">
        {mode !== "magic" && (
          <button className="text-accent flex items-center gap-1 hover:underline" onClick={() => setMode("magic")}>
            <Mail className="size-3.5" /> Sign in with an email link instead
          </button>
        )}
        <button className="text-muted hover:text-ink text-left" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
          {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </div>
    </Card>
  );
}
