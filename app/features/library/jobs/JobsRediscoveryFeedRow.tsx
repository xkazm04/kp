"use client";

import { Check, Send, UserPlus, X } from "lucide-react";
import type { useTranslations } from "next-intl";
import type { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { PRIOR_STYLE, type Alert } from "./jobsRediscoveryFeedTypes";
import { pairKey, pairStatus, type GroupView, type Outcomes, type PairStatus, type PersonGroup } from "./jobsRediscoveryFeedGroups";

type T = ReturnType<typeof useTranslations<"jobs.rediscoveryFeed">>;
type TR = ReturnType<typeof useTranslations<"jobs.rediscover">>;

// One silver medalist (challenge-r08 candidate-rediscovery/B). The feed used to be
// one row per person x role; this is one row per PERSON: her best still-open role
// leads with its why-now line, the other roles she clears sit under "Also clears"
// in the same prior-aware rank order, and every role carries its own Reach out /
// Add / Dismiss, so the outcome of one never paints another.
export function JobsRediscoveryFeedRow({
  group,
  view,
  outcomes,
  rowError,
  onAdd,
  onReach,
  onDismiss,
  t,
  tr,
  enumLabel,
}: {
  group: PersonGroup;
  view: GroupView;
  outcomes: Outcomes;
  rowError: ReadonlyMap<string, string>;
  onAdd: (a: Alert) => void;
  onReach: (a: Alert) => void;
  onDismiss: (a: Alert) => void;
  t: T;
  tr: TR;
  // Hoisted out of the row: the labeller is stable and cheap to pass, while
  // calling the hook here opened one `enums` translator subscription per alert.
  enumLabel: ReturnType<typeof useEnumLabel>;
}) {
  // The lead is the best role still offered; once every role is done or withheld
  // it falls back to her best role so the row still says who she is.
  const lead = view.next ?? group.best;
  const others = group.roles.filter((a) => a.id !== lead.id);
  const status = (a: Alert) => pairStatus(outcomes, a.candidateId, a.jobId);
  const actions = (a: Alert, compact: boolean) => (
    <RoleActions a={a} status={status(a)} compact={compact} onAdd={onAdd} onReach={onReach} onDismiss={onDismiss} t={t} tr={tr} />
  );
  const leadError = rowError.get(pairKey(lead.candidateId, lead.jobId));

  return (
    <li className="rounded-md border border-stone-200 bg-white px-3 py-2">
      <div className="flex items-center gap-3">
        <span className="shrink-0">
          <ScoreBadge score={lead.score} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-ink">
            {t.rich("clears", {
              label: group.label,
              role: lead.jobTitle,
              b: (chunks) => <span className="font-semibold">{chunks}</span>,
            })}
            {group.roles.length > 1 ? (
              <span className="ml-2 text-meta text-steel">{t("roleCount", { count: group.roles.length })}</span>
            ) : null}
          </p>
          {/* feed-tells-why: rows carrying the live prior shape (stage present)
              tell the SAME localized why-now the panel does — whyNow.{kind} plus
              the "reached {stage}" disclosure when the band-limited depth boost
              lifted this candidate (depth > 0). Legacy rows (stage null, written
              before the migration) fall back to the persisted English chip. */}
          {lead.prior.stage ? (
            <p className="mt-1 text-sm leading-snug text-steel">
              {tr(`whyNow.${lead.prior.kind}`, { jobTitle: lead.jobTitle, score: lead.score })}
              {(lead.prior.depth ?? 0) > 0
                ? " " + tr("whyNow.reached", { stage: enumLabel("stage", lead.prior.stage) })
                : ""}
            </p>
          ) : (
            <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-meta ${PRIOR_STYLE[lead.prior.kind] ?? PRIOR_STYLE.elsewhere}`}>
              {lead.prior.label}
            </span>
          )}
          {leadError ? <p className="mt-0.5 text-meta text-coral">{leadError}</p> : null}
        </div>
        {actions(lead, false)}
      </div>
      {others.length > 0 ? (
        <div className="mt-2 border-t border-stone-100 pt-2">
          <p className={META_LABEL}>{t("alsoClears")}</p>
          <ul className="mt-1 space-y-1">
            {others.map((a) => {
              const err = rowError.get(pairKey(a.candidateId, a.jobId));
              return (
                <li key={a.id} className="flex items-center gap-2">
                  <span className="shrink-0">
                    <ScoreBadge score={a.score} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{a.jobTitle}</p>
                    {err ? <p className="text-meta text-coral">{err}</p> : null}
                  </div>
                  {actions(a, true)}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

const ACTION_BTN =
  "focus-ring inline-flex items-center gap-1.5 rounded-md border border-coral/40 bg-coral/5 text-sm font-semibold text-coral hover:bg-coral/10 disabled:opacity-50";

// One role's affordance, by its PAIR status: done badges, a withheld note, or the
// three actions. A pending pair keeps its buttons, disabled, so the row does not jump.
function RoleActions({
  a,
  status,
  compact,
  onAdd,
  onReach,
  onDismiss,
  t,
  tr,
}: {
  a: Alert;
  status: PairStatus;
  compact: boolean;
  onAdd: (a: Alert) => void;
  onReach: (a: Alert) => void;
  onDismiss: (a: Alert) => void;
  t: T;
  tr: TR;
}) {
  if (status === "added" || status === "reached") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-moss">
        <Check size={14} /> {status === "added" ? t("added") : tr("reachedOut")}
      </span>
    );
  }
  if (status === "withheld") {
    return <span className="shrink-0 text-sm text-steel">{t("withheld")}</span>;
  }
  const pending = status === "pending";
  const pad = compact ? "p-1.5" : "px-2.5 py-1.5";
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => onReach(a)}
        disabled={pending}
        title={tr("reachTitle")}
        aria-label={compact ? `${tr("reachOut")}: ${a.jobTitle}` : undefined}
        className={`${ACTION_BTN} ${pad}`}
      >
        <Send size={14} /> {compact ? null : tr("reachOut")}
      </button>
      <button
        type="button"
        onClick={() => onAdd(a)}
        disabled={pending}
        title={t("addToPipeline")}
        aria-label={compact ? `${t("addToPipeline")}: ${a.jobTitle}` : undefined}
        className={`${ACTION_BTN} ${pad}`}
      >
        <UserPlus size={14} /> {compact ? null : t("addToPipeline")}
      </button>
      <button
        type="button"
        onClick={() => onDismiss(a)}
        disabled={pending}
        title={t("dismiss")}
        aria-label={`${t("dismiss")}: ${a.jobTitle}`}
        className="focus-ring inline-flex items-center rounded-md border border-stone-200 bg-white p-1.5 text-steel hover:text-ink disabled:opacity-50"
      >
        <X size={14} />
      </button>
    </div>
  );
}
