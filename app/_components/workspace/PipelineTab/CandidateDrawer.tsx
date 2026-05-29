"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, ClipboardList, ExternalLink, Mail, Shuffle, Sparkles, UserCheck, X } from "lucide-react";
import { buildUrl } from "../tabs";

type Entry = {
  id: string;
  candidateId: string | null;
  candidateLabel: string;
  archetype: string | null;
  jobId: string | null;
  jobTitle: string | null;
  stage: string;
  matchScore: number | null;
  status: string;
};

type TaskId = "screen" | "outreach" | "rejection" | "prep" | "scorecard" | "rematch";

const ARCHETYPE: Record<string, { label: string; bg: string }> = {
  bau: { label: "Experienced", bg: "bg-steel" },
  student: { label: "Student", bg: "bg-coral" },
  career_switcher: { label: "Switcher", bg: "bg-moss" },
};

const ACTIONS: { id: TaskId; label: string; icon: typeof Mail; stages: string[] | "all"; note?: string }[] = [
  { id: "screen", label: "Screen with AI", icon: UserCheck, stages: ["AI-matched"], note: "Routes to advance or holds for your review in Decisions." },
  { id: "prep", label: "Interview prep", icon: ClipboardList, stages: ["AI-matched", "Screening", "Interview"] },
  { id: "scorecard", label: "Synthesize scorecard", icon: ClipboardList, stages: ["Interview"], note: "From your notes → a structured scorecard in Decisions." },
  { id: "outreach", label: "Draft outreach", icon: Mail, stages: "all" },
  { id: "rejection", label: "Draft rejection", icon: Ban, stages: ["AI-matched", "Screening", "Interview", "Offer"] },
  { id: "rematch", label: "Explore alternatives", icon: Shuffle, stages: ["AI-matched", "Screening", "Interview", "Offer"] },
];

const APPLIED_LABEL: Record<string, string> = {
  advanced: "Advanced to Screening.",
  held_for_review: "Held for your review in Decisions.",
  scorecard_ready: "Scorecard sent to Decisions.",
  rematched: "Alternative role added to the pipeline.",
  no_alternative: "No alternative role above the match floor.",
  advisory: "Advisory only — candidate is past the screening gate.",
  drafted: "Draft ready to copy.",
};

type Result = { task: TaskId; data: Record<string, unknown>; source: string; applied: string };

export function CandidateDrawer({ entry, onClose, onChanged }: { entry: Entry; onClose: () => void; onChanged: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<TaskId | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const a = ARCHETYPE[entry.archetype ?? "bau"] ?? ARCHETYPE.bau;
  const initials = entry.candidateLabel.split(" ").map((p) => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
  const actions = ACTIONS.filter((act) => act.stages === "all" || act.stages.includes(entry.stage)).filter(
    (act) => entry.status === "active" || act.id === "rematch"
  );

  const run = async (task: TaskId) => {
    setBusy(task);
    setError(null);
    setResult(null);
    try {
      const r = await fetch(`/api/automation/${task}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id, notes: task === "scorecard" ? notes : undefined }),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error || "Automation task failed.");
      setResult({ task, data: p.result, source: p.source, applied: p.applied });
      if (["advanced", "held_for_review", "scorecard_ready", "rematched"].includes(p.applied)) onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Automation task failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/20 backdrop-blur-[1px]" />
      <aside className="animate-slide-in relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-stone-200 bg-paper shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-stone-200 bg-paper/95 p-4 backdrop-blur">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-semibold text-white ${a.bg}`}>{initials}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-serif text-lg text-ink">{entry.candidateLabel}</p>
            <p className="truncate text-xs text-steel">
              {a.label} · {entry.jobTitle} · <span className="text-ink">{entry.stage}</span>
            </p>
          </div>
          {entry.matchScore != null ? (
            <span className="rounded-md bg-white px-2 py-1 text-center">
              <span className="block font-serif text-lg leading-none text-ink">{entry.matchScore}</span>
              <span className="text-[9px] uppercase text-steel">match</span>
            </span>
          ) : null}
          <button type="button" onClick={onClose} className="focus-ring rounded-md p-1 text-steel hover:bg-stone-100">
            <X size={18} />
          </button>
        </header>

        <div className="space-y-4 p-4">
          <div>
            <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
              <Sparkles size={13} /> AI actions
            </p>
            <p className="mt-1 text-[11px] text-steel">Each task runs locally through the Claude CLI, with a deterministic fallback.</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {actions.map((act) => (
                <button
                  key={act.id}
                  type="button"
                  onClick={() => run(act.id)}
                  disabled={busy !== null}
                  className={`focus-ring flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    result?.task === act.id ? "border-coral bg-coral/5 text-coral" : "border-stone-200 bg-white text-ink hover:border-coral/40"
                  }`}
                >
                  <act.icon size={14} className="shrink-0 text-coral" />
                  {busy === act.id ? "Working…" : act.label}
                </button>
              ))}
            </div>
          </div>

          {actions.some((act) => act.id === "scorecard") ? (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-steel">Interview notes (for scorecard)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Paste raw interviewer notes here, then click Synthesize scorecard."
                className="focus-ring mt-1 w-full rounded-md border border-stone-200 bg-white p-2 text-xs text-ink"
              />
            </div>
          ) : null}

          {error ? <p className="rounded-md bg-red-50 p-2.5 text-xs text-red-700">{error}</p> : null}

          {result ? <ResultView result={result} /> : null}

          <button
            type="button"
            onClick={() => {
              if (entry.candidateId) router.push(buildUrl({ tab: "match", profile: entry.candidateId }));
            }}
            className="focus-ring inline-flex items-center gap-1 text-xs font-semibold text-steel hover:text-coral"
          >
            <ExternalLink size={13} /> Open full match in Profile &amp; Match
          </button>
        </div>
      </aside>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const llm = source === "llm";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${llm ? "bg-coral/15 text-coral" : "bg-stone-200 text-steel"}`}>
      {llm ? "Claude CLI" : "template"}
    </span>
  );
}

function ResultView({ result }: { result: Result }) {
  const d = result.data as Record<string, unknown>;
  const applied = APPLIED_LABEL[result.applied];
  return (
    <div className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-steel">{result.task}</p>
        <SourceBadge source={result.source} />
      </div>

      {(result.task === "outreach" || result.task === "rejection") && (
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-ink">{String(d.subject ?? "")}</p>
          <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink">{String(d.body ?? "")}</pre>
          {d.feedback ? <p className="text-[11px] text-steel">Feedback: {String(d.feedback)}</p> : null}
          <p className="text-[10px] uppercase text-steel">{String(d.language ?? "")}</p>
        </div>
      )}

      {result.task === "screen" && (
        <div className="space-y-1.5 text-xs text-ink">
          <p>
            <span className="font-semibold uppercase">{String(d.recommendation ?? "")}</span>
            {typeof d.confidence === "number" ? ` · ${d.confidence}% confidence` : ""}
          </p>
          <p>{String(d.rationale ?? "")}</p>
        </div>
      )}

      {result.task === "prep" && (
        <ol className="list-decimal space-y-2 pl-4 text-xs text-ink">
          {((d.questions as { competency?: string; question?: string; whatsGoodLooksLike?: string }[]) ?? []).map((q, i) => (
            <li key={i}>
              <span className="font-semibold">{q.question}</span>
              {q.whatsGoodLooksLike ? <span className="block text-[11px] text-steel">Good answer: {q.whatsGoodLooksLike}</span> : null}
            </li>
          ))}
        </ol>
      )}

      {result.task === "scorecard" && (
        <div className="space-y-1.5 text-xs text-ink">
          <p className="font-semibold uppercase">{String(d.recommendation ?? "")}</p>
          {d.summary ? <p>{String(d.summary)}</p> : null}
          <ul className="space-y-0.5">
            {((d.ratings as { competency: string; rating: number }[]) ?? []).map((r, i) => (
              <li key={i} className="flex justify-between">
                <span className="text-steel">{r.competency}</span>
                <span className="font-semibold">{r.rating}/5</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.task === "rematch" && (
        <div className="space-y-1 text-xs text-ink">
          {d.found ? (
            <>
              <p className="font-semibold">
                {String(d.jobTitle ?? "")} <span className="text-moss">· {String(d.score ?? "")} match</span>
              </p>
              <p className="text-steel">{String(d.rationale ?? "")}</p>
            </>
          ) : (
            <p className="text-steel">{String(d.reason ?? "No alternative found.")}</p>
          )}
        </div>
      )}

      {applied ? <p className="mt-2 rounded bg-moss/10 px-2 py-1 text-[11px] font-semibold text-moss">{applied}</p> : null}
    </div>
  );
}
