"use client";

import { useMemo, useState } from "react";
import { Briefcase, Calendar, Check, Clock, Users, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Sample data. Replaced by a real pipeline model + enterprise-scale population
// in the next phase; here it establishes the swimlane + approval-flow concept.
// ---------------------------------------------------------------------------

type Archetype = "experienced" | "student" | "switcher";
type Approval = { type: "decision" } | { type: "calendar"; slot: string };

const STAGES = ["Sourced", "AI-matched", "Screening", "Interview", "Offer", "Hired"] as const;
type Stage = (typeof STAGES)[number];

type Position = { id: string; title: string; family: string };
const POSITIONS: Position[] = [
  { id: "p1", title: "Junior Frontend Developer", family: "Software" },
  { id: "p2", title: "Medior Backend Engineer", family: "Software" },
  { id: "p3", title: "Junior Data Analyst", family: "Data / AI" },
  { id: "p4", title: "Product Manager", family: "Product" },
  { id: "p5", title: "Senior DevOps Engineer", family: "Software" },
];

type Candidate = {
  id: string;
  name: string;
  posId: string;
  stage: Stage;
  archetype: Archetype;
  score: number;
  approval?: Approval;
};

const NAMES = [
  "Jana N.", "Petr S.", "Eva K.", "Tomáš M.", "Lucie V.", "Adam R.", "Klára B.", "Jan D.",
  "Nina P.", "Filip H.", "Tereza Z.", "Marek T.", "Aleš S.", "Ivan L.", "Beáta C.", "Dan K.",
  "Sofia W.", "Lukáš J.", "Hana O.", "Viktor E.", "Iva M.", "Robert P.", "Nela H.", "Ondřej V.",
  "Karolína D.", "Šimon B.", "Veronika L.", "Matěj K.", "Anna R.", "David T.", "Gabriela S.",
  "Pavel N.", "Monika Č.", "Štěpán M.", "Barbora K.", "Radek J.",
];
const ARCHES: Archetype[] = ["experienced", "student", "switcher"];
const SLOTS = ["Tue 14:00", "Wed 10:30", "Thu 09:00", "Mon 15:30", "Fri 11:00"];

// Deterministic spread across positions / stages / archetypes (no RNG).
const SAMPLE: Candidate[] = NAMES.map((name, i) => {
  const pos = POSITIONS[i % POSITIONS.length];
  const stage = STAGES[(i * 3 + 1) % STAGES.length];
  const archetype = ARCHES[i % ARCHES.length];
  const score = 58 + ((i * 7) % 37);
  const c: Candidate = { id: `c${i}`, name, posId: pos.id, stage, archetype, score };
  if (i % 7 === 0 && stage !== "Hired") c.approval = { type: "decision" };
  else if (i % 11 === 0 && stage !== "Hired") c.approval = { type: "calendar", slot: SLOTS[i % SLOTS.length] };
  return c;
});

const ARCHETYPE_STYLE: Record<Archetype, { ring: string; bg: string; label: string }> = {
  experienced: { ring: "ring-steel", bg: "bg-steel", label: "Experienced" },
  student: { ring: "ring-coral", bg: "bg-coral", label: "Student" },
  switcher: { ring: "ring-moss", bg: "bg-moss", label: "Switcher" },
};

// ---------------------------------------------------------------------------

export function PipelineTab() {
  // Optimistic local state: accepting advances a stage, rejecting removes,
  // approving a calendar event clears the request. (No backend yet.)
  const [moved, setMoved] = useState<Record<string, Stage>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  const stageOf = (c: Candidate): Stage => moved[c.id] ?? c.stage;
  const visible = useMemo(() => SAMPLE.filter((c) => !removed.has(c.id)), [removed]);

  const approvals = visible.filter((c) => c.approval && !resolved.has(c.id));
  const activeCount = visible.filter((c) => stageOf(c) !== "Hired").length;
  const interviewCount = visible.filter((c) => stageOf(c) === "Interview").length;

  const accept = (c: Candidate) => {
    setResolved((s) => new Set(s).add(c.id));
    const idx = STAGES.indexOf(stageOf(c));
    const next = STAGES[Math.min(idx + 1, STAGES.length - 1)];
    setMoved((m) => ({ ...m, [c.id]: next }));
  };
  const reject = (c: Candidate) => {
    setResolved((s) => new Set(s).add(c.id));
    setRemoved((s) => new Set(s).add(c.id));
  };
  const approveEvent = (c: Candidate) => {
    setResolved((s) => new Set(s).add(c.id));
    setMoved((m) => ({ ...m, [c.id]: "Interview" }));
  };

  const posById = (id: string) => POSITIONS.find((p) => p.id === id);

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
        <span className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800">
          Sample data · real candidates populate here in the next phase
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi icon={<Briefcase size={16} />} label="Open positions" value={POSITIONS.length} />
        <Kpi icon={<Users size={16} />} label="Active candidates" value={activeCount} />
        <Kpi icon={<Clock size={16} />} label="In interview" value={interviewCount} />
        <Kpi
          icon={<Check size={16} />}
          label="Awaiting you"
          value={approvals.length}
          tone={approvals.length > 0 ? "coral" : "neutral"}
        />
      </div>

      {/* Human-in-the-loop: strong visual approval requests. */}
      <section>
        <h3 className="text-meta uppercase tracking-wide text-steel">Needs your decision</h3>
        {approvals.length === 0 ? (
          <p className="mt-2 rounded-lg border border-stone-200 bg-paper p-4 text-sm text-steel">
            Nothing waiting on you — every pending request has been actioned. ✓
          </p>
        ) : (
          <div className="mt-2 flex gap-3 overflow-x-auto pb-1">
            {approvals.map((c) => (
              <ApprovalCard
                key={c.id}
                candidate={c}
                position={posById(c.posId)?.title ?? ""}
                onAccept={() => accept(c)}
                onReject={() => reject(c)}
                onApproveEvent={() => approveEvent(c)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Swimlanes: positions × stages. */}
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
            {POSITIONS.map((pos) => {
              const lane = visible.filter((c) => c.posId === pos.id);
              return (
                <div
                  key={pos.id}
                  className="grid grid-cols-[180px_repeat(6,1fr)] border-b border-stone-100 last:border-0"
                >
                  <div className="border-r border-stone-100 px-3 py-3">
                    <p className="text-sm font-semibold leading-tight text-ink">{pos.title}</p>
                    <p className="text-[11px] text-steel">
                      {pos.family} · {lane.length} active
                    </p>
                  </div>
                  {STAGES.map((stage) => {
                    const cell = lane.filter((c) => stageOf(c) === stage);
                    return (
                      <div key={stage} className="border-r border-stone-100 px-2 py-3 last:border-0">
                        <div className="flex flex-wrap gap-1">
                          {cell.map((c) => (
                            <Avatar key={c.id} candidate={c} pending={!!c.approval && !resolved.has(c.id)} />
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
      className={`rounded-lg border p-3 ${
        tone === "coral" ? "border-coral/30 bg-coral/5" : "border-stone-200 bg-white"
      } shadow-panel`}
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
  candidate,
  position,
  onAccept,
  onReject,
  onApproveEvent,
}: {
  candidate: Candidate;
  position: string;
  onAccept: () => void;
  onReject: () => void;
  onApproveEvent: () => void;
}) {
  const isCalendar = candidate.approval?.type === "calendar";
  return (
    <div className="flex w-64 shrink-0 flex-col gap-3 rounded-lg border border-coral/30 bg-white p-3 shadow-panel">
      <div className="flex items-center gap-2">
        <Avatar candidate={candidate} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{candidate.name}</p>
          <p className="truncate text-[11px] text-steel">{position}</p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-paper px-1.5 py-0.5 text-[11px] text-ink">
          <ScoreDot score={candidate.score} />
          {candidate.score}
        </span>
      </div>

      {isCalendar ? (
        <div className="flex items-center gap-2 rounded-md bg-paper px-2 py-1.5 text-xs text-ink">
          <Calendar size={14} className="text-steel" />
          Interview proposed · <span className="font-semibold">{(candidate.approval as { slot: string }).slot}</span>
        </div>
      ) : (
        <p className="text-xs text-steel">Advance to the next stage?</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={isCalendar ? onApproveEvent : onAccept}
          className="focus-ring inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-moss text-sm font-semibold text-white hover:opacity-90"
          aria-label={isCalendar ? "Approve interview slot" : "Accept candidate"}
        >
          <Check size={16} />
          {isCalendar ? "Approve" : "Accept"}
        </button>
        <button
          type="button"
          onClick={onReject}
          className="focus-ring inline-flex h-9 w-10 items-center justify-center rounded-md border border-stone-200 text-coral hover:bg-coral/5"
          aria-label={isCalendar ? "Decline slot" : "Reject candidate"}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function Avatar({ candidate, pending = false }: { candidate: Candidate; pending?: boolean }) {
  const style = ARCHETYPE_STYLE[candidate.archetype];
  const initials = candidate.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);
  return (
    <span
      title={`${candidate.name} · ${style.label} · match ${candidate.score}`}
      className={`relative inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white ${style.bg} ${
        pending ? `ring-2 ring-offset-1 ${style.ring}` : ""
      }`}
    >
      {initials}
      {pending ? (
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full border border-white bg-coral" />
      ) : null}
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
      {(Object.keys(ARCHETYPE_STYLE) as Archetype[]).map((a) => (
        <span key={a} className="inline-flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-full ${ARCHETYPE_STYLE[a].bg}`} />
          {ARCHETYPE_STYLE[a].label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-coral" />
        Awaiting your decision
      </span>
    </div>
  );
}
