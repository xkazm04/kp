"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextArea } from "@/app/_components/TextArea";
import { Checkbox } from "@/app/_components/Checkbox";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import {
  DISPOSITION_ACK_REQUIRED,
  decisionBrief,
  decisionGate,
  dispositionPatchBody,
  settleDisposition,
} from "./decisionBrief";

const OPTIONS = [
  { value: "advance", labelKey: "dispAdvance", on: "bg-moss text-white", off: "text-moss hover:bg-moss/10" },
  { value: "hold", labelKey: "dispHold", on: "bg-dial-amber text-ink", off: "text-amber-700 hover:bg-amber-50" },
  { value: "pass", labelKey: "dispPass", on: "bg-coral text-white", off: "text-coral hover:bg-coral/10" },
] as const;

/** Every settled save, reported to an optional host (History's triage drawer). `ok` is a
 *  2xx; `code` is the refusal's code (DISPOSITION_ACK_REQUIRED, FORBIDDEN_CAPABILITY),
 *  null for a network failure. `disposition`/`note` are what the request carried. */
export type DispositionOutcome = { ok: boolean; code: string | null; disposition: string; note: string };

// Human decision record on a saved analysis (RES5). The report was read-only —
// AiDisclosure promises a human makes every call, but that call was never captured
// against the analysis. This pins a disposition (advance/hold/pass) + an optional
// reason via PATCH /api/analyses/[slug], shown on the history detail header and the
// list rows. print:hidden so it stays out of an exported/printed report.
//
// challenge-r07 results-core/B: the decision is taken WITH the engine's open flags in
// view. The brief (decisionBrief.ts) renders inline; Advance needs every open flag
// ticked, Pass on a strong read needs a reason, and the PATCH door re-checks the
// acknowledgements (DISPOSITION_ACK_REQUIRED), which every body carries.
export function DispositionEditor({
  slug,
  initialDisposition,
  initialNote,
  analysis,
  onSettled,
}: {
  slug: string;
  initialDisposition: string | null;
  initialNote: string | null;
  /** The analysis being decided on; its open flags and gaps form the brief. */
  analysis?: unknown;
  /** Told about every settled save (success and refusal), including the unmount flush.
   *  The host decides what to repaint; the editor's own state is unchanged by it. */
  onSettled?: (outcome: DispositionOutcome) => void;
}) {
  const t = useTranslations("report");
  const errorMessage = useErrorMessage();
  const brief = useMemo(() => decisionBrief(analysis), [analysis]);
  const [disposition, setDisposition] = useState(initialDisposition ?? "");
  const [note, setNote] = useState(initialNote ?? "");
  const [acked, setAcked] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<"ack" | "reason" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The disposition last persisted: a refused advance rolls back to it (settleDisposition),
  // and the gate never re-asks for a decision that is already stored.
  const stored = useRef(initialDisposition ?? "");
  const ackedRef = useRef(acked);
  useEffect(() => {
    ackedRef.current = acked;
  }, [acked]);
  // The note value last persisted to the server — gates the autosave + blur so we
  // don't re-PATCH an unchanged reason, and lets the debounce know there's nothing new.
  const lastSavedNote = useRef(initialNote ?? "");
  // The host callback as of the latest render, read by the unmount flush too.
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  const save = useCallback(
    async (nextDisposition: string, nextNote: string) => {
      setSaving(true);
      setSaved(false);
      setError(null);
      try {
        const r = await fetch(`/api/analyses/${encodeURIComponent(slug)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dispositionPatchBody(nextDisposition, nextNote, ackedRef.current)),
        });
        if (!r.ok) {
          const payload = (await r.json().catch(() => null)) as { code?: string } | null;
          setDisposition(settleDisposition({ attempted: nextDisposition, stored: stored.current, ok: false, code: payload?.code }));
          if (payload?.code === DISPOSITION_ACK_REQUIRED) setBlocked("ack");
          setError(errorMessage(payload, t("saveFailed")));
          onSettledRef.current?.({ ok: false, code: payload?.code ?? null, disposition: nextDisposition, note: nextNote });
          return;
        }
        stored.current = nextDisposition;
        lastSavedNote.current = nextNote;
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2000);
        onSettledRef.current?.({ ok: true, code: null, disposition: nextDisposition, note: nextNote });
      } catch {
        setError(t("saveFailed"));
        onSettledRef.current?.({ ok: false, code: null, disposition: nextDisposition, note: nextNote });
      } finally {
        setSaving(false);
      }
    },
    [slug, errorMessage, t],
  );

  const pick = (value: string) => {
    const next = disposition === value ? "" : value; // click the active one to clear
    const gate = decisionGate(brief, next, { acknowledged: acked, note, stored: stored.current });
    if (!gate.canSave) {
      // Nothing is saved or shown as picked: the brief says what the click still needs.
      setBlocked(gate.needs);
      return;
    }
    setBlocked(null);
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

  // The debounce above clears its timeout on unmount, which would CANCEL a still-pending
  // save (e.g. type a reason, then immediately close the report). Flush the latest value
  // on real unmount with a keepalive PATCH so the in-flight note survives navigation.
  const latest = useRef({ disposition, note, acked });
  useEffect(() => {
    latest.current = { disposition, note, acked };
  }, [disposition, note, acked]);
  useEffect(() => {
    return () => {
      const { disposition: d, note: n, acked: a } = latest.current;
      if (d && n !== lastSavedNote.current) {
        // The component is unmounting, so there is nobody left to tell and no
        // state left to set: a rejected keepalive PATCH (the page is closing, the
        // network died, the browser refused the beacon) must not surface as an
        // unhandled rejection in the console of a recruiter who did nothing wrong.
        // The note is a best-effort flush of something already typed on screen —
        // dropped here, and recoverable by re-opening the report and typing again.
        // A stronger promise would need the outbox, not a fetch in a cleanup.
        void fetch(`/api/analyses/${encodeURIComponent(slug)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dispositionPatchBody(d, n, a)),
          keepalive: true,
        })
          // The editor is gone, but its host (History's list) may still be on screen:
          // tell it what the flush settled so a note typed before moving on repaints.
          .then(async (r) => {
            const payload = r.ok ? null : ((await r.json().catch(() => null)) as { code?: string } | null);
            onSettledRef.current?.({ ok: r.ok, code: payload?.code ?? null, disposition: d, note: n });
          })
          .catch((err: unknown) => {
            console.warn(`[disposition] unmount flush failed for "${slug}"`, err);
          });
      }
    };
  }, [slug]);

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
        {error ? <span className="text-sm text-coral">{error}</span> : null}
      </div>
      {brief.openWarns.length > 0 ? (
        <fieldset className="mt-2 space-y-1">
          <legend className="text-meta text-steel">{t("decisionOpenFlags")}</legend>
          {brief.openWarns.map((w) => (
            <Checkbox
              key={w}
              label={<span className="font-normal">{w}</span>}
              checked={acked.includes(w)}
              invalid={blocked === "ack" && !acked.includes(w)}
              onChange={(e) => {
                const on = e.target.checked;
                setAcked((prev) => (on ? [...prev, w] : prev.filter((x) => x !== w)));
              }}
            />
          ))}
        </fieldset>
      ) : null}
      {brief.missing.length > 0 ? (
        <p className="mt-2 text-sm text-steel">{t("decisionMissing", { skills: brief.missing.join(", ") })}</p>
      ) : null}
      {blocked ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-coral">
          {t(blocked === "ack" ? "decisionAckNeeded" : "decisionReasonNeeded")}
        </p>
      ) : null}
      {disposition || blocked === "reason" ? (
        <TextArea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (disposition && note !== lastSavedNote.current) void save(disposition, note);
          }}
          rows={2}
          placeholder={t("notePlaceholder")}
          sizeVariant="sm"
          className="mt-2"
        />
      ) : null}
    </div>
  );
}
