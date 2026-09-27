import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { loadBook } from "@/lib/server/book";
import { formatRefs } from "@/lib/content/refs";
import { PrintBlock } from "@/components/reader/blocks";
import { PrintTrigger } from "./print-trigger";

export const metadata: Metadata = { title: "Printable study book" };

export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) redirect(`/login?next=/p/${id}/print`);
  const book = await loadBook(supabase, id, user.id);
  if (!book) notFound();
  const segs = new Map(book.segments.map((s) => [s.idx, s]));
  const d = book.document;
  return (
    <div data-theme="light" className="bg-white text-black">
      <PrintTrigger />
      <article className="mx-auto max-w-[46rem] px-8 py-10 font-serif text-[11.5pt] leading-relaxed">
        <header className="flex min-h-[60vh] break-after-page flex-col justify-center border-b pb-10">
          <p className="font-sans text-sm tracking-widest text-neutral-500 uppercase">Study book</p>
          <h1 className="mt-3 text-4xl leading-tight font-semibold">{d.title}</h1>
          {d.subtitle && <p className="mt-3 text-lg text-neutral-600">{d.subtitle}</p>}
          {book.source.title && (
            <p className="mt-8 font-sans text-sm text-neutral-500">
              Based on: {book.source.title}
              {book.source.url ? ` — ${book.source.url}` : ""}
            </p>
          )}
        </header>
        <nav className="break-after-page py-8">
          <h2 className="font-sans text-xl font-semibold">Table of Contents</h2>
          <ol className="mt-4 list-decimal space-y-1 pl-6">
            {book.chapters.map((c) => (
              <li key={c.id}>{c.title}</li>
            ))}
            <li>Key Takeaways</li>
            <li>Revision Questions</li>
          </ol>
        </nav>
        {d.plan.overview && (
          <section className="py-6">
            <h2 className="font-sans text-2xl font-semibold">About this book</h2>
            {d.plan.overview.split(/\n+/).map((p, i) => (
              <p key={i} className="mt-3">
                {p}
              </p>
            ))}
          </section>
        )}
        {book.chapters.map((c, i) => (
          <section key={c.id} className="break-before-page py-6">
            <p className="font-sans text-xs tracking-widest text-neutral-500 uppercase">Chapter {i + 1}</p>
            <h2 className="font-sans text-2xl font-semibold">{c.title}</h2>
            {c.summary && <p className="mt-2 text-neutral-600 italic">{c.summary}</p>}
            {c.sections.map((s) => (
              <div key={s.id} className="mt-6">
                <h3 className="font-sans text-lg font-semibold">{s.title}</h3>
                {s.blocks.map((b, bi) => (
                  <PrintBlock key={bi} block={b} refLabel={formatRefs(b.refs, segs)} />
                ))}
              </div>
            ))}
            {c.key_takeaway && (
              <p className="mt-6 rounded border border-neutral-300 p-3 font-sans text-sm">
                <strong>✅ Chapter takeaway:</strong> {c.key_takeaway}
              </p>
            )}
          </section>
        ))}
        <section className="break-before-page py-6">
          <h2 className="font-sans text-2xl font-semibold">Key Takeaways</h2>
          <ul className="mt-3 list-disc space-y-1 pl-6">
            {d.revision.key_takeaways.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
          {d.revision.quick_revision.length > 0 && (
            <>
              <h3 className="mt-6 font-sans text-lg font-semibold">Quick Revision</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-6">
                {d.revision.quick_revision.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ol>
            </>
          )}
        </section>
        <section className="break-before-page py-6">
          <h2 className="font-sans text-2xl font-semibold">Revision Questions</h2>
          <ol className="mt-3 list-decimal space-y-4 pl-6">
            {book.questions.map((q) => (
              <li key={q.id}>
                <p className="font-semibold">{q.question}</p>
                <p className="mt-1">{q.answer}</p>
              </li>
            ))}
          </ol>
        </section>
        <p className="mt-10 border-t pt-4 font-sans text-xs text-neutral-500">
          Content labelled &ldquo;AI-generated example&rdquo; or &ldquo;Additional explanation&rdquo; did not come from the original source.
          Source references point to timestamps, pages or paragraphs of the original.
        </p>
      </article>
    </div>
  );
}
