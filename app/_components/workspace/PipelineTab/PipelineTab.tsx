"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Check, Clock, Users } from "lucide-react";
import { buildUrl } from "../tabs";

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
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const openCandidate = (e: Entry) => {
    if (e.candidateId) router.push(buildUrl({ tab: "match", profile: e.candidateId }));
  };
  const openPositionRanking = (jobId: string) => router.push(buildUrl({ tab: "jobs", job: jobId }));

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
              onClick={() => router.push(buildUrl({ tab: "decisions" }))}
            />
          </div>

          {approvals.length > 0 ? (
            <button
              type="button"
              onClick={() => router.push(buildUrl({ tab: "decisions" }))}
              className="focus-ring flex w-full items-center justify-between rounded-lg border border-coral/30 bg-coral/5 px-4 py-3 text-left hover:bg-coral/10"
            >
              <span className="text-sm text-ink">
                <span className="font-semibold text-coral">{approvals.length} candidates</span> need your decision —
                advance, reject, or confirm an interview slot.
              </span>
              <span className="text-sm font-semibold text-coral">Open Decisions →</span>
            </button>
          ) : null}

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
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "neutral" | "coral";
  onClick?: () => void;
}) {
  const cls = `rounded-lg border p-3 text-left shadow-panel ${
    tone === "coral" ? "border-coral/30 bg-coral/5" : "border-stone-200 bg-white"
  } ${onClick ? "focus-ring transition-colors hover:border-coral/50" : ""}`;
  const body = (
    <>
      <div className="flex items-center gap-2 text-steel">
        <span className={tone === "coral" ? "text-coral" : "text-steel"}>{icon}</span>
        <span className="text-meta uppercase">{label}</span>
      </div>
      <p className={`mt-1 font-serif text-3xl ${tone === "coral" ? "text-coral" : "text-ink"}`}>{value}</p>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} block w-full`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
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
