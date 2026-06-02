"use client";

import { Check, Sparkles } from "lucide-react";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { styleFor, type Entry } from "./DecisionsTypes";

// One row per role: its pending candidates as clickable chips (→ analysis
// summary) plus a single Group-evaluation button for the whole role.
export function RoleDecisionRow({
  roleTitle,
  entries,
  evaluated,
  busy,
  onCandidate,
  onGroupEval,
}: {
  roleTitle: string;
  entries: Entry[];
  evaluated: boolean;
  busy: boolean;
  onCandidate: (e: Entry) => void;
  onGroupEval: () => void;
}) {
  return (
    <div className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-serif text-h3 text-ink">
          {roleTitle} <span className="text-sm font-normal text-steel">· {entries.length} candidate{entries.length === 1 ? "" : "s"}</span>
        </h4>
        <button
          type="button"
          onClick={onGroupEval}
          disabled={busy}
          className={`focus-ring inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2.5 text-sm font-semibold disabled:opacity-60 ${
            evaluated
              ? "border-moss/40 bg-moss/10 text-moss hover:bg-moss/15"
              : "border-coral/40 bg-coral/5 text-coral hover:bg-coral/10"
          }`}
          title={evaluated ? "View the saved evaluation — re-run it from inside the modal" : "Compare all candidates in this role"}
        >
          {busy ? <Sparkles size={14} /> : evaluated ? <Check size={14} /> : <Sparkles size={14} />}{" "}
          {busy ? "Evaluating…" : evaluated ? "View evaluation" : "Group evaluation"}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entries.map((e) => {
          const s = styleFor(e.archetype);
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onCandidate(e)}
              title={`${e.candidateLabel} · ${s.label} · open analysis summary`}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-paper px-2 py-1 text-sm hover:border-coral/40"
            >
              <span
                className={`h-3 w-3 shrink-0 rounded-full ${s.bg}`}
                role="img"
                aria-label={s.label}
                title={s.label}
              />
              <span className="font-medium text-ink">{e.candidateLabel}</span>
              <ScoreBadge score={e.matchScore ?? null} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
