"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Check, ShieldCheck, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { Skeleton } from "@/app/_components/Skeleton";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";

type DataView = {
  jobTitle: string | null;
  company: string | null;
  appliedAt: string | null;
  consentExpiresAt: string | null;
  anonymized: boolean;
  // #5 — the categories we actually hold, projected server-side; falls back to the
  // full known set for defensiveness if an older API omits it.
  held?: string[];
};

/** A load failure is one of two things, and the page must not confuse them: the
 *  LINK is gone (404 — nothing to retry), or our side blinked (5xx, a dropped
 *  connection — the erasure request is still available and a retry is the point). */
type LoadFailure = "dead" | "retryable";

/** Authoritative re-read after a failed erase POST. The erasure token is NULLed by
 *  anonymizeEntry, so a 404 here means the scrub already ran (in another tab, or on
 *  a request that landed before the connection dropped) — as does an entry that
 *  reports `anonymized`. False keeps the inline error so the candidate can retry. */
async function confirmErased(token: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/data/${token}`);
    if (r.status === 404) return true;
    const p = (await r.json().catch(() => ({}))) as Partial<DataView>;
    return r.ok && p.anonymized === true;
  } catch {
    return false;
  }
}

// Public, token-gated GDPR self-service page (right to erasure). The candidate
// opens it from the "manage your data" footer on any of our emails: it shows what
// we hold and lets them erase their personal data — PII is scrubbed while the
// de-identified recruitment record is retained (explained in plain language).
export function DataClient() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const t = useTranslations("data");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const errMsg = useErrorMessage();
  const [view, setView] = useState<DataView | null>(null);
  // #4 — load failure and erase-action failure are DISTINCT states. A load error is
  // terminal (nothing to show); an erase error is a dismissible inline alert beside the
  // (re-enabled) button so the candidate can retry without losing the whole page.
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const [eraseError, setEraseError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erased, setErased] = useState(false);

  // `loadFailed` is DEAD-LINK copy ("This link has expired or is no longer valid"),
  // which is the truth for a 404 and a lie for a 5xx or a dropped connection —
  // and a lie that closes the door on the candidate's Art. 17 request, since a
  // "expired" link reads as nothing left to retry. The store's own
  // DATA_LOOKUP_FAILED message is already localized in all four catalogs
  // (safeJsonError returns that code), so the retryable half needs no new copy.
  // A plain string, computed at render: `errMsg` is a fresh closure each render
  // and must never enter an effect's dependency list.
  const loadRetryMessage = errMsg({ code: "DATA_LOOKUP_FAILED" }, t("loadFailed"));

  // The load is a callback so the retry button can re-run exactly it (the offer
  // door's shape). Only the FAILURE KIND is stored here; the message is resolved
  // at render, keeping `errMsg` out of every dependency list.
  const load = useCallback(async (): Promise<{ failure: LoadFailure } | { view: DataView }> => {
    if (!token) return { failure: "retryable" };
    try {
      const r = await fetch(`/api/data/${token}`);
      const p = (await r.json().catch(() => ({}))) as Partial<DataView> & { error?: string };
      // Only a 404 means the link itself is dead; everything else is transient.
      if (r.status === 404) return { failure: "dead" };
      if (!r.ok || p.error) return { failure: "retryable" };
      return { view: p as DataView };
    } catch {
      return { failure: "retryable" };
    }
  }, [token]);

  useEffect(() => {
    let alive = true;
    void load().then((r) => {
      if (!alive) return;
      if ("view" in r) setView(r.view);
      else setLoadFailure(r.failure);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  // Retry: clear the error and show the loading skeleton immediately (a synchronous
  // set is fine in an event handler), then refetch. Offered ONLY for `retryable` —
  // a retry button over a link that 404s is a loop with no exit.
  const retryLoad = () => {
    setLoadFailure(null);
    void load().then((r) => {
      if ("view" in r) setView(r.view);
      else setLoadFailure(r.failure);
    });
  };

  const erase = async () => {
    if (!token) return;
    setBusy(true);
    setEraseError(null); // clear a prior failure so a retry starts clean
    try {
      const res = await fetch(`/api/data/${token}`, { method: "POST" });
      const p = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || p.error) throw new Error("erase failed");
      setErased(true);
    } catch {
      // The erasure token is nulled on the FIRST scrub, so an erase that already
      // landed — in a second tab open on the same link, or on a request whose
      // response was lost — makes this and every retry 404. Reporting that as
      // "could not complete the erasure" tells a candidate their data is still held
      // when it is already gone, and no retry can ever clear it. Re-read the
      // authoritative state first (the offer page's reconcile), and only surface the
      // error when the entry really is still there.
      if (await confirmErased(token)) {
        setErased(true);
        return;
      }
      // #4 — surface the failure inline; DON'T collapse the page, so the erase button
      // stays available for an in-place retry.
      setEraseError(t("eraseFailed"));
    } finally {
      setBusy(false);
    }
  };

  const heldLabel: Record<string, string> = {
    cv: t("held.cv"),
    contact: t("held.contact"),
    answers: t("held.answers"),
    interview: t("held.interview"),
    scores: t("held.scores"),
  };
  // #5 — render only the categories the API says we actually hold; defensively fall
  // back to the full known set if the field is absent, and drop any unknown key.
  const held = (view?.held ?? Object.keys(heldLabel)).filter((h) => h in heldLabel);

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      {/* The candidate's own escape hatch, mirroring the offer and status doors:
          the "manage your data" link is ?lang=-pinned to the language of the LETTER
          it rode on, but a forwarded link or a stale NEXT_LOCALE cookie can still
          land them in a language they don't read — and an erasure explainer is a
          legal affordance, the last page that should be unreadable. */}
      <div className="mb-4 flex justify-end">
        <LanguageSwitcher />
      </div>
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
        <ShieldCheck size={14} /> {t("eyebrow")}
      </p>

      {/* #5 — a STABLE page heading rendered in every state (loading, load-error,
          erased, active), so a screen-reader user never lands on a headingless page.
          The role-specific title lives here at the root rather than only inside the
          active branch. */}
      <h1 className="mt-1 font-serif text-display text-ink">
        {view?.jobTitle ? t("forRole", { role: view.jobTitle }) : t("forRoleGeneric")}
      </h1>

      {loadFailure ? (
        <div role="alert" className="mt-4 rounded-lg border border-stone-200 bg-paper p-4">
          <p className="text-body text-steel">{loadFailure === "dead" ? t("loadFailed") : loadRetryMessage}</p>
          {/* Retryable only. The copy already promises a retry is worth making;
              until now the page offered no way to make one. */}
          {loadFailure === "retryable" ? (
            <button type="button" onClick={retryLoad} className={`${BTN_SECONDARY} mt-3 h-11 px-4`}>
              {tCommon("retry")}
            </button>
          ) : null}
        </div>
      ) : !view ? (
        // Skeleton mirroring the loaded page's shape (the offer door's treatment)
        // so the first paint reserves its height instead of a bare line that
        // visibly reflows into a full page (CLS).
        <div className="mt-6 space-y-6" aria-busy="true" aria-label={tCommon("loading")}>
          <div className="space-y-2 rounded-lg border border-stone-200 bg-paper p-5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/5" />
          </div>
          <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-5">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-11 w-48 rounded-md" />
          </div>
        </div>
      ) : erased || view.anonymized ? (
        <div role="status" className="mt-6 rounded-lg border border-moss/40 bg-moss/5 p-5">
          <p className="flex items-center gap-2 font-serif text-h3 text-ink">
            <Check size={18} className="text-moss" /> {t("erasedTitle")}
          </p>
          <p className="mt-2 text-body text-steel">{t("erasedBody")}</p>
        </div>
      ) : (
        <>
          {view.company ? <p className="mt-1 text-body text-steel">{view.company}</p> : null}

          <div className="mt-6 rounded-lg border border-stone-200 bg-paper p-5">
            <p className="text-meta uppercase tracking-wide text-steel">{t("heldTitle")}</p>
            <ul className="mt-2 space-y-1.5" role="list">
              {held.map((h) => (
                <li key={h} className="flex items-start gap-2 text-body text-ink">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-steel" />
                  {heldLabel[h]}
                </li>
              ))}
            </ul>
            {view.appliedAt ? (
              <p className="mt-3 text-meta text-steel">
                {t("appliedOn", {
                  date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(view.appliedAt)),
                })}
              </p>
            ) : null}
          </div>

          <div className="mt-6 rounded-lg border border-stone-200 bg-white p-5">
            <p className="font-serif text-h3 text-ink">{t("eraseTitle")}</p>
            <p className="mt-2 text-body text-steel">{t("eraseExplainer")}</p>
            {confirming ? (
              <EraseConfirm busy={busy} onCancel={() => setConfirming(false)} onConfirm={erase} />
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className={`${BTN_SECONDARY} mt-4 h-11 px-4`}
              >
                <Trash2 size={15} /> {t("eraseCta")}
              </button>
            )}
            {/* #4 — erase failure is an inline, dismissible alert beside the still-
                available button (page intact), so the candidate can retry in place. */}
            {eraseError ? (
              <p role="alert" className="mt-3 text-body text-red-700">
                {eraseError}
              </p>
            ) : null}
          </div>
        </>
      )}
    </main>
  );
}

/**
 * The erasure confirm. Erasure is IRREVERSIBLE and this is a public page a
 * candidate reaches from an email footer, so it is a real `alertdialog`, not the
 * plain `<div>` of two buttons it used to be:
 *  - `useDialogA11y` (the same hook Modal and the drawers use) moves focus inside
 *    on open, traps Tab, closes on Escape and restores focus to the trigger;
 *  - Cancel is FIRST in the DOM, so the hook's "focus the first focusable" lands a
 *    keyboard user on the safe option, and the destructive button is last — the
 *    offer door's decline confirm, which had this right already;
 *  - it is its own component so the hook mounts/unmounts with the dialog rather
 *    than running for the life of the page.
 */
function EraseConfirm({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const t = useTranslations("data");
  const ref = useRef<HTMLDivElement>(null);
  // Escape must not close the dialog mid-write: the POST is already irreversible
  // and a vanished dialog would leave no place for its result.
  useDialogA11y(ref, () => {
    if (!busy) onCancel();
  });
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="erase-confirm-title"
      aria-describedby="erase-confirm-desc"
      className="mt-4 rounded-lg border border-coral/30 bg-coral/5 p-4"
    >
      <p id="erase-confirm-title" className="text-base font-semibold text-ink">
        {t("confirmTitle")}
      </p>
      <p id="erase-confirm-desc" className="mt-0.5 text-body text-steel">
        {t("confirmBody")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className={`${BTN_SECONDARY} h-11 px-4`}>
          {t("cancel")}
        </button>
        <button type="button" onClick={onConfirm} disabled={busy} aria-busy={busy} className={`${BTN_PRIMARY} h-11 px-4`}>
          <Trash2 size={15} /> {busy ? t("erasing") : t("eraseConfirm")}
        </button>
      </div>
    </div>
  );
}
