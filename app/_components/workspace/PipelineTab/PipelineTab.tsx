"use client";

import { useEffect, useMemo, useState } from "react";
import { Briefcase, Calendar, Check, Clock, Users, X } from "lucide-react";
import { navigate } from "../tabs";

type Entry = {
  id: string;
  candidateId: string | null;
  candidateLabel: string;
  archetype: string | null;
  roleFamily: string | null;
  jobId: string | null;
  jobTitle: string | null;
  stage: string;
  matchScore: number | null;
  status: string;
  approvalKind: string | null;
  approvalDetail: string | null;
};

const STAGES = ["Sourced", "AI-matched", "Screening", "Interview", "Offer", "Hired"];

const ARCHETYPE_STYLE: Record<string, { ring: string; bg: string; label: string }> = {
  bau: { ring: "ring-steel", bg: "bg-steel", label: "Experienced" },
  student: { ring: "ring-coral", bg: "bg-coral", label: "Student" },
  career_switcher: { ring: "ring-moss", bg: "bg-moss", label: "Switcher" },
};
const styleFor = (a: string | null) => ARCHETYPE_STYLE[a ?? "bau"] ?? ARCHETYPE_STYLE.bau;

export function PipelineTab() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<Set<string>>(new Set());

  const load = () =>
    fetch("/api/pipeline")
      .then((r) => r.json())
      .then((p) => {
        if (p.error) throw new Error(p.error);
        setEntries((p.entries as Entry[]) ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load pipeline."));
  useEffect(() => {
    load();
  }, []);

  const stageOf = (e: Entry) => e.stage;
  const positions = useMemo(() => {
    const map = new Map<string, { id: string; title: string; family: string; count: number }>();
    for (const e of entries ?? []) {
      const key = e.jobId ?? e.jobTitle ?? "?";
      if (!map.has(key)) map.set(key, { id: key, title: e.jobTitle ?? "—", family: e.roleFamily ?? "", count: 0 });
      map.get(key)!.count += 1;
    }
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [entries]);

  const approvals = (entries ?? []).filter((e) => e.approvalKind && e.status === "active");
  const activeCount = (entries ?? []).filter((e) => e.stage !== "Hired").length;
  const interviewCount = (entries ?? []).filter((e) => e.stage === "Interview").length;

  const act = async (id: string, action: "accept" | "reject" | "approve_event") => {
    setActing((s) => new Set(s).add(id));
    setEntries((prev) => {
      if (!prev) return prev;
      if (action === "reject") return prev.filter((e) => e.id !== id);
      return prev.map((e) => {
        if (e.id !== id) return e;
        if (action === "approve_event") return { ...e, stage: "Interview", approvalKind: null, approvalDetail: "" };
        const idx = STAGES.indexOf(e.stage);
        return { ...e, stage: STAGES[Math.min(idx + 1, STAGES.length - 1)], approvalKind: null, approvalDetail: "" };
      });
    });
    try {
      const r = await fetch(`/api/pipeline/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!r.ok) throw new Error();
    } catch {
      load(); // resync on failure
    } finally {
      setActing((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  const posTitle = (jobId: string) => positions.find((p) => p.id === jobId)?.title ?? "";
  const openCandidate = (e: Entry) => {
    if (e.candidateId) navigate({ tab: "match", profile: e.candidateId });
  };
  const openPositionRanking = (jobId: string) => navigate({ tab: "jobs", job: jobId });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-meta uppercase text-coral">Pipeline</p>
          <h2 className="mt-1 font-serif text-display text-ink">Hiring pipeline</h2>
          <p className="mt-1 max-w-2xl text-body text-steel">
            Live view of candidates moving through open positions. Items that need a human decision
            surface at the top — approve or reject, or confirm a proposed interview slot.
          </p>
        </div>
        <span className="rounded-md border border-stone-200 bg-paper px-2.5 py-1 text-xs text-steel">
          Seeded demo pipeline · {(entries ?? []).length} candidates
        </span>
      </header>

      {error ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
      ) : entries == null ? (
        <p className="text-sm text-steel">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="rounded-lg border border-stone-200 bg-paper p-4 text-sm text-steel">
          No candidates in the pipeline yet. Seed the candidate population and pipeline (see the data-population
          step), or build a profile and match it.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi icon={<Briefcase size={16} />} label="Open positions" value={positions.length} />
            <Kpi icon={<Users size={16} />} label="Active candidates" value={activeCount} />
            <Kpi icon={<Clock size={16} />} label="In interview" value={interviewCount} />
            <Kpi
              icon={<Check size={16} />}
              label="Awaiting you"
              value={approvals.length}
              tone={approvals.length > 0 ? "coral" : "neutral"}
            />
          </div>

          <section>
            <h3 className="text-meta uppercase tracking-wide text-steel">Needs your decision</h3>
            {approvals.length === 0 ? (
              <p className="mt-2 rounded-lg border border-stone-200 bg-paper p-4 text-sm text-steel">
                Nothing waiting on you — every pending request has been actioned. ✓
              </p>
            ) : (
              <div className="mt-2 flex gap-3 overflow-x-auto pb-1">
                {approvals.map((e) => (
                  <ApprovalCard
                    key={e.id}
                    entry={e}
                    position={posTitle(e.jobId ?? "")}
                    busy={acting.has(e.id)}
                    onOpen={() => openCandidate(e)}
                    onAccept={() => act(e.id, "accept")}
                    onReject={() => act(e.id, "reject")}
                    onApproveEvent={() => act(e.id, "approve_event")}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-meta uppercase tracking-wide text-steel">Positions</h3>
            <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-panel">
              <div className="min-w-[860px]">
                <div className="grid grid-cols-[180px_repeat(6,1fr)] border-b border-stone-200 bg-paper">
                  <div className="px-3 py-2 text-meta uppercase text-steel">Position</div>
                  {STAGES.map((s) => (
                    <div key={s} className="px-3 py-2 text-center text-meta uppercase text-steel">
                      {s}
                    </div>
                  ))}
                </div>
                {positions.map((pos) => {
                  const lane = (entries ?? []).filter((e) => (e.jobId ?? e.jobTitle) === pos.id);
                  return (
                    <div
                      key={pos.id}
                      className="grid grid-cols-[180px_repeat(6,1fr)] border-b border-stone-100 last:border-0"
                    >
                      <div className="border-r border-stone-100 px-3 py-3">
                        <p className="text-sm font-semibold leading-tight text-ink">{pos.title}</p>
                        <p className="text-[11px] text-steel">{pos.count} active</p>
                        <button
                          type="button"
                          onClick={() => openPositionRanking(pos.id)}
                          className="focus-ring mt-1 text-[11px] font-semibold text-coral hover:underline"
                        >
                          Rank candidates →
                        </button>
                      </div>
                      {STAGES.map((stage) => {
                        const cell = lane.filter((e) => stageOf(e) === stage);
                        return (
                          <div key={stage} className="border-r border-stone-100 px-2 py-3 last:border-0">
                            <div className="flex flex-wrap gap-1">
                              {cell.map((e) => (
                                <Avatar key={e.id} entry={e} pending={!!e.approvalKind} onClick={() => openCandidate(e)} />
                              ))}
                              {cell.length === 0 ? <span className="text-[11px] text-stone-300">·</span> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
            <Legend />
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "neutral" | "coral";
}) {
  return (
    <div
      className={`rounded-lg border p-3 shadow-panel ${
        tone === "coral" ? "border-coral/30 bg-coral/5" : "border-stone-200 bg-white"
      }`}
    >
      <div className="flex items-center gap-2 text-steel">
        <span className={tone === "coral" ? "text-coral" : "text-steel"}>{icon}</span>
        <span className="text-meta uppercase">{label}</span>
      </div>
      <p className={`mt-1 font-serif text-3xl ${tone === "coral" ? "text-coral" : "text-ink"}`}>{value}</p>
    </div>
  );
}

function ApprovalCard({
  entry,
  position,
  busy,
  onOpen,
  onAccept,
  onReject,
  onApproveEvent,
}: {
  entry: Entry;
  position: string;
  busy: boolean;
  onOpen: () => void;
  onAccept: () => void;
  onReject: () => void;
  onApproveEvent: () => void;
}) {
  const isCalendar = entry.approvalKind === "calendar";
  return (
    <div className="flex w-64 shrink-0 flex-col gap-3 rounded-lg border border-coral/30 bg-white p-3 shadow-panel">
      <div className="flex items-center gap-2">
        <Avatar entry={entry} onClick={onOpen} />
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            className="focus-ring block max-w-full truncate text-left text-sm font-semibold text-ink hover:text-coral"
          >
            {entry.candidateLabel}
          </button>
          <p className="truncate text-[11px] text-steel">{position}</p>
        </div>
        {entry.matchScore != null ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-paper px-1.5 py-0.5 text-[11px] text-ink">
            <ScoreDot score={entry.matchScore} />
            {entry.matchScore}
          </span>
        ) : null}
      </div>

      {isCalendar ? (
        <div className="flex items-center gap-2 rounded-md bg-paper px-2 py-1.5 text-xs text-ink">
          <Calendar size={14} className="text-steel" />
          Interview proposed · <span className="font-semibold">{entry.approvalDetail}</span>
        </div>
      ) : (
        <p className="text-xs text-steel">Advance to the next stage?</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={isCalendar ? onApproveEvent : onAccept}
          className="focus-ring inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-moss text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          aria-label={isCalendar ? "Approve interview slot" : "Accept candidate"}
        >
          <Check size={16} />
          {isCalendar ? "Approve" : "Accept"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onReject}
          className="focus-ring inline-flex h-9 w-10 items-center justify-center rounded-md border border-stone-200 text-coral hover:bg-coral/5 disabled:opacity-50"
          aria-label={isCalendar ? "Decline slot" : "Reject candidate"}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function Avatar({ entry, pending = false, onClick }: { entry: Entry; pending?: boolean; onClick?: () => void }) {
  const style = styleFor(entry.archetype);
  const initials = entry.candidateLabel
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const title = `${entry.candidateLabel} · ${style.label}${entry.matchScore != null ? ` · match ${entry.matchScore}` : ""}`;
  const cls = `relative inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white ${style.bg} ${
    pending ? `ring-2 ring-offset-1 ${style.ring}` : ""
  }`;
  const dot = pending ? (
    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full border border-white bg-coral" />
  ) : null;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={`${title} · open`} className={`focus-ring ${cls} cursor-pointer hover:opacity-90`}>
        {initials}
        {dot}
      </button>
    );
  }
  return (
    <span title={title} className={cls}>
      {initials}
      {dot}
    </span>
  );
}

function ScoreDot({ score }: { score: number }) {
  const tone = score >= 80 ? "bg-moss" : score >= 65 ? "bg-amber-400" : "bg-stone-300";
  return <span className={`inline-block h-2 w-2 rounded-full ${tone}`} />;
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-[11px] text-steel">
      {Object.values(ARCHETYPE_STYLE).map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-full ${s.bg}`} />
          {s.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-coral" />
        Awaiting your decision
      </span>
    </div>
  );
}
