"use client";

import type { CSSProperties, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ScenePress } from "@/app/_components/kit/scene";
import { ABSENT, KitIcon } from "@/app/_components/kit";
import type { CohortMember, CohortView } from "../cohortTypes";
import type { AbsentGroup } from "./dimensionModel";
export { makeStops } from "./dimensionModel";
import { useAbsentWord } from "./useCohortLabel";

/** What every page body receives from the dispatcher (DimensionPageProps without the dimension). */
export interface PageProps {
  view: CohortView;
  focusMemberId: string | null;
  onFocusMember: (memberId: string | null) => void;
  onOpenReport: (analysisSlug: string) => void;
}

/** The member as a press: focuses them (onFocusMember). The drawing inside is the caller's. */
export function MemberPress({ member, focusId, stop, onFocusMember, label, tip, className, style, children }: {
  member: CohortMember;
  focusId: string | null;
  stop: boolean;
  onFocusMember: (id: string | null) => void;
  label: string;
  tip?: string;
  className: string;
  /** Position only (custom properties a page's sheet reads), never colour. */
  style?: CSSProperties;
  children: ReactNode;
}) {
  const on = focusId === member.memberId;
  return (
    <ScenePress
      className={className}
      style={style}
      data-dim-member={member.memberId}
      data-dim-stop={stop ? "" : undefined}
      data-on={on ? "" : undefined}
      data-dim-tip={tip}
      aria-pressed={on}
      aria-label={label}
      onClick={() => onFocusMember(member.memberId)}
    >
      {children}
    </ScenePress>
  );
}

/** The member's label: it opens the full report when the analysis has landed, else it is text. */
export function MemberName({ member, onOpenReport }: { member: CohortMember; onOpenReport: (slug: string) => void }) {
  const t = useTranslations("analyzeCohort.pages.common");
  const slug = member.analysisSlug;
  if (!slug) return <span className="cd-name">{member.label}</span>;
  return (
    <ScenePress
      className="cd-name cd-name--link"
      aria-label={t("openReport", { name: member.label })}
      data-dim-tip={t("openReport", { name: member.label })}
      onClick={() => onOpenReport(slug)}
    >
      <span className="cd-name__text">{member.label}</span>
      <KitIcon name="open" />
    </ScenePress>
  );
}

/** A rare model comment: a small mark that opens on hover, focus or press (never `title=`). */
export function CommentMark({ name, text }: { name: string; text: string | undefined }) {
  const t = useTranslations("analyzeCohort.pages.common");
  if (!text) return null;
  return (
    <ScenePress className="cd-comment" aria-label={t("comment", { name, text })} data-dim-tip={text}>
      <svg viewBox="0 0 16 16" aria-hidden>
        <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2Z" />
      </svg>
    </ScenePress>
  );
}

/** A member dominated on every compared dimension: marked quietly, the reason one focus away. */
export function DecoyMark({ member, view }: { member: CohortMember; view: CohortView }) {
  const t = useTranslations("analyzeCohort.pages.common");
  if (!member.decoyOf) return null;
  const over = view.members.find((m) => m.memberId === member.decoyOf)?.label ?? member.decoyOf;
  const why = t("decoy", { name: over });
  return (
    <span className="cd-decoy" role="img" tabIndex={0} aria-label={why} data-dim-tip={why}>
      {t("decoyShort")}
    </span>
  );
}

/**
 * The honest remainder under every page: who is still analyzing (drawn unfilled, never hidden)
 * and who has no reading on this dimension, grouped by WHY. Never a 0, never empty space.
 */
export function Remainder({ pending, groups, focusId, onFocusMember, stops, title }: {
  pending: CohortMember[];
  groups: AbsentGroup[];
  focusId: string | null;
  onFocusMember: (id: string | null) => void;
  stops: (id: string, slot: string) => boolean;
  title?: string;
}) {
  const t = useTranslations("analyzeCohort.pages.common");
  const reasonWord = useAbsentWord();
  if (!pending.length && !groups.length) return null;
  const rows: AbsentGroup[] = [...(pending.length ? [{ reason: "pending" as const, members: pending }] : []), ...groups];
  const word = (g: AbsentGroup) => (g.note === "readFailed" ? t("readFailed") : reasonWord(g.reason));
  return (
    <section className="cd-rest" aria-label={title ?? t("notCompared")}>
      <h3 className="cd-rest__title">{title ?? t("notCompared")}</h3>
      <ul className="cd-rest__groups">
        {rows.map((g) => (
          <li key={`${g.reason}-${g.note ?? ""}`} className="cd-rest__group" data-reason={g.reason}>
            <span className="cd-rest__why">
              <span className="cd-dash" aria-hidden>
                {ABSENT}
              </span>
              {word(g)}
              <span className="cd-rest__n k-nums">{g.members.length}</span>
            </span>
            <span className="cd-rest__who">
              {g.members.map((m) => (
                <MemberPress
                  key={m.memberId}
                  member={m}
                  focusId={focusId}
                  stop={stops(m.memberId, "rest")}
                  onFocusMember={onFocusMember}
                  label={t("absentMember", { name: m.label, reason: word(g) })}
                  className="cd-chip cd-chip--absent"
                >
                  {m.label}
                </MemberPress>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
