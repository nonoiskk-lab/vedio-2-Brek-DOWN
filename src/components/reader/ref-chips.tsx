"use client";
import { Quote } from "lucide-react";
import { groupRefs } from "@/lib/content/refs";
import { useReader } from "./context";

/** Source reference chips: "Source: 02:34–04:18". Clicking opens the original at that point. */
export function RefChips({ refs, className }: { refs: string[]; className?: string }) {
  const { segments, openSource, book } = useReader();
  const groups = groupRefs(refs, segments);
  if (!groups.length) return null;
  const videoId = book.source.kind === "youtube" ? (book.source.meta?.videoId as string | undefined) : undefined;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 font-sans ${className ?? ""}`}>
      <Quote className="text-muted size-3" aria-hidden />
      <span className="text-muted text-[11px]">Source:</span>
      {groups.map((g) => (
        <span key={g.start} className="inline-flex items-center">
          <button
            type="button"
            onClick={() => openSource(g.start)}
            className="bg-surface-2 text-ink-2 hover:bg-accent-soft hover:text-accent rounded-md px-1.5 py-0.5 text-[11px] font-medium"
            title="Show in original source"
          >
            {g.label}
          </button>
          {videoId && g.startSec !== null && (
            <a
              href={`https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(Number(g.startSec))}s`}
              target="_blank"
              rel="noreferrer"
              className="text-muted hover:text-accent ml-0.5 text-[11px]"
              title="Watch this part on YouTube"
            >
              ▶
            </a>
          )}
        </span>
      ))}
    </span>
  );
}
