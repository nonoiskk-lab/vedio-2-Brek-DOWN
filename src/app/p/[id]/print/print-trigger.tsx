"use client";
import { useEffect } from "react";
import { Printer } from "lucide-react";

export function PrintTrigger() {
  useEffect(() => {
    document.documentElement.dataset.theme = "light";
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-3 font-sans text-sm">
      <span className="text-neutral-600">Choose &ldquo;Save as PDF&rdquo; as the destination to download a PDF.</span>
      <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-white">
        <Printer className="size-4" /> Print / Save as PDF
      </button>
    </div>
  );
}
