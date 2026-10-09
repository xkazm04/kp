"use client";

// One member as a card (the narrow fallback): rank, name (the full report when it has landed),
// the rule that seated them, the quiet decoy mark, then the seven dimensions as a compact list.
// A rated cell shows its short label; an absent one shows "—" and its reason, never a 0. The
// rare model comment is a mark that opens on focus, hover or press.
import { useTranslations } from "next-intl";
import { MessageSquareText } from "lucide-react";
import { ABSENT } from "@/app/_components/kit/figure";
import { IconAction } from "@/app/_components/IconAction";
import { Tooltip } from "@/app/_components/Tooltip";
import { BTN_GHOST, CHIP_QUIET, PANEL } from "@/app/_components/ui/recipes";
import {
  COHORT_DIMENSIONS,
  type CohortCell,
  type CohortDimension,
  type CohortMember,
  type CohortView,
  type ShortLabel,
} from "./cohortTypes";

type LooseT = (key: string, values?: Record<string, string | number>) => string;

const NAME_BTN =
  "focus-ring min-w-0 truncate rounded-md text-left text-h3 text-ink underline-offset-2 hover:underline";
const DIM_BTN = `${BTN_GHOST} h-9 w-full justify-between gap-3 px-2 text-body`;

export function CohortMemberCard({
  member,
  view,
  onOpenDimension,
  onOpenReport,
}: {
  member: CohortMember;
  view: CohortView;
  onOpenDimension: (dimension: CohortDimension, memberId: string) => void;
  onOpenReport: (analysisSlug: string) => void;
}) {
  const t = useTranslations("analyzeCohort.shell.cards");
  const tc = useTranslations("analyzeCohort");
  const loose = tc as unknown as LooseT;
  const label = (l: ShortLabel) => loose(`labels.${l.key}`, l.params);
  const value = (c: CohortCell) =>
    c.tier === "absent"
      ? `${ABSENT} ${tc(`absent.${c.absentReason ?? "notRead"}`)}`
      : label(c.label);
  const decoyOf = member.decoyOf
    ? (view.members.find((m) => m.memberId === member.decoyOf)?.label ?? null)
    : null;
  const fit = member.cells.fit;
  // A member with nothing landed (pending, failed, blind-redacted) says it once, not seven times.
  const reasons = new Set(
    COHORT_DIMENSIONS.map((d) =>
      member.cells[d].tier === "absent"
        ? (member.cells[d].absentReason ?? "notRead")
        : null,
    ),
  );
  const sameAbsence = reasons.size === 1 ? [...reasons][0] : null;
  const slug = member.analysisSlug;

  return (
    <article
      className={`${PANEL} space-y-3 p-4`}
      data-member={member.memberId}
      data-run={member.runState}
    >
      <div className="flex items-start gap-3">
        <span
          className="font-serif text-h2 leading-none text-ink nums"
          aria-label={
            member.fitRank ? t("rank", { n: member.fitRank }) : t("unranked")
          }
        >
          {member.fitRank ?? "—"}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          {slug ? (
            <button
              type="button"
              className={NAME_BTN}
              onClick={() => onOpenReport(slug)}
            >
              {member.label}
            </button>
          ) : (
            <p className="truncate text-h3 text-ink">{member.label}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className={CHIP_QUIET}>
              {t(`membership.${member.membership}`)}
            </span>
            {decoyOf ? (
              <Tooltip label={t("decoyWhy", { other: decoyOf })}>
                <span tabIndex={0} className={`${CHIP_QUIET} focus-ring`}>
                  {t("decoy")}
                </span>
              </Tooltip>
            ) : null}
          </div>
        </div>
        <p className="shrink-0 text-right text-body text-ink">
          {fit.tier === "absent" ? (
            <span className="text-steel">{value(fit)}</span>
          ) : (
            <span className="font-semibold">{t(`tier.${fit.tier}`)}</span>
          )}
        </p>
      </div>
      {sameAbsence ? (
        <p className="text-body text-steel">
          {t("allAbsent", { reason: tc(`absent.${sameAbsence}`) })}
        </p>
      ) : (
        <ul
          className="divide-y divide-stone-200"
          aria-label={t("dimsOf", { name: member.label })}
        >
          {COHORT_DIMENSIONS.map((d) => {
            const c = member.cells[d];
            return (
              <li key={d} className="flex items-center gap-1">
                <button
                  type="button"
                  className={DIM_BTN}
                  data-card-opener={`${member.memberId}:${d}`}
                  onClick={() => onOpenDimension(d, member.memberId)}
                >
                  <span className="text-steel">{tc(`dims.${d}`)}</span>
                  <span
                    className={`truncate ${c.tier === "absent" ? "text-steel" : "text-ink"}`}
                  >
                    {value(c)}
                  </span>
                </button>
                {c.comment ? (
                  <IconAction
                    icon={MessageSquareText}
                    label={t("comment")}
                    hint={c.comment}
                    side="left"
                    size={16}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
