"use client";

import { useState } from "react";

// One save-on-blur numeric input: holds the draft, re-seeds when the server
// `value` changes (the in-render prop-resync pattern), validates (blank → null;
// rejects non-finite/negative), short-circuits an unchanged value, and delegates
// the actual persistence to `onSave`. Each caller owns its own endpoint/body and
// supplies its label/suffix chrome around this. Extracted from the near-identical
// SpendInput/TargetInput (only endpoint/body + minor styling differed). Split out
// of AnalyticsTab.tsx to keep that file under the 200-line cap — reused by
// AnalyticsChannelSpendInput.tsx and AnalyticsTargetInput.tsx.
export function InlineNumberSave({
  value,
  onSave,
  width,
  inputType = "text",
  inputClassName,
  ariaLabel,
  id,
  failedTitle,
}: {
  value: number | null;
  onSave: (value: number | null) => Promise<void>;
  width: string;
  inputType?: "text" | "number";
  inputClassName?: string;
  ariaLabel?: string;
  id?: string;
  failedTitle: string;
}) {
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // Re-seed when the server value changes (post-save reload) — the in-render
  // "adjust state when a prop changes" pattern used across the codebase.
  const [seeded, setSeeded] = useState(value);
  if (value !== seeded) {
    setSeeded(value);
    setDraft(value != null ? String(value) : "");
  }

  const save = async () => {
    const trimmed = draft.trim();
    const v = trimmed === "" ? null : Number(trimmed);
    if (v !== null && (!Number.isFinite(v) || v < 0)) {
      setFailed(true);
      return;
    }
    if (v === value) return; // unchanged — no request
    setSaving(true);
    setFailed(false);
    try {
      await onSave(v);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      id={id}
      type={inputType}
      inputMode="numeric"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (failed) setFailed(false);
      }}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      disabled={saving}
      aria-label={ariaLabel}
      title={failed ? failedTitle : undefined}
      aria-invalid={failed ? true : undefined}
      placeholder="—"
      className={`focus-ring h-8 bg-white caret-coral placeholder:text-steel ${width} rounded-md border px-2 text-right disabled:opacity-50 ${inputClassName ?? ""} ${
        failed ? "border-coral text-coral" : "border-stone-200 text-ink"
      }`}
    />
  );
}
