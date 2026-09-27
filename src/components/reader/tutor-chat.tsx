"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, GraduationCap, RotateCcw, Square } from "lucide-react";
import { api, streamPost } from "@/lib/client/api";
import { Markdown } from "@/components/ui/rich-text";
import { Spinner, cx, useToast } from "@/components/ui";
import { useReader } from "./context";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  selection?: string;
}

export interface TutorRequest {
  id: number;
  message: string;
  selection?: string;
}

const SUGGESTIONS = [
  "Explain this chapter more simply",
  "Is there anything in the source about competition?",
  "Give me a real-life example of the main idea",
  "Ye concept mujhe samajh nahi aaya — simple example se samjhao",
];

export function TutorChat({ request, chapterId }: { request: TutorRequest | null; chapterId: string | null }) {
  const { book, openSource } = useReader();
  const toast = useToast();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const handled = useRef<number | null>(null);
  const convRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ conversationId: string | null; messages: Msg[] }>(`/api/projects/${book.project.id}/chat`)
      .then((d) => {
        if (cancelled) return;
        setConversationId(d.conversationId);
        convRef.current = d.conversationId;
        setMessages(d.messages);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [book.project.id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const send = useCallback(
    async (text: string, selection?: string) => {
      const message = text.trim();
      if (!message || streaming) return;
      setInput("");
      const userMsg: Msg = { id: `u${Date.now()}`, role: "user", content: message, selection };
      const aiId = `a${Date.now()}`;
      setMessages((m) => [...m, userMsg, { id: aiId, role: "assistant", content: "" }]);
      setStreaming(true);
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        const { headers } = await streamPost(
          `/api/projects/${book.project.id}/chat`,
          { message, conversationId: convRef.current, chapterId, selection },
          (full) => setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, content: full } : x))),
          ctrl.signal,
        );
        const cid = headers.get("X-Conversation-Id");
        if (cid) {
          convRef.current = cid;
          setConversationId(cid);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          toast((e as Error).message, "error");
          setMessages((m) => m.filter((x) => x.id !== aiId || x.content));
        }
      } finally {
        setStreaming(false);
        abort.current = null;
      }
    },
    [book.project.id, chapterId, streaming, toast],
  );

  useEffect(() => {
    if (request && handled.current !== request.id && loaded) {
      handled.current = request.id;
      void send(request.message, request.selection);
    }
  }, [request, loaded, send]);

  async function reset() {
    abort.current?.abort();
    await api(`/api/projects/${book.project.id}/chat`, { method: "DELETE" }).catch(() => {});
    convRef.current = null;
    setConversationId(null);
    setMessages([]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 pb-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <GraduationCap className="text-accent size-4" /> AI Tutor
        </p>
        {(messages.length > 0 || conversationId) && (
          <button
            onClick={reset}
            className="text-muted hover:text-ink inline-flex items-center gap-1 text-xs"
            title="Start a new conversation"
          >
            <RotateCcw className="size-3" /> New chat
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 scrollbar-thin space-y-3 overflow-y-auto px-4 pb-3" aria-live="polite">
        {!loaded ? (
          <Spinner className="mx-auto mt-8" />
        ) : messages.length === 0 ? (
          <div className="mt-4 space-y-2 text-sm">
            <p className="text-muted">
              Ask anything about this book. Answers come from the source first — anything else is clearly labelled.
            </p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="border-line text-ink-2 hover:border-accent hover:bg-accent-soft block w-full rounded-xl border px-3 py-2 text-left"
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cx("text-sm", m.role === "user" && "flex justify-end")}>
              {m.role === "user" ? (
                <div className="bg-accent text-accent-ink max-w-[90%] rounded-2xl rounded-br-md px-3 py-2">
                  {m.selection && (
                    <p className="border-accent-ink/40 mb-1 line-clamp-2 border-l-2 pl-2 text-xs opacity-80">{m.selection}</p>
                  )}
                  {m.content}
                </div>
              ) : (
                <div className="bg-surface-2 rounded-2xl rounded-bl-md px-3 py-2">
                  {m.content ? <Markdown text={m.content} onCite={openSource} /> : <Spinner className="size-4" />}
                </div>
              )}
            </div>
          ))
        )}
        <div ref={bottom} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="border-line border-t p-3"
      >
        <div className="border-line bg-surface focus-within:border-accent flex items-end gap-2 rounded-xl border p-1.5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="Ask your tutor…"
            aria-label="Ask your tutor"
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
          />
          {streaming ? (
            <button type="button" onClick={() => abort.current?.abort()} className="bg-surface-2 rounded-lg p-2" aria-label="Stop">
              <Square className="size-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="bg-accent text-accent-ink rounded-lg p-2 disabled:opacity-40"
              aria-label="Send"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
