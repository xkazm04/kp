"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

const OPTIONS = [
  { value: "advance", labelKey: "dispAdvance", on: "bg-moss text-white", off: "text-moss hover:bg-moss/10" },
  { value: "hold", labelKey: "dispHold", on: "bg-dial-amber text-ink", off: "text-amber-700 hover:bg-amber-50" },
  { value: "pass", labelKey: "dispPass", on: "bg-coral text-white", off: "text-coral hover:bg-coral/10" },
] as const;

// Human decision record on a saved analysis (RES5). The report was read-only —
// AiDisclosure promises a human makes every call, but that call was never captured
// against the analysis. This pins a disposition (advance/hold/pass) + an optional
// reason via PATCH /api/analyses/[slug], shown on the history detail header and the
// list rows. print:hidden so it stays out of an exported/printed report.
export function DispositionEditor({
  slug,
  initialDisposition,
  initialNote,
}: {
  slug: string;
  initialDisposition: string | null;
  initialNote: string | null;
}) {
  const t = useTranslations("report");
  const [disposition, setDisposition] = useState(initialDisposition ?? "");
  const [note, setNote] = useState(initialNote ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  // The note value last persisted to the server — gates the autosave + blur so we
  // don't re-PATCH an unchanged reason, and lets the debounce know there's nothing new.
  const lastSavedNote = useRef(initialNote ?? "");

  const save = useCallback(
    async (nextDisposition: string, nextNote: string) => {
      setSaving(true);
      setSaved(false);
      setError(false);
      try {
        const r = await fetch(`/api/analyses/${encodeURIComponent(slug)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ disposition: nextDisposition, note: nextNote }),
        });
        if (!r.ok) throw new Error();
        lastSavedNote.current = nextNote;
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2000);
      } catch {
        setError(true);
      } finally {
        setSaving(false);
      }
    },
    [slug],
  );

  const pick = (value: string) => {
    const next = disposition === value ? "" : value; // click the active one to clear
    setDisposition(next);
    if (next === "") {
      // Clearing the decision clears its reason too: a note with no disposition is an
      // orphan (the field only renders WITH a disposition, so it'd be saved but never
      // shown). Previously the typed note was saved against the empty decision.
      setNote("");
      void save("", "");
    } else {
      // Switching decisions: persist the reason that's actually on screen against the
      // new disposition (it stays visible + editable), rather than leaving it to a blur
      // that the re-render may skip.
      void save(next, note);
    }
  };

  // Autosave the reason shortly after typing stops, so a note typed but NOT blurred —
  // the recruiter clicks a disposition, closes the report, or the panel unmounts — is
  // never lost (the field used to persist only on blur, which a clear/unmount skipped).
  useEffect(() => {
    if (!disposition || note === lastSavedNote.current) return;
    const id = window.setTimeout(() => void save(disposition, note), 800);
    return () => window.clearTimeout(id);
  }, [note, disposition, save]);

  return (
    <div className="rounded-lg border border-stone-200 bg-paper p-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-meta uppercase tracking-wide text-steel">{t("yourDecision")}</span>
        <div className="inline-flex overflow-hidden rounded-md border border-stone-200 bg-white">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => pick(o.value)}
              disabled={saving}
              aria-pressed={disposition === o.value}
              className={`focus-ring px-3 py-1 text-sm font-semibold transition-colors disabled:opacity-50 ${
                disposition === o.value ? o.on : o.off
              }`}
            >
              {t(o.labelKey)}
            </button>
          ))}
        </div>
        {saving ? <Loader2 size={14} className="animate-spin text-steel" /> : null}
        {saved ? (
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-moss">
            <Check size={14} /> {t("saved")}
          </span>
        ) : null}
        {error ? <span className="text-sm text-coral">{t("saveFailed")}</span> : null}
      </div>
      {disposition ? (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note !== lastSavedNote.current) void save(disposition, note);
          }}
          rows={2}
          placeholder={t("notePlaceholder")}
          className="focus-ring mt-2 w-full rounded-md border border-stone-200 bg-white p-2 text-sm text-ink"
        />
      ) : null}
    </div>
  );
}
