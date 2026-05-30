"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Markdown } from "@/app/_components/Markdown";

// The JD description card, with an icon-only "copy as Markdown" button pinned to
// its top-right corner (the copy action lives with the content it copies).
export function JdBody({ markdown }: { markdown: string }) {
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
    <article className="relative rounded-lg border border-stone-200 bg-white p-6 shadow-panel">
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied to clipboard" : "Copy as Markdown"}
        title={copied ? "Copied" : "Copy as Markdown"}
        className="focus-ring absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-white text-steel hover:border-coral/40 hover:text-coral"
      >
        {copied ? <Check size={15} className="text-moss" /> : <Copy size={15} />}
      </button>
      <div className="pr-8">
        <Markdown content={markdown} />
      </div>
    </article>
  );
}
