import { BookOpen, Brain, CheckCircle2, HelpCircle, Layers, Lightbulb, ListChecks, Rocket, Sparkles, Waypoints } from "lucide-react";
import { PROVENANCE_LABELS, type Block } from "@/lib/content/types";
import { RichText, type HighlightSpec } from "@/components/ui/rich-text";
import cx from "clsx";

export const TEACHER_LABELS = ["What is it?", "Why is it important?", "How does it work?", "Where is it used?", "Practical example"];

export function ProvenanceTag({ provenance }: { provenance: Block["provenance"] }) {
  if (provenance === "ai_example")
    return (
      <span className="bg-warn-soft text-warn inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
        <Sparkles className="size-3" /> {PROVENANCE_LABELS.ai_example}
      </span>
    );
  if (provenance === "additional")
    return (
      <span className="bg-violet-soft text-violet inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
        <Layers className="size-3" /> Additional explanation · not in source
      </span>
    );
  return null;
}

function Callout({
  icon,
  title,
  tone,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tone: "accent" | "ok" | "warn" | "violet" | "neutral";
  children: React.ReactNode;
}) {
  const tones = {
    accent: "border-accent/25 bg-accent-soft/60",
    ok: "border-ok/25 bg-ok-soft/60",
    warn: "border-warn/25 bg-warn-soft/60",
    violet: "border-violet/25 bg-violet-soft/60",
    neutral: "border-line bg-surface-2/60",
  };
  const iconTone = { accent: "text-accent", ok: "text-ok", warn: "text-warn", violet: "text-violet", neutral: "text-ink-2" };
  return (
    <div className={cx("rounded-xl border p-4", tones[tone])}>
      <p className={cx("mb-1.5 flex items-center gap-2 font-sans text-sm font-semibold", iconTone[tone])}>
        {icon} {title}
      </p>
      <div>{children}</div>
    </div>
  );
}

/** Renders one learning block. Pure (no hooks) so it works in the reader and the print view. */
export function BlockBody({
  block: b,
  highlights,
  onCite,
}: {
  block: Block;
  highlights?: HighlightSpec[];
  onCite?: (segment: number) => void;
}) {
  const rt = (t: string) => <RichText text={t} highlights={highlights} onCite={onCite} />;
  const list = (items: string[], ordered = false) => {
    const Tag = ordered ? "ol" : "ul";
    return (
      <Tag className={cx("mt-1 space-y-1.5 pl-5", ordered ? "list-decimal" : "list-disc")}>
        {items.map((i, n) => (
          <li key={n}>{rt(i)}</li>
        ))}
      </Tag>
    );
  };

  switch (b.type) {
    case "paragraph":
      return <p>{rt(b.text)}</p>;
    case "story":
      return <p className="border-accent/40 text-ink-2 border-l-2 pl-4 italic">{rt(b.text)}</p>;
    case "definition":
      return (
        <Callout icon={<BookOpen className="size-4" />} title={b.title} tone="accent">
          <p>{rt(b.text)}</p>
          {b.extra && (
            <p className="mt-2 text-[0.94em]">
              <span className="text-muted font-sans text-xs font-semibold tracking-wide uppercase">Why it matters · </span>
              {rt(b.extra)}
            </p>
          )}
          {b.items[0] && (
            <p className="mt-2 text-[0.94em]">
              <span className="text-muted font-sans text-xs font-semibold tracking-wide uppercase">Example · </span>
              {rt(b.items[0])}
            </p>
          )}
        </Callout>
      );
    case "qa":
      return (
        <div className="border-line bg-surface rounded-xl border p-4">
          <p className="flex gap-2 font-semibold">
            <HelpCircle className="text-accent mt-1 size-4 shrink-0" /> <span>{rt(b.title)}</span>
          </p>
          <p className="mt-2 pl-6">{rt(b.text)}</p>
        </div>
      );
    case "example":
      return (
        <Callout icon={<Lightbulb className="size-4" />} title={b.title || "Example"} tone={b.provenance === "ai_example" ? "warn" : "ok"}>
          <p>{rt(b.text)}</p>
          {b.extra && (
            <p className="mt-2 text-[0.94em]">
              <span className="text-muted font-sans text-xs font-semibold tracking-wide uppercase">Why this example matters · </span>
              {rt(b.extra)}
            </p>
          )}
        </Callout>
      );
    case "why_it_matters":
      return (
        <Callout icon={<Brain className="size-4" />} title="Why it matters" tone="violet">
          <p>{rt(b.text)}</p>
        </Callout>
      );
    case "practical":
      return (
        <Callout icon={<Rocket className="size-4" />} title={b.title || "Practical application"} tone="accent">
          {b.text && <p>{rt(b.text)}</p>}
          {b.items.length > 0 && list(b.items)}
        </Callout>
      );
    case "takeaway":
      return (
        <Callout icon={<CheckCircle2 className="size-4" />} title="Key takeaway" tone="ok">
          <p className="font-medium">{rt(b.text)}</p>
        </Callout>
      );
    case "bullets":
      return (
        <div>
          {b.title && <p className="font-sans font-semibold">{rt(b.title)}</p>}
          {list(b.items)}
        </div>
      );
    case "steps":
      return (
        <Callout icon={<ListChecks className="size-4" />} title={b.title || "Action steps"} tone="neutral">
          {list(b.items, true)}
        </Callout>
      );
    case "teacher":
      return (
        <div className="border-line bg-surface rounded-xl border p-4">
          <p className="mb-3 font-sans font-semibold">🎓 {rt(b.title)}</p>
          <dl className="space-y-2.5">
            {b.items.map((item, i) => (
              <div key={i}>
                <dt className="text-accent font-sans text-xs font-semibold tracking-wide uppercase">{TEACHER_LABELS[i] ?? ""}</dt>
                <dd>{rt(item)}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
    case "concept_map":
      return (
        <div className="border-line bg-surface rounded-xl border p-4">
          <p className="mb-3 flex items-center gap-2 font-sans font-semibold">
            <Waypoints className="text-accent size-4" /> {rt(b.title)}
          </p>
          <ol className="space-y-2">
            {b.items.map((item, i) => {
              const [name, ...rest] = item.split(/\s+[—–-]\s+/);
              return (
                <li key={i} className="flex gap-3">
                  <span className="bg-accent-soft text-accent mt-1 flex size-5 shrink-0 items-center justify-center rounded-full font-sans text-[11px] font-semibold">
                    {i + 1}
                  </span>
                  <span>
                    <strong>{name}</strong>
                    {rest.length ? <> — {rt(rest.join(" — "))}</> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      );
    default:
      return b.text ? <p>{rt(b.text)}</p> : null;
  }
}

export function PrintBlock({ block, refLabel }: { block: Block; refLabel: string }) {
  return (
    <div className="mt-3 break-inside-avoid">
      <BlockBody block={block} />
      {(refLabel || block.provenance === "ai_example" || block.provenance === "additional") && (
        <p className="mt-1 font-sans text-[8.5pt] text-neutral-500">
          {block.provenance === "ai_example" || block.provenance === "additional" ? `${PROVENANCE_LABELS[block.provenance]} · ` : ""}
          {refLabel ? `Source: ${refLabel}` : ""}
        </p>
      )}
    </div>
  );
}
