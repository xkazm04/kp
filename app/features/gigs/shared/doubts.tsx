"use client";

import { Tooltip } from "@/app/_components/Tooltip";
import { type DraftLintFinding, lintDraft } from "@/app/_lib/gigs/draft-lint";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { useGigsFormat } from "../data/useGigsFormat";
import { parseReviewNote, type ReviewNote } from "../logic/reviewNote";
import type { SourceRow } from "../logic/wire";
import { useLintText } from "./useLintText";

// What to doubt about one gig, in one vocabulary for the front page's marks and the
// proof's slip (B/3 "The Proof"). Two sources, kept apart:
//   the pre-send lint  app/_lib/gigs/draft-lint.ts - deterministic, tested, and THE gate:
//                      a blocker keeps Approve disabled, a warn until it is marked seen.
//   the reviewer note  the reviewer agent's pre-send review, read into its parts
//                      (logic/reviewNote parseReviewNote). Advisory: its blocker is shown first
//                      and plainly, but it is the reviewer's call, never a gate.
// Marks differ by SHAPE: a stop is a filled coral diamond, a doubt a hollow ring, a note a
// small dot - and every row says its sentence in words, so nothing is hover-only.

export type DoubtSev = "stop" | "doubt" | "note";

export type Doubt = {
  sev: DoubtSev;
  key: string;
  label: string;
  detail: string | null;
  /** The lint findings this row stands for (a row of open questions stands for several). */
  findings: DraftLintFinding[];
  /** True when the row gates Approve (a lint blocker or warn). */
  gates: boolean;
  /** The row came from the reviewer agent's note. */
  review: boolean;
};

const RANK: Record<DoubtSev, number> = { stop: 0, doubt: 1, note: 2 };

/** A gig's doubts: the lint findings (open questions grouped into one row), the reviewer
 *  note's verdict, and the states that are not a draft at all (quarantined, still running,
 *  nothing came back). Sorted stop, doubt, note. */
export function useDoubts() {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const lintText = useLintText();
  return useCallback(
    (gig: Gig, attempt: GigAttempt | null, source: SourceRow | null, now: Date): { doubts: Doubt[]; findings: DraftLintFinding[]; note: ReviewNote | null } => {
      const out: Doubt[] = [];
      const push = (d: Omit<Doubt, "findings" | "gates" | "review"> & Partial<Pick<Doubt, "findings" | "gates" | "review">>) =>
        out.push({ findings: [], gates: false, review: false, ...d });
      if (gig.status === "suspect") push({ sev: "stop", key: "suspect", label: t("slip.quarantined"), detail: gig.suspectReasons.map((r) => fmt.suspect(r)).join(", ") });
      if (!attempt) return { doubts: out, findings: [], note: null };
      if (attempt.status === "running" || attempt.status === "dispatched") {
        push({ sev: "note", key: "running", label: t("slip.running"), detail: null });
        return { doubts: out, findings: [], note: null };
      }
      const onDesk = attempt.status === "drafted" || attempt.status === "approved";
      const findings = onDesk ? lintDraft({ gig, attempt, source, now }) : [];
      const questions = findings.filter((f) => f.messageKey === "questionOpen");
      for (const f of findings) {
        if (f.messageKey === "questionOpen") continue;
        push({ sev: f.severity === "blocker" ? "stop" : f.severity === "warn" ? "doubt" : "note", key: f.id, label: lintText(f), detail: null, findings: [f], gates: f.severity !== "info" });
      }
      if (questions.length) {
        push({
          sev: "doubt",
          key: "questions",
          label: t("slip.questions", { count: questions.length }),
          detail: typeof questions[0].params.question === "string" ? questions[0].params.question : null,
          findings: questions,
          gates: true,
        });
      }
      const note = onDesk ? parseReviewNote(attempt.review?.note) : null;
      if (note && note.header) {
        const firstBlocker = note.defects.find((d) => d.blocker)?.text ?? null;
        if (note.blockers > 0) push({ sev: "stop", key: "review:blockers", label: t("slip.reviewBlockers", { count: note.blockers }), detail: firstBlocker, review: true });
        else if (note.verdict === "warnings") {
          const n = note.items.length + note.defects.length;
          push({ sev: "doubt", key: "review:warnings", label: t("slip.reviewWarnings", { count: n }), detail: note.items[0] ?? note.defects[0]?.text ?? null, review: true });
        }
      }
      out.sort((a, b) => RANK[a.sev] - RANK[b.sev]);
      return { doubts: out, findings, note };
    },
    [t, fmt, lintText]
  );
}

/** The marks a row carries: one diamond per stop, a ring per doubt (up to five), a moss
 *  tick when nothing was found, a dash while the run is still out. Its sentence is the
 *  accessible name AND the tooltip. */
export function DoubtMarks({ doubts, running = false }: { doubts: readonly Doubt[]; running?: boolean }) {
  const t = useTranslations("gigs");
  const stops = doubts.filter((d) => d.sev === "stop");
  const dbs = doubts.filter((d) => d.sev === "doubt");
  if (running) {
    return (
      <Tooltip label={t("slip.marksRunning")}>
        <span className="marks" role="img" aria-label={t("slip.marksRunning")} tabIndex={-1}>
          <i className="mk none" />
        </span>
      </Tooltip>
    );
  }
  const label = stops.length || dbs.length ? t("slip.marksLabel", { stops: stops.length, doubts: dbs.length }) : t("slip.marksClean");
  const lines = [...stops, ...dbs].map((d) => `${d.sev === "stop" ? "◆" : "○"} ${d.label}`).join("\n");
  return (
    <Tooltip label={lines || label}>
      <span className="marks" role="img" aria-label={label}>
        {stops.length || dbs.length ? (
          <>
            {stops.map((d) => (
              <i key={d.key} className="mk stop" />
            ))}
            {dbs.slice(0, 5).map((d) => (
              <i key={d.key} className="mk doubt" />
            ))}
          </>
        ) : (
          <i className="mk clean" />
        )}
      </span>
    </Tooltip>
  );
}
