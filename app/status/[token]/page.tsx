"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  CANDIDATE_TIMELINE,
  isTerminalCandidateStatus,
  timelineIndex,
  type CandidateStatus,
} from "@/app/_lib/application-status";

type StatusView = {
  status: CandidateStatus;
  jobTitle: string | null;
  company: string | null;
  updatedAt: string | null;
  // REC-10 — false when no delivery relay is configured (no email will ever
  // arrive), so the stage copy must not say "watch your email".
  relayConfigured?: boolean;
};

// Public, token-gated candidate application-status page (idea-e76a6fb2). Shows
// where the candidate stands — received → under review → interview → offer →
// hired — without them having to email the recruiter.
export default function ApplicationStatusPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const t = useTranslations("status");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [view, setView] = useState<StatusView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/status/${token}`)
      .then((r) => r.json())
      .then((p) => {
        if (p.error) throw new Error(p.error);
        setView(p as StatusView);
      })
      .catch(() => setError(t("loadFailed")));
  }, [token, t]);

  // Literal-key lookups for the 5 happy-path steps (next-intl's `t` rejects
  // template-literal keys), read by the timeline loop below via the step value.
  const stepLabels: Record<string, string> = {
    received: t("steps.received"),
    under_review: t("steps.under_review"),
    interview: t("steps.interview"),
    offer: t("steps.offer"),
    hired: t("steps.hired"),
  };
  // "Watch your email" is only promised when a relay can actually deliver one
  // (REC-10); otherwise the honest variant — the team reaches out directly.
  const emailPromised = view?.relayConfigured !== false;
  const nowText: Record<string, string> = {
    received: t("now.received"),
    under_review: t("now.under_review"),
    interview: emailPromised ? t("now.interview") : t("now.interviewNoEmail"),
    offer: emailPromised ? t("now.offer") : t("now.offerNoEmail"),
    hired: t("now.hired"),
  };

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <p className="text-meta uppercase tracking-wide text-coral">{t("eyebrow")}</p>
      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-stone-200 bg-paper p-4 text-body text-steel">
          {error}
        </p>
      ) : !view ? (
        <p className="mt-4 text-base text-steel">{tCommon("loading")}</p>
      ) : (
        <>
          <h1 className="mt-1 font-serif text-display text-ink">
            {view.jobTitle ? t("forRole", { role: view.jobTitle }) : t("forRoleGeneric")}
          </h1>
          {view.company ? <p className="mt-1 text-body text-steel">{view.company}</p> : null}

          {isTerminalCandidateStatus(view.status) && view.status !== "hired" ? (
            <div
              role="status"
              className="mt-6 rounded-lg border border-stone-200 bg-paper p-5"
            >
              <p className="font-serif text-h3 text-ink">
                {view.status === "not_selected" ? t("notSelectedTitle") : t("withdrawnTitle")}
              </p>
              <p className="mt-2 text-body text-steel">
                {view.status === "not_selected" ? t("notSelectedBody") : t("withdrawnBody")}
              </p>
            </div>
          ) : (
            <>
              <ol className="mt-6 space-y-3" role="list">
                {CANDIDATE_TIMELINE.map((step, i) => {
                  const reached = i <= timelineIndex(view.status);
                  const current = i === timelineIndex(view.status);
                  return (
                    <li key={step} className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-semibold ${
                          reached ? "border-moss bg-moss text-white" : "border-stone-300 bg-white text-steel"
                        }`}
                      >
                        {reached ? <Check size={14} /> : i + 1}
                      </span>
                      <div>
                        <p className={`text-body font-semibold ${current ? "text-ink" : reached ? "text-steel" : "text-stone-400"}`}>
                          {stepLabels[step]}
                        </p>
                        {current ? <p className="mt-0.5 text-base text-steel">{nowText[step]}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}

          {view.updatedAt ? (
            <p className="mt-6 text-meta text-steel">
              {t("updated", {
                date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(view.updatedAt)),
              })}
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
