"use client";

import { useTranslations } from "next-intl";
import type { MarginNote } from "../logic/galley";
import type { useLintText } from "../shared/useLintText";

// One pinned note's words: its letter, what it says (a lint finding in the reader's language,
// a reviewer's note verbatim), and where it came from. The galley's margin (Galley.tsx) and the
// Summary prototypes' letter and compose views (report/variants/) all set a note with it.

export function NoteText({ note: n, lintText, reviewBy }: { note: MarginNote; lintText: ReturnType<typeof useLintText>; reviewBy: string }) {
  const t = useTranslations("gigs");
  return (
    <>
      <span className="k">{n.key}</span>
      <span>
        {n.source === "lint" && n.finding ? lintText(n.finding) : n.text}
        <span className="src">
          {n.source === "lint" ? t("proof.srcLint", { severity: t(`lint.severity.${n.finding?.severity ?? "info"}`) }) : `${reviewBy} · ${n.role === "defect" ? t("proof.roleDefect") : t("proof.roleMustDo", { n: Number((n.role ?? "").replace(/\D/g, "")) || 0 })}`}
        </span>
      </span>
    </>
  );
}

export const noteClass = (n: MarginNote) => `mnote${n.source === "lint" ? " lint" : ""}${n.blocker ? " blocker" : ""}`;

/** The gig's draft is on the desk: the galley proofs it (else it shows a stamp saying why not). */
export const draftOnDesk = (gigStatus: string, attempt: { status: string; deliverable: unknown } | null) =>
  gigStatus !== "suspect" && attempt !== null && !!attempt.deliverable && (attempt.status === "drafted" || attempt.status === "approved");
