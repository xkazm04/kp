"use client";

// Who sits in the comparison, by the rule that seated them: the role's applicants, the pool's
// best matches by the deterministic rank, the ones added by hand. The cap is drawn as seats; the
// candidates the cap left out are counted, never hidden; a member whose analysis of THIS role
// already exists says it is reused at no cost. Zero candidates is its own state with a way to
// get some — distinct from "fewer than the head-to-head floor", which the run sheet explains.
import { useEffect, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { IconAction } from "@/app/_components/IconAction";
import { CHIP_QUIET, META_LABEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { COHORT_CAP, type CohortProposal } from "./cohortTypes";
import { groupByMembership, type Tray, type TrayMember } from "./cohortProposalEdits";
import { CohortSeats, SeatKey } from "./CohortSeats";
import { CohortAddMember } from "./CohortAddMember";

const LINK = "font-semibold text-coral underline-offset-2 hover:underline";

export function CohortProposalTray({
  proposal,
  tray,
  onRemove,
  onAdd,
}: {
  proposal: CohortProposal;
  tray: Tray;
  onRemove: (memberId: string) => void;
  onAdd: (member: TrayMember) => void;
}) {
  const t = useTranslations("analyzeCohort.shell.tray");
  const n = tray.members.length;
  const { applicants, matched } = proposal.leftOut;
  const rootRef = useRef<HTMLElement>(null);
  // A removed ticket takes its button with it: focus moves to the neighbour's, else the heading.
  const focusNext = useRef<string | null | undefined>(undefined);
  const remove = (memberId: string) => {
    const ids = tray.members.map((m) => m.memberId);
    const i = ids.indexOf(memberId);
    focusNext.current = ids[i + 1] ?? ids[i - 1] ?? null;
    onRemove(memberId);
  };
  useEffect(() => {
    const next = focusNext.current;
    if (next === undefined) return;
    focusNext.current = undefined;
    const root = rootRef.current;
    const target = next ? root?.querySelector<HTMLElement>(`[data-member="${CSS.escape(next)}"] button`) : null;
    (target ?? root?.querySelector<HTMLElement>("#cohort-tray-h"))?.focus();
  }, [n]);
  return (
    <section ref={rootRef} aria-labelledby="cohort-tray-h" className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h3 id="cohort-tray-h" tabIndex={-1} className="font-serif text-h2 text-ink outline-none">
          {t("title")}
        </h3>
        <div className="flex items-center gap-3">
          <CohortSeats seats={tray.members.map((m) => ({ key: m.memberId, tone: m.membership }))} label={t("seats", { n, cap: COHORT_CAP })} />
          <span className="whitespace-nowrap text-body text-ink nums" aria-hidden>
            {t("seatsShort", { n, cap: COHORT_CAP })}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1" aria-hidden>
        <SeatKey tone="applicant">{t("group.applicant")}</SeatKey>
        <SeatKey tone="matched">{t("group.matched")}</SeatKey>
        <SeatKey tone="added">{t("group.added")}</SeatKey>
      </div>
      {applicants + matched > 0 ? (
        <p className="text-body text-steel">
          {applicants > 0 ? t("leftOutApplicants", { n: applicants, cap: COHORT_CAP }) : null}
          {applicants > 0 && matched > 0 ? " " : null}
          {matched > 0 ? t("leftOutMatched", { n: matched, cap: COHORT_CAP }) : null}
        </p>
      ) : null}

      {n === 0 ? (
        <div className={`${PANEL_SUNKEN} space-y-2 p-6`}>
          <p className="text-h3 text-ink">{t("emptyTitle")}</p>
          <p className="text-body text-steel">
            {t.rich("empty", {
              pipeline: (c) => <Link href="/?tab=pipeline" className={LINK}>{c}</Link>,
              profiles: (c) => <Link href="/?tab=archetypes" className={LINK}>{c}</Link>,
            })}
          </p>
        </div>
      ) : (
        groupByMembership(tray.members).map((g) => (
          <div key={g.membership} className="space-y-2">
            <h4 className={META_LABEL}>
              {t(`group.${g.membership}`)} · <span className="nums">{g.members.length}</span>
            </h4>
            <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {g.members.map((m) => (
                <Ticket key={m.memberId} member={m} onRemove={() => remove(m.memberId)} />
              ))}
            </ul>
          </div>
        ))
      )}
      <CohortAddMember tray={tray} onAdd={onAdd} />
    </section>
  );
}

function Ticket({ member, onRemove }: { member: TrayMember; onRemove: () => void }) {
  const t = useTranslations("analyzeCohort.shell.tray");
  return (
    <li className="cs-ticket" data-membership={member.membership} data-member={member.memberId}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-h3 text-ink">{member.label}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-micro text-steel">
          <span className="nums">{member.matchScore != null ? t("match", { n: member.matchScore }) : t(`noMatch.${member.membership}`)}</span>
          {member.reuseKnown && member.reusable ? <span className={CHIP_QUIET}>{t("reused")}</span> : null}
        </p>
      </div>
      <IconAction icon={X} label={t("remove", { name: member.label })} onClick={onRemove} size={16} />
    </li>
  );
}
