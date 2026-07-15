"use client";

import { useEffect, useRef, useState } from "react";
import { Check, RefreshCw, Sparkles, UserPlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { postPipelineAdd } from "@/app/_lib/useAddToPipeline";
// bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #4): the add-outcome
// transition (keep the row + badge it "Added ✓", THEN dismiss after a beat) lives in
// this pure sibling so the previously-dead success branch is reachable and testable.
import { applyAddResult, ADDED_BADGE_MS } from "./rediscovery-add";

type Alert = {
  id: string;
  jobId: string;
  jobTitle: string;
  candidateId: string;
  label: string;
  archetype: string;
  score: number;
  // `stage`/`depth` are null for legacy rows persisted before feed-tells-why — those
  // fall back to the legacy English `label`; newer rows carry the live prior shape so
  // the feed rebuilds the same localized why-now the panel renders.
  // `kind` is the closed prior union (mirrors Rediscovered.prior.kind) so the
  // whyNow.{kind} message key type-checks as an exact key, not `whyNow.${string}`.
  prior: { kind: "rejected" | "closed" | "elsewhere"; label: string; stage: string | null; depth: number | null };
};

const PRIOR_STYLE: Record<string, string> = {
  rejected: "bg-coral/10 text-coral",
  closed: "bg-dial-amber/20 text-ink",
  elsewhere: "bg-steel/10 text-steel",
};

// Standing silver-medalist feed (idea-fdb45cd0). Rediscovery used to be a button
// a recruiter had to remember to click per role; this surfaces the hits the moment
// they become true — raised on publish, re-swept on demand — as a dismissable
// feed at the top of the Jobs tab. Each row is "a candidate you rejected from Role
// X clears the bar for new Role Y (78)" with one-click add-to-pipeline / dismiss.
export function RediscoveryFeed() {
  const t = useTranslations("jobs.rediscoveryFeed");
  // Same localized why-now the on-demand panel tells (RediscoverPanel): reuse the exact
  // jobs.rediscover.whyNow.* keys + enums.stage resolution — never a forked copy.
  const tr = useTranslations("jobs.rediscover");
  const enumLabel = useEnumLabel();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [rowError, setRowError] = useState<Map<string, string>>(() => new Map());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    // Actually wire the abort: the long pool-sweep fetch now carries the controller's
    // signal, so navigating away mid-load cancels the in-flight request instead of
    // the ref's abort() being a no-op against a fetch that never received the signal.
    const controller = new AbortController();
    abortRef.current = controller;
    // Inlined (not a called helper) so the lint rule can see the setState lands in
    // an async callback AFTER the await — the allowed shape (cf. useJsonFetch).
    (async () => {
      try {
        const r = await fetch("/api/rediscovery/alerts", { signal: controller.signal });
        const body = (await r.json().catch(() => null)) as { alerts?: Alert[] } | null;
        if (!alive) return;
        setAlerts(r.ok && body?.alerts ? body.alerts : []);
      } catch {
        // An abort (unmount) is expected — only surface a genuine load failure.
        if (alive && !controller.signal.aborted) setAlerts([]);
      }
    })();
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, []);

  const sweep = async () => {
    if (sweeping) return;
    setSweeping(true);
    setNote(null);
    try {
      const r = await fetch("/api/rediscovery/alerts", { method: "POST" });
      const body = (await r.json().catch(() => null)) as
        | { alerts?: Alert[]; newAlerts?: number; jobsSwept?: number }
        | null;
      if (r.ok && body?.alerts) {
        setAlerts(body.alerts);
        setNote(
          body.jobsSwept === 0
            ? t("noPublished")
            : t("swept", { jobs: body.jobsSwept ?? 0, found: body.newAlerts ?? 0 })
        );
      } else {
        setNote(t("sweepFailed"));
      }
    } catch {
      setNote(t("sweepFailed"));
    } finally {
      setSweeping(false);
    }
  };

  const dismiss = async (id: string) => {
    // Optimistic: drop it immediately, the PATCH is fire-and-forget recovery.
    setAlerts((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
    try {
      await fetch("/api/rediscovery/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      /* the row's already gone from the view; a reload would resurface it */
    }
  };

  const addToPipeline = async (a: Alert) => {
    if (pending.has(a.candidateId) || added.has(a.candidateId)) return;
    setPending((p) => new Set(p).add(a.candidateId));
    setRowError((m) => {
      const next = new Map(m);
      next.delete(a.candidateId);
      return next;
    });
    const res = await postPipelineAdd(a.jobId, a.jobTitle, {
      candidateId: a.candidateId,
      candidateLabel: a.label,
      archetype: a.archetype,
      matchScore: a.score,
      source: "rediscovery",
    });
    setPending((p) => {
      const next = new Set(p);
      next.delete(a.candidateId);
      return next;
    });
    // bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #4): route the outcome
    // through the pure transition, then HONOR its dismiss timing. On success the row is
    // KEPT so the green "Added ✓" badge actually renders, and dismissed only after a
    // beat — pre-fix the row was filtered out in the same tick, so the badge branch was
    // unreachable dead code and the candidate vanished with no confirmation. Each slice
    // derives from the LATEST state (functional updater) so a second in-flight add of a
    // different candidate can't drop the first.
    setAdded((s) => applyAddResult({ added: s, rowError: new Map() }, a.candidateId, res).added);
    setRowError((m) => applyAddResult({ added: new Set(), rowError: m }, a.candidateId, res).rowError);
    const { dismiss: timing } = applyAddResult({ added: new Set(), rowError: new Map() }, a.candidateId, res);
    if (timing === "deferred") {
      window.setTimeout(() => dismiss(a.id), ADDED_BADGE_MS);
    }
  };

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
            {alerts.map((a) => {
              const err = rowError.get(a.candidateId);
              return (
                <li key={a.id} className="flex items-center gap-3 rounded-md border border-stone-200 bg-white px-3 py-2">
                  <span className="shrink-0">
                    <ScoreBadge score={a.score} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium text-ink">
                      {t.rich("clears", {
                        label: a.label,
                        role: a.jobTitle,
                        b: (chunks) => <span className="font-semibold">{chunks}</span>,
                      })}
                    </p>
                    {/* feed-tells-why: rows carrying the live prior shape (stage present)
                        tell the SAME localized why-now the panel does — whyNow.{kind} plus
                        the "reached {stage}" disclosure when the band-limited depth boost
                        lifted this candidate (depth > 0). Legacy rows (stage null, written
                        before the migration) fall back to the persisted English chip. */}
                    {a.prior.stage ? (
                      <p className="mt-1 text-sm leading-snug text-steel">
                        {tr(`whyNow.${a.prior.kind}`, { jobTitle: a.jobTitle, score: a.score })}
                        {(a.prior.depth ?? 0) > 0
                          ? " " + tr("whyNow.reached", { stage: enumLabel("stage", a.prior.stage) })
                          : ""}
                      </p>
                    ) : (
                      <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-meta ${PRIOR_STYLE[a.prior.kind] ?? PRIOR_STYLE.elsewhere}`}>
                        {a.prior.label}
                      </span>
                    )}
                    {err ? <span className="ml-2 text-meta text-coral">{err}</span> : null}
                  </div>
                  {added.has(a.candidateId) ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-moss">
                      <Check size={14} /> {t("added")}
                    </span>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => addToPipeline(a)}
                        disabled={pending.has(a.candidateId)}
                        className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-coral/40 bg-coral/5 px-2.5 py-1.5 text-sm font-semibold text-coral hover:bg-coral/10 disabled:opacity-50"
                      >
                        <UserPlus size={14} /> {pending.has(a.candidateId) ? t("adding") : t("addToPipeline")}
                      </button>
                      <button
                        type="button"
                        onClick={() => dismiss(a.id)}
                        title={t("dismiss")}
                        aria-label={t("dismiss")}
                        className="focus-ring inline-flex items-center rounded-md border border-stone-200 bg-white p-1.5 text-steel hover:text-ink"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
