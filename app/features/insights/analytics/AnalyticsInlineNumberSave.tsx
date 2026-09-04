"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { planInlineSave } from "./inlineNumberSavePlan";
import { localizedFailureMessage } from "./analyticsFetchError";

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
  announceFailure = false,
}: {
  value: number | null;
  onSave: (value: number | null) => Promise<void>;
  width: string;
  inputType?: "text" | "number";
  inputClassName?: string;
  ariaLabel?: string;
  id?: string;
  failedTitle: string;
  /** Render the failure as a `role="alert"` line beside the field, in addition to
   *  the coral border. Opt-in because the two hosts differ: the spend editor is the
   *  ONLY write path to `channel_spend` (a lost write silently corrupts every
   *  cost-per-hire figure), while the goals editor sits in a tight label/input/suffix
   *  row where an inline sentence would land between the number and its unit. */
  announceFailure?: boolean;
}) {
  const locale = useLocale();
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  const [saving, setSaving] = useState(false);
  // The failure is now a MESSAGE, not a flag: the route answers with a code
  // (api-contracts.md §1.1) and a caller that resolves it throws a LocalizedFailure,
  // so "your role may not do this" and "the write fell over" stop being the same red
  // outline. Anything else caught here is an unlocalized accident and falls back to
  // the caller's own `failedTitle`.
  const [failure, setFailure] = useState<string | null>(null);
  const failed = failure !== null;
  // Re-seed when the server value changes (post-save reload) — the in-render
  // "adjust state when a prop changes" pattern used across the codebase.
  const [seeded, setSeeded] = useState(value);
  if (value !== seeded) {
    setSeeded(value);
    setDraft(value != null ? String(value) : "");
  }

  const save = async () => {
    // The decision (locale-aware parse, zero-is-no-value, unchanged short-circuit,
    // canonical re-seed) is `planInlineSave` — a pure module, so it is covered by an
    // EXECUTING test rather than by reading this file. See inlineNumberSavePlan.ts
    // for why each rule exists.
    const plan = planInlineSave(draft, value, locale);
    if (plan.kind === "invalid") {
      setFailure(failedTitle);
      return;
    }
    if (plan.canonical !== draft) setDraft(plan.canonical);
    if (plan.kind === "unchanged") return;
    setSaving(true);
    setFailure(null);
    try {
      await onSave(plan.value);
    } catch (err) {
      setFailure(localizedFailureMessage(err, failedTitle));
    } finally {
      setSaving(false);
    }
  };

  const field = (
    <input
      id={id}
      type={inputType}
      inputMode="numeric"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (failed) setFailure(null);
      }}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      disabled={saving}
      aria-label={ariaLabel}
      title={failed ? failure ?? failedTitle : undefined}
      aria-invalid={failed ? true : undefined}
      placeholder="—"
      className={`focus-ring h-8 bg-white caret-coral placeholder:text-steel ${width} rounded-md border px-2 text-right disabled:opacity-50 ${inputClassName ?? ""} ${
        failed ? "border-coral text-coral" : "border-stone-200 text-ink"
      }`}
    />
  );
  if (!announceFailure) return field;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {field}
      {/* A lost write, announced. The coral border plus a `title` tooltip was the
          whole prior report: unreachable by keyboard, unannounced by a screen reader,
          and identical for a refusal and an outage. role="alert" because the value the
          reader believes they just stored is not stored. */}
      {failure ? (
        <span role="alert" className="max-w-[16rem] text-right text-meta text-coral">
          {failure}
        </span>
      ) : null}
    </span>
  );
}
