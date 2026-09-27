"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Trash2 } from "lucide-react";
import type { NoteRow } from "@/lib/content/types";
import { cx } from "@/components/ui";
import { useReader } from "./context";

/** A personal note with debounced autosave. */
export function NoteCard({ note, compact }: { note: NoteRow; compact?: boolean }) {
  const r = useReader();
  const [value, setValue] = useState(note.content);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [editing, setEditing] = useState(!note.content);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);

  // Flush a pending save if the card unmounts mid-debounce (e.g. navigating away).
  const flush = useRef(() => {});
  useEffect(() => {
    flush.current = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void r.updateNote(note.id, latest.current);
      }
    };
  });
  useEffect(() => () => flush.current(), []);

  function change(v: string) {
    setValue(v);
    latest.current = v;
    setState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      timer.current = null;
      await r.updateNote(note.id, v);
      setState("saved");
    }, 700);
  }

  return (
    <div className={cx("border-warn/30 bg-warn-soft/50 mt-3 rounded-xl border font-sans text-sm", compact ? "p-3" : "p-4")}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-warn text-xs font-semibold">📝 My note</span>
        <span className="text-muted flex items-center gap-2 text-xs">
          {state === "saving" && <Loader2 className="size-3 animate-spin" aria-label="Saving" />}
          {state === "saved" && (
            <span className="flex items-center gap-1">
              <Check className="size-3" /> Saved
            </span>
          )}
          <button
            onClick={() => r.deleteNote(note.id)}
            className="hover:bg-surface-2 hover:text-danger rounded p-1"
            aria-label="Delete note"
            title="Delete note"
          >
            <Trash2 className="size-3.5" />
          </button>
        </span>
      </div>
      {editing ? (
        <textarea
          autoFocus={!note.content}
          value={value}
          onChange={(e) => change(e.target.value)}
          onBlur={() => {
            // An abandoned empty note is removed rather than left blank.
            if (!value.trim()) void r.deleteNote(note.id);
            else setEditing(false);
          }}
          rows={3}
          placeholder="Write your note… (saved automatically)"
          aria-label="Note"
          className="border-line bg-surface focus:border-accent w-full resize-y rounded-lg border p-2 outline-none"
        />
      ) : (
        <button onClick={() => setEditing(true)} className="text-ink w-full text-left whitespace-pre-wrap" title="Click to edit">
          {value}
        </button>
      )}
    </div>
  );
}
