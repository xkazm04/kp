"use client";

import { useMemo, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";
import { draftParagraphs, firstClosing, type FileFilter, type FrontColumn, type Niche } from "./deskLogic";
import { deadlineView, type SourceRow } from "./gigsLogic";
import { GigsFile } from "./GigsFile";
import type { ProofList } from "./GigsProof";
import { DoubtMarks, useDoubts } from "./GigsSlip";
import { useGigsFormat } from "./useGigsFormat";

// The front page (B/3 "The Proof", the owner's pick "for clarity in overview of priorities
// I should spend next, and layout of sections"): a headline built from the live counts,
// then the single most urgent proof with what to doubt about it and its opening
// paragraphs, then the index columns by next move - Ready to send, To proof, Quarantined
// (and To record, while anything is out) - each most urgent first, ten rows and the rest
// one fold away. Below a double rule: the whole file (GigsFile.tsx).

const INDEX_CAP = 10;

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
  const fmt = useGigsFormat();
  const doubtsOf = useDoubts();
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
  const reward = (g: Gig, withCurrency: boolean) =>
    g.reward ? (
      <span>
        {g.reward.text.replace(/\s+(INR|USD|EUR|GBP|CAD|AUD|SGD|NZD|USDC)$/, "")}
        {withCurrency && g.reward.currency ? <span className="dim"> {g.reward.currency}</span> : null}
      </span>
    ) : (
      <span className="absent">{t("front.rewardNone")}</span>
    );
  const deadline = (g: Gig, words = false) => {
    const d = deadlineView(g.deadlineAt, now);
    if (d.state === "none") return <span className="absent">{t("front.deadlineNone")}</span>;
    if (d.state === "passed") return <span className="dim">{t("front.closed")}</span>;
    const text = words ? t("front.closesIn", { days: Math.max(0, d.days) }) : t("front.daysLeft", { days: Math.max(0, d.days) });
    return <span className={d.state === "soon" ? "coral" : undefined}>{text}</span>;
  };

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

      {lead ? <Lead gig={lead} attempt={attemptsByGig[lead.id] ?? null} source={lead.sourceId ? (sourceById.get(lead.sourceId) ?? null) : null} niche={nicheOf(lead)} now={now} reward={reward} deadline={deadline} onOpen={() => onOpen(lead.id, { ids: queue.map((g) => g.id), label: t("head.waitList") })} /> : null}

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

function Lead({
  gig,
  attempt,
  source,
  niche,
  now,
  reward,
  deadline,
  onOpen,
}: {
  gig: Gig;
  attempt: GigAttempt | null;
  source: SourceRow | null;
  niche: string | null;
  now: Date;
  reward: (g: Gig, withCurrency: boolean) => ReactNode;
  deadline: (g: Gig, words?: boolean) => ReactNode;
  onOpen: () => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const doubtsOf = useDoubts();
  const { doubts } = doubtsOf(gig, attempt, source, now);
  const top = doubts.filter((d) => d.sev !== "note").slice(0, 2);
  const draft = attempt?.deliverable?.draftText ?? "";
  const paras = draftParagraphs(draft);
  const hasDraft = draft.trim().length > 40;
  const stage = gig.status === "in_review" ? t("front.col.ready") : gig.status === "drafted" ? t("front.col.proof") : gig.status === "suspect" ? t("front.col.quar") : fmt.status(gig.status);

  return (
    <article className="lead" aria-label={t("front.leadLabel")}>
      <div>
        <div className="kicker">
          <span className="caps coral">{t("front.lead")}</span>
          <span className="caps dim">{stage}</span>
        </div>
        <button type="button" className="title" onClick={onOpen}>
          {gig.title}
        </button>
        <div className="facts">
          <span>{fmt.arena(gig.arena)}</span>
          <span className="strong">{reward(gig, true)}</span>
          <span>{deadline(gig, true)}</span>
          {niche ? <span>{niche}</span> : null}
        </div>
        {top.length ? (
          <div className="doubts">
            {top.map((d) => (
              <div key={d.key} className={`mnote-lite ${d.sev}`}>
                <i className={`mk ${d.sev}`} aria-hidden />
                <div>
                  <div className={`l${d.sev === "stop" ? " coral" : ""}`}>
                    <span className="sr-only">{t(`slip.sev.${d.sev}`)}: </span>
                    {d.label}
                  </div>
                  {d.detail ? <div className="d">{d.detail}</div> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="galley-strip">
        {hasDraft ? (
          paras.slice(0, 2).map((p, i) => (
            <div key={i} className="gal-p">
              <span className="pn" aria-hidden>
                ¶{i + 1}
              </span>
              <p>{p.text}</p>
            </div>
          ))
        ) : (
          <div className="gal-p">
            <span className="pn" aria-hidden>
              —
            </span>
            <p>{gig.bodyText.slice(0, 420)}</p>
          </div>
        )}
        <div className="more">
          <span className="t-meta">
            {hasDraft
              ? t("front.leadSize", { paragraphs: paras.length, enclosures: attempt?.deliverable?.artifacts.length ?? 0 })
              : t("front.leadListing")}
          </span>
          <button type="button" className="btn primary" onClick={onOpen}>
            {t("front.readProof")}
          </button>
        </div>
      </div>
    </article>
  );
}
