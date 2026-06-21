"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { buildTabSwitchUrl } from "@/app/features/tabs";
import { ChainEmptyState } from "@/app/_components/ChainEmptyState";
import { CompletionCta } from "@/app/_components/CompletionCta";
import { Skeleton } from "@/app/_components/Skeleton";
import { useTasks, useTaskResult } from "@/app/features/tasks/TasksProvider";
import { useLiveRefresh } from "@/app/features/live-refresh";
import { AiReviewCard } from "./AiReviewCard";
import { DecisionRulesModal } from "./DecisionRulesModal";
import { ScreenWaveModal } from "./ScreenWaveModal";
import { AnalysisSummaryModal } from "./AnalysisSummaryModal";
import { Empty } from "./DecisionsShared";
import { GroupEvalModal, type GroupEvalPayload } from "./GroupEvalModal";
import { RoleDecisionRow } from "./RoleDecisionRow";
import type { Entry } from "./DecisionsTypes";

type Group = { roleKey: string; roleTitle: string; jobId: string | null; entries: Entry[] };

// idea-e43fa801 — an auto-rejected candidate a recruiter can put back for review.
type ReconsiderRow = {
  id: string;
  candidateLabel: string;
  jobTitle: string | null;
  archetype: string | null;
  matchScore: number | null;
  rejectedAt: string | null;
};

const roleKeyOf = (e: Entry) => e.jobId ?? e.jobTitle ?? "unassigned";

export function DecisionsTab() {
  const router = useRouter();
  const search = useSearchParams();
  const t = useTranslations("decisions");
  const locale = useLocale(); // PREP2 — prep pack language
  const { startTask } = useTasks();
  // Filter the queue to one opened JD (deep-linkable via ?job=<id>).
  const [jobFilter, setJobFilter] = useState<string | null>(search.get("job"));
  const [rulesOpen, setRulesOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<Record<string, "accept" | "reject" | "approve_event">>({});
  // Candidates whose screening was accepted THIS sitting — accepting silently
  // queues them on Schedule (approvalKind flips to "calendar" server-side), so
  // the banner below narrates the handoff and offers the jump. Session-local on
  // purpose: it is a "what just happened" trail, not a persistent inbox.
  const [queuedLabels, setQueuedLabels] = useState<string[]>([]);

  // Modal + group-eval state
  const [summaryEntry, setSummaryEntry] = useState<Entry | null>(null);
  // The role whose screening wave (DEC1/DEC2) is open — jobId + title for the modal.
  const [waveRole, setWaveRole] = useState<{ jobId: string; title: string } | null>(null);
  const [evalRole, setEvalRole] = useState<{ roleKey: string; roleTitle: string } | null>(null);
  // Governance mode for the next group evaluation (P1-3). "recommendation" keeps the
  // AI-picks-a-lead default; "committee" / "eligibility_list" make the AI advisory.
  const [evalMode, setEvalMode] = useState<"recommendation" | "committee" | "eligibility_list">("recommendation");
  const [evalData, setEvalData] = useState<GroupEvalPayload | null>(null);
  const [evalCreatedAt, setEvalCreatedAt] = useState<string | null>(null);
  const [evalTaskId, setEvalTaskId] = useState<string | null>(null);
  // Set when a role marked "evaluated" has an unreadable/missing saved payload, so the modal
  // shows an honest "couldn't load — re-run" instead of the misleading "no evaluation yet".
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evaluated, setEvaluated] = useState<Record<string, string>>({});

  // idea-e43fa801 — the reconsider (auto-rejected) queue, loaded alongside the
  // pending queue and refreshed on the same signals.
  const [reconsider, setReconsider] = useState<ReconsiderRow[]>([]);
  const [reinstating, setReinstating] = useState<ReadonlySet<string>>(new Set());

  const load = () =>
    fetch("/api/pipeline")
      .then((r) => r.json())
      .then((p) => {
        if (p.error) throw new Error(p.error);
        setEntries((p.entries as Entry[]) ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("loadFailed")));
  const loadReconsider = () =>
    fetch("/api/decisions/reconsider")
      .then((r) => r.json())
      .then((p) => setReconsider((p.items as ReconsiderRow[]) ?? []))
      .catch(() => undefined);
  useEffect(() => {
    load();
    loadReconsider();
  }, []);
  useLiveRefresh(() => {
    load();
    loadReconsider();
  }); // live-update both queues when the simulation / automation acts

  const reinstate = async (item: ReconsiderRow) => {
    setReinstating((s) => new Set(s).add(item.id));
    try {
      const r = await fetch(`/api/pipeline/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reinstate" }),
      });
      if (r.ok) {
        setReconsider((cur) => cur.filter((x) => x.id !== item.id));
        load(); // the candidate is back in the active pipeline at Screened
      }
    } finally {
      setReinstating((s) => {
        const n = new Set(s);
        n.delete(item.id);
        return n;
      });
    }
  };
  const fmtDate = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));

  const pending = (entries ?? []).filter((e) => e.approvalKind && e.status === "active");
  const keyDecisions = pending.filter((e) => e.approvalKind === "decision");
  const aiReviews = pending.filter(
    (e) =>
      e.approvalKind === "screening_review" ||
      e.approvalKind === "scorecard_review" ||
      e.approvalKind === "rejection_review" ||
      e.approvalKind === "offer_review"
  );

  // Distinct roles (opened JDs) with pending decisions, for the filter dropdown.
  const jobOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of pending) map.set(roleKeyOf(e), e.jobTitle ?? t("unassignedRole"));
    return [...map.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);
  // If the active filter no longer matches any pending role, fall back to all.
  const activeFilter = jobFilter && jobOptions.some((o) => o.key === jobFilter) ? jobFilter : null;
  const matchesFilter = (e: Entry) => !activeFilter || roleKeyOf(e) === activeFilter;
  const visibleAiReviews = aiReviews.filter(matchesFilter);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const e of keyDecisions) {
      const roleKey = roleKeyOf(e);
      if (!map.has(roleKey)) map.set(roleKey, { roleKey, roleTitle: e.jobTitle ?? t("unassignedRole"), jobId: e.jobId, entries: [] });
      map.get(roleKey)!.entries.push(e);
    }
    return [...map.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);
  const roleKeys = groups.map((g) => g.roleKey).join(",");
  const visibleGroups = groups.filter((g) => !activeFilter || g.roleKey === activeFilter);

  // Which roles already have a saved evaluation (toggles the button label).
  useEffect(() => {
    if (!roleKeys) return;
    fetch(`/api/decisions/group-eval?roles=${encodeURIComponent(roleKeys)}`)
      .then((r) => r.json())
      .then((p) => setEvaluated(p.evaluated ?? {}))
      .catch(() => undefined);
  }, [roleKeys]);

  // Watch the group-eval background task; its result is fetched on demand once it
  // finishes (the poll omits the blob). Completion is consumed DURING render
  // (guarded: the task id is cleared in the same pass, so this runs once per
  // task) — the guarded render-phase pattern instead of an effect round-trip.
  const { status: evalStatus, full: evalFull } = useTaskResult(evalTaskId);
  if (evalTaskId && evalStatus === "succeeded" && evalFull) {
    setEvalData((evalFull.result as GroupEvalPayload) ?? null);
    setEvalTaskId(null);
    if (evalRole) setEvaluated((s) => ({ ...s, [evalRole.roleKey]: new Date().toISOString() }));
  } else if (evalTaskId && (evalStatus === "failed" || evalStatus === "canceled" || evalStatus === "interrupted")) {
    setEvalTaskId(null);
  }

  const act = async (e: Entry, action: "accept" | "reject" | "approve_event", detail?: string) => {
    setResolving((s) => ({ ...s, [e.id]: action }));
    window.setTimeout(() => setEntries((prev) => (prev ? prev.filter((x) => x.id !== e.id) : prev)), 260);
    try {
      const note = detail?.trim();
      const r = await fetch(`/api/pipeline/${e.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // expectedStage pins the decision to the snapshot this card/modal was
        // rendered from (idea-84392364): the queue live-refreshes while the
        // analysis modal can stay open across a state change, so a stale
        // Advance/Reject now gets a 409 (and the catch below reloads the fresh
        // queue) instead of blindly overriding what another actor did.
        // An optional reason (DEC4) rides as `detail` → recorded on the
        // advanced/rejected event → shown in the Decision Log.
        body: JSON.stringify({ action, expectedStage: e.stage, ...(note ? { detail: note } : {}) }),
      });
      if (!r.ok) throw new Error();
      // Accepting an AI screening flows the candidate to interview scheduling —
      // generate their interview-prep artifact in the background so it's ready
      // when the interviewer opens it from the Schedule tab.
      if (action === "accept" && e.approvalKind === "screening_review") {
        void startTask("interview_prep", {
          entryId: e.id,
          candidateLabel: e.candidateLabel,
          jobTitle: e.jobTitle,
          lang: locale,
        });
        setQueuedLabels((prev) => [...prev, e.candidateLabel]);
      }
    } catch {
      load();
      setResolving((s) => {
        const n = { ...s };
        delete n[e.id];
        return n;
      });
    }
  };

  const openGroupEval = async (g: Group, rerun = false) => {
    setEvalRole({ roleKey: g.roleKey, roleTitle: g.roleTitle });
    setEvalData(null);
    setEvalCreatedAt(null);
    setEvalTaskId(null);
    setEvalError(null);
    if (evaluated[g.roleKey] && !rerun) {
      const p = await fetch(`/api/decisions/group-eval?role=${encodeURIComponent(g.roleKey)}`)
        .then((r) => r.json())
        .catch(() => null);
      const payload = (p?.evaluation?.payload as GroupEvalPayload) ?? null;
      // The role is marked evaluated but the stored eval is unreadable/missing (parse failed,
      // or removed between the list and this read). Surface an error so the modal doesn't fall
      // through to "No evaluation yet" for a role its own button promised had one.
      if (!payload) {
        setEvalError(t("evalLoadFailed"));
        return;
      }
      setEvalData(payload);
      setEvalCreatedAt((p?.evaluation?.createdAt as string) ?? null);
      return;
    }
    const candidates = g.entries.map((e) => ({ entryId: e.id, candidateId: e.candidateId, label: e.candidateLabel, matchScore: e.matchScore }));
    const started = await startTask("group_eval", { roleKey: g.roleKey, roleTitle: g.roleTitle, jobId: g.jobId, candidates, governanceMode: evalMode });
    if (started) setEvalTaskId(started.id);
  };

  const decide = (e: Entry, action: "accept" | "reject", detail?: string) => {
    setSummaryEntry(null);
    void act(e, action, detail);
  };

  const leavingWrapClass = (e: Entry) =>
    resolving[e.id]
      ? "transition-all duration-200 ease-in pointer-events-none -translate-x-2 scale-[0.98] opacity-0"
      : "transition-all duration-200 ease-in";

  const evalGroup = evalRole ? groups.find((g) => g.roleKey === evalRole.roleKey) ?? null : null;

  // Pool drift: how many candidates were added/removed from this role's pending
  // pool since the cached evaluation ran. Compared by label against the pre-cap
  // set the eval was computed over, so a stale comparison prompts a re-run.
  const evalDrift = (() => {
    if (!evalData?.evaluatedLabels || !evalGroup) return 0;
    const evaluatedSet = new Set(evalData.evaluatedLabels);
    const currentSet = new Set(evalGroup.entries.map((e) => e.candidateLabel));
    let changed = 0;
    for (const l of evaluatedSet) if (!currentSet.has(l)) changed += 1;
    for (const l of currentSet) if (!evaluatedSet.has(l)) changed += 1;
    return changed;
  })();

  return (
    <div data-sim="decisions" className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
          <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
          <p className="mt-1 max-w-2xl text-body text-steel">
            {t.rich("intro", {
              schedule: (chunks) => (
                <button
                  type="button"
                  onClick={() => router.push(buildTabSwitchUrl("schedule", search.toString()))}
                  className="focus-ring font-semibold text-coral hover:underline"
                >
                  {chunks}
                </button>
              ),
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {jobOptions.length > 1 ? (
            <select
              value={activeFilter ?? ""}
              onChange={(e) => setJobFilter(e.target.value || null)}
              className="focus-ring rounded-md border border-stone-200 bg-white px-2.5 py-1 text-sm text-ink"
              title={t("filterTitle")}
            >
              <option value="">{t("allRoles", { count: pending.length })}</option>
              {jobOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label} ({pending.filter((e) => roleKeyOf(e) === o.key).length})
                </option>
              ))}
            </select>
          ) : null}
          <select
            value={evalMode}
            onChange={(e) => setEvalMode(e.target.value as typeof evalMode)}
            className="focus-ring rounded-md border border-stone-200 bg-white px-2.5 py-1 text-sm text-ink"
            title={t("govModeTitle")}
          >
            <option value="recommendation">{t("govRecommendation")}</option>
            <option value="committee">{t("govCommittee")}</option>
            <option value="eligibility_list">{t("govEligibility")}</option>
          </select>
          <span className="rounded-md border border-stone-200 bg-paper px-2.5 py-1 text-sm text-steel">
            {t("pending", {
              count: activeFilter
                ? visibleAiReviews.length + visibleGroups.reduce((n, g) => n + g.entries.length, 0)
                : pending.length,
            })}
          </span>
          <button
            type="button"
            onClick={() => setRulesOpen(true)}
            title={t("rulesTitle")}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1 text-sm font-semibold text-steel hover:bg-stone-50"
          >
            <SlidersHorizontal size={13} /> {t("rulesButton")}
          </button>
        </div>
      </header>

      {/* Forward handoff (Decisions → Schedule): accepting a screening queues
          the candidate for slot-picking on Schedule with no visible trace here —
          this band says what happened and where the work continues. */}
      {queuedLabels.length > 0 ? (
        <CompletionCta
          message={t("queuedBanner", { count: queuedLabels.length, name: queuedLabels[queuedLabels.length - 1] })}
          links={[{ label: t("queuedBannerCta"), tab: "schedule" }]}
          onDismiss={() => setQueuedLabels([])}
          dismissLabel={t("queuedDismiss")}
        />
      ) : null}

      {error ? (
        <p role="alert" aria-live="assertive" className="rounded-md bg-red-50 p-3 text-base text-red-700">
          {error}
        </p>
      ) : entries == null ? (
        <div aria-busy="true" aria-label={t("loading")} className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ) : pending.length === 0 ? (
        // Caught-up is closure, not a dead-end: point at where the work
        // continues (slots waiting on Schedule, the live board).
        <ChainEmptyState
          icon={Check}
          title={t("caughtUpTitle")}
          body={t("caughtUpBody")}
          links={[
            { tab: "schedule", label: t("caughtUpCtaSchedule") },
            { tab: "pipeline", label: t("caughtUpCtaPipeline") },
          ]}
        />
      ) : (
        <div className="space-y-6">
          {visibleAiReviews.length > 0 ? (
            <section>
              <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
                <Sparkles size={13} className="text-coral" /> {t("aiRecommendations")} <span className="text-coral">· {visibleAiReviews.length}</span>
              </h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleAiReviews.map((e) => (
                  <div key={e.id} data-sim-entry={e.id} className={leavingWrapClass(e)}>
                    <AiReviewCard entry={e} onAccept={() => act(e, "accept")} onReject={() => act(e, "reject")} />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h3 className="text-meta uppercase tracking-wide text-steel">
              {t("keyDecisions")} <span className="text-coral">· {visibleGroups.length}</span>
            </h3>
            <p className="mt-1 text-sm text-steel">{t("keyDecisionsHelp")}</p>
            <div className="mt-3 space-y-3">
              {visibleGroups.map((g) => (
                <RoleDecisionRow
                  key={g.roleKey}
                  roleTitle={g.roleTitle}
                  entries={g.entries}
                  evaluated={Boolean(evaluated[g.roleKey])}
                  busy={evalTaskId !== null && evalRole?.roleKey === g.roleKey}
                  onCandidate={setSummaryEntry}
                  onGroupEval={() => openGroupEval(g)}
                  onScreenWave={g.jobId ? () => setWaveRole({ jobId: g.jobId as string, title: g.roleTitle }) : undefined}
                />
              ))}
              {visibleGroups.length === 0 ? <Empty>{t("noKeyDecisions")}</Empty> : null}
            </div>
          </section>
        </div>
      )}

      {/* idea-e43fa801 — the safety valve over irreversible auto-rejection. Always
          available (even when caught up), collapsed by default so it doesn't
          compete with the live decision queue. */}
      {reconsider.length > 0 ? (
        <details className="rounded-lg border border-stone-200 bg-paper/40">
          <summary className="focus-ring flex cursor-pointer items-center gap-1.5 px-4 py-2.5 text-meta uppercase tracking-wide text-steel">
            <RotateCcw size={13} className="text-coral" /> {t("reconsiderTitle", { count: reconsider.length })}
          </summary>
          <div className="space-y-2 px-4 pb-3">
            <p className="text-sm text-steel">{t("reconsiderHelp")}</p>
            <ul className="space-y-1.5">
              {reconsider.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-stone-100 bg-white px-3 py-2 text-sm"
                >
                  <span className="font-semibold text-ink">{item.candidateLabel}</span>
                  {item.jobTitle ? <span className="text-steel">· {item.jobTitle}</span> : null}
                  {item.matchScore != null ? (
                    <span className="text-stone-400">· {t("reconsiderMatch", { score: item.matchScore })}</span>
                  ) : null}
                  {item.rejectedAt ? (
                    <span className="text-stone-400">· {t("reconsiderRejected", { date: fmtDate(item.rejectedAt) })}</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void reinstate(item)}
                    disabled={reinstating.has(item.id)}
                    className="focus-ring ml-auto rounded-md border border-coral/40 bg-white px-2.5 py-1 text-sm font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
                  >
                    {reinstating.has(item.id) ? t("reinstating") : t("reinstate")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}

      {summaryEntry ? (
        <AnalysisSummaryModal
          entry={summaryEntry}
          onClose={() => setSummaryEntry(null)}
          onAccept={(reason) => decide(summaryEntry, "accept", reason)}
          onReject={(reason) => decide(summaryEntry, "reject", reason)}
        />
      ) : null}

      {evalRole ? (
        <GroupEvalModal
          roleTitle={evalRole.roleTitle}
          evaluation={evalData}
          loading={evalTaskId !== null}
          error={evalError}
          createdAt={evalCreatedAt}
          poolDrift={evalDrift}
          onClose={() => {
            setEvalRole(null);
            setEvalData(null);
            setEvalCreatedAt(null);
            setEvalTaskId(null);
            setEvalError(null);
          }}
          onRerun={() => evalGroup && openGroupEval(evalGroup, true)}
          onDecide={(identity, action) => {
            // Resolve the eval candidate back to the live pipeline entry by stable id
            // (candIdentity = entry id, label fallback), then reuse act() — same
            // expectedStage CAS + comms as the queue. Resolving by id prevents an
            // irreversible advance/reject from landing on the wrong same-named candidate;
            // the label fallback keeps evals saved before entryId existed working. Acts
            // only on still-pending entries (a candidate decided elsewhere has left
            // evalGroup.entries).
            const e =
              evalGroup?.entries.find((x) => x.id === identity) ??
              evalGroup?.entries.find((x) => x.candidateLabel === identity);
            // Report back whether we found a live entry: a candidate who already left
            // the pool returns false so the modal won't show a fake "Advanced/Rejected".
            if (!e) return false;
            void act(e, action);
            return true;
          }}
        />
      ) : null}

      {rulesOpen ? <DecisionRulesModal onClose={() => setRulesOpen(false)} /> : null}

      {waveRole ? (
        <ScreenWaveModal
          jobId={waveRole.jobId}
          roleTitle={waveRole.title}
          onClose={() => setWaveRole(null)}
          onCommitted={load}
        />
      ) : null}
    </div>
  );
}
