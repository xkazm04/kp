"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Tooltip } from "@/app/_components/Tooltip";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Gig, GigArena, GigAttempt, GigKpi } from "@/app/_lib/gigs/types";
import { afterLeavingList, draftParagraphs, listNeighbours, nicheKeyOf, paragraphSpans, pinNotes, type MarginNote, type Niche } from "./deskLogic";
import { canQuickDecline, deadlineView, type SourceRow, type SpecialistRow } from "./gigsLogic";
import { GigsBackMatter, type BackFold } from "./GigsBackMatter";
import { UntrustedText } from "./GigsFacts";
import { useLintText } from "./GigsLint";
import { DifficultyGlyph } from "./GigsMarks";
import { GigsSignoff, type AfterWrite, type DeskMemory, type DeskStore } from "./GigsSignoff";
import { ProofSlip, useDoubts, type SlipTarget } from "./GigsSlip";
import { useBareKeys } from "./useBareKeys";
import { sendJson } from "./useGigsData";
import { useGigsFormat } from "./useGigsFormat";

// One gig as a full page (B/3 "The Proof", the owner's pick "for well formatted content and
// designed sections"). It REPLACES the section it was opened from; a trail on top carries
// the way back (the crumb, ×, Esc) and the list it was opened from, walked with ← / →
// (the owner's keys; no wrap) - and Decline (D), confirmed by D again or Enter.
//
// Left: the sign-off (GigsSignoff.tsx) - the state and only the moves it allows. Right:
// the head, the proof slip (GigsSlip.tsx - what to doubt, in words), then the galley: the
// draft set as it would be sent, paragraphs numbered, every phrase a note names
// underlined and the note pinned in the margin beside it (a lint finding in amber, a
// reviewer's note in coral). Below it the lettered back matter (GigsBackMatter.tsx).
//
// Every page swap lands at the top with focus on the way back, so focus never sits on a
// control that is gone.

export type ProofList = { ids: string[]; label: string };

export function GigsProof({
  gigId,
  list,
  gigs,
  attemptsByGig,
  sources,
  specialists,
  niches,
  kpi,
  now,
  store,
  onStep,
  onBack,
  onLeft,
  onChanged,
  onFlash,
  onOpenLane,
}: {
  gigId: string;
  list: ProofList;
  gigs: readonly Gig[];
  attemptsByGig: Readonly<Record<string, GigAttempt>>;
  sources: readonly SourceRow[];
  specialists: readonly SpecialistRow[];
  niches: readonly Niche[];
  kpi: GigKpi | null;
  now: Date;
  store: DeskStore;
  onStep: (gigId: string) => void;
  onBack: () => void;
  /** The gig left the list (declined): open `next` (or go back when null), and say `message`. */
  onLeft: (next: string | null, message: string) => void;
  onChanged: AfterWrite;
  onFlash: (message: string) => void;
  onOpenLane: (lane: string | null, arena: GigArena | null) => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const lintText = useLintText();
  const doubtsOf = useDoubts();
  const backRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const declineRef = useRef<HTMLButtonElement | null>(null);

  const gig = gigs.find((g) => g.id === gigId) ?? null;
  const attempt = gig ? (attemptsByGig[gig.id] ?? null) : null;
  const source = gig?.sourceId ? (sources.find((s) => s.id === gig.sourceId) ?? null) : null;
  const specialistId = attempt?.specialistId ?? gig?.specialistId ?? null;
  const specialist = specialistId ? (specialists.find((s) => s.id === specialistId) ?? null) : null;
  const niche = specialist ? (niches.find((n) => n.key === nicheKeyOf(specialist)) ?? null) : null;
  const pos = listNeighbours(list.ids, gigId);
  const onDesk = attempt !== null && (attempt.status === "drafted" || attempt.status === "approved");

  // The desk memory for this attempt: kept in the tab's store, so going back and returning
  // finds the ticks, the seen marks and the note where they were left.
  const [memory, setMemoryState] = useState<DeskMemory | null>(() => {
    if (!attempt || !onDesk) return null;
    return store.get(attempt.id) ?? { ticks: { ...(attempt.review?.checklist ?? {}) }, seen: [], note: "", startedAt: Date.now() };
  });
  const setMemory = useCallback(
    (update: (m: DeskMemory) => DeskMemory) =>
      setMemoryState((m) => {
        if (!m) return m;
        const next = update(m);
        if (attempt) store.set(attempt.id, next);
        return next;
      }),
    [attempt, store]
  );
  // Kept in the store from the first render, so the review timer survives a trip back.
  // A different attempt remounts this page (GigsTab keys it by gig AND attempt), so the
  // memory never outlives its draft.
  useEffect(() => {
    if (attempt && memory) store.set(attempt.id, memory);
  }, [attempt, memory, store]);

  const { doubts, findings, note } = useMemo(
    () => (gig ? doubtsOf(gig, attempt, source, now) : { doubts: [], findings: [], note: null }),
    [gig, attempt, source, now, doubtsOf]
  );
  const draft = onDesk ? (attempt?.deliverable?.draftText ?? "") : "";
  const paras = useMemo(() => draftParagraphs(draft), [draft]);
  const { pinned, loose } = useMemo(() => pinNotes(paras, findings, note && note.header ? note : null), [paras, findings, note]);
  const seen = useMemo(() => new Set(memory?.seen ?? []), [memory]);

  // Arriving on a page: its top, focus on the way back.
  useLayoutEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, [gigId]);

  // Decline, confirmed: D once opens the question, D again or Enter confirms, Esc cancels.
  const canDecline = gig !== null && canQuickDecline(gig.status);
  const [confirming, setConfirming] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineError, setDeclineError] = useState<string | null>(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  const cancelConfirm = () => {
    setConfirming(false);
    window.requestAnimationFrame(() => declineRef.current?.focus());
  };
  async function decline() {
    if (!gig || declining) return;
    setDeclining(true);
    setDeclineError(null);
    const res = await sendJson(`/api/gigs/${encodeURIComponent(gig.id)}`, "PATCH", { action: "decline" });
    setDeclining(false);
    if (!res.ok) {
      setDeclineError(resolveError(res.body as ApiErrorPayload | null, t("work.actionFailed")));
      return;
    }
    setConfirming(false);
    const title = gig.title;
    await onChanged(null);
    onLeft(afterLeavingList(pos), t("detail.declinedFlash", { title }));
  }
  const askDecline = () => {
    setDeclineError(null);
    setConfirming(true);
  };

  useBareKeys((key) => {
    if (declining) return key === "d" || key === "enter";
    if (confirming) {
      if (key === "escape") {
        cancelConfirm();
        return true;
      }
      if (key === "d") {
        void decline();
        return true;
      }
      if (key === "enter") {
        const active = document.activeElement;
        if (active && active !== document.body && active.closest("button, a, input, select, textarea, [role='button']")) return false;
        void decline();
        return true;
      }
    }
    if (key === "escape") {
      onBack();
      return true;
    }
    if (key === "arrowleft" && pos?.prev) {
      onStep(pos.prev);
      return true;
    }
    if (key === "arrowright" && pos?.next) {
      onStep(pos.next);
      return true;
    }
    if (key === "d" && canDecline && !confirming) {
      askDecline();
      return true;
    }
    return false;
  });

  // Back matter folds opened on purpose (a jump from the slip).
  const [openFolds, setOpenFolds] = useState<Set<BackFold>>(() => new Set(gig?.status === "suspect" ? ["listing"] : []));
  const jump = useCallback((target: SlipTarget) => {
    if (target.kind === "evidence") {
      setOpenFolds((s) => new Set(s).add("evidence"));
      window.requestAnimationFrame(() => {
        const el = document.getElementById(`gd-ev-${target.n}`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        el?.classList.add("target");
      });
      return;
    }
    const el = document.getElementById(`gd-note-${target.key}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus({ preventScroll: true });
  }, []);

  if (!gig) {
    return (
      <div>
        <Trail t={t} label={list.label} pos={pos} backRef={backRef} onBack={onBack} onStep={onStep} canDecline={false} onDecline={() => {}} declineRef={declineRef} />
        <div className="stamp-wrap">
          <div className="stamp calm">
            <span className="s1">{t("detail.notFoundTitle")}</span>
            <span className="s2">{t("proof.notFound")}</span>
          </div>
        </div>
      </div>
    );
  }

  const d = deadlineView(gig.deadlineAt, now);
  const waits = gig.status === "in_review" || gig.status === "drafted" || gig.status === "suspect" || gig.status === "sent";
  const stage = gig.status === "in_review" ? t("front.col.ready") : gig.status === "drafted" ? t("front.col.proof") : gig.status === "suspect" ? t("front.col.quar") : fmt.status(gig.status);
  const reviewNoteText = note && note.header ? [note.lead, ...note.items.map((x, i) => `${i + 1}) ${x}`), ...note.defects.map((x) => x.text)].filter(Boolean).join("\n") : null;
  const pinnedKeyOf = (findingId: string) => pinned.find((n) => n.finding?.id === findingId)?.key ?? null;

  return (
    <div className="enter">
      <Trail
        t={t}
        label={list.label}
        pos={pos}
        backRef={backRef}
        onBack={onBack}
        onStep={onStep}
        canDecline={canDecline && !confirming}
        onDecline={askDecline}
        declineRef={declineRef}
        declining={declining}
      />
      {confirming ? (
        <div className="confirm" role="group" aria-labelledby="gd-decline-q">
          <span id="gd-decline-q">{t.rich("detail.declineConfirm", { title: gig.title, kbd: (c) => <kbd>{c}</kbd> })}</span>
          <span className="row-form">
            <button ref={confirmRef} type="button" className="btn quiet danger" disabled={declining} onClick={() => void decline()}>
              {declining ? t("detail.declining") : t("detail.declineYes")}
            </button>
            <button type="button" className="btn quiet ghost" disabled={declining} onClick={cancelConfirm}>
              {t("detail.declineNo")}
            </button>
          </span>
        </div>
      ) : null}
      {declineError ? (
        <p role="alert" className="alert gap-below">
          {declineError}
        </p>
      ) : null}

      <div className="proof">
        <GigsSignoff
          gig={gig}
          attempt={attempt}
          source={source}
          specialist={specialist}
          kpi={kpi}
          now={now}
          findings={findings}
          memory={memory}
          setMemory={setMemory}
          reviewNoteText={reviewNoteText}
          onChanged={onChanged}
          onFlash={onFlash}
          onDecline={askDecline}
          onHire={() => onOpenLane(null, gig.arena)}
        />
        <div className="col">
          <header className="proof-head">
            <div className="kicker">
              <span className={`caps ${waits ? "coral" : "dim"}`}>{stage}</span>
              {niche ? <span className="caps dim">{niche.label}</span> : null}
            </div>
            <h2>{gig.title}</h2>
            <div className="facts">
              <span>{fmt.arena(gig.arena)}</span>
              <span className="strong">{gig.reward ? gig.reward.text : <span className="absent">{t("facts.rewardNotStated")}</span>}</span>
              <span className={d.state === "soon" ? "coral" : undefined}>
                {d.state === "none" ? <span className="absent">{t("facts.noDeadline")}</span> : d.state === "passed" ? t("facts.deadlinePassed", { date: fmt.date(d.at) }) : t("front.closesIn", { days: Math.max(0, d.days) })}
              </span>
              {gig.org ? <span>{gig.org}</span> : null}
              {gig.brief ? (
                <span>
                  <DifficultyGlyph difficulty={gig.brief.difficulty} /> {gig.brief.difficulty === "unrated" ? <span className="absent">{t("brief.level.unrated")}</span> : t(`brief.level.${gig.brief.difficulty}`)}
                </span>
              ) : null}
            </div>
            {onDesk && attempt?.deliverable?.summary ? <p className="summary">{attempt.deliverable.summary}</p> : null}
          </header>

          {onDesk && memory ? (
            <ProofSlip
              doubts={doubts}
              pinnedKeyOf={pinnedKeyOf}
              pinnedCount={pinned.length}
              loose={loose}
              seen={seen}
              onSeen={(ids, value) => setMemory((m) => ({ ...m, seen: value ? [...new Set([...m.seen, ...ids])] : m.seen.filter((x) => !ids.includes(x)) }))}
              onJump={jump}
              carriedNote={attempt?.revisionNote ?? null}
            />
          ) : doubts.length ? (
            <ProofSlip doubts={doubts} pinnedKeyOf={() => null} pinnedCount={0} loose={[]} seen={new Set()} onSeen={() => {}} onJump={jump} carriedNote={attempt?.revisionNote ?? null} />
          ) : null}

          <Galley gig={gig} attempt={attempt} source={source} specialistName={specialist?.name ?? null} now={now} paras={paras} pinned={pinned} lintText={lintText} reviewBy={note?.byAgent ? t("proof.reviewerAgent") : t("proof.reviewer")} />

          <GigsBackMatter
            key={gig.id}
            gig={gig}
            attempt={attempt}
            source={source}
            specialists={specialists}
            kpi={kpi}
            note={note}
            open={openFolds}
            onOpen={(f, v) =>
              setOpenFolds((s) => {
                const n = new Set(s);
                if (v) n.add(f);
                else n.delete(f);
                return n;
              })
            }
            onChanged={onChanged}
            onOpenLane={() => onOpenLane(niche?.key ?? null, null)}
          />
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {pos ? t("proof.position", { index: pos.index, total: pos.total, list: list.label }) : null}
      </span>
    </div>
  );
}

function Trail({
  t,
  label,
  pos,
  backRef,
  onBack,
  onStep,
  canDecline,
  onDecline,
  declineRef,
  declining = false,
}: {
  t: ReturnType<typeof useTranslations<"gigs">>;
  label: string;
  pos: ReturnType<typeof listNeighbours>;
  backRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  onStep: (id: string) => void;
  canDecline: boolean;
  onDecline: () => void;
  declineRef: RefObject<HTMLButtonElement | null>;
  declining?: boolean;
}) {
  return (
    <nav className="trail" aria-label={t("proof.trail")}>
      <button ref={backRef} type="button" className="crumb" onClick={onBack}>
        {t("proof.back")}
      </button>
      <span className="sep" aria-hidden>
        /
      </span>
      <span className="pos">{label}</span>
      {pos ? (
        <>
          <span className="sep" aria-hidden>
            /
          </span>
          <span className="pos">{t("proof.of", { index: pos.index, total: pos.total })}</span>
        </>
      ) : null}
      <span className="step">
        {canDecline ? (
          <button ref={declineRef} type="button" className="btn quiet danger" disabled={declining} onClick={onDecline}>
            {t("detail.decline")} <kbd aria-hidden>D</kbd>
          </button>
        ) : null}
        <Tooltip label={t("proof.prev")}>
          <button type="button" className="btn quiet iconbtn" aria-label={t("proof.prev")} disabled={!pos?.prev} onClick={() => pos?.prev && onStep(pos.prev)}>
            <ChevronLeft size={16} aria-hidden />
          </button>
        </Tooltip>
        <Tooltip label={t("proof.next")}>
          <button type="button" className="btn quiet iconbtn" aria-label={t("proof.next")} disabled={!pos?.next} onClick={() => pos?.next && onStep(pos.next)}>
            <ChevronRight size={16} aria-hidden />
          </button>
        </Tooltip>
        <Tooltip label={t("proof.close")}>
          <button type="button" className="btn quiet iconbtn" aria-label={t("proof.close")} onClick={onBack}>
            <X size={16} aria-hidden />
          </button>
        </Tooltip>
      </span>
    </nav>
  );
}

/** The galley: the draft as it would be sent, or a stamp saying why there is none. */
function Galley({
  gig,
  attempt,
  source,
  specialistName,
  now,
  paras,
  pinned,
  lintText,
  reviewBy,
}: {
  gig: Gig;
  attempt: GigAttempt | null;
  source: SourceRow | null;
  specialistName: string | null;
  now: Date;
  paras: ReturnType<typeof draftParagraphs>;
  pinned: MarginNote[];
  lintText: ReturnType<typeof useLintText>;
  reviewBy: string;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // Where the margin is a real column (a wide sheet), pull each paragraph's notes down to
  // the first phrase they mark, so the hairline meets its underline (B/3's alignNotes).
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const align = () => {
      sheet.querySelectorAll<HTMLElement>(".para").forEach((p) => {
        const notes = p.querySelector<HTMLElement>(".mnotes");
        const mark = p.querySelector<HTMLElement>("mark.pm");
        if (!notes || !mark || !notes.children.length) return;
        notes.style.paddingTop = "";
        if (getComputedStyle(notes).gridColumnStart !== "3") return;
        const off = mark.getBoundingClientRect().top - p.getBoundingClientRect().top - 12;
        notes.style.paddingTop = `${Math.max(0, Math.round(off))}px`;
      });
    };
    align();
    const ro = new ResizeObserver(align);
    ro.observe(sheet);
    return () => ro.disconnect();
  }, [paras, pinned]);
  const stamp = (tone: "" | "calm" | "moss", s1: string, s2: string) => (
    <div className="galley">
      <div className="sheet">
        <div className="stamp-wrap">
          <div className={`stamp ${tone}`} role="note">
            <span className="s1">{s1}</span>
            <span className="s2">{s2}</span>
          </div>
        </div>
      </div>
    </div>
  );

  if (gig.status === "suspect") {
    return (
      <div className="galley">
        <div className="sheet">
          <div className="stamp-wrap tight">
            <div className="stamp" role="note">
              <span className="s1">{t("proof.stampQuarantined")}</span>
              <span className="s2">{gig.suspectReasons.map((r) => fmt.suspect(r)).join(" · ")}</span>
            </div>
          </div>
          <div className="sheet-pad">
            <UntrustedText gig={gig} source={source} />
          </div>
        </div>
      </div>
    );
  }
  if (!attempt) {
    if (gig.status === "qualified") return stamp("calm", t("proof.stampNotWritten"), specialistName ? t("proof.stampQualified", { name: specialistName }) : t("proof.stampQualifiedNone"));
    if (gig.status === "new") return stamp("calm", t("proof.stampNotQualified"), t("proof.stampNew"));
    if (gig.status === "declined" || gig.status === "withdrawn" || gig.status === "expired") return stamp("calm", fmt.status(gig.status), t("proof.stampOff"));
    return stamp("calm", fmt.status(gig.status), t("proof.stampNoProof"));
  }
  if (attempt.status === "running" || attempt.status === "dispatched") {
    return stamp("moss", t("proof.stampRunning"), t("proof.stampRunningBody", { when: fmt.relative(attempt.createdAt, now) ?? "" }));
  }
  if (attempt.status === "revision_requested") return stamp("calm", t("agentView.revisionTitle"), t("agentView.revisionBody"));
  if (attempt.status === "failed" || !attempt.deliverable) {
    return stamp("", t("proof.stampNoDeliverable"), t("agentView.failedReason", { reason: attempt.fallbackReason ?? t("agentView.noReason") }));
  }
  const dl = attempt.deliverable;
  if (attempt.status === "sent" || attempt.status === "discarded" || !["drafted", "approved"].includes(attempt.status)) {
    // Out of the desk's hands: the draft as it went (or would have gone), unmarked.
    return (
      <div className="galley">
        <div className="sheet">
          <div className="rh">
            <span className="caps dim">{fmt.attemptStatus(attempt.status)}</span>
            <span className="t-meta">{fmt.dateTime(attempt.sentAt ?? attempt.updatedAt)}</span>
          </div>
          {draftParagraphs(dl.draftText).map((p, i) => (
            <div key={i} className="para">
              <span className="pn">¶{i + 1}</span>
              <div className="tx">{p.text}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const words = dl.draftText.trim().split(/\s+/).filter(Boolean).length;
  return (
    <div className="galley">
      <div className="sheet" ref={sheetRef}>
        <div className="rh">
          <span className="caps dim">{t("proof.draftOf", { date: fmt.dateTime(attempt.createdAt) })}</span>
          <span className="t-meta">{t("proof.size", { paragraphs: paras.length, words })}</span>
        </div>
        {paras.length ? (
          paras.map((p, i) => {
            const mine = pinned.filter((n) => n.para === i);
            return (
              <div key={i} className="para" id={`gd-p${i + 1}`}>
                <span className="pn" aria-label={t("proof.paragraph", { n: i + 1 })}>
                  ¶{i + 1}
                </span>
                <div className="tx">
                  <MarkedText text={p.text} notes={mine} />
                </div>
                <div className="mnotes">
                  {mine.map((n) => (
                    <div key={n.key} id={`gd-note-${n.key}`} tabIndex={-1} className={`mnote${n.source === "lint" ? " lint" : ""}${n.blocker ? " blocker" : ""}`}>
                      <span className="k">{n.key}</span>
                      <span>
                        {n.source === "lint" && n.finding ? lintText(n.finding) : n.text}
                        <span className="src">
                          {n.source === "lint" ? t("proof.srcLint", { severity: t(`lint.severity.${n.finding?.severity ?? "info"}`) }) : `${reviewBy} · ${n.role === "defect" ? t("proof.roleDefect") : t("proof.roleMustDo", { n: Number((n.role ?? "").replace(/\D/g, "")) || 0 })}`}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <div className="stamp-wrap">
            <div className="stamp" role="note">
              <span className="s1">{t("proof.stampEmpty")}</span>
              <span className="s2">{t("proof.stampEmptyBody")}</span>
            </div>
          </div>
        )}
        {dl.artifacts.length ? (
          <div className="para">
            <span className="pn" aria-hidden>
              ✉
            </span>
            <div className="encl">
              <span className="caps dim">{t("proof.enclosures", { count: dl.artifacts.length })}</span>
              {dl.artifacts.map((a, i) => (
                <span key={i}>
                  {a.title || a.ref} <code>{a.ref}</code>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A paragraph with its noted phrases underlined; each note's letter rides the run where
 *  the note ends. */
function MarkedText({ text, notes }: { text: string; notes: readonly MarginNote[] }) {
  const spans = paragraphSpans(text, notes);
  const ends = spans.map((_, j) => spans.slice(0, j + 1).reduce((n, x) => n + x.text.length, 0));
  return (
    <>
      {spans.map((s, j) => {
        if (!s.mark) return <span key={j}>{s.text}</span>;
        const ending = s.mark.filter((m) => m.end === ends[j]);
        return (
          <span key={j}>
            <mark className={`pm${s.mark.every((m) => m.source === "lint") ? " lint" : ""}`}>{s.text}</mark>
            {ending.map((m) => (
              <sup key={m.key} className="pk">
                {m.key}
              </sup>
            ))}
          </span>
        );
      })}
    </>
  );
}
