"use client";
import { useEffect, useRef, useState } from "react";
import { Highlighter, Lightbulb, ListChecks, MessageCircleQuestion, NotebookPen, RefreshCw, Wand2 } from "lucide-react";
import { streamPost } from "@/lib/client/api";
import { ASSIST_ACTIONS, type AssistAction } from "@/lib/ai/prompts";
import { Button, Modal, Spinner, useToast } from "@/components/ui";
import { Markdown } from "@/components/ui/rich-text";
import { useReader } from "./context";

interface Sel {
  text: string;
  x: number;
  y: number;
  anchor: string | null;
  chapterId: string | null;
}

/** Floating toolbar for text selected inside the chapter content. */
export function SelectionToolbar({ container }: { container: React.RefObject<HTMLElement | null> }) {
  const r = useReader();
  const [sel, setSel] = useState<Sel | null>(null);

  useEffect(() => {
    function onUp() {
      setTimeout(() => {
        const s = window.getSelection();
        const text = s?.toString().trim() ?? "";
        if (!s || !text || text.length < 3 || !s.rangeCount || !container.current) return setSel(null);
        const range = s.getRangeAt(0);
        if (!container.current.contains(range.commonAncestorContainer)) return setSel(null);
        const rect = range.getBoundingClientRect();
        const node = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
        const blockEl = node?.closest<HTMLElement>("[data-anchor]");
        setSel({
          text: text.slice(0, 8000),
          x: rect.left + rect.width / 2,
          y: rect.top,
          anchor: blockEl?.dataset.anchor ?? null,
          chapterId: blockEl?.dataset.chapter ?? null,
        });
      }, 10);
    }
    function onDown(e: MouseEvent) {
      if (!(e.target as Element)?.closest?.("[data-selection-toolbar]")) setSel(null);
    }
    const onScroll = () => setSel(null);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onUp);
    document.addEventListener("mousedown", onDown);
    container.current?.addEventListener("scroll", onScroll, { passive: true });
    const el = container.current;
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onUp);
      document.removeEventListener("mousedown", onDown);
      el?.removeEventListener("scroll", onScroll);
    };
  }, [container]);

  if (!sel) return null;
  const act = (fn: () => void) => () => {
    fn();
    setSel(null);
    window.getSelection()?.removeAllRanges();
  };
  const actions: { label: string; icon: React.ReactNode; run: () => void }[] = [
    { label: ASSIST_ACTIONS.simplify.label, icon: <Wand2 className="size-4" />, run: () => r.runAssist("simplify", sel.text) },
    { label: ASSIST_ACTIONS.example.label, icon: <Lightbulb className="size-4" />, run: () => r.runAssist("example", sel.text) },
    { label: ASSIST_ACTIONS.rephrase.label, icon: <RefreshCw className="size-4" />, run: () => r.runAssist("rephrase", sel.text) },
    { label: ASSIST_ACTIONS.points.label, icon: <ListChecks className="size-4" />, run: () => r.runAssist("points", sel.text) },
    { label: ASSIST_ACTIONS.notes.label, icon: <NotebookPen className="size-4" />, run: () => r.runAssist("notes", sel.text) },
    {
      label: "Highlight",
      icon: <Highlighter className="size-4" />,
      run: () => r.addHighlight({ chapter_id: sel.chapterId, anchor: sel.anchor, text: sel.text.slice(0, 4000) }),
    },
    {
      label: "Ask AI",
      icon: <MessageCircleQuestion className="size-4" />,
      run: () => r.askTutor("Please explain this selected part.", sel.text),
    },
  ];

  return (
    <div
      data-selection-toolbar
      role="toolbar"
      aria-label="Selected text actions"
      className="no-print border-line bg-surface fixed z-40 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-xl border p-1 font-sans shadow-xl"
      style={{ left: Math.min(Math.max(sel.x, 180), window.innerWidth - 180), top: Math.max(sel.y - 8, 56) }}
    >
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={act(a.run)}
          title={a.label}
          aria-label={a.label}
          className="text-ink-2 hover:bg-accent-soft hover:text-accent rounded-lg p-2"
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
}

export interface AssistRequest {
  id: number;
  action: AssistAction;
  text: string;
  chapterId: string | null;
}

/** Streams an AI study action (simplify, example, explain again, points, notes) for a passage. */
export function AssistDialog({ request, onClose }: { request: AssistRequest | null; onClose: () => void }) {
  const r = useReader();
  const toast = useToast();
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!request) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset output for a new request
    setOutput("");
    setLoading(true);
    streamPost(
      `/api/projects/${r.book.project.id}/assist`,
      { action: request.action, text: request.text, chapterId: request.chapterId },
      setOutput,
      ctrl.signal,
    )
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setOutput(`_${(e as Error).message}_`);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [request, r.book.project.id]);

  if (!request) return null;
  return (
    <Modal open onClose={onClose} title={ASSIST_ACTIONS[request.action].label} wide>
      <div className="space-y-4 p-5 font-sans">
        <blockquote className="border-line text-muted line-clamp-4 border-l-2 pl-3 text-sm">{request.text}</blockquote>
        <div className="min-h-24 text-[15px]">
          {output ? (
            <Markdown
              text={output}
              onCite={(n) => {
                onClose();
                r.openSource(n);
              }}
            />
          ) : (
            <Spinner />
          )}
        </div>
        <div className="border-line flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button
            variant="secondary"
            size="sm"
            disabled={loading || !output}
            onClick={async () => {
              await navigator.clipboard.writeText(output).catch(() => {});
              toast("Copied", "ok");
            }}
          >
            Copy
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={loading || !output}
            onClick={async () => {
              const note = await r.addNote({
                chapter_id: request.chapterId,
                anchor: null,
                quote: request.text.slice(0, 300),
                content: output,
              });
              if (note) toast("Saved to your notes", "ok");
            }}
          >
            <NotebookPen className="size-4" /> Save as note
          </Button>
          <Button
            size="sm"
            disabled={loading}
            onClick={() => {
              onClose();
              r.askTutor("I still have a question about this part.", request.text);
            }}
          >
            <MessageCircleQuestion className="size-4" /> Ask a follow-up
          </Button>
        </div>
      </div>
    </Modal>
  );
}
