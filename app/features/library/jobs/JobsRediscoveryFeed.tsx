"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRediscoveryFeedLogic } from "./jobsRediscoveryFeedLogic";
import { JobsRediscoveryFeedRow } from "./JobsRediscoveryFeedRow";

// Standing silver-medalist feed (idea-fdb45cd0). Rediscovery used to be a button
// a recruiter had to remember to click per role; this surfaces the hits the moment
// they become true — raised on publish, re-swept on demand — as a dismissable
// feed at the top of the Jobs tab. Each row is "a candidate you rejected from Role
// X clears the bar for new Role Y (78)" with one-click add-to-pipeline / dismiss.
export function RediscoveryFeed() {
  // Same localized why-now the on-demand panel tells (RediscoverPanel): reuse the exact
  // jobs.rediscover.whyNow.* keys + enums.stage resolution — never a forked copy.
  const tr = useTranslations("jobs.rediscover");
  const { t, alerts, sweeping, note, added, pending, rowError, sweep, dismiss, addToPipeline } = useRediscoveryFeedLogic();

  // Empty + loaded: render a slim bar so the recruiter can still trigger a sweep
  // after the pool changes. Hidden entirely until the first load resolves.
  if (alerts === null) return null;

  return (
    <section className="mt-4 rounded-lg border border-coral/30 bg-coral/5 p-3" aria-label={t("title")}>
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-coral" />
        <h3 className="text-base font-semibold text-ink">{t("title")}</h3>
        {alerts.length > 0 ? (
          <span className="rounded-full bg-coral px-2 py-0.5 text-meta font-semibold text-white">{alerts.length}</span>
        ) : null}
        <button
          type="button"
          onClick={sweep}
          disabled={sweeping}
          className="focus-ring ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
        >
          <RefreshCw size={13} className={sweeping ? "animate-spin" : ""} /> {sweeping ? t("sweeping") : t("refresh")}
        </button>
      </div>

      {alerts.length === 0 ? (
        <p className="mt-1.5 text-sm text-steel">{note ?? t("empty")}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-steel">{t("intro")}</p>
          {note ? <p className="mt-1 text-sm text-moss">{note}</p> : null}
          <ul className="mt-2 space-y-2">
            {alerts.map((a) => (
              <JobsRediscoveryFeedRow
                key={a.id}
                a={a}
                added={added.has(a.candidateId)}
                pending={pending.has(a.candidateId)}
                error={rowError.get(a.candidateId)}
                onAdd={() => addToPipeline(a)}
                onDismiss={() => dismiss(a.id)}
                t={t}
                tr={tr}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
