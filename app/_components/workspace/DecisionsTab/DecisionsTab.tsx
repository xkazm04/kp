"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Check, ChevronRight, Sparkles, X } from "lucide-react";
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
const ARCHETYPE = {
  bau: { label: "Experienced", bg: "bg-steel" },
  student: { label: "Student", bg: "bg-coral" },
  career_switcher: { label: "Switcher", bg: "bg-moss" },
} as const;
const styleFor = (a: string | null) => ARCHETYPE[(a as keyof typeof ARCHETYPE) ?? "bau"] ?? ARCHETYPE.bau;

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const TIMES = ["09:00", "10:30", "11:00", "14:00", "15:30"];

export function DecisionsTab() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<Record<string, "accept" | "reject" | "approve_event">>({});

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

  const pending = (entries ?? []).filter((e) => e.approvalKind && e.status === "active" && !resolving[e.id]);
  const keyDecisions = pending.filter((e) => e.approvalKind === "decision");
  const scheduling = pending.filter((e) => e.approvalKind === "calendar");
  const aiReviews = pending.filter((e) => e.approvalKind === "screening_review" || e.approvalKind === "scorecard_review");

  const act = async (e: Entry, action: "accept" | "reject" | "approve_event", detail?: string) => {
    setResolving((s) => ({ ...s, [e.id]: action })); // triggers exit animation + removes from lists
    // remove from local state after the card animates out
    window.setTimeout(() => {
      setEntries((prev) => (prev ? prev.filter((x) => x.id !== e.id) : prev));
    }, 260);
    try {
      const r = await fetch(`/api/pipeline/${e.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, detail }),
      });
      if (!r.ok) throw new Error();
    } catch {
      load(); // resync on failure
      setResolving((s) => {
        const n = { ...s };
        delete n[e.id];
        return n;
      });
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-meta uppercase text-coral">Decisions</p>
          <h2 className="mt-1 font-serif text-display text-ink">Your decision queue</h2>
          <p className="mt-1 max-w-2xl text-body text-steel">
            The human-in-the-loop step. Key decisions advance or reject a candidate with full context; scheduling
            decisions confirm a proposed interview slot. Everything you action here moves the candidate in the{" "}
            <button
              type="button"
              onClick={() => router.push(buildUrl({ tab: "pipeline" }))}
              className="focus-ring font-semibold text-coral hover:underline"
            >
              pipeline
            </button>
            .
          </p>
        </div>
        <span className="rounded-md border border-stone-200 bg-paper px-2.5 py-1 text-xs text-steel">
          {pending.length} pending
        </span>
      </header>

      {error ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
      ) : entries == null ? (
        <p className="text-sm text-steel">Loading…</p>
      ) : pending.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-paper p-6 text-center">
          <Check className="mx-auto text-moss" size={28} />
          <p className="mt-2 text-sm font-semibold text-ink">You&apos;re all caught up.</p>
          <p className="text-xs text-steel">No decisions are waiting on you right now.</p>
        </div>
      ) : (
        <div className="space-y-6">
        {aiReviews.length > 0 ? (
          <section>
            <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
              <Sparkles size={13} className="text-coral" /> AI recommendations <span className="text-coral">· {aiReviews.length}</span>
            </h3>
            <p className="mt-1 text-[11px] text-steel">
              The LLM screened these at the AI-matched gate or synthesized an interview scorecard. Confirm or override —
              early-career candidates are deliberately held here for your judgment.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {aiReviews.map((e) => (
                <AiReviewCard key={e.id} entry={e} onAccept={() => act(e, "accept")} onReject={() => act(e, "reject")} />
              ))}
            </div>
          </section>
        ) : null}
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h3 className="text-meta uppercase tracking-wide text-steel">
              Key decisions <span className="text-coral">· {keyDecisions.length}</span>
            </h3>
            <p className="mt-1 text-[11px] text-steel">Advance to the next stage, or reject — read the fit first.</p>
            <div className="mt-3 space-y-3">
              {keyDecisions.map((e) => (
                <KeyDecisionCard key={e.id} entry={e} onAccept={() => act(e, "accept")} onReject={() => act(e, "reject")} />
              ))}
              {keyDecisions.length === 0 ? <Empty>No key decisions pending.</Empty> : null}
            </div>
          </section>

          <section>
            <h3 className="text-meta uppercase tracking-wide text-steel">
              Interview scheduling <span className="text-coral">· {scheduling.length}</span>
            </h3>
            <p className="mt-1 text-[11px] text-steel">Confirm the proposed slot, or pick another, then approve.</p>
            <div className="mt-3 space-y-3">
              {scheduling.map((e) => (
                <SchedulingCard
                  key={e.id}
                  entry={e}
                  onApprove={(slot) => act(e, "approve_event", slot)}
                  onDecline={() => act(e, "reject")}
                />
              ))}
              {scheduling.length === 0 ? <Empty>No scheduling decisions pending.</Empty> : null}
            </div>
          </section>
        </div>
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-stone-200 p-3 text-xs text-steel">{children}</p>;
}

function NextStage({ stage }: { stage: string }) {
  const idx = STAGES.indexOf(stage);
  const next = STAGES[Math.min(idx + 1, STAGES.length - 1)];
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-steel">
      <span className="rounded bg-stone-100 px-1.5 py-0.5">{stage}</span>
      <ChevronRight size={12} />
      <span className="rounded bg-moss/10 px-1.5 py-0.5 font-semibold text-moss">{next}</span>
    </span>
  );
}

function CandidateHead({ entry }: { entry: Entry }) {
  const s = styleFor(entry.archetype);
  const initials = entry.candidateLabel.split(" ").map((p) => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-2">
      <span className={`grid h-9 w-9 place-items-center rounded-full text-xs font-semibold text-white ${s.bg}`}>
        {initials}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink">{entry.candidateLabel}</p>
        <p className="truncate text-[11px] text-steel">
          {s.label} · {entry.jobTitle}
        </p>
      </div>
      {entry.matchScore != null ? (
        <span className="ml-auto rounded-md bg-paper px-2 py-1 text-center">
          <span className="block font-serif text-lg leading-none text-ink">{entry.matchScore}</span>
          <span className="text-[9px] uppercase text-steel">match</span>
        </span>
      ) : null}
    </div>
  );
}

type Reasoning = { verdict: string; strengths: string[]; gaps: string[]; interviewProbes: string[] };

function KeyDecisionCard({
  entry,
  onAccept,
  onReject,
}: {
  entry: Entry;
  onAccept: () => void;
  onReject: () => void;
}) {
  const [reasoning, setReasoning] = useState<{ loading?: boolean; data?: Reasoning; error?: string } | null>(null);

  const explain = async () => {
    if (reasoning?.loading || reasoning?.data) return;
    setReasoning({ loading: true });
    try {
      const r = await fetch("/api/match/reasoning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: entry.candidateId, jobId: entry.jobId }),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error);
      setReasoning({ data: p.reasoning as Reasoning });
    } catch {
      setReasoning({ error: "Couldn't load the fit for this candidate." });
    }
  };

  return (
    <article className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
      <CandidateHead entry={entry} />
      <div className="mt-2">
        <NextStage stage={entry.stage} />
      </div>

      {reasoning?.data ? (
        <div className="mt-3 rounded-md border border-stone-200 bg-paper/50 p-2.5">
          <p className="text-sm text-ink">{reasoning.data.verdict}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <MiniList title="Strengths" items={reasoning.data.strengths} tone="green" />
            <MiniList title="Gaps" items={reasoning.data.gaps} tone="red" />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={explain}
          disabled={reasoning?.loading}
          className="focus-ring mt-3 inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-[11px] font-semibold text-coral hover:bg-paper disabled:opacity-50"
        >
          <Sparkles size={13} />
          {reasoning?.loading ? "Reading the fit…" : "Why this candidate?"}
        </button>
      )}
      {reasoning?.error ? <p className="mt-2 text-[11px] text-red-700">{reasoning.error}</p> : null}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onAccept}
          className="focus-ring inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-moss text-sm font-semibold text-white hover:opacity-90"
        >
          <Check size={16} /> Advance
        </button>
        <button
          type="button"
          onClick={onReject}
          className="focus-ring inline-flex h-9 items-center justify-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-coral hover:bg-coral/5"
        >
          <X size={16} /> Reject
        </button>
      </div>
    </article>
  );
}

function MiniList({ title, items, tone }: { title: string; items: string[]; tone: "green" | "red" }) {
  const dot = tone === "green" ? "text-moss" : "text-coral";
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-steel">{title}</p>
      <ul className="mt-0.5 space-y-0.5">
        {items.slice(0, 3).map((it, i) => (
          <li key={i} className="flex gap-1 text-[11px] text-ink">
            <span className={dot}>•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Screening = { recommendation?: string; confidence?: number; rationale?: string; strengths?: string[]; redFlags?: string[] };
type Scorecard = { recommendation?: string; summary?: string; ratings?: { competency: string; rating: number; evidence?: string }[] };

function RecBadge({ rec, confidence }: { rec?: string; confidence?: number }) {
  const tone =
    rec === "advance" ? "bg-moss/15 text-moss" : rec === "reject" ? "bg-coral/15 text-coral" : "bg-amber-100 text-amber-700";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${tone}`}>
      {rec ?? "hold"}
      {typeof confidence === "number" ? ` · ${confidence}%` : ""}
    </span>
  );
}

function AiReviewCard({ entry, onAccept, onReject }: { entry: Entry; onAccept: () => void; onReject: () => void }) {
  let parsed: (Screening & Scorecard) | null = null;
  try {
    parsed = entry.approvalDetail ? (JSON.parse(entry.approvalDetail) as Screening & Scorecard) : null;
  } catch {
    parsed = null;
  }
  const isScorecard = entry.approvalKind === "scorecard_review";

  return (
    <article className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
      <div className="mb-1 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-coral">
          <Sparkles size={11} /> {isScorecard ? "Interview scorecard" : "AI screening"}
        </span>
        <RecBadge rec={parsed?.recommendation} confidence={isScorecard ? undefined : parsed?.confidence} />
      </div>
      <CandidateHead entry={entry} />

      {parsed ? (
        <div className="mt-2 rounded-md border border-stone-200 bg-paper/50 p-2.5 text-[11px] text-ink">
          {isScorecard ? (
            <>
              {parsed.summary ? <p className="mb-1.5">{parsed.summary}</p> : null}
              <ul className="space-y-1">
                {(parsed.ratings ?? []).slice(0, 4).map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="truncate text-steel">{r.competency}</span>
                    <span className="flex shrink-0 gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span key={n} className={`h-1.5 w-1.5 rounded-full ${n <= r.rating ? "bg-moss" : "bg-stone-200"}`} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p>{parsed.rationale}</p>
              {parsed.strengths?.length || parsed.redFlags?.length ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <MiniList title="Strengths" items={parsed.strengths ?? []} tone="green" />
                  <MiniList title="Red flags" items={parsed.redFlags ?? []} tone="red" />
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onAccept}
          className="focus-ring inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-moss text-sm font-semibold text-white hover:opacity-90"
        >
          <Check size={16} /> {isScorecard ? "To offer" : "Advance"}
        </button>
        <button
          type="button"
          onClick={onReject}
          className="focus-ring inline-flex h-9 items-center justify-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-coral hover:bg-coral/5"
        >
          <X size={16} /> Reject
        </button>
      </div>
    </article>
  );
}

function SchedulingCard({
  entry,
  onApprove,
  onDecline,
}: {
  entry: Entry;
  onApprove: (slot: string) => void;
  onDecline: () => void;
}) {
  const proposed = entry.approvalDetail || "Tue 14:00";
  const [pick, setPick] = useState(proposed);
  const [pickDay, pickTime] = pick.split(" ");

  return (
    <article className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
      <CandidateHead entry={entry} />
      <div className="mt-2 flex items-center gap-1.5 text-xs text-ink">
        <Calendar size={14} className="text-steel" />
        Proposed: <span className="font-semibold">{proposed}</span>
        {pick !== proposed ? <span className="text-steel">· you picked {pick}</span> : null}
      </div>

      {/* week × time grid visualization */}
      <div className="mt-2 overflow-hidden rounded-md border border-stone-200">
        <div className="grid grid-cols-[44px_repeat(5,1fr)] bg-paper text-center text-[10px] text-steel">
          <div className="py-1" />
          {DAYS.map((d) => (
            <div key={d} className="py-1 font-semibold">
              {d}
            </div>
          ))}
        </div>
        {TIMES.map((t) => (
          <div key={t} className="grid grid-cols-[44px_repeat(5,1fr)] border-t border-stone-100">
            <div className="py-1 pl-1 text-[10px] text-steel">{t}</div>
            {DAYS.map((d) => {
              const slot = `${d} ${t}`;
              const isProposed = slot === proposed;
              const isPicked = slot === pick;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setPick(slot)}
                  aria-label={`Pick ${slot}`}
                  className={`m-0.5 h-6 rounded transition-colors ${
                    isPicked
                      ? "bg-moss text-white"
                      : isProposed
                        ? "bg-moss/20 ring-1 ring-moss/40"
                        : "bg-stone-50 hover:bg-coral/10"
                  }`}
                >
                  {isPicked ? <Check size={12} className="mx-auto" /> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onApprove(pick)}
          className="focus-ring inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-moss text-sm font-semibold text-white hover:opacity-90"
        >
          <Check size={16} /> Confirm {pickDay} {pickTime}
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="focus-ring inline-flex h-9 items-center justify-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-coral hover:bg-coral/5"
        >
          <X size={16} />
        </button>
      </div>
    </article>
  );
}
