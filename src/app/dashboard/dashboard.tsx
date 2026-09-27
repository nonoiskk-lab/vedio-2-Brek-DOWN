"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, BookOpen, FileText, Loader2, MoreHorizontal, Plus, Search, Trash2, Type, SquarePlay } from "lucide-react";
import { api } from "@/lib/client/api";
import { Badge, Card, EmptyState, ProgressBar, ToastProvider, useToast } from "@/components/ui";

export interface ProjectCard {
  id: string;
  title: string;
  emoji: string;
  status: "processing" | "ready" | "failed";
  stage: string;
  progress_percent: number;
  updated_at: string;
  last_opened_at: string | null;
  sources: { kind: string; word_count: number }[] | { kind: string; word_count: number } | null;
}

function sourceOf(p: ProjectCard) {
  return Array.isArray(p.sources) ? p.sources[0] : p.sources;
}

function SourceIcon({ kind }: { kind?: string }) {
  if (kind === "youtube") return <SquarePlay className="size-3.5" />;
  if (kind === "text" || kind === "transcript") return <Type className="size-3.5" />;
  return <FileText className="size-3.5" />;
}

function relative(date: string) {
  const diff = (Date.now() - new Date(date).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return new Date(date).toLocaleDateString();
}

export function Dashboard(props: { projects: ProjectCard[] }) {
  return (
    <ToastProvider>
      <DashboardInner {...props} />
    </ToastProvider>
  );
}

function DashboardInner({ projects: initial }: { projects: ProjectCard[] }) {
  const [projects, setProjects] = useState(initial);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  const filtered = useMemo(() => projects.filter((p) => p.title.toLowerCase().includes(query.trim().toLowerCase())), [projects, query]);
  const recent = [...filtered].sort(
    (a, b) => new Date(b.last_opened_at ?? b.updated_at).getTime() - new Date(a.last_opened_at ?? a.updated_at).getTime(),
  );
  const ready = projects.filter((p) => p.status === "ready");
  const avg = ready.length ? Math.round(ready.reduce((n, p) => n + p.progress_percent, 0) / ready.length) : 0;

  async function remove(p: ProjectCard) {
    if (!confirm(`Delete "${p.title}"? Notes, bookmarks and progress for it will be deleted too.`)) return;
    setMenu(null);
    const prev = projects;
    setProjects((ps) => ps.filter((x) => x.id !== p.id));
    try {
      await api(`/api/projects/${p.id}`, { method: "DELETE" });
      toast("Deleted", "ok");
      router.refresh();
    } catch (e) {
      setProjects(prev);
      toast((e as Error).message, "error");
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Learning</h1>
          <p className="text-muted mt-1 text-sm">
            {projects.length
              ? `${projects.length} book${projects.length === 1 ? "" : "s"} · average progress ${avg}%`
              : "Your AI textbooks live here."}
          </p>
        </div>
        <Link
          href="/new"
          className="bg-accent text-accent-ink inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 font-medium shadow-sm transition hover:opacity-90"
        >
          <Plus className="size-4" /> Create New Learning Material
        </Link>
      </div>

      {projects.length > 3 && (
        <div className="relative mt-6 max-w-sm">
          <Search className="text-muted absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your books"
            aria-label="Search your books"
            className="border-line bg-surface focus:border-accent h-10 w-full rounded-xl border pr-3 pl-9 text-sm outline-none"
          />
        </div>
      )}

      {!projects.length ? (
        <Card className="mt-8">
          <EmptyState icon={<BookOpen className="size-10" />} title="No learning material yet">
            Paste a YouTube link, upload a PDF, or drop in any text — we&apos;ll turn it into a structured book with a tutor, notes and
            quizzes.
            <div className="mt-4">
              <Link
                href="/new"
                className="bg-accent text-accent-ink inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium shadow-sm transition hover:opacity-90"
              >
                <Plus className="size-4" /> Create your first book
              </Link>
            </div>
          </EmptyState>
        </Card>
      ) : (
        <section className="mt-8" aria-label="Recent learning">
          <h2 className="text-muted mb-3 text-sm font-medium tracking-wide uppercase">Recent Learning</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((p) => {
              const src = sourceOf(p);
              return (
                <li key={p.id} className="relative">
                  <Link href={`/p/${p.id}`} className="block h-full">
                    <Card className="hover:border-accent/50 flex h-full flex-col gap-3 p-5 transition hover:shadow-md">
                      <div className="flex items-start gap-3 pr-8">
                        <span className="text-2xl" aria-hidden>
                          {p.emoji}
                        </span>
                        <h3 className="line-clamp-2 leading-snug font-semibold">{p.title}</h3>
                      </div>
                      <div className="text-muted flex flex-wrap items-center gap-2 text-xs">
                        <Badge>
                          <SourceIcon kind={src?.kind} /> {src?.kind ?? "source"}
                        </Badge>
                        {src?.word_count ? <span>{src.word_count.toLocaleString()} words</span> : null}
                        <span>· {relative(p.last_opened_at ?? p.updated_at)}</span>
                      </div>
                      <div className="mt-auto">
                        {p.status === "ready" ? (
                          <>
                            <div className="mb-1 flex justify-between text-xs">
                              <span className="text-muted">Progress</span>
                              <span className="font-medium">{p.progress_percent}%</span>
                            </div>
                            <ProgressBar value={p.progress_percent} />
                          </>
                        ) : p.status === "processing" ? (
                          <Badge tone="accent">
                            <Loader2 className="size-3 animate-spin" /> Building your book…
                          </Badge>
                        ) : (
                          <Badge tone="danger">
                            <AlertTriangle className="size-3" /> Needs attention
                          </Badge>
                        )}
                      </div>
                    </Card>
                  </Link>
                  <div className="absolute top-3 right-3">
                    <button
                      aria-label={`Options for ${p.title}`}
                      aria-expanded={menu === p.id}
                      onClick={() => setMenu(menu === p.id ? null : p.id)}
                      className="text-muted hover:bg-surface-2 hover:text-ink rounded-lg p-1.5"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                    {menu === p.id && (
                      <div className="border-line bg-surface absolute right-0 z-10 mt-1 w-40 rounded-xl border p-1 shadow-lg">
                        <button
                          onClick={() => remove(p)}
                          className="text-danger hover:bg-danger-soft flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm"
                        >
                          <Trash2 className="size-4" /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
