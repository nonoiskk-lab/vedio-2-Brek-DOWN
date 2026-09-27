import "server-only";
import { Document, HeadingLevel, Packer, Paragraph, TextRun, TableOfContents } from "docx";
import { PROVENANCE_LABELS, type Block, type LearningBook } from "@/lib/content/types";
import { formatRefs } from "@/lib/content/refs";

const TEACHER_LABELS = ["What is it?", "Why is it important?", "How does it work?", "Where is it used?", "Practical example"];

/** Parse **bold** spans into runs. */
function runs(text: string, base: { italics?: boolean; bold?: boolean } = {}): TextRun[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**")
        ? new TextRun({ text: part.slice(2, -2), bold: true, italics: base.italics })
        : new TextRun({ text: part, ...base }),
    );
}

function note(text: string) {
  return new Paragraph({ children: [new TextRun({ text, italics: true, color: "777777", size: 18 })] });
}

function blockParagraphs(b: Block, refs: string): Paragraph[] {
  const out: Paragraph[] = [];
  const label = b.provenance === "ai_example" || b.provenance === "additional" ? PROVENANCE_LABELS[b.provenance] : null;
  const heading = (t: string) => out.push(new Paragraph({ children: runs(t, { bold: true }), spacing: { before: 120 } }));
  const bullets = (items: string[], numbered = false) =>
    items.forEach((i, n) =>
      out.push(new Paragraph({ children: runs(numbered ? `${n + 1}. ${i}` : i), bullet: numbered ? undefined : { level: 0 } })),
    );

  switch (b.type) {
    case "paragraph":
    case "story":
      out.push(new Paragraph({ children: runs(b.text, { italics: b.type === "story" }), spacing: { after: 120 } }));
      break;
    case "definition":
      heading(`${b.title}`);
      out.push(new Paragraph({ children: runs(b.text) }));
      if (b.extra) out.push(new Paragraph({ children: runs(`Why it matters: ${b.extra}`) }));
      if (b.items[0]) out.push(new Paragraph({ children: runs(`Example: ${b.items[0]}`) }));
      break;
    case "qa":
      heading(`Q: ${b.title}`);
      out.push(new Paragraph({ children: runs(`A: ${b.text}`) }));
      break;
    case "example":
      heading(`💡 ${b.title || "Example"}`);
      out.push(new Paragraph({ children: runs(b.text) }));
      if (b.extra) out.push(new Paragraph({ children: runs(`Why this example matters: ${b.extra}`) }));
      break;
    case "why_it_matters":
      heading("🧠 Why it matters");
      out.push(new Paragraph({ children: runs(b.text) }));
      break;
    case "practical":
      heading("🚀 Practical application");
      out.push(new Paragraph({ children: runs(b.text) }));
      bullets(b.items);
      break;
    case "takeaway":
      heading(`✅ Key takeaway: `);
      out.push(new Paragraph({ children: runs(b.text) }));
      break;
    case "bullets":
      if (b.title) heading(b.title);
      bullets(b.items);
      break;
    case "steps":
      if (b.title) heading(b.title);
      bullets(b.items, true);
      break;
    case "teacher":
      heading(`🎓 ${b.title}`);
      b.items.forEach((i, n) =>
        out.push(new Paragraph({ children: [new TextRun({ text: `${TEACHER_LABELS[n] ?? ""} `, bold: true }), ...runs(i)] })),
      );
      break;
    case "concept_map":
      heading(`🧩 ${b.title}`);
      bullets(b.items);
      break;
  }
  if (label || refs) out.push(note([label, refs ? `Source: ${refs}` : null].filter(Boolean).join(" · ")));
  return out;
}

export async function bookToDocx(book: LearningBook): Promise<Buffer> {
  const segs = new Map(book.segments.map((s) => [s.idx, s]));
  const children: (Paragraph | TableOfContents)[] = [new Paragraph({ text: book.document.title, heading: HeadingLevel.TITLE })];
  if (book.document.subtitle) children.push(new Paragraph({ children: [new TextRun({ text: book.document.subtitle, italics: true })] }));
  if (book.source.url) children.push(note(`Source: ${book.source.title ?? ""} — ${book.source.url}`));
  children.push(new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }));
  if (book.document.plan.overview) {
    children.push(new Paragraph({ text: "About this book", heading: HeadingLevel.HEADING_1 }));
    book.document.plan.overview.split(/\n+/).forEach((p) => children.push(new Paragraph({ children: runs(p) })));
  }
  book.chapters.forEach((c, i) => {
    children.push(new Paragraph({ text: `Chapter ${i + 1} — ${c.title}`, heading: HeadingLevel.HEADING_1, pageBreakBefore: true }));
    if (c.summary) children.push(new Paragraph({ children: [new TextRun({ text: c.summary, italics: true })] }));
    for (const s of c.sections) {
      children.push(new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_2 }));
      s.blocks.forEach((b) => children.push(...blockParagraphs(b, formatRefs(b.refs, segs))));
    }
    if (c.key_takeaway) children.push(new Paragraph({ children: runs(`✅ Chapter takeaway: ${c.key_takeaway}`, { bold: true }) }));
  });
  children.push(new Paragraph({ text: "Key Takeaways", heading: HeadingLevel.HEADING_1, pageBreakBefore: true }));
  book.document.revision.key_takeaways.forEach((t) => children.push(new Paragraph({ children: runs(t), bullet: { level: 0 } })));
  if (book.document.revision.quick_revision.length) {
    children.push(new Paragraph({ text: "Quick Revision", heading: HeadingLevel.HEADING_2 }));
    book.document.revision.quick_revision.forEach((t, i) => children.push(new Paragraph({ children: runs(`${i + 1}. ${t}`) })));
  }
  children.push(new Paragraph({ text: "Revision Questions", heading: HeadingLevel.HEADING_1 }));
  book.questions.forEach((q, i) => {
    children.push(new Paragraph({ children: runs(`${i + 1}. ${q.question}`, { bold: true }), spacing: { before: 120 } }));
    children.push(new Paragraph({ children: runs(q.answer) }));
  });
  if (book.document.plan.glossary?.length) {
    children.push(new Paragraph({ text: "Glossary", heading: HeadingLevel.HEADING_1 }));
    book.document.plan.glossary.forEach((g) =>
      children.push(new Paragraph({ children: [new TextRun({ text: `${g.term} — `, bold: true }), ...runs(g.meaning)] })),
    );
  }
  const doc = new Document({
    creator: "AI Learning Studio",
    title: book.document.title,
    features: { updateFields: true },
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
