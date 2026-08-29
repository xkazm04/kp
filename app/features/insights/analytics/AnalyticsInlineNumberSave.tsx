"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { parseLocaleNumber } from "./parseLocaleNumber";

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
  const locale = useLocale();
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
    // Parse in the READER's notation (parseLocaleNumber). The previous version
    // stripped spaces and handed the rest to `Number()`, which is en-US-only: it
    // deliberately left `,` and `.` alone because each is a group separator in one
    // shipped locale and a decimal separator in another, reasoning that guessing
    // between 1.2 and 1200 "would turn a visible refusal into a silent wrong
    // write". The asymmetry is that it already WAS one in `de` — `Number("12.000")`
    // is 12, so an operator correcting a channel's spend to 12.000 stored 12 and
    // cost-per-applicant answered accordingly, while `en`'s `12,000` failed
    // visibly. Knowing the locale is what removes the guess: `1.234` is 1.234 in
    // `en` and 1234 in `de`, and both are now read correctly instead of one being
    // right by accident.
    const parsed = parseLocaleNumber(draft, locale);
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
