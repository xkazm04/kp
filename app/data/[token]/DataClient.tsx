"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, ShieldCheck, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
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
  const [loadError, setLoadError] = useState<string | null>(null);
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

  useEffect(() => {
    if (!token) return;
    let alive = true;
    fetch(`/api/data/${token}`)
      .then(async (r) => {
        const p = (await r.json().catch(() => ({}))) as Partial<DataView> & { error?: string };
        if (!alive) return;
        // Only a 404 means the link itself is dead; everything else is transient.
        if (r.status === 404) {
          setLoadError(t("loadFailed"));
          return;
        }
        if (!r.ok || p.error) {
          setLoadError(loadRetryMessage);
          return;
        }
        setView(p as DataView);
      })
      .catch(() => {
        if (alive) setLoadError(loadRetryMessage);
      });
    return () => {
      alive = false;
    };
  }, [token, t, loadRetryMessage]);

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

      {loadError ? (
        <p role="alert" className="mt-4 rounded-lg border border-stone-200 bg-paper p-4 text-body text-steel">
          {loadError}
        </p>
      ) : !view ? (
        <p className="mt-4 text-base text-steel">{tCommon("loading")}</p>
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
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={erase}
                  disabled={busy}
                  className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  <Trash2 size={15} /> {busy ? t("erasing") : t("eraseConfirm")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="focus-ring inline-flex h-10 items-center justify-center rounded-md border border-stone-200 px-4 text-sm font-semibold text-steel hover:text-ink disabled:opacity-50"
                >
                  {t("cancel")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="focus-ring mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50"
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
