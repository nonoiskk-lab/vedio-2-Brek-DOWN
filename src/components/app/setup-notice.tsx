export function SetupNotice() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Almost there — connect your backend</h1>
      <p className="text-ink-2">
        AI Learning Studio needs Supabase (database, auth, storage) and an Anthropic API key. Copy{" "}
        <code className="bg-surface-2 rounded px-1">.env.example</code> to <code className="bg-surface-2 rounded px-1">.env.local</code>,
        fill in the values, run the SQL in <code className="bg-surface-2 rounded px-1">supabase/migrations</code>, and restart the server.
      </p>
      <p className="text-muted text-sm">See README.md for step-by-step setup and Vercel deployment.</p>
    </main>
  );
}
