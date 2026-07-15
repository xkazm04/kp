import { useState } from "react";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, CircleDot, XCircle } from "lucide-react";
import { PotentialBadge } from "@/app/_components/PotentialBadge";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { ConfidenceBandBadge, FitTierBadge } from "@/app/_components/Badge";
import { ScoreBreakdown, useConfidenceBandCopy, useFitTierLabels } from "@/app/features/sub_match/MatchShared";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { styleFor } from "../DecisionsTypes";
import { potentialOf } from "./helpers";
import { ArchetypeTag, Avatar, Pill, SectionTitle } from "./primitives";
import { candIdentity, type EvalCandidate } from "./types";

// ---- Per candidate (full-width tab switcher) ------------------------------

function IconList({ title, items, icon: Icon, tone }: { title: string; items: string[]; icon: LucideIcon; tone: "moss" | "coral" | "steel" }) {
  if (!items.length) return null;
  const color = tone === "moss" ? "text-moss" : tone === "coral" ? "text-coral" : "text-steel";
  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-wide text-steel">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1.5 text-base text-ink">
            <Icon size={15} className={`mt-1 shrink-0 ${color}`} aria-hidden />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// One candidate's full evaluation, laid out across the modal's full width so the
// text-heavy strengths / gaps / probes get room instead of cramped cards.
function CandidateDetail({
  c,
  differentiators,
  topPick,
  decision,
  onDecide,
}: {
  c: EvalCandidate;
  differentiators: string[];
  topPick?: string;
  decision?: "accept" | "reject";
  onDecide?: (label: string, action: "accept" | "reject") => void;
}) {
  const t = useTranslations("decisions.groupEval");
  const enumLabel = useEnumLabel();
  const bandCopy = useConfidenceBandCopy();
  const fitLabels = useFitTierLabels();
  return (
    <div className="rounded-xl border border-stone-200 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar label={c.label} archetype={c.archetype} />
        <div className="min-w-0">
          <p className="font-serif text-h3 text-ink">{c.label}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <ArchetypeTag archetype={c.archetype} />
            {c.seniority ? <Pill>{enumLabel("seniority", c.seniority)}</Pill> : null}
            {c.potentialScore != null ? <PotentialBadge potential={potentialOf(c)} /> : null}
            {c.koPassed === false ? <Pill tone="coral">{t("koFiltered")}</Pill> : null}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ScoreBadge score={c.score} />
          <FitTierBadge tier={c.fitTier} score={c.score} labels={fitLabels} />
          {c.confidence ? <ConfidenceBandBadge level={c.confidence.level} drivers={c.confidence.drivers} copy={bandCopy} /> : null}
          {/* Decide right here (DEC3) — at the moment of highest comparative
              context — instead of closing the modal to open a per-candidate one.
              Reuses the same act()/expectedStage path as the queue. Once decided,
              the buttons collapse to the recorded outcome (the live queue has
              already moved the candidate underneath). */}
          {onDecide ? (
            decision ? (
              <Pill tone={decision === "accept" ? "moss" : "coral"}>
                {decision === "accept" ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                {decision === "accept" ? t("advanced") : t("rejected")}
              </Pill>
            ) : (
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onDecide(candIdentity(c), "reject")}
                  className="focus-ring inline-flex h-8 items-center gap-1 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-coral hover:bg-coral/5"
                >
                  <XCircle size={14} /> {t("reject")}
                </button>
                <button
                  type="button"
                  onClick={() => onDecide(candIdentity(c), "accept")}
                  className="focus-ring inline-flex h-8 items-center gap-1 rounded-md bg-moss px-2.5 text-sm font-semibold text-white hover:opacity-90"
                >
                  <CheckCircle2 size={14} /> {t("advance")}
                </button>
              </span>
            )
          ) : null}
        </div>
      </div>

      {c.scoreBreakdown?.length ? (
        <div className="mt-3">
          {/* A breakdown only exists when the recruiter ranker ran, i.e. score IS the
              fresh total — the `?? 0` is a type-level fallback, unreachable here. */}
          <ScoreBreakdown dims={c.scoreBreakdown} total={c.score ?? 0} />
        </div>
      ) : null}

      {c.verdict ? <p className="mt-3 text-base text-ink">{c.verdict}</p> : null}

      {topPick === c.label && differentiators.length ? (
        <div className="mt-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-steel">{t("uniqueStrengths")}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {differentiators.map((s) => (
              <Pill key={s} tone="moss">
                {s}
              </Pill>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 grid gap-4 md:grid-cols-3">
        <IconList title={t("strengths")} items={c.strengths} icon={CheckCircle2} tone="moss" />
        <IconList title={t("gaps")} items={c.gaps} icon={AlertTriangle} tone="coral" />
        <IconList title={t("interviewProbes")} items={c.interviewProbes ?? []} icon={CircleDot} tone="steel" />
      </div>

      {c.assumptions?.length ? (
        <p className="mt-3 text-sm text-steel">
          <span className="font-semibold uppercase">{t("assumptions")}</span> {c.assumptions.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

export function PerCandidateTabs({
  candidates,
  differentiators,
  topPick,
  decided,
  onDecide,
}: {
  candidates: EvalCandidate[];
  differentiators: string[];
  topPick?: string;
  decided: Record<string, "accept" | "reject">;
  onDecide?: (label: string, action: "accept" | "reject") => void;
}) {
  const t = useTranslations("decisions.groupEval");
  const [active, setActive] = useState(0);
  if (!candidates.length) return null;
  const idx = Math.min(active, candidates.length - 1);
  const current = candidates[idx];

  return (
    <section>
      <SectionTitle>{t("perCandidate")}</SectionTitle>
      <div role="tablist" aria-label={t("candidatesAria")} className="mt-2 flex flex-wrap gap-1 border-b border-stone-200">
        {candidates.map((c, i) => {
          const selected = i === idx;
          const s = styleFor(c.archetype ?? null);
          const tabDecision = decided[candIdentity(c)];
          return (
            <button
              key={candIdentity(c)}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(i)}
              className={`focus-ring -mb-px inline-flex items-center gap-2 rounded-t-md border-b-2 px-3 py-2 text-base font-semibold ${
                selected ? "border-coral text-ink" : "border-transparent text-steel hover:text-ink"
              }`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${s.bg}`} aria-hidden />
              <span className="max-w-[160px] truncate">{c.label}</span>
              {/* A tab badges its decided outcome so the recruiter sees, across the
                  whole pool, who's been actioned without opening each tab. */}
              {tabDecision === "accept" ? (
                <CheckCircle2 size={14} className="text-moss" aria-label={t("advancedAria")} />
              ) : tabDecision === "reject" ? (
                <XCircle size={14} className="text-coral" aria-label={t("rejectedAria")} />
              ) : (
                <ScoreBadge score={c.score} />
              )}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="mt-3">
        <CandidateDetail c={current} differentiators={differentiators} topPick={topPick} decision={decided[candIdentity(current)]} onDecide={onDecide} />
      </div>
    </section>
  );
}
