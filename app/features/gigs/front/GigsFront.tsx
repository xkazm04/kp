"use client";

import { useMemo, type RefObject } from "react";
import { useTranslations } from "next-intl";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";
import type { FileFilter } from "../logic/file";
import { firstClosing, type FrontColumn } from "../logic/front";
import type { Niche } from "../logic/niches";
import type { SourceRow } from "../logic/wire";
import type { ProofList } from "../proof/GigsProof";
import { FrontIndex } from "./FrontIndex";
import { FrontLead } from "./FrontLead";
import { GigsFile } from "./GigsFile";
import { useGigCells } from "./useGigCells";

// The front page (B/3 "The Proof", the owner's pick "for clarity in overview of priorities
// I should spend next, and layout of sections"): a headline built from the live counts,
// then the single most urgent proof with what to doubt about it and its opening
// paragraphs, then the index columns by next move - Ready to send, To proof, Quarantined
// (and To record, while anything is out) - each most urgent first, ten rows and the rest
// one fold away. Below a double rule: the whole file (GigsFile.tsx).
//
// Parts: FrontLead.tsx (the lead), FrontIndex.tsx (the index columns), useGigCells.tsx (a
// gig's reward and deadline, set once for the lead, the index and the file).

export function GigsFront({
  gigs,
  attemptsByGig,
  sources,
  columns,
  queue,
  nicheMap,
  niches,
  truncated,
  now,
  filter,
  onFilter,
  page,
  onPage,
  searchRef,
  lastOpened,
  onOpen,
  onToWires,
}: {
  gigs: readonly Gig[];
  attemptsByGig: Readonly<Record<string, GigAttempt>>;
  sources: readonly SourceRow[];
  columns: Readonly<Record<FrontColumn, Gig[]>>;
  queue: readonly Gig[];
  nicheMap: ReadonlyMap<string, string>;
  niches: readonly Niche[];
  truncated: boolean;
  now: Date;
  filter: FileFilter;
  onFilter: (f: FileFilter) => void;
  page: number;
  onPage: (p: number) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  lastOpened: string | null;
  onOpen: (gigId: string, list: ProofList) => void;
  onToWires: () => void;
}) {
  const t = useTranslations("gigs");
  const { reward, deadline } = useGigCells(now);
  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const nicheLabel = useMemo(() => new Map(niches.map((n) => [n.key, n.label])), [niches]);

  const nProofs = columns.ready.length + columns.proof.length;
  const nQuar = columns.quar.length;
  const closing = firstClosing(queue, now);
  const out = gigs.filter((g) => g.status === "sent").length;
  const lead = queue[0] ?? null;

  const nicheOf = (g: Gig) => {
    const id = attemptsByGig[g.id]?.specialistId ?? g.specialistId;
    const key = id ? nicheMap.get(id) : null;
    return key ? (nicheLabel.get(key) ?? null) : null;
  };

  return (
    <div className="enter">
      <div className="fp-top">
        <h2 className="t-display">
          {nProofs + nQuar + columns.record.length === 0 ? t("front.clearHeadline") : t("front.headline", { proofs: nProofs, quar: nQuar })}
        </h2>
        <p className="deck">
          {nProofs + nQuar + columns.record.length === 0 ? (
            t("front.clearDeck")
          ) : (
            <>
              {t("front.deckReady", { count: columns.ready.length })}
              {closing ? (
                <>
                  <span className="sep">·</span>
                  <span className="coral">{t("front.deckFirstCloses", { days: closing.days })}</span>
                </>
              ) : null}
              <span className="sep">·</span>
              {out ? t("front.deckOut", { count: out }) : t("front.deckNothingOut")}.
            </>
          )}
        </p>
      </div>

      {lead ? <FrontLead gig={lead} attempt={attemptsByGig[lead.id] ?? null} source={lead.sourceId ? (sourceById.get(lead.sourceId) ?? null) : null} niche={nicheOf(lead)} now={now} reward={reward} deadline={deadline} onOpen={() => onOpen(lead.id, { ids: queue.map((g) => g.id), label: t("head.waitList") })} /> : null}

      <FrontIndex columns={columns} attemptsByGig={attemptsByGig} sourceById={sourceById} now={now} lastOpened={lastOpened} nicheOf={nicheOf} reward={reward} deadline={deadline} onOpen={onOpen} />

      <hr className="rule-double" />
      <GigsFile
        gigs={gigs}
        attemptsByGig={attemptsByGig}
        sources={sources}
        nicheMap={nicheMap}
        niches={niches}
        truncated={truncated}
        now={now}
        filter={filter}
        onFilter={onFilter}
        page={page}
        onPage={onPage}
        searchRef={searchRef}
        lastOpened={lastOpened}
        onOpen={onOpen}
        onToWires={onToWires}
        reward={reward}
        deadline={deadline}
      />
    </div>
  );
}
