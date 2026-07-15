"use client";

import { useState } from "react";
import { Check, Filter, ListChecks, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { canonicalScoreOf } from "@/app/_lib/match-score";
import { GROUP_EVAL_CAP } from "@/app/_lib/group-eval-cohort";
import { styleFor, type Entry } from "./DecisionsTypes";

// One row per role: its pending candidates as clickable chips (→ analysis
// summary), a Group-evaluation button, and (when the role has a real jobId) a
// "Screening wave" action that previews + commits the bottom-% auto-reject.
//
// group-eval-cohort-choice — beyond the default "compare the top N by fit", the
// recruiter can arm a selection mode (reusing the decisions batch-select grammar:
// a Select toggle → checkable chips → a "Compare N" action) to compare an EXPLICIT
// shortlist. `onGroupEval(selection)` carries the chosen entry ids; `onGroupEval()`
// with no argument keeps today's top-N default byte-for-byte.
export function RoleDecisionRow({
  roleTitle,
  entries,
  evaluated,
  busy,
  onCandidate,
  onGroupEval,
  onScreenWave,
}: {
  roleTitle: string;
  entries: Entry[];
  evaluated: boolean;
  busy: boolean;
  onCandidate: (e: Entry) => void;
  onGroupEval: (selection?: string[]) => void;
  onScreenWave?: () => void;
}) {
  const t = useTranslations("decisions.row");
  const enumLabel = useEnumLabel();
  // Selection mode: pick an explicit subset (≤ GROUP_EVAL_CAP) to compare. Only
  // worth offering when the cohort is larger than a head-to-head pair — with ≤ 2 the
  // whole field IS the comparison. Session-local per role.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const canSelect = entries.length > 2;
  const atCap = picked.size >= GROUP_EVAL_CAP;

  const togglePick = (id: string) => {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      // Enforce the cap client-side (the server re-enforces): ignore adds past it.
      else if (next.size < GROUP_EVAL_CAP) next.add(id);
      return next;
    });
  };
  const exitPicking = () => {
    setPicking(false);
    setPicked(new Set());
  };
  // In selection mode a chip toggles its pick; otherwise it opens the analysis summary.
  const onChip = (e: Entry) => (picking ? togglePick(e.id) : onCandidate(e));
  // A comparison needs at least a head-to-head pair.
  const canCompare = picked.size >= 2;

  return (
    <div className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-serif text-h3 text-ink">
          {roleTitle} <span className="text-sm font-normal text-steel">· {t("candidateCount", { count: entries.length })}</span>
        </h4>
        <div className="flex shrink-0 items-center gap-2">
          {canSelect ? (
            <button
              type="button"
              onClick={() => (picking ? exitPicking() : setPicking(true))}
              aria-pressed={picking}
              title={t("selectTitle")}
              className={`focus-ring inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm font-semibold ${
                picking ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-steel hover:border-coral/40 hover:text-ink"
              }`}
            >
              <ListChecks size={14} /> {picking ? t("selectExit") : t("select")}
            </button>
          ) : null}
          {onScreenWave ? (
            <button
              type="button"
              onClick={onScreenWave}
              title={t("screeningWaveTitle")}
              className="focus-ring inline-flex h-8 items-center gap-1 rounded-md border border-stone-200 bg-white px-2.5 text-sm font-semibold text-steel hover:border-coral/40 hover:text-ink"
            >
              <Filter size={14} /> {t("screeningWave")}
            </button>
          ) : null}
          <button
            type="button"
            // In selection mode this compares the chosen subset (needs ≥ 2); otherwise
            // it runs / views the default top-N evaluation.
            onClick={() => (picking ? onGroupEval([...picked]) : onGroupEval())}
            disabled={busy || (picking && !canCompare)}
            className={`focus-ring inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm font-semibold disabled:opacity-60 ${
              evaluated && !picking
                ? "border-moss/40 bg-moss/10 text-moss hover:bg-moss/15"
                : "border-coral/40 bg-coral/5 text-coral hover:bg-coral/10"
            }`}
            title={picking ? t("compareTitle") : evaluated ? t("viewEvalTitle") : t("groupEvalTitle")}
          >
            {busy ? <Sparkles size={14} /> : evaluated && !picking ? <Check size={14} /> : <Sparkles size={14} />}{" "}
            {busy
              ? t("evaluating")
              : picking
                ? t("compareSelected", { count: picked.size })
                : evaluated
                  ? t("viewEval")
                  : t("groupEval")}
          </button>
        </div>
      </div>
      {picking ? (
        <p className="mt-2 text-sm text-steel" aria-live="polite">
          {atCap ? t("selectHelpAtCap", { cap: GROUP_EVAL_CAP }) : t("selectHelp", { cap: GROUP_EVAL_CAP })}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entries.map((e) => {
          const s = styleFor(e.archetype);
          const archLabel = enumLabel("archetype", e.archetype);
          const isPicked = picked.has(e.id);
          // A chip that can't be added (cap reached, not already picked) is dimmed.
          const dimmed = picking && !isPicked && atCap;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onChip(e)}
              aria-pressed={picking ? isPicked : undefined}
              title={picking ? t("candidatePickTitle", { name: e.candidateLabel }) : t("candidateChipTitle", { name: e.candidateLabel, archetype: archLabel })}
              className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${
                isPicked ? "border-coral bg-coral/10" : "border-stone-200 bg-paper hover:border-coral/40"
              } ${dimmed ? "opacity-50" : ""}`}
            >
              {picking ? (
                <span
                  className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border ${
                    isPicked ? "border-coral bg-coral text-white" : "border-stone-300 bg-white"
                  }`}
                  aria-hidden
                >
                  {isPicked ? <Check size={10} strokeWidth={3} /> : null}
                </span>
              ) : (
                <span
                  className={`h-3 w-3 shrink-0 rounded-full ${s.bg}`}
                  role="img"
                  aria-label={archLabel}
                  title={archLabel}
                />
              )}
              <span className="font-medium text-ink">{e.candidateLabel}</span>
              {/* Same canonical number CandidateHead / the board show (REC-01). */}
              <ScoreBadge score={canonicalScoreOf(e)} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
