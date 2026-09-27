"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, FileUp, Globe, Sparkles, Type, Upload, SquarePlay } from "lucide-react";
import { api } from "@/lib/client/api";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { LANGUAGE_LABELS, LEARNING_STYLES, type LearningStyle, type OutputLanguage } from "@/lib/content/types";
import { Button, Card, cx } from "@/components/ui";

type SourceTab = "youtube" | "file" | "text" | "article";
const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.srt,.vtt";
const MAX_FILE_MB = 50;
const YT_RE = /(youtube\.com\/(watch\?.*v=|shorts\/|embed\/|live\/)|youtu\.be\/)[A-Za-z0-9_-]{11}/;

const INSTRUCTION_PRESETS = [
  "Main beginner hoon. Mujhe simple Hinglish mein samjhao. English technical terms ko retain karo. Har concept ke saath example do.",
  "I'm preparing for an exam — focus on definitions, key facts and likely questions.",
  "Explain like I'm a busy founder: short, practical, what to do next.",
];

export function Wizard({ userId }: { userId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [tab, setTab] = useState<SourceTab>("youtube");
  const [url, setUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);
  const [text, setText] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [styles, setStyles] = useState<LearningStyle[]>(["book", "beginner", "teacher", "qa", "examples"]);
  const [language, setLanguage] = useState<OutputLanguage>("en");
  const [instruction, setInstruction] = useState("");
  const [aiExamples, setAiExamples] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const sourceValid =
    (tab === "youtube" && YT_RE.test(url)) ||
    (tab === "article" && /^https?:\/\/\S+\.\S+/.test(url)) ||
    (tab === "text" && text.trim().split(/\s+/).length >= 60) ||
    (tab === "file" && !!file);

  function pickFile(f: File | undefined | null) {
    setError(null);
    if (!f) return;
    const ext = f.name.toLowerCase().split(".").pop() ?? "";
    if (!["pdf", "docx", "txt", "md", "markdown", "srt", "vtt"].includes(ext)) {
      setError(
        ext === "doc"
          ? "Legacy .doc files aren't supported — save it as .docx first."
          : "Unsupported file type. Use PDF, DOCX, TXT, MD, SRT or VTT.",
      );
      return;
    }
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`That file is larger than ${MAX_FILE_MB} MB.`);
      return;
    }
    setFile(f);
  }

  function toggleStyle(id: LearningStyle) {
    setStyles((s) => (s.includes(id) ? (s.length > 1 ? s.filter((x) => x !== id) : s) : [...s, id]));
  }

  async function create() {
    setError(null);
    try {
      let source: Record<string, unknown>;
      if (tab === "file" && file) {
        setBusy("Uploading file…");
        const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-120);
        const path = `${userId}/${crypto.randomUUID()}/${safe}`;
        const { error: upErr } = await supabaseBrowser().storage.from("sources").upload(path, file, { upsert: false });
        if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
        source = { type: "file", storagePath: path, filename: file.name };
      } else if (tab === "youtube") {
        source = { type: "youtube", url, ...(showTranscript && transcript.trim() ? { transcript } : {}) };
      } else if (tab === "article") {
        source = { type: "article", url };
      } else {
        source = { type: "text", text, title: textTitle || undefined };
      }
      setBusy(tab === "youtube" ? "Fetching the video transcript…" : "Reading your source…");
      const res = await api<{ id: string }>("/api/projects", {
        method: "POST",
        json: { source, settings: { styles, language, customInstruction: instruction || undefined, aiExamples } },
      });
      setBusy("Starting…");
      router.push(`/p/${res.id}`);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      setBusy(null);
      // A video without accessible captions: take the learner back to step 1 with the transcript box open.
      if (tab === "youtube" && /transcript|caption/i.test(message)) {
        setShowTranscript(true);
        setStep(1);
      }
    }
  }

  const tabs: { id: SourceTab; label: string; icon: React.ReactNode }[] = [
    { id: "youtube", label: "YouTube", icon: <SquarePlay className="size-4" /> },
    { id: "file", label: "Upload File", icon: <Upload className="size-4" /> },
    { id: "text", label: "Paste Text", icon: <Type className="size-4" /> },
    { id: "article", label: "Article URL", icon: <Globe className="size-4" /> },
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/dashboard" className="text-muted hover:text-ink inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" /> My Learning
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">New Learning Material</h1>

      <ol className="mt-6 flex items-center gap-3 text-sm" aria-label="Steps">
        {["Choose source", "How should AI teach you?"].map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cx(
                "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                step > i + 1 ? "bg-ok text-white" : step === i + 1 ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted",
              )}
            >
              {step > i + 1 ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={step === i + 1 ? "font-medium" : "text-muted"}>{label}</span>
            {i === 0 && <span className="bg-line mx-1 h-px w-8" />}
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="border-danger/30 bg-danger-soft text-danger mt-6 rounded-xl border px-4 py-3 text-sm">
          {error}
        </p>
      )}

      {step === 1 ? (
        <Card className="mt-6 p-6">
          <div role="tablist" aria-label="Source type" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => {
                  setTab(t.id);
                  setError(null);
                }}
                className={cx(
                  "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition",
                  tab === t.id ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-surface-2",
                )}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          <div className="mt-6">
            {tab === "youtube" && (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-sm font-medium">YouTube URL</span>
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=…"
                    inputMode="url"
                    className="border-line bg-surface focus:border-accent mt-1 h-11 w-full rounded-xl border px-3 outline-none"
                  />
                </label>
                {url && !YT_RE.test(url) && <p className="text-danger text-sm">That doesn&apos;t look like a YouTube video link.</p>}
                <p className="text-muted text-sm">
                  We read the video&apos;s captions/transcript (with timestamps). If a video has no captions, we&apos;ll tell you — we never
                  pretend to have watched it.
                </p>
                <button className="text-accent text-sm hover:underline" onClick={() => setShowTranscript((s) => !s)}>
                  {showTranscript ? "Hide transcript box" : "Paste the transcript myself instead"}
                </button>
                {showTranscript && (
                  <textarea
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    rows={8}
                    placeholder={"Paste from YouTube → ··· → Show transcript. Timestamps like 02:34 are kept.\n\n0:00\nWelcome everyone…"}
                    className="border-line bg-surface focus:border-accent w-full rounded-xl border p-3 font-mono text-sm outline-none"
                  />
                )}
              </div>
            )}

            {tab === "file" && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  pickFile(e.dataTransfer.files[0]);
                }}
                className={cx(
                  "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition",
                  dragging ? "border-accent bg-accent-soft" : "border-line",
                )}
              >
                <FileUp className="text-muted size-8" />
                {file ? (
                  <p className="font-medium">
                    {file.name} <span className="text-muted text-sm">({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
                  </p>
                ) : (
                  <p className="font-medium">Drop a file here</p>
                )}
                <p className="text-muted text-sm">PDF, DOCX, TXT, Markdown, or SRT/VTT transcripts · up to {MAX_FILE_MB} MB</p>
                <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                  {file ? "Choose another file" : "Browse files"}
                </Button>
                <input ref={fileInput} type="file" accept={ACCEPT} className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
              </div>
            )}

            {tab === "text" && (
              <div className="space-y-3">
                <input
                  value={textTitle}
                  onChange={(e) => setTextTitle(e.target.value)}
                  placeholder="Title (optional)"
                  aria-label="Title"
                  className="border-line bg-surface focus:border-accent h-11 w-full rounded-xl border px-3 outline-none"
                />
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={12}
                  aria-label="Content"
                  placeholder="Paste an article, transcript, notes, or any educational text…"
                  className="border-line bg-surface focus:border-accent w-full rounded-xl border p-3 text-sm outline-none"
                />
                <p className="text-muted text-xs">
                  {text.trim() ? text.trim().split(/\s+/).length.toLocaleString() : 0} words · at least 60 needed
                </p>
              </div>
            )}

            {tab === "article" && (
              <label className="block">
                <span className="text-sm font-medium">Article URL</span>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  inputMode="url"
                  className="border-line bg-surface focus:border-accent mt-1 h-11 w-full rounded-xl border px-3 outline-none"
                />
                <span className="text-muted mt-2 block text-sm">
                  We extract the main article text. Paywalled pages may need to be pasted instead.
                </span>
              </label>
            )}
          </div>

          <div className="mt-8 flex justify-end">
            <Button size="lg" disabled={!sourceValid} onClick={() => setStep(2)}>
              Next <ArrowRight className="size-4" />
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="mt-6 p-6">
          <fieldset>
            <legend className="font-medium">Learning styles</legend>
            <p className="text-muted text-sm">Pick as many as you like — they&apos;re combined into one book.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {LEARNING_STYLES.map((s) => {
                const on = styles.includes(s.id);
                return (
                  <label
                    key={s.id}
                    className={cx(
                      "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition",
                      on ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2",
                    )}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggleStyle(s.id)} className="mt-1 accent-[var(--accent)]" />
                    <span>
                      <span className="font-medium">
                        {s.emoji} {s.label}
                      </span>
                      <span className="text-muted block text-xs">{s.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="mt-6">
            <legend className="font-medium">Output language</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(LANGUAGE_LABELS) as OutputLanguage[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={language === l}
                  onClick={() => setLanguage(l)}
                  className={cx(
                    "rounded-xl border px-4 py-2 text-sm font-medium",
                    language === l ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-surface-2",
                  )}
                >
                  {LANGUAGE_LABELS[l]}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="mt-6 block">
            <span className="font-medium">How should AI teach me? (optional)</span>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. Main beginner hoon. Simple Hinglish mein samjhao…"
              className="border-line bg-surface focus:border-accent mt-2 w-full rounded-xl border p-3 text-sm outline-none"
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {INSTRUCTION_PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setInstruction(p)}
                className="bg-surface-2 text-ink-2 hover:bg-accent-soft hover:text-accent rounded-full px-3 py-1 text-xs"
              >
                {p.length > 48 ? p.slice(0, 46) + "…" : p}
              </button>
            ))}
          </div>

          <label className="border-line mt-6 flex cursor-pointer items-start gap-3 rounded-xl border p-4">
            <input
              type="checkbox"
              checked={aiExamples}
              onChange={(e) => setAiExamples(e.target.checked)}
              className="mt-1 accent-[var(--accent)]"
            />
            <span>
              <span className="font-medium">Allow AI-generated examples</span>
              <span className="text-muted block text-sm">
                When the source has no example for a concept, the AI may create one. They are always labelled &ldquo;AI-generated
                example&rdquo;.
              </span>
            </span>
          </label>

          <div className="mt-8 flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep(1)} disabled={!!busy}>
              <ArrowLeft className="size-4" /> Back
            </Button>
            <Button size="lg" onClick={create} loading={!!busy}>
              {busy ?? (
                <>
                  <Sparkles className="size-4" /> Create my learning book
                </>
              )}
            </Button>
          </div>
        </Card>
      )}
    </main>
  );
}
