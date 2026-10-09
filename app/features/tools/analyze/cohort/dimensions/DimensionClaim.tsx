"use client";

import { useTranslations } from "next-intl";
import { KeyHints } from "@/app/_components/kit/scene";
import type { CohortDimension, CohortView } from "../cohortTypes";

/** The claim's seal, drawn: two bands apart (clears), two bands overlapping (inside the noise),
 *  one dashed band (below the floor), a bare ruler (salary: ordered, never crowned). */
function Seal({ kind }: { kind: "clears" | "insideNoise" | "belowFloor" | "never" }) {
  return (
    <svg className="cd-seal" viewBox="0 0 40 20" aria-hidden data-kind={kind}>
      {kind === "clears" ? (
        <>
          <rect className="cd-seal__band" x="2" y="5" width="14" height="10" rx="3" />
          <rect className="cd-seal__band cd-seal__band--lead" x="24" y="5" width="14" height="10" rx="3" />
          <path className="cd-seal__gap" d="M17.5 10h5" />
        </>
      ) : kind === "insideNoise" ? (
        <>
          <rect className="cd-seal__band" x="3" y="5" width="20" height="10" rx="3" />
          <rect className="cd-seal__band" x="15" y="5" width="22" height="10" rx="3" />
          <rect className="cd-seal__overlap" x="15" y="5" width="8" height="10" />
        </>
      ) : kind === "belowFloor" ? (
        <rect className="cd-seal__band cd-seal__band--floor" x="6" y="5" width="28" height="10" rx="3" />
      ) : (
        <path className="cd-seal__ruler" d="M3 13h34M3 9v8M13 11v4M20 9v8M27 11v4M37 9v8" />
      )}
    </svg>
  );
}

/**
 * The strip at the top of every dimension page: what may be CLAIMED here (the separation, in
 * words a reader can tell apart: "leads, clears" never reads like "first, within the noise"),
 * how many members carry a rating, the model's reorder-surviving note, the refused partitions,
 * and the page's keys.
 */
export function DimensionClaim({ view, dimension }: { view: CohortView; dimension: CohortDimension }) {
  const t = useTranslations("analyzeCohort.pages.common");
  const claim = view.claims.byDimension[dimension];
  const leader = claim.leader ? (view.members.find((m) => m.memberId === claim.leader)?.label ?? claim.leader) : null;
  const kind = dimension === "salary" ? "never" : claim.separation;
  const sentence =
    dimension === "salary"
      ? t("sepSalary")
      : claim.separation === "clears" && leader
        ? t("sepClears", { leader })
        : claim.separation === "belowFloor"
          ? t("sepFloor")
          : t("sepNoise");
  // The compared partition is the one the engine RATED (the role band's currency, or the cohort's
  // majority) — not necessarily the largest, which is how the claim lists them.
  const rated = new Set(view.members.filter((m) => m.cells[dimension].rating != null).map((m) => m.memberId));
  const parts = [...(claim.partitions ?? [])].sort((a, b) => Number(b.memberIds.some((id) => rated.has(id))) - Number(a.memberIds.some((id) => rated.has(id))));
  return (
    <div className="cd-claim" data-sep={kind}>
      <div className="cd-claim__seal">
        <Seal kind={kind} />
        <span className="cd-claim__word">{t(`sepShort.${kind}`)}</span>
      </div>
      <div className="cd-claim__body">
        <p className="cd-claim__sentence">{sentence}</p>
        <p className="cd-claim__facts">
          <span>{t("rated", { rated: claim.rated, total: view.members.length })}</span>
          {parts.map((p, i) => (
            <span key={p.key} className="cd-claim__part" data-refused={i > 0 ? "" : undefined}>
              {i === 0 ? t("partitionCompared", { key: p.key, n: p.memberIds.length }) : t("partitionRefused", { key: p.key, n: p.memberIds.length })}
            </span>
          ))}
        </p>
        {claim.note ? (
          <p className="cd-claim__note">
            <span className="cd-claim__note-k">{t("note")}</span> {claim.note}
          </p>
        ) : null}
      </div>
      <KeyHints label={t("keys")} hints={[{ id: "move", keys: ["J", "K"], act: t("keyMove") }]} />
    </div>
  );
}
