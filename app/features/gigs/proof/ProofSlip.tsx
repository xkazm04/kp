"use client";

import { useTranslations } from "next-intl";
import type { LooseNote } from "../logic/galley";
import type { Doubt } from "../shared/doubts";

/** A pinned margin note's place, for a jump from the slip. */
export type SlipTarget = { kind: "note"; key: string } | { kind: "evidence"; n: number };

/** The proof slip: every doubt in words, above the galley. A gating warn carries its
 *  "seen" box; a lint blocker says it blocks Approve; the reviewer's rows say they are the
 *  reviewer's call. Reviewer marks that quote nothing in the draft are listed here, never
 *  dropped; the revision note this proof carries is one fold away. */
export function ProofSlip({
  doubts,
  pinnedKeyOf,
  pinnedCount,
  loose,
  seen,
  onSeen,
  onJump,
  carriedNote,
}: {
  doubts: readonly Doubt[];
  /** The margin letter a lint finding was pinned under, if it was. */
  pinnedKeyOf: (findingId: string) => string | null;
  pinnedCount: number;
  loose: readonly LooseNote[];
  seen: ReadonlySet<string>;
  onSeen: (ids: string[], value: boolean) => void;
  onJump: (target: SlipTarget) => void;
  carriedNote: string | null;
}) {
  const t = useTranslations("gigs");
  const rows = doubts.filter((d) => d.sev !== "note");
  const notes = doubts.filter((d) => d.sev === "note");
  const stops = rows.filter((d) => d.sev === "stop").length;
  const clean = rows.length === 0 && loose.length === 0;

  return (
    <section className="slip" aria-label={t("slip.label")}>
      <div className="caps">
        <span>{t("slip.title")}</span>
        {stops ? <span className="coral">{t("slip.stops", { count: stops })}</span> : null}
        {rows.length - stops ? <span className="dim">{t("slip.doubts", { count: rows.length - stops })}</span> : null}
        {pinnedCount ? <span className="dim">{t("slip.pinned", { count: pinnedCount })}</span> : null}
        {clean ? <span className="clean">{t("slip.nothing")}</span> : null}
      </div>
      {clean ? <p className="t-meta after">{t("lint.none")}</p> : null}
      {rows.length ? (
        <ul>
          {rows.map((d) => {
            const ids = d.findings.map((f) => f.id);
            const isSeen = ids.length > 0 && ids.every((id) => seen.has(id));
            const first = d.findings[0];
            const pinned = first ? pinnedKeyOf(first.id) : null;
            const ev = first ? /^evidence:(\d+):/.exec(first.id) : null;
            return (
              <li key={d.key} className={`${d.sev}${d.sev === "doubt" && d.gates && isSeen ? " seen" : ""}`}>
                <i className={`mk ${d.sev}`} aria-hidden />
                <span>
                  <span className="sr-only">{t(`slip.sev.${d.sev}`)}: </span>
                  <span className="l">{d.label}</span>
                  {d.detail ? <span className="d">{d.detail}</span> : null}
                  {d.key === "questions" ? (
                    <details>
                      <summary>{t("slip.allQuestions", { count: d.findings.length })}</summary>
                      <ol>
                        {d.findings.map((f) => (
                          <li key={f.id}>{String(f.params.question ?? "")}</li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                  {pinned ? (
                    <button type="button" className="linkbtn go" onClick={() => onJump({ kind: "note", key: pinned })}>
                      {t("slip.goNote", { key: pinned })}
                    </button>
                  ) : ev ? (
                    <button type="button" className="linkbtn go" onClick={() => onJump({ kind: "evidence", n: Number(ev[1]) })}>
                      {t("slip.goEvidence", { n: Number(ev[1]) + 1 })}
                    </button>
                  ) : null}
                </span>
                {d.review ? (
                  <span className="gate quiet">{t("slip.reviewersCall")}</span>
                ) : d.sev === "stop" && d.gates ? (
                  <span className="gate">{t("lint.blocksApprove")}</span>
                ) : d.sev === "doubt" && d.gates ? (
                  <label className="seenbox">
                    <input type="checkbox" checked={isSeen} onChange={(e) => onSeen(ids, e.target.checked)} />
                    {t("lint.seen")}
                  </label>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {notes.length ? <p className="t-meta after">{notes.map((n) => n.label).join(" · ")}</p> : null}
      {loose.length ? (
        <details>
          <summary>{t("slip.loose", { count: loose.length })}</summary>
          <ol>
            {loose.map((n, i) => (
              <li key={i} className={n.blocker ? "coral" : undefined}>
                {n.blocker ? <b>{t("slip.blockerWord")} </b> : null}
                {n.text}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {carriedNote ? (
        <details>
          <summary>{t("slip.carried")}</summary>
          <p className="carried">{carriedNote}</p>
        </details>
      ) : null}
    </section>
  );
}
