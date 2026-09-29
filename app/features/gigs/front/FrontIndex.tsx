"use client";

import { useTranslations } from "next-intl";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";
import type { FrontColumn } from "../logic/front";
import type { SourceRow } from "../logic/wire";
import type { ProofList } from "../proof/GigsProof";
import { DoubtMarks, useDoubts } from "../shared/doubts";
import { useGigsFormat } from "../data/useGigsFormat";
import type { DeadlineCell, RewardCell } from "./useGigCells";

// The front page's index columns by next move (GigsFront.tsx): Ready to send, To proof,
// Quarantined, and To record while anything is out - each most urgent first, ten rows and
// the rest one fold away. A row opens its proof with its column as the list ← / → walk.

const INDEX_CAP = 10;

export function FrontIndex({
  columns,
  attemptsByGig,
  sourceById,
  now,
  lastOpened,
  nicheOf,
  reward,
  deadline,
  onOpen,
}: {
  columns: Readonly<Record<FrontColumn, Gig[]>>;
  attemptsByGig: Readonly<Record<string, GigAttempt>>;
  sourceById: ReadonlyMap<string, SourceRow>;
  now: Date;
  lastOpened: string | null;
  nicheOf: (g: Gig) => string | null;
  reward: RewardCell;
  deadline: DeadlineCell;
  onOpen: (gigId: string, list: ProofList) => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const doubtsOf = useDoubts();

  const colTitle: Record<FrontColumn, string> = {
    ready: t("front.col.ready"),
    proof: t("front.col.proof"),
    quar: t("front.col.quar"),
    record: t("front.col.record"),
  };
  const shown: FrontColumn[] = columns.record.length ? ["ready", "proof", "quar", "record"] : ["ready", "proof", "quar"];

  const row = (g: Gig, col: FrontColumn) => {
    const a = attemptsByGig[g.id] ?? null;
    const { doubts } = doubtsOf(g, a, g.sourceId ? (sourceById.get(g.sourceId) ?? null) : null, now);
    const niche = nicheOf(g);
    return (
      <button
        key={g.id}
        type="button"
        className={`irow${g.id === lastOpened ? " current" : ""}`}
        onClick={() => onOpen(g.id, { ids: columns[col].map((x) => x.id), label: colTitle[col] })}
      >
        <span className="t">{g.title}</span>
        <span className="m">
          {reward(g, false)} <span className="dim">·</span> {deadline(g)}
          {niche ? (
            <>
              {" "}
              <span className="dim">·</span> {niche}
            </>
          ) : null}
        </span>
        {col === "record" ? <span className="t-meta">{fmt.relative(a?.sentAt ?? null, now) ?? ""}</span> : <DoubtMarks doubts={doubts} running={a?.status === "running" || a?.status === "dispatched"} />}
      </button>
    );
  };

  return (
    <div className="index" style={{ ["--cols" as string]: shown.length }}>
      {shown.map((col) => {
        const list = columns[col];
        return (
          <section key={col} aria-labelledby={`gd-col-${col}`}>
            <div className="zone-head">
              <span className={`n${list.length ? " coral" : ""}`}>{list.length}</span>
              <h3 className="caps" id={`gd-col-${col}`}>
                {colTitle[col]}
              </h3>
              <span className="who">{t(`front.who.${col}`)}</span>
            </div>
            {list.length ? list.slice(0, INDEX_CAP).map((g) => row(g, col)) : <p className="q-empty">{t("front.colEmpty")}</p>}
            {list.length > INDEX_CAP ? (
              <details open={list.slice(INDEX_CAP).some((g) => g.id === lastOpened) || undefined}>
                <summary>{t("front.more", { count: list.length - INDEX_CAP })}</summary>
                {list.slice(INDEX_CAP).map((g) => row(g, col))}
              </details>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
