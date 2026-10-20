"use client";

import type { CSSProperties } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ScenePress } from "@/app/_components/kit/scene";
import { ABSENT, KitIcon } from "@/app/_components/kit";
import type { CohortDimension, CohortMember } from "../../cohortTypes";
import { useAbsentWord } from "../../dimensions/useCohortLabel";
import type { fieldOf } from "./headToHeadModel";

const PICK = "hh-frow__pick";
const PIN = "hh-frow__pin";

interface RowProps {
  member: CohortMember;
  dimension: CohortDimension;
  /** "#3" / "=3" for a rated row; null when unrated or on salary (never ranked). */
  rank: string | null;
  /** Why the row has no reading, or null when it has one. */
  absent: string | null;
  focusId: string | null;
  inBoard: boolean;
  full: boolean;
  onFocus: (id: string | null) => void;
  onPin: (m: CohortMember) => void;
}

function FieldRowView({ member: m, dimension, rank, absent, focusId, inBoard, full, onFocus, onPin }: RowProps) {
  const t = useTranslations("analyzeCohort.layerHeadToHead.field");
  const format = useFormatter();
  const focus = focusId === m.memberId;
  const rating = m.cells[dimension].rating;
  const salary = dimension === "salary" ? m.detail.salary : null;
  // salary rows show the figure (an expectation in another currency too: shown, never compared)
  const money = salary?.midpoint != null && salary.currency ? `${format.number(salary.midpoint, { notation: "compact" })} ${salary.currency}` : null;
  const figure = money && (rating != null || m.cells.salary.absentReason === "currencyMismatch") ? money : rating == null ? ABSENT : String(rating);
  const pinLabel = focus ? t("unfocus", { name: m.label }) : inBoard ? t("drop", { name: m.label }) : t("add", { name: m.label });
  const blocked = !inBoard && !focus && (absent != null || full);
  const pinTip = blocked ? (absent != null ? t("noReading", { name: m.label, reason: absent }) : t("full")) : pinLabel;
  return (
    <li className="hh-frow" data-in={inBoard || focus ? "" : undefined} data-focus={focus ? "" : undefined} data-absent={absent != null ? "" : undefined}>
      <ScenePress
        className={PICK}
        data-dim-member={m.memberId}
        data-h2h-stop=""
        aria-pressed={focus}
        aria-label={absent != null ? t("focusAbsent", { name: m.label, reason: absent }) : t("focusRated", { name: m.label, figure })}
        onClick={() => onFocus(m.memberId)}
      >
        <span className="hh-frow__rank k-nums" aria-hidden>
          {rank ?? ""}
        </span>
        <span className="hh-frow__name">{m.label}</span>
        <span className="hh-frow__num k-nums" aria-hidden>
          {figure}
        </span>
        {rating != null ? <span className="hh-frow__bar" aria-hidden style={{ "--v": rating } as CSSProperties} /> : null}
      </ScenePress>
      <ScenePress
        className={PIN}
        aria-pressed={inBoard || focus}
        aria-disabled={blocked || undefined}
        aria-label={pinTip}
        data-dim-tip={pinTip}
        onClick={() => (blocked ? undefined : focus ? onFocus(null) : onPin(m))}
      >
        <KitIcon name={inBoard || focus ? "check" : "plus"} />
      </ScenePress>
    </li>
  );
}

/**
 * The field: everyone in the cohort, as the picker. Rated candidates by this dimension's rating
 * (an order, never a lead; salary by closeness to the band, never ranked), then the still-analyzing
 * drawn unfilled, then the absent grouped by why. Pressing a name puts them in focus (the first
 * column; j/k walks it); the pin adds or takes out a rival, up to four side by side.
 */
export function H2HField({ dimension, field, focusId, inBoard, full, onFocus, onPin }: {
  dimension: CohortDimension;
  field: ReturnType<typeof fieldOf>;
  focusId: string | null;
  inBoard: ReadonlySet<string>;
  full: boolean;
  onFocus: (id: string | null) => void;
  onPin: (m: CohortMember) => void;
}) {
  const t = useTranslations("analyzeCohort.layerHeadToHead.field");
  const td = useTranslations("analyzeCohort.dims");
  const reason = useAbsentWord();
  const common = { dimension, focusId, full, onFocus, onPin };
  const groups = [
    ...(field.pending.length ? [{ key: "pending", word: reason("pending"), members: field.pending }] : []),
    ...field.absent.map((g) => ({ key: g.reason, word: reason(g.reason), members: g.members })),
  ];
  return (
    <section className="hh-field" data-dimension={dimension} aria-label={t("title")}>
      <h4 className="hh-field__title">{t("title")}</h4>
      <p className="hh-field__order">{dimension === "salary" ? t("orderSalary") : t("order", { dimension: td(dimension) })}</p>
      <ol className="hh-field__list">
        {field.rated.map((r) => (
          <FieldRowView
            key={r.member.memberId}
            member={r.member}
            rank={dimension === "salary" ? null : `${r.tied ? "=" : "#"}${r.rank}`}
            absent={null}
            inBoard={inBoard.has(r.member.memberId)}
            {...common}
          />
        ))}
      </ol>
      {groups.map((g) => (
        <div key={g.key} className="hh-field__group" data-reason={g.key}>
          <p className="hh-field__why">
            <span aria-hidden>{ABSENT}</span> {g.word} <span className="k-nums">{g.members.length}</span>
          </p>
          <ul className="hh-field__list">
            {g.members.map((m) => (
              <FieldRowView key={m.memberId} member={m} rank={null} absent={g.word} inBoard={inBoard.has(m.memberId)} {...common} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
