"use client";

import { CheckCircle2, X } from "lucide-react";

export function AnalyzePasteRow({
  ariaLabel,
  inputId,
  text,
  onChange,
  onClear,
}: {
  ariaLabel: string;
  inputId: string;
  text: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  const hasContent = text.trim().length > 0;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={inputId}
        className="block text-[11px] font-semibold uppercase tracking-wide text-steel"
      >
        Paste content
      </label>
      <textarea
        id={inputId}
        aria-label={ariaLabel}
        rows={1}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        // When content is present we hide the textarea entirely (sr-only
        // keeps it in DOM for tests + accessibility, but visually only the
        // confirmation badge shows). When empty, the input is the visible
        // paste target with no placeholder.
        className={
          hasContent
            ? "sr-only"
            : "focus-ring h-10 w-full resize-none overflow-hidden whitespace-pre rounded-md border border-stone-300 bg-white px-3 py-2 text-xs text-ink"
        }
      />
      {hasContent ? (
        <div className="flex items-center justify-between gap-2 rounded-md bg-moss/15 px-2 py-1">
          <CheckCircle2 className="h-3.5 w-3.5 text-moss" aria-hidden />
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear pasted content"
            title="Clear"
            className="focus-ring inline-flex h-5 w-5 items-center justify-center rounded-md text-coral hover:bg-coral/10"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
