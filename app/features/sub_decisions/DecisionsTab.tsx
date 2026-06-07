"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, SlidersHorizontal, Sparkles } from "lucide-react";
import { buildUrl } from "@/app/features/tabs";
import { useTasks, useTaskResult } from "@/app/features/tasks/TasksProvider";
import { useLiveRefresh } from "@/app/features/live-refresh";
import { AiReviewCard } from "./AiReviewCard";
import { DecisionRulesModal } from "./DecisionRulesModal";
import { AnalysisSummaryModal } from "./AnalysisSummaryModal";
import { Empty } from "./DecisionsShared";
import { GroupEvalModal, type GroupEvalPayload } from "./GroupEvalModal";
import { RoleDecisionRow } from "./RoleDecisionRow";
import type { Entry } from "./DecisionsTypes";

type Group = { roleKey: string; roleTitle: string; jobId: string | null; entries: Entry[] };

const roleKeyOf = (e: Entry) => e.jobId ?? e.jobTitle ?? "unassigned";

export function DecisionsTab() {
  const router = useRouter();
  const search = useSearchParams();
  const { startTask } = useTasks();
  // Filter the queue to one opened JD (deep-linkable via ?job=<id>).
  const [jobFilter, setJobFilter] = useState<string | null>(search.get("job"));
  const [rulesOpen, setRulesOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<Record<string, "accept" | "reject" | "approve_event">>({});

  // Modal + group-eval state
  const [summaryEntry, setSummaryEntry] = useState<Entry | null>(null);
  const [evalRole, setEvalRole] = useState<{ roleKey: string; roleTitle: string } | null>(null);
  const [evalData, setEvalData] = useState<GroupEvalPayload | null>(null);
  const [evalCreatedAt, setEvalCreatedAt] = useState<string | null>(null);
  const [evalTaskId, setEvalTaskId] = useState<string | null>(null);
  const [evaluated, setEvaluated] = useState<Record<string, string>>({});

  const load = () =>
    fetch("/api/pipeline")
      .then((r) => r.json())
      .then((p) => {
        if (p.error) throw new Error(p.error);
        setEntries((p.entries as Entry[]) ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load."));
  useEffect(() => {
    load();
  }, []);
  useLiveRefresh(load); // live-update the queue when the simulation acts

  const pending = (entries ?? []).filter((e) => e.approvalKind && e.status === "active");
  const keyDecisions = pending.filter((e) => e.approvalKind === "decision");
  const aiReviews = pending.filter(
    (e) => e.approvalKind === "screening_review" || e.approvalKind === "scorecard_review" || e.approvalKind === "offer_review"
  );

  // Distinct roles (opened JDs) with pending decisions, for the filter dropdown.
  const jobOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of pending) map.set(roleKeyOf(e), e.jobTitle ?? "Unassigned role");
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
      if (!map.has(roleKey)) map.set(roleKey, { roleKey, roleTitle: e.jobTitle ?? "Unassigned role", jobId: e.jobId, entries: [] });
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

  const act = async (e: Entry, action: "accept" | "reject" | "approve_event") => {
    setResolving((s) => ({ ...s, [e.id]: action }));
    window.setTimeout(() => setEntries((prev) => (prev ? prev.filter((x) => x.id !== e.id) : prev)), 260);
    try {
      const r = await fetch(`/api/pipeline/${e.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // expectedStage pins the decision to the snapshot this card/modal was
        // rendered from (idea-84392364): the queue live-refreshes while the
        // analysis modal can stay open across a state change, so a stale
        // Advance/Reject now gets a 409 (and the catch below reloads the fresh
        // queue) instead of blindly overriding what another actor did.
        body: JSON.stringify({ action, expectedStage: e.stage }),
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
        });
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
    if (evaluated[g.roleKey] && !rerun) {
      const p = await fetch(`/api/decisions/group-eval?role=${encodeURIComponent(g.roleKey)}`).then((r) => r.json());
      setEvalData((p.evaluation?.payload as GroupEvalPayload) ?? null);
      setEvalCreatedAt((p.evaluation?.createdAt as string) ?? null);
      return;
    }
    const candidates = g.entries.map((e) => ({ entryId: e.id, candidateId: e.candidateId, label: e.candidateLabel, matchScore: e.matchScore }));
    const t = await startTask("group_eval", { roleKey: g.roleKey, roleTitle: g.roleTitle, jobId: g.jobId, candidates });
    if (t) setEvalTaskId(t.id);
  };

  const decide = (e: Entry, action: "accept" | "reject") => {
    setSummaryEntry(null);
    void act(e, action);
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
          <p className="text-meta uppercase text-coral">Decisions</p>
          <h2 className="mt-1 font-serif text-display text-ink">Your decision queue</h2>
          <p className="mt-1 max-w-2xl text-body text-steel">
            The human-in-the-loop step, grouped by role. Click a candidate for their analysis summary, or run a
            group evaluation to compare a role&apos;s candidates. Interview slots live in{" "}
            <button type="button" onClick={() => router.push(buildUrl({ tab: "schedule" }, search.toString()))} className="focus-ring font-semibold text-coral hover:underline">
              Schedule
            </button>
            .
          </p>
        </div>
        <div className="flex items-center gap-2">
          {jobOptions.length > 1 ? (
            <select
              value={activeFilter ?? ""}
              onChange={(e) => setJobFilter(e.target.value || null)}
              className="focus-ring rounded-md border border-stone-200 bg-white px-2.5 py-1 text-sm text-ink"
              title="Filter decisions to one opened JD"
            >
              <option value="">All roles ({pending.length})</option>
              {jobOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label} ({pending.filter((e) => roleKeyOf(e) === o.key).length})
                </option>
              ))}
            </select>
          ) : null}
          <span className="rounded-md border border-stone-200 bg-paper px-2.5 py-1 text-sm text-steel">
            {activeFilter ? visibleAiReviews.length + visibleGroups.reduce((n, g) => n + g.entries.length, 0) : pending.length} pending
          </span>
          <button
            type="button"
            onClick={() => setRulesOpen(true)}
            title="Configure decision rules"
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1 text-sm font-semibold text-steel hover:bg-stone-50"
          >
            <SlidersHorizontal size={13} /> Rules
          </button>
        </div>
      </header>

      {error ? (
        <p role="alert" aria-live="assertive" className="rounded-md bg-red-50 p-3 text-base text-red-700">
          {error}
        </p>
      ) : entries == null ? (
        <p className="text-base text-steel">Loading…</p>
      ) : pending.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-paper p-6 text-center">
          <Check className="mx-auto text-moss" size={28} />
          <p className="mt-2 text-base font-semibold text-ink">You&apos;re all caught up.</p>
          <p className="text-sm text-steel">No decisions are waiting on you right now.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {visibleAiReviews.length > 0 ? (
            <section>
              <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
                <Sparkles size={13} className="text-coral" /> AI recommendations <span className="text-coral">· {visibleAiReviews.length}</span>
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
              Key decisions <span className="text-coral">· {visibleGroups.length}</span>
            </h3>
            <p className="mt-1 text-sm text-steel">One row per role — advance or reject from a candidate&apos;s analysis summary.</p>
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
                />
              ))}
              {visibleGroups.length === 0 ? <Empty>No key decisions pending.</Empty> : null}
            </div>
          </section>
        </div>
      )}

      {summaryEntry ? (
        <AnalysisSummaryModal
          entry={summaryEntry}
          onClose={() => setSummaryEntry(null)}
          onAccept={() => decide(summaryEntry, "accept")}
          onReject={() => decide(summaryEntry, "reject")}
        />
      ) : null}

      {evalRole ? (
        <GroupEvalModal
          roleTitle={evalRole.roleTitle}
          evaluation={evalData}
          loading={evalTaskId !== null}
          createdAt={evalCreatedAt}
          poolDrift={evalDrift}
          onClose={() => {
            setEvalRole(null);
            setEvalData(null);
            setEvalCreatedAt(null);
            setEvalTaskId(null);
          }}
          onRerun={() => evalGroup && openGroupEval(evalGroup, true)}
        />
      ) : null}

      {rulesOpen ? <DecisionRulesModal onClose={() => setRulesOpen(false)} /> : null}
    </div>
  );
}
