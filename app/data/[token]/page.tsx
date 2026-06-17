"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, ShieldCheck, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

type DataView = {
  jobTitle: string | null;
  company: string | null;
  appliedAt: string | null;
  consentExpiresAt: string | null;
  anonymized: boolean;
};

// Public, token-gated GDPR self-service page (right to erasure). The candidate
// opens it from the "manage your data" footer on any of our emails: it shows what
// we hold and lets them erase their personal data — PII is scrubbed while the
// de-identified recruitment record is retained (explained in plain language).
export default function DataPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const t = useTranslations("data");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [view, setView] = useState<DataView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erased, setErased] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/data/${token}`)
      .then((r) => r.json())
      .then((p) => {
        if (p.error) throw new Error(p.error);
        setView(p as DataView);
      })
      .catch(() => setError(t("loadFailed")));
  }, [token, t]);

  const erase = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/data/${token}`, { method: "POST" });
      const p = await res.json();
      if (p.error) throw new Error(p.error);
      setErased(true);
    } catch {
      setError(t("eraseFailed"));
    } finally {
      setBusy(false);
    }
  };

  const held = ["cv", "contact", "answers", "interview", "scores"] as const;
  const heldLabel: Record<string, string> = {
    cv: t("held.cv"),
    contact: t("held.contact"),
    answers: t("held.answers"),
    interview: t("held.interview"),
    scores: t("held.scores"),
  };

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
        <ShieldCheck size={14} /> {t("eyebrow")}
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-stone-200 bg-paper p-4 text-body text-steel">
          {error}
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
          <h1 className="mt-1 font-serif text-display text-ink">
            {view.jobTitle ? t("forRole", { role: view.jobTitle }) : t("forRoleGeneric")}
          </h1>
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
          </div>
        </>
      )}
    </main>
  );
}
