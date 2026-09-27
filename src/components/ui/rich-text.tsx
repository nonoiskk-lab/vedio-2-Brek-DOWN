import { Fragment } from "react";

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface HighlightSpec {
  text: string;
  color: string;
}

/** Wrap highlighted substrings in <mark>. */
function withHighlights(text: string, highlights: HighlightSpec[] | undefined, keyBase: string): React.ReactNode[] {
  const specs = (highlights ?? []).filter((h) => h.text.trim().length > 1);
  if (!specs.length) return [text];
  const re = new RegExp(`(${specs.map((h) => escapeRe(h.text)).join("|")})`, "g");
  return text.split(re).map((part, i) => {
    const spec = specs.find((h) => h.text === part);
    return spec ? (
      <mark key={`${keyBase}-${i}`} className="hl" data-color={spec.color}>
        {part}
      </mark>
    ) : (
      <Fragment key={`${keyBase}-${i}`}>{part}</Fragment>
    );
  });
}

/** Inline formatting: bold, italic, inline code and [S12] citations. */
export function RichText({ text, highlights, onCite }: { text: string; highlights?: HighlightSpec[]; onCite?: (segment: number) => void }) {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[S\d+(?:\s*[,–-]\s*S?\d+)*\]|(?<![\w*])[*_][^*_\n]+[*_](?![\w*]))/g);
  return (
    <>
      {tokens.map((tok, i) => {
        if (!tok) return null;
        const key = `t${i}`;
        if (tok.startsWith("**") && tok.endsWith("**"))
          return <strong key={key}>{withHighlights(tok.slice(2, -2), highlights, key)}</strong>;
        if (tok.startsWith("`") && tok.endsWith("`"))
          return (
            <code key={key} className="bg-surface-2 rounded px-1 py-0.5 text-[0.9em]">
              {tok.slice(1, -1)}
            </code>
          );
        const cite = tok.match(/^\[S(\d+)/);
        if (cite && tok.endsWith("]")) {
          return onCite ? (
            <button
              key={key}
              type="button"
              onClick={() => onCite(Number(cite[1]))}
              className="bg-accent-soft text-accent mx-0.5 rounded px-1 align-middle text-[0.75em] font-medium hover:underline"
            >
              {tok.slice(1, -1)}
            </button>
          ) : (
            <span key={key} className="text-muted text-[0.75em]">
              {tok}
            </span>
          );
        }
        if (/^[*_].+[*_]$/.test(tok)) return <em key={key}>{withHighlights(tok.slice(1, -1), highlights, key)}</em>;
        return <Fragment key={key}>{withHighlights(tok, highlights, key)}</Fragment>;
      })}
    </>
  );
}

/** Minimal Markdown for AI chat/assist output: headings, lists, quotes, paragraphs. */
export function Markdown({ text, onCite }: { text: string; onCite?: (segment: number) => void }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={`p${blocks.length}`} className="my-2">
          <RichText text={para.join(" ")} onCite={onCite} />
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((it, i) => (
        <li key={i}>
          <RichText text={it} onCite={onCite} />
        </li>
      ));
      blocks.push(
        list.ordered ? (
          <ol key={`l${blocks.length}`} className="my-2 list-decimal space-y-1 pl-5">
            {items}
          </ol>
        ) : (
          <ul key={`l${blocks.length}`} className="my-2 list-disc space-y-1 pl-5">
            {items}
          </ul>
        ),
      );
      list = null;
    }
  };
  for (const line of lines) {
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    if (h) {
      flushPara();
      flushList();
      blocks.push(
        <p key={`h${blocks.length}`} className="mt-3 mb-1 font-semibold">
          <RichText text={h[2]} onCite={onCite} />
        </p>,
      );
    } else if (ul || ol) {
      flushPara();
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
    } else if (quote) {
      flushPara();
      flushList();
      blocks.push(
        <blockquote key={`q${blocks.length}`} className="border-line text-ink-2 my-2 border-l-2 pl-3">
          <RichText text={quote[1]} onCite={onCite} />
        </blockquote>,
      );
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className="leading-relaxed">{blocks}</div>;
}
