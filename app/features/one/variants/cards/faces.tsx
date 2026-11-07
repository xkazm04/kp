"use client";

// The answer cards (round 4, `?v=cards`) — ONE card shell and its three faces for one
// candidate: profile (verdict, the two figures, the strongest parts, the CV's first lines),
// letter (the held outreach letter: state, subject, first lines, forecast, Approve / Send)
// and interview (how long they wait, their invitations, the first free times as Book
// buttons, Send a link instead).
//
// A card is a LAYOUT over the core's reads (tools/reads.ts hooks, the same requests the
// panels make, so nothing is fetched twice) and the core's acts (`onPropose` — every act
// arms a PREVIEW consent card; nothing is written). The full tool behind a face is the
// core's `renderTool(face, …, { look: "pane" })`, which the layout shows on Expand.
import { motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, Mark, Note, Tag } from "@/app/_components/kit";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { META_LABEL, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { isoToDateSlot } from "@/app/_lib/schedule-slots";
import { useOneMotion } from "../../motion";
import { useDays } from "../../panels/cells";
import { PANEL_TITLE } from "../../panels/PanelFrame";
import type { OneEntry } from "../../panels/pipelineRead";
import { ScoreBar } from "../../panels/ScoreFig";
import type { PanelProps } from "../../panels/types";
import { SEG_GROUP, Seg } from "../../Seg";
import { LetterAct } from "../../tools/LetterTool";
import { useInterview, useLetter, usePipeline, useProfile, type ProfileSummary, type Slot } from "../../tools/reads";
import { TOOL_KINDS, type Selected, type ToolKind } from "../../types";

/** A "first lines" box: it gives way to the card's height (never below ~2 lines) and fades
 *  out at its foot, so a cut reads as "the first lines", never as a clipped sentence. The
 *  mask is alpha only (no colour). */
const FIRST_LINES = "flex min-h-16 flex-1 flex-col overflow-hidden p-3 [&>p]:min-h-0 [&>p]:flex-1 [&>p]:overflow-hidden [&>p]:mask-b-from-70% [&>p]:mask-b-to-100%";

/** How many free times a scheduling card offers as buttons. */
const SLOT_OFFER = 3;

/** Days since an ISO instant (null when unknown). */
function daysSince(iso: string | null, now: number): number | null {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 86_400_000)) : null;
}

/** The candidate's pipeline row (role, stage) from the shared read, or null. */
export function useEntry(entryId: string, epoch: number): OneEntry | null {
  const read = usePipeline(epoch);
  return read.state === "ready" ? (read.data.entries.find((e) => e.id === entryId) ?? null) : null;
}

/* ── the shell ───────────────────────────────────────────────────────────── */

export type CardShellProps = {
  person: Selected;
  entry: OneEntry | null;
  face: ToolKind;
  onFace: (face: ToolKind) => void;
  /** What the card is in this answer ("Letter 1 of 3", "Waiting longest", "Profile"). */
  eyebrow: string;
  onExpand: () => void;
  /** Present when the card is a picked candidate (× clears the selection). */
  onClose?: () => void;
  /** The face's acts (one primary at most). */
  acts: ReactNode;
  /** The quiet line under the acts ("2 more waiting: …"). */
  strip?: ReactNode;
  /** Shared-layout id: the card morphs into the expanded pane (none under reduced motion). */
  layoutId?: string;
  className?: string;
  children: ReactNode;
};

export function CardShell({ person, entry, face, onFace, eyebrow, onExpand, onClose, acts, strip, layoutId, className = "", children }: CardShellProps) {
  const t = useTranslations("one.cards");
  const m = useOneMotion();
  const sub = [entry?.jobTitle, entry?.stageLabel].filter(Boolean).join(" · ");
  return (
    <motion.section
      layoutId={layoutId}
      transition={m.panelEnter.transition}
      className={`${PANEL} flex min-h-0 flex-col ${className}`}
      data-one-surface
      data-one-sticker
      data-role="cards-card"
      data-face={face}
      aria-label={`${t(`faces.${face}`)} · ${person.label}`}
    >
      {/* Head: the name and the faces on one line; what the card is (eyebrow) + role · stage
          under it. */}
      <div className="flex shrink-0 flex-col gap-0.5 border-b border-stone-200 px-[var(--one-pad)] pt-2 pb-2 dark:border-b-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className={`${PANEL_TITLE} min-w-0 flex-1 text-h2! leading-tight`} data-role="cards-name">
            {person.label}
          </h2>
          <div role="tablist" aria-label={t("faces.label")} className={`${SEG_GROUP} shrink-0`}>
            {TOOL_KINDS.map((k) => (
              <Seg key={k} group={`cards-face-${person.entryId}`} active={k === face} role="tab" aria-selected={k === face} onClick={() => onFace(k)} data-face-tab={k}>
                {t(`faces.${k}`)}
              </Seg>
            ))}
          </div>
          {onClose ? <Button label={t("close")} icon="x" iconOnly variant="ghost" size="sm" onClick={onClose} /> : null}
        </div>
        <p className="flex min-w-0 items-baseline gap-2 text-micro text-steel">
          <span className={`${META_LABEL} shrink-0`} data-role="cards-eyebrow">
            {eyebrow}
          </span>
          {sub ? <span className="min-w-0 truncate">{sub}</span> : null}
        </p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-[var(--one-pad)]" data-role="cards-body">
        {children}
      </div>
      <div className="flex shrink-0 flex-col gap-1.5 border-t border-stone-200 px-[var(--one-pad)] py-2 dark:border-t-2 dark:border-dashed" data-role="cards-acts">
        <div className="flex flex-wrap items-center gap-2">
          {acts}
          <Button label={t("expand")} icon="open" variant="ghost" size="md" className="ml-auto" onClick={onExpand} aria-keyshortcuts="e" data-act="cards-expand" />
        </div>
        {strip}
      </div>
    </motion.section>
  );
}

/** "N more waiting: Ana · Petr · …" — each name picks that person (navigation). */
export function MoreStrip({ rest, onPick }: { rest: Selected[]; onPick: (s: Selected) => void }) {
  const t = useTranslations("one.cards");
  if (rest.length === 0) return null;
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-micro text-steel" data-role="cards-more">
      <span className="shrink-0">{t("moreWaiting", { count: rest.length })}</span>
      <span className="flex min-w-0 items-center gap-1 overflow-hidden" aria-label={t("moreLabel")}>
        {rest.slice(0, 3).map((s, i) => (
          <span key={s.entryId} className="flex min-w-0 items-center gap-1">
            {i > 0 ? <span aria-hidden>·</span> : null}
            <Button label={s.label} variant="link" size="sm" className="min-w-0 truncate" onClick={() => onPick(s)} />
          </span>
        ))}
        {rest.length > 3 ? <span aria-hidden>…</span> : null}
      </span>
    </p>
  );
}

/* ── profile ─────────────────────────────────────────────────────────────── */

type Ready = ProfileSummary & { labelOnly: boolean };

/** The profile face's read: the analysis the timeline links (else the seeded one). */
export function useProfileFace(entryId: string, epoch: number) {
  const pipeline = usePipeline(epoch);
  const candidateId = pipeline.state === "ready" ? (pipeline.data.entries.find((e) => e.id === entryId)?.candidateId ?? null) : null;
  return useProfile(pipeline.state !== "loading" ? entryId : null, candidateId, epoch);
}

/** The three strongest score parts, by share of their maximum. */
function topParts(p: Ready) {
  return [...p.parts].sort((a, b) => b.value / b.max - a.value / a.max).slice(0, 3);
}

/** The CV's first non-empty lines (the analysis text — there is no CV file store). */
function cvHead(text: string | null): string | null {
  if (!text) return null;
  const lines = text.split(/\n/).map((l) => l.trim()).filter((l) => l !== "");
  return lines.slice(0, 8).join("\n");
}

export function ProfileFaceBody({ person, epoch }: { person: Selected; epoch: number }) {
  const t = useTranslations("one.cards");
  const tp = useTranslations("one.core.panels.profile");
  const p = useProfileFace(person.entryId, epoch);
  if (p.state === "loading") return <LoadingGap className="min-h-24" />;
  if (p.state === "error") {
    return (
      <Note tone="critical" action={<Button label={t("retry")} variant="ghost" size="sm" onClick={p.read.retry} />}>
        {t("loadFailed")}
      </Note>
    );
  }
  if (p.state === "none") {
    return (
      <div className="flex flex-1 flex-col justify-center gap-1 py-6" data-role="cards-profile-none">
        <p className="text-body text-ink">{tp("none", { label: person.label })}</p>
        <p className="text-micro text-steel">{t("noneHint")}</p>
      </div>
    );
  }
  const head = cvHead(p.cvText);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-role="cards-profile">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        <p className={META_LABEL}>{tp("overall")}</p>
        <p className={META_LABEL}>{tp("jobFit")}</p>
        <div className="flex justify-start">{p.verdict.overall !== null ? <ScoreBar score={p.verdict.overall} /> : <span className="text-micro text-steel">{tp("unscored")}</span>}</div>
        <div className="flex justify-start">{p.verdict.jobFit !== null ? <ScoreBar score={p.verdict.jobFit} /> : <span className="text-micro text-steel">{tp("jobFitNone")}</span>}</div>
      </div>
      {p.labelOnly ? <Note tone="caution">{tp("labelOnly")}</Note> : null}
      {p.parts.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className={META_LABEL}>{t("topParts")}</p>
          <ul className="flex flex-col gap-1">
            {topParts(p).map((part) => (
              <li key={part.key} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 text-micro">
                <span className="truncate text-ink">{tp(`parts.${part.key}`)}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-stone-200" aria-hidden>
                  <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.round((part.value / part.max) * 100)}%` }} />
                </span>
                <span className="k-nums text-steel">
                  <span className="sr-only">{tp(`parts.${part.key}`)}: </span>
                  {tp("partOf", { value: part.value, max: part.max })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <p className={META_LABEL}>{t("cvLines")}</p>
        {head ? (
          <div className={`${PANEL_SUNKEN} ${FIRST_LINES}`} data-role="cards-cv">
            <p className="whitespace-pre-wrap break-words text-micro leading-6 text-ink">{head}</p>
          </div>
        ) : (
          <p className="text-micro text-steel">{tp("cvNone")}</p>
        )}
      </div>
    </div>
  );
}

/* ── letter ──────────────────────────────────────────────────────────────── */

/** The letter's first lines for the card (the stored draft, up to ~6 lines). */
function firstLines(body: string | null): string {
  if (!body) return "";
  return body.split(/\n/).filter((l) => l.trim() !== "").slice(0, 6).join("\n");
}

export function useLetterFace(entryId: string, epoch: number) {
  return useLetter(entryId, epoch);
}

/** `compact`: a consent card is up below the card — the sample line gives its height back. */
export function LetterFaceBody({ person, epoch, compact = false }: { person: Selected; epoch: number; compact?: boolean }) {
  const t = useTranslations("one.cards");
  const tl = useTranslations("one.core.panels.letter");
  const fmt = useDateFormat();
  const { letter } = useLetterFace(person.entryId, epoch);
  if (letter.state === "loading") return <LoadingGap className="min-h-24" />;
  if (letter.state === "error") {
    return (
      <Note tone="critical" action={<Button label={t("retry")} variant="ghost" size="sm" onClick={letter.retry} />}>
        {t("loadFailed")}
      </Note>
    );
  }
  const held = letter.data.letter;
  const preview = letter.data.preview;
  if (!held) {
    return (
      <div className="flex flex-1 flex-col justify-center gap-1 py-6" data-role="cards-letter-none">
        <p className="text-body text-ink">{tl("none", { label: person.label })}</p>
        <p className="text-micro text-steel">{tl("heldOnly")}</p>
      </div>
    );
  }
  const forecast = preview?.forecast ? tl(`forecast.${preview.forecast}`) : tl("forecast.unknown");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-role="cards-letter">
      <div className="flex flex-wrap items-center gap-2">
        <Tag label={tl(`state.${held.state}`)} />
        <span className="k-nums text-micro text-steel">{tl("revision", { revision: held.revision })}</span>
        {held.createdAt ? <span className="text-micro text-steel">· {t("drafted", { date: fmt.dateTime(held.updatedAt || held.createdAt) })}</span> : null}
      </div>
      <div className="flex flex-col gap-0.5">
        <p className={compact ? "sr-only" : META_LABEL}>{tl("subject")}</p>
        <p className="break-words text-body font-semibold text-ink">{preview?.subject || held.subject || tl("noSubject")}</p>
      </div>
      {held.body === null ? (
        <Note tone="caution">{tl("erased")}</Note>
      ) : (
        <div className={`${PANEL_SUNKEN} ${FIRST_LINES}`} data-role="cards-letter-lines">
          <p className="whitespace-pre-wrap break-words text-micro leading-6 text-ink">{firstLines(held.body)}</p>
        </div>
      )}
      <p className="flex items-start gap-1.5 text-micro text-steel" data-role="cards-letter-forecast">
        <Mark kind={preview?.forecast === "relay" ? "ok" : preview?.forecast === "local" ? "wait" : "caution"} />
        <span>{forecast}</span>
      </p>
      {held.sample && !compact ? <p className="flex items-start gap-1.5 text-micro text-steel"><Mark kind="caution" /><span>{t("sampleNote")}</span></p> : null}
    </div>
  );
}

/** The letter face's acts: Approve / Send (the one primary) — or nothing to act on. */
export function LetterFaceAct({ person, epoch, onPropose }: { person: Selected; epoch: number; onPropose: PanelProps["onPropose"] }) {
  const { letter } = useLetterFace(person.entryId, epoch);
  const held = letter.state === "ready" ? letter.data.letter : null;
  return held ? <LetterAct letter={held} label={person.label} onPropose={onPropose} size="md" /> : null;
}

/* ── interview ───────────────────────────────────────────────────────────── */

export function InterviewFaceBody({
  person,
  epoch,
  onPropose,
}: {
  person: Selected;
  epoch: number;
  onPropose: PanelProps["onPropose"];
}) {
  const t = useTranslations("one.cards");
  const tc = useTranslations("one.core.panels.calendar");
  const tn = useTranslations("one.core.panels");
  const fmt = useDateFormat();
  const days = useDays();
  const [now] = useState(() => Date.now());
  const r = useInterview(person.entryId, epoch);
  if (r.state === "none") return null;
  if (r.state === "loading") return <LoadingGap className="min-h-24" />;
  if (r.state === "error") {
    return (
      <Note tone="critical" action={<Button label={t("retry")} variant="ghost" size="sm" onClick={r.read.retry} />}>
        {t("loadFailed")}
      </Note>
    );
  }
  const waiting = r.entry?.waitingInterview ?? false;
  const since = daysSince(r.entry?.stageChangedAt ?? null, now);
  const upcoming = r.invites.filter((i) => i.status === "confirmed" || i.status === "pending");
  const offer: { slot: Slot; dateSlot: string }[] = [];
  for (const slot of r.slots ?? []) {
    const dateSlot = isoToDateSlot(slot.value, r.zone);
    if (dateSlot) offer.push({ slot, dateSlot });
    if (offer.length === SLOT_OFFER) break;
  }
  const book = (o: { slot: Slot; dateSlot: string }) =>
    onPropose("interviewBook", { entryId: person.entryId, dateSlot: o.dateSlot, label: person.label, when: o.slot.label, zone: r.zone });
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-role="cards-interview">
      <p className="flex items-start gap-1.5 text-body text-ink">
        <Mark kind={waiting ? "needs" : "ok"} />
        <span>{waiting ? (since === null ? t("waitingUnknown") : t("waitingSince", { days: days(since) })) : t("notWaiting")}</span>
      </p>
      {upcoming.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className={META_LABEL}>{t("invites")}</p>
          <ul className="flex flex-col">
            {upcoming.map((i) => (
              <li key={i.id} className="flex items-center gap-1.5 text-micro text-ink">
                <Mark kind={i.status === "confirmed" ? "ok" : "wait"} />
                <span className="k-nums">{i.slotAt ? fmt.dateTime(i.slotAt, { timeZone: r.zone }) : tn("notReturned")}</span>
                <span className="text-steel">· {i.status === "confirmed" ? tc("confirmed") : tc("pending")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {waiting ? (
        <div className="flex flex-col gap-1.5" data-role="cards-slots">
          <p className={META_LABEL}>{t("firstFree")}</p>
          {r.slots === null ? (
            <p className="text-micro text-steel">{tc("slotsFailed")}</p>
          ) : offer.length === 0 ? (
            <p className="text-micro text-steel">{t("noFree")}</p>
          ) : (
            <div className="grid gap-1.5">
              {offer.map((o, i) => (
                <Button
                  key={o.slot.value}
                  label={o.slot.label}
                  variant={i === 0 ? "primary" : "secondary"}
                  size="md"
                  className="w-full justify-start"
                  onClick={() => book(o)}
                  data-act="interview-book"
                />
              ))}
            </div>
          )}
          <p className="text-micro text-steel">{tc("zone", { zone: r.zone })}</p>
        </div>
      ) : null}
      {r.calendarStatus === "not_connected" ? <p className="text-micro text-steel">{tc("notConnected")}</p> : r.calendarStatus === "unavailable" ? <p className="text-micro text-steel">{tc("unavailable")}</p> : null}
    </div>
  );
}
