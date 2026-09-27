import { PROVENANCE_LABELS, type Block, type LearningBook } from "./types";
import { formatRefs } from "./refs";

const TEACHER_LABELS = ["What is it?", "Why is it important?", "How does it work?", "Where is it used?", "Practical example"];

function segMap(book: LearningBook) {
  return new Map(book.segments.map((s) => [s.idx, s]));
}

function blockMarkdown(b: Block, refs: string): string {
  const src = refs ? ` _(Source: ${refs})_` : "";
  const tag = b.provenance === "ai_example" || b.provenance === "additional" ? ` _[${PROVENANCE_LABELS[b.provenance]}]_` : "";
  switch (b.type) {
    case "paragraph":
      return `${b.text}${tag}${src}`;
    case "definition":
      return `> **${b.title}** — ${b.text}${b.extra ? `\n> _Why it matters:_ ${b.extra}` : ""}${b.items[0] ? `\n> _Example:_ ${b.items[0]}` : ""}${tag}${src}`;
    case "qa":
      return `**Q: ${b.title}**\n\nA: ${b.text}${tag}${src}`;
    case "example":
      return `**💡 ${b.title || "Example"}**${tag}\n\n${b.text}${b.extra ? `\n\n_Why this example matters:_ ${b.extra}` : ""}${src}`;
    case "why_it_matters":
      return `**🧠 Why it matters:** ${b.text}${tag}${src}`;
    case "practical":
      return `**🚀 Practical application:** ${b.text}${b.items.length ? "\n" + b.items.map((i) => `- ${i}`).join("\n") : ""}${tag}${src}`;
    case "takeaway":
      return `**✅ Key takeaway:** ${b.text}${src}`;
    case "story":
      return `_${b.text}_${src}`;
    case "bullets":
      return `${b.title ? `**${b.title}**\n` : ""}${b.items.map((i) => `- ${i}`).join("\n")}${tag}${src}`;
    case "steps":
      return `${b.title ? `**${b.title}**\n` : ""}${b.items.map((i, n) => `${n + 1}. ${i}`).join("\n")}${tag}${src}`;
    case "teacher":
      return `**🎓 ${b.title}**\n${b.items.map((i, n) => `- **${TEACHER_LABELS[n] ?? ""}** ${i}`).join("\n")}${tag}${src}`;
    case "concept_map":
      return `**🧩 ${b.title}**\n${b.items.map((i) => `- ${i}`).join("\n")}${src}`;
    default:
      return b.text;
  }
}

export function bookToMarkdown(book: LearningBook, opts: { withNotes?: boolean } = {}): string {
  const segs = segMap(book);
  const out: string[] = [];
  const d = book.document;
  out.push(`# ${d.title}`);
  if (d.subtitle) out.push(`_${d.subtitle}_`);
  if (book.source.url) out.push(`Source: ${book.source.title ?? ""} — ${book.source.url}`);
  out.push("\n## Table of Contents");
  book.chapters.forEach((c, i) => out.push(`${i + 1}. ${c.title}`));
  out.push(`${book.chapters.length + 1}. Key Takeaways`);
  out.push(`${book.chapters.length + 2}. Revision Questions`);
  if (d.plan.overview) out.push(`\n## About this book\n\n${d.plan.overview}`);

  book.chapters.forEach((c, i) => {
    out.push(`\n## Chapter ${i + 1} — ${c.title}`);
    if (c.summary) out.push(`_${c.summary}_`);
    for (const s of c.sections) {
      out.push(`\n### ${s.title}`);
      if (s.summary) out.push(`_${s.summary}_`);
      s.blocks.forEach((b, bi) => {
        out.push("\n" + blockMarkdown(b, formatRefs(b.refs, segs)));
        if (opts.withNotes) {
          for (const n of book.notes.filter((n) => n.anchor === `${s.id}:${bi}`)) out.push(`\n> 📝 **My note:** ${n.content}`);
        }
      });
    }
    if (c.key_takeaway) out.push(`\n**✅ Chapter takeaway:** ${c.key_takeaway}`);
    if (opts.withNotes) {
      for (const n of book.notes.filter((n) => n.chapter_id === c.id && !n.anchor)) out.push(`\n> 📝 **My note:** ${n.content}`);
    }
  });

  const r = d.revision;
  out.push(`\n## Key Takeaways`);
  (r.key_takeaways ?? []).forEach((t) => out.push(`- ${t}`));
  if (r.quick_revision?.length) {
    out.push(`\n### Quick Revision`);
    r.quick_revision.forEach((t, i) => out.push(`${i + 1}. ${t}`));
  }
  out.push(`\n## Revision Questions`);
  book.questions.forEach((q, i) => out.push(`\n**${i + 1}. ${q.question}**\n\n${q.answer}`));
  if (book.flashcards.length) {
    out.push(`\n## Flashcards`);
    book.flashcards.forEach((f) => out.push(`- **${f.front}** — ${f.back}`));
  }
  if (d.plan.glossary?.length) {
    out.push(`\n## Glossary`);
    d.plan.glossary.forEach((g) => out.push(`- **${g.term}** — ${g.meaning}`));
  }
  out.push(
    `\n---\n_Labels: "${PROVENANCE_LABELS.ai_example}" and "${PROVENANCE_LABELS.additional}" mark content that did not come from the original source._`,
  );
  return out.join("\n");
}

export function markdownToPlainText(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\W)_(.+?)_(?=\W|$)/g, "$1$2")
    .replace(/^>\s?/gm, "  ")
    .replace(/^---$/gm, "")
    .trim();
}
