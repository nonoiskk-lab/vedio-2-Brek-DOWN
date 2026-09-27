import { handleRouteError, jsonError, requireProject } from "@/lib/server/http";
import { loadBook } from "@/lib/server/book";
import { bookToMarkdown, markdownToPlainText } from "@/lib/content/export";
import { bookToDocx } from "@/lib/server/docx";

export const maxDuration = 60;

function safeName(title: string) {
  return (
    title
      .replace(/[^\p{L}\p{N} _-]+/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "learning-book"
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "md";
    const withNotes = url.searchParams.get("notes") === "1";
    const { supabase, user } = await requireProject(id);
    const book = await loadBook(supabase, id, user.id);
    if (!book) return jsonError("This learning book isn't ready yet.", 409);
    const name = safeName(book.document.title);
    const disposition = (ext: string) =>
      `attachment; filename="${encodeURIComponent(name)}.${ext}"; filename*=UTF-8''${encodeURIComponent(name)}.${ext}`;

    if (format === "docx") {
      const buf = await bookToDocx(book);
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": disposition("docx"),
        },
      });
    }
    const md = bookToMarkdown(book, { withNotes });
    if (format === "txt") {
      return new Response(markdownToPlainText(md), {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": disposition("txt") },
      });
    }
    return new Response(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        ...(url.searchParams.get("inline") ? {} : { "Content-Disposition": disposition("md") }),
      },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
