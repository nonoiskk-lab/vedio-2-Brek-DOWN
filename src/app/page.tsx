import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, BookOpen, Brain, FileText, GraduationCap, HelpCircle, Layers, SquarePlay } from "lucide-react";
import { getUser, supabaseConfigured } from "@/lib/supabase/server";

// Auth- and env-dependent: always render per request.
export const dynamic = "force-dynamic";

export default async function Home() {
  if (supabaseConfigured()) {
    const { user } = await getUser();
    if (user) redirect("/dashboard");
  }
  const features = [
    {
      icon: BookOpen,
      title: "A real book, not a summary",
      text: "Chapters, table of contents and flowing explanations organised by concept.",
    },
    {
      icon: GraduationCap,
      title: "A teacher beside every page",
      text: "Ask the AI tutor, simplify any paragraph, get examples and explain-again.",
    },
    { icon: HelpCircle, title: "Questions you'd ask", text: "Beginner Q&A, flashcards, quizzes and revision — all from your source." },
    { icon: Layers, title: "Source-faithful", text: "Every claim links to the timestamp, page or paragraph. AI additions are labelled." },
  ];
  return (
    <main className="min-h-dvh">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <div className="flex items-center gap-2 font-semibold">
          <Image src="/icon.svg" alt="" width={32} height={32} className="size-8" /> AI Learning
        </div>
        <h1 className="mt-16 max-w-3xl font-serif text-5xl leading-tight tracking-tight sm:text-6xl">
          Turn anything you watch or read into your own AI-powered textbook.
        </h1>
        <p className="text-ink-2 mt-6 max-w-2xl text-lg">
          Paste a YouTube link, upload a PDF or drop in your notes. Get a structured learning book with a personal teacher, Q&amp;A, notes,
          quizzes and a revision system — in English, Hindi or Hinglish.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/login"
            className="bg-accent text-accent-ink inline-flex h-12 items-center gap-2 rounded-xl px-6 font-medium shadow-sm hover:opacity-90"
          >
            Start learning <ArrowRight className="size-4" />
          </Link>
          <span className="text-muted flex items-center gap-3 text-sm">
            <SquarePlay className="size-4" /> YouTube <FileText className="size-4" /> PDF · DOCX · TXT · MD <Brain className="size-4" />{" "}
            Text
          </span>
        </div>
        <div className="mt-20 grid gap-4 sm:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="border-line bg-surface rounded-2xl border p-6">
              <f.icon className="text-accent size-5" />
              <h2 className="mt-3 font-semibold">{f.title}</h2>
              <p className="text-ink-2 mt-1 text-sm">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
