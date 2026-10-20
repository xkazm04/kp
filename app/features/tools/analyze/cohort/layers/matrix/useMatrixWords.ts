"use client";

import { useTranslations } from "next-intl";
import type { CohortDimension, CriterionStatus } from "../../cohortTypes";
import type { ColMarks } from "./MatrixCells";
import type { Entry, HeadClaim, MatrixColumn, Voice } from "./matrixModel";
import { usePhrase } from "./usePhrase";
import { useCohortLabel } from "../../dimensions/useCohortLabel";

/** The matrix's sentences in one place: every accessible name and tip a cell carries. */
export function useMatrixWords() {
  const t = useTranslations("analyzeCohort.layerMatrix");
  const tCommon = useTranslations("analyzeCohort.pages.common");
  const phrase = usePhrase();
  const label = useCohortLabel();
  const nameOf = (columns: readonly MatrixColumn[], id: string | null) => columns.find((c) => c.member.memberId === id)?.member.label ?? "";
  const status = (voice: Voice, s: CriterionStatus) => t(`status.${voice}.${s}`);
  const pendingLabel = (name: string) => t("colPending", { name });

  return {
    status,
    pendingLabel,
    headLine: (head: NonNullable<HeadClaim>, columns: readonly MatrixColumn[]) =>
      head.kind === "clears" ? t("headClears", { name: nameOf(columns, head.leader) }) : t("headNoise", { count: head.count }),
    colLabel: (c: MatrixColumn, d: CohortDimension, m: ColMarks, columns: readonly MatrixColumn[]) => {
      if (c.state === "pending") return pendingLabel(c.member.label);
      const extras = [m.lead ? t("leadMark") : null, m.noise ? t("noiseMark") : null, c.member.decoyOf ? tCommon("decoy", { name: nameOf(columns, c.member.decoyOf) || c.member.decoyOf }) : null].filter(Boolean);
      // the cell's own short label (a figure, a count) rides along: salary's figure is the column's order
      const short = label(c.member.cells[d].label);
      const args = { name: c.member.label, rating: c.rating ?? "—" };
      const base = short ? t("colWith", { ...args, label: short }) : t("col", args);
      return [base, ...extras].join(" ");
    },
    cellLabel: (name: string, criterion: string, voice: Voice, e: Entry | null) => {
      if (!e) return t("cellPending", { name, criterion });
      const s = status(voice, e.status);
      return e.note ? t("cellNote", { name, criterion, status: s, note: phrase(e.note) }) : t("cell", { name, criterion, status: s });
    },
    diffLabel: (columns: readonly MatrixColumn[], a: string | null, b: string | null) => t("differs", { a: nameOf(columns, a), b: nameOf(columns, b) }),
    footLabel: (c: MatrixColumn, d: CohortDimension) => {
      const w = c.member.why[d];
      if (c.state === "pending" || !w) return pendingLabel(c.member.label);
      const cell = c.member.cells[d];
      const args = { name: c.member.label, rating: cell.rating ?? "—", tier: t(`tier.${cell.tier}`), why: phrase(w.why) };
      return cell.comment ? t("ratingComment", { ...args, comment: cell.comment }) : t("rating", args);
    },
  };
}
