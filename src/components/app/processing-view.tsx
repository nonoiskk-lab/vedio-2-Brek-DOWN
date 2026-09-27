"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Loader2, RotateCcw } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import type { PipelineStage, StageDetail } from "@/lib/content/types";
import { Button, Card, cx } from "@/components/ui";

interface State {
  status: "processing" | "ready" | "failed";
  stage: PipelineStage;
  stage_detail: StageDetail;
  error: string | null;
  title: string;
  busy?: boolean;
}

const ORDER: PipelineStage[] = ["analyze", "plan", "write", "quality", "revision", "finalize", "done"];

const STEPS: { label: string; stage: PipelineStage | "extract"; detail?: (d: StageDetail) => string | null }[] = [
  { label: "Extracting content", stage: "extract" },
  {
    label: "Understanding topics",
    stage: "analyze",
    detail: (d) => (d.totalChunks ? `${d.analyzed ?? 0} of ${d.totalChunks} source parts analysed` : null),
  },
  { label: "Detecting important concepts", stage: "plan" },
  { label: "Organizing chapters", stage: "plan" },
  {
    label: "Simplifying explanations",
    stage: "write",
    detail: (d) => (d.totalChapters ? `${d.written ?? 0} of ${d.totalChapters} chapters written` : null),
  },
  { label: "Creating examples", stage: "write" },
  { label: "Creating questions", stage: "write" },
  {
    label: "Checking quality against the source",
    stage: "quality",
    detail: (d) =>
      d.totalChapters
        ? `${d.checked ?? 0} of ${d.totalChapters} chapters checked${d.regenerated ? ` · ${d.regenerated} rewritten` : ""}`
        : null,
  },
  { label: "Preparing revision material", stage: "revision" },
  { label: "Finalizing learning book", stage: "finalize" },
];

function stepStatus(step: PipelineStage | "extract", current: PipelineStage): "done" | "active" | "pending" {
  if (step === "extract") return "done";
  const a = ORDER.indexOf(step);
  const b = ORDER.indexOf(current);
  return a < b ? "done" : a === b ? "active" : "pending";
}

export function ProcessingView({ projectId, initial }: { projectId: string; initial: State }) {
  const router = useRouter();
  const [state, setState] = useState<State>(initial);
  const [transient, setTransient] = useState<string | null>(null);
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const running = useRef(false);

  const loop = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    let delay = 2000;
    try {
      for (;;) {
        let next: State;
        try {
          next = await api<State>(`/api/projects/${projectId}/process`, { method: "POST" });
          setTransient(next.stage_detail?.message && next.status === "processing" ? next.stage_detail.message : null);
          delay = 2000;
        } catch (e) {
          if (e instanceof ApiError && (e.status === 401 || e.status === 404 || e.status === 503)) {
            setState((s) => ({ ...s, status: "failed", error: e.message }));
            return;
          }
          // Network error or the step was cut off by a timeout: completed work is saved, just resume.
          setTransient("Connection interrupted — resuming…");
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay * 2, 30000);
          continue;
        }
        setState(next);
        if (next.status === "ready") {
          router.refresh();
          return;
        }
        if (next.status === "failed") return;
        if (next.busy) {
          // Another tab or request holds the lock; poll until it releases.
          await new Promise((r) => setTimeout(r, 5000));
        } else if (next.stage_detail?.message) {
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay * 2, 30000);
        }
      }
    } finally {
      running.current = false;
    }
  }, [projectId, router]);

  useEffect(() => {
    if (initial.status === "processing") void loop();
  }, [initial.status, loop]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function retry() {
    try {
      await api(`/api/projects/${projectId}/retry`, { method: "POST" });
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message }));
      return;
    }
    setState((s) => ({ ...s, status: "processing", error: null }));
    void loop();
  }

  const elapsed = Math.floor((now - started) / 1000);
  const failed = state.status === "failed";

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <Link href="/dashboard" className="text-muted hover:text-ink inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" /> My Learning
      </Link>
      <Card className="mt-6 p-7">
        <p className="text-accent text-sm font-medium">{failed ? "Something went wrong" : "Building your learning book"}</p>
        <h1 className="mt-1 text-xl leading-snug font-semibold">{state.title}</h1>
        {!failed && (
          <p className="text-muted mt-2 text-sm" aria-live="polite">
            Analyzing source… · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} elapsed
          </p>
        )}

        <ol className="mt-6 space-y-3" aria-label="Processing steps">
          {STEPS.map((s) => {
            const st = stepStatus(s.stage, state.stage);
            const detail = st !== "pending" && s.detail ? s.detail(state.stage_detail ?? {}) : null;
            return (
              <li key={s.label} className="flex items-start gap-3">
                <span
                  className={cx(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                    st === "done" && "bg-ok text-white",
                    st === "active" && !failed && "bg-accent-soft text-accent",
                    st === "active" && failed && "bg-danger-soft text-danger",
                    st === "pending" && "border-line border",
                  )}
                >
                  {st === "done" ? (
                    <Check className="size-3.5" />
                  ) : st === "active" ? (
                    failed ? (
                      <AlertTriangle className="size-3" />
                    ) : (
                      <Loader2 className="size-3.5 animate-spin" />
                    )
                  ) : null}
                </span>
                <span>
                  <span className={cx("text-sm", st === "pending" ? "text-muted" : "font-medium")}>{s.label}</span>
                  {detail && <span className="text-muted block text-xs">{detail}</span>}
                </span>
              </li>
            );
          })}
        </ol>

        {transient && !failed && (
          <p className="bg-warn-soft text-warn mt-6 rounded-lg px-3 py-2 text-sm">{transient} Retrying automatically.</p>
        )}

        {failed ? (
          <div className="mt-6 space-y-3">
            <p role="alert" className="bg-danger-soft text-danger rounded-lg px-3 py-2 text-sm">
              {state.error ?? "Processing failed."}
            </p>
            <p className="text-muted text-sm">Everything completed so far is saved — retrying continues from the failed step.</p>
            <Button onClick={retry}>
              <RotateCcw className="size-4" /> Retry
            </Button>
          </div>
        ) : (
          <p className="text-muted mt-6 text-xs">
            Long videos and documents take a few minutes. Progress is saved after every step — if you close this page, processing pauses and
            resumes from the same step when you come back.
          </p>
        )}
      </Card>
    </main>
  );
}
