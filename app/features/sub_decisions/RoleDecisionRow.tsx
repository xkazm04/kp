"use client";

import { Check, Filter, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { canonicalScoreOf } from "@/app/_lib/match-score";
import { styleFor, type Entry } from "./DecisionsTypes";

// One row per role: its pending candidates as clickable chips (→ analysis
// summary), a Group-evaluation button, and (when the role has a real jobId) a
// "Screening wave" action that previews + commits the bottom-% auto-reject.
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
  onGroupEval: () => void;
  onScreenWave?: () => void;
}) {
  const t = useTranslations("decisions.row");
  const enumLabel = useEnumLabel();
  return (
    <div className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-serif text-h3 text-ink">
          {roleTitle} <span className="text-sm font-normal text-steel">· {t("candidateCount", { count: entries.length })}</span>
        </h4>
        <div className="flex shrink-0 items-center gap-2">
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
            onClick={onGroupEval}
            disabled={busy}
            className={`focus-ring inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm font-semibold disabled:opacity-60 ${
              evaluated
                ? "border-moss/40 bg-moss/10 text-moss hover:bg-moss/15"
                : "border-coral/40 bg-coral/5 text-coral hover:bg-coral/10"
            }`}
            title={evaluated ? t("viewEvalTitle") : t("groupEvalTitle")}
          >
            {busy ? <Sparkles size={14} /> : evaluated ? <Check size={14} /> : <Sparkles size={14} />}{" "}
            {busy ? t("evaluating") : evaluated ? t("viewEval") : t("groupEval")}
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entries.map((e) => {
          const s = styleFor(e.archetype);
          const archLabel = enumLabel("archetype", e.archetype);
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onCandidate(e)}
              title={t("candidateChipTitle", { name: e.candidateLabel, archetype: archLabel })}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-paper px-2 py-1 text-sm hover:border-coral/40"
            >
              <span
                className={`h-3 w-3 shrink-0 rounded-full ${s.bg}`}
                role="img"
                aria-label={archLabel}
                title={archLabel}
              />
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
