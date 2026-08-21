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
    // Strip EVERY space, not just the outer ones. The figure this input corrects is
    // rendered beside it by `formatGrouped`, which groups with U+00A0 in `cs` and
    // U+202F in `fr` — so an operator who types back the number they can see handed
    // `Number()` a NaN and got a coral "Enter a number" for a number they had entered
    // correctly. A space is a group separator in all four catalogs and a decimal
    // separator in none, so removing it cannot change a value's meaning. The `en`
    // comma and the `de` period are NOT normalized on purpose: those two are each a
    // group separator in one locale and a decimal separator in another, and guessing
    // between 1.2 and 1200 would turn a visible refusal into a silent wrong write.
    const trimmed = draft.replace(/\s+/g, "");
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setFailed(true);
      return;
    }
    // BOTH stores behind this input CLEAR on a non-positive amount — setChannelSpend
    // and setAnalyticsTarget each DELETE the row when `!(v > 0)` — and the routes
    // still answer 200. So a typed `0` is "no value", never a stored zero, and the
    // field has to say the same thing the column it feeds says. It didn't: typing 0
    // over an EMPTY field posted, the row was deleted, `value` came back null
    // (unchanged), so the prop-resync above never fired and `0` sat in the input for
    // the rest of the session while cost-per-applicant went on rendering "—". A dash
    // is a measurement boundary on these surfaces; an editor showing 0 beside it is
    // the one claim it must not make. Normalizing here also collapses "007"/" 5000 "
    // onto the value that will actually be stored.
    const v = parsed != null && parsed > 0 ? parsed : null;
    const canonical = v != null ? String(v) : "";
    if (canonical !== draft) setDraft(canonical);
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
