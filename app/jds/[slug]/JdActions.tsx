"use client";

import { useState } from "react";
import { Check, Copy, Send } from "lucide-react";

// Client actions for the (server-rendered) JD detail page: copy the JD as
// Markdown, and a disabled Publish button foreshadowing job-board integration.
export function JdActions({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={copy}
        className="focus-ring inline-flex h-10 items-center gap-2 rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-ink hover:border-coral/40"
      >
        {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy markdown"}
      </button>
      <button
        type="button"
        disabled
        title="Job-board publishing integration coming soon"
        className="focus-ring inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-md border border-stone-200 px-3 text-sm font-semibold text-steel opacity-70"
      >
        <Send size={15} /> Publish
      </button>
    </div>
  );
}
