"use client";

// The ANSWER CARDS layout (round 4, `?v=cards`) — a fork of the Dense layout
// (variants/dense/DenseLayout.tsx) that keeps its regions, finish and keys and changes what
// the main column's card is: the card IS the tool.
//
//   - "Letters to approve" → a LETTER card: the first waiting letter (or the one picked on
//     the side) — subject, first lines, forecast, Approve / Send (preview), Next letter, and
//     "N more waiting" counted from the letters read, never from the reply's words.
//   - "Calendar" → a SCHEDULING card: the person waiting longest (or the one picked), the
//     first three free times as Book buttons (preview), Send link instead.
//   - A person picked from any other list → their PROFILE card (verdict, the two figures,
//     the strongest parts, the CV's first lines). Every person card flips between its
//     Profile · Letter · Interview faces in its head.
//   - Expand (or E) → the face's full tool (`renderTool(face, …, { look: "pane" })`) takes
//     the whole main + side width as two halves; the side collapses to a slim rail — the
//     same view as a role-grouped list — so it stays reachable. Esc returns.
//   - Under each card, next-step chips that are ORDINARY submits (Write letter, Schedule,
//     Letters, Back to decisions), so the stepper ([ ]) walks back through what you did.
//   - Motion: answerSwap between cards (the variant's personality); Expand is a shared-
//     layout morph (card → pane). Both still under reduced motion.
import Link from "next/link";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, ChipRow, type Chip } from "@/app/_components/kit";
import { EYEBROW, FIELD } from "@/app/_components/ui/recipes";
import { useTablist } from "@/app/_components/ui/useTablist";
import { useOneMotion } from "../../motion";
import { consoleHref as consoleHrefFor } from "../../panels/PanelShell";
import { SEG_GROUP, Seg } from "../../Seg";
import { useLettersWaiting, usePipeline, waitingForInterview } from "../../tools/reads";
import { TOOL_KINDS, type ChipId, type PanelInstance, type PanelKind, type Selected, type ToolKind } from "../../types";
import type { VariantProps } from "../../variantProps";
import { DENSE_ASKING_TRIM, DENSE_COMPACT, KEYCAP } from "../dense/styles";
import { primaryOf, sideOf, tabsOf } from "../shared/side";
import { FACE_DISPLAY, NO_CHROME, STICKER_COMPOSER } from "../shared/styles";
import { CardShell, InterviewFaceBody, LetterFaceAct, LetterFaceBody, MoreStrip, ProfileFaceBody, useEntry } from "./faces";

/** The views the host draws itself before anything is on screen (the first beat). */
const NEEDS_VIEW: PanelInstance = { id: "cards-needs", kind: "needs", params: {}, pinned: false };
/** The role-grouped candidate list the side falls back to when the answer is one person. */
const ROSTER: PanelInstance = { id: "cards-roster", kind: "pipelineSlice", params: {}, pinned: false };
/** Views that ARE one person: the card shows them, so the side never repeats them. */
const PERSON_KINDS: readonly PanelKind[] = ["profile", "letter"];

/** Conductor input for "write a letter to <name>" — the matcher's own (English-only)
 *  vocabulary (engine/resolve.ts `companionOutreach`), not UI copy. */
const writeLetterAsk = (label: string) => `write outreach to ${label}`;

/** The rail is for reaching people, not acting on them: a row's quiet acts show only on
 *  the picked row (descendant hook on the core list's row markup, PanelFrame ListRows). */
const RAIL_QUIET = "[&_li[data-row]:not([data-picked])>div+div]:hidden";
/** The letters table's door ("Open in Console") needs its own track, or it lands on the
 *  drafted date (the core sets the template inline per row, hence `!`). */
const LETTER_TRACKS = "[&_[data-one-panel=letters]_[role=row]]:grid-cols-[minmax(12rem,1fr)_6rem_8rem_9rem]!";

type Context = "letters" | "calendar" | "person" | "other";

/** True when a key press belongs to a text field (the page keys stay out of its way). */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

export function CardsLayout({
  variant,
  session,
  submit,
  greeting,
  current,
  position,
  stepBack,
  stepForward,
  renderPanel,
  renderConsent,
  words,
  selected,
  select,
  renderTool,
}: VariantProps) {
  const t = useTranslations("one.cards");
  const tc = useTranslations("one.core");
  const m = useOneMotion();
  const [draft, setDraft] = useState("");
  const sideId = useId();
  const composer = useRef<HTMLInputElement>(null);
  const epoch = session.epoch;

  // ── Where each view goes ────────────────────────────────────────────
  const primary = primaryOf(session.panels, session.focusId);
  const tabs = tabsOf(session.panels, primary).filter((p) => !PERSON_KINDS.includes(p.kind));
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedFor, setPickedFor] = useState<string | null>(primary?.id ?? null);
  if ((primary?.id ?? null) !== pickedFor) {
    setPickedFor(primary?.id ?? null);
    setPicked(null);
  }
  const ctx: Context = !primary
    ? "other"
    : primary.kind === "letters"
      ? "letters"
      : primary.kind === "calendar"
        ? "calendar"
        : PERSON_KINDS.includes(primary.kind)
          ? "person"
          : "other";
  const sideView = sideOf(tabs, picked) ?? (ctx === "person" ? ROSTER : null);
  const { tablistProps, tabProps, panelProps } = useTablist({
    ids: tabs.map((p) => p.id),
    active: sideView?.id ?? "",
    onSelect: setPicked,
  });

  // ── The swap direction: back = from the left, forward / new = from the right ──
  const answerKey = current ? current.reply.id : "first-beat";
  const [seen, setSeen] = useState({ key: answerKey, index: position.index, dir: 1 as 1 | -1 });
  if (seen.key !== answerKey) setSeen({ key: answerKey, index: position.index, dir: position.index < seen.index ? -1 : 1 });

  // ── The card's person and its queue (who comes next) ────────────────
  const lettersRead = useLettersWaiting(epoch);
  const pipeline = usePipeline(epoch);
  const queue: Selected[] =
    ctx === "letters" && lettersRead.state === "ready"
      ? lettersRead.data.letters.map((l) => ({ entryId: l.entryId, label: l.candidateLabel }))
      : ctx === "calendar" && pipeline.state === "ready"
        ? waitingForInterview(pipeline.data.entries).map((e) => ({ entryId: e.id, label: e.label }))
        : [];
  const fromAnswer: Selected | null =
    ctx === "person" && primary?.params.entryId ? { entryId: primary.params.entryId, label: primary.params.label ?? "" } : null;
  const person: Selected | null = selected ?? queue[0] ?? fromAnswer;
  const at = person ? queue.findIndex((q) => q.entryId === person.entryId) : -1;
  const rest = at >= 0 ? [...queue.slice(at + 1), ...queue.slice(0, at)] : [];
  const entry = useEntry(person?.entryId ?? "", epoch);

  // The face: the answer's (letters → letter, calendar → interview, else profile) unless
  // the user flipped this card — a flip lasts for this person in this answer.
  const faceKey = `${answerKey}:${person?.entryId ?? ""}`;
  const defaultFace: ToolKind = ctx === "letters" ? "letter" : ctx === "calendar" ? "interview" : primary?.kind === "letter" ? "letter" : "profile";
  const [flip, setFlip] = useState<{ key: string; face: ToolKind } | null>(null);
  const face: ToolKind = flip?.key === faceKey ? flip.face : defaultFace;

  // ── Expand: the face's full tool across main + side (navigation, never undo) ──
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const [expandedAt, setExpandedAt] = useState(answerKey);
  if (expandedAt !== answerKey) {
    setExpandedAt(answerKey);
    setExpandedFor(null);
  }
  const expanded = person !== null && expandedFor === person.entryId;

  /** Hand focus to the side's list: the selected row if there is one, else the first. */
  const focusSide = useCallback(() => {
    requestAnimationFrame(() => {
      const side = document.getElementById(sideId);
      (side?.querySelector<HTMLElement>("[data-row][data-selected]") ?? side?.querySelector<HTMLElement>("[data-row]"))?.focus();
    });
  }, [sideId]);

  // ── The page keys: / composer, [ ] answers, E expand, Esc back one level. ──
  const personId = person?.entryId ?? null;
  const hasSelection = selected !== null;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || typing(e.target)) return;
      if (e.key === "/") {
        e.preventDefault();
        composer.current?.focus();
      } else if (e.key === "[" && position.canBack) {
        e.preventDefault();
        stepBack();
      } else if (e.key === "]" && position.canForward) {
        e.preventDefault();
        stepForward();
      } else if ((e.key === "e" || e.key === "E") && personId && !expanded) {
        e.preventDefault();
        setExpandedFor(personId);
      } else if (e.key === "Escape") {
        if (expanded) {
          e.preventDefault();
          setExpandedFor(null);
        } else if (hasSelection) {
          e.preventDefault();
          select(null);
          focusSide();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [position.canBack, position.canForward, stepBack, stepForward, personId, expanded, hasSelection, select, focusSide]);

  /** In the composer: Esc, or ↓ on an empty line, goes to the list. */
  const onComposerKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" || (e.key === "ArrowDown" && draft === "")) {
      e.preventDefault();
      focusSide();
    }
  };

  // ── The first beat (nothing asked yet) ──────────────────────────────
  const g = words.greeting(greeting);
  const firstNeed: PanelInstance | null =
    greeting.state === "needs" ? { id: "cards-first", kind: greeting.first.panel, params: greeting.first.params, pinned: false } : null;

  const handProposals = session.proposals.filter((p) => p.turnId === null && !current?.proposals.includes(p));
  const proposals = [...(current?.proposals ?? []), ...handProposals];
  const asking = proposals.length > 0;
  const consents = useRef<HTMLDivElement>(null);
  const newestProposal = proposals.at(-1)?.id ?? null;
  useEffect(() => {
    if (!newestProposal) return;
    consents.current?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: m.reduced ? "auto" : "smooth" });
  }, [newestProposal, m.reduced]);

  const askedWords = current ? (current.asked.text ?? (current.asked.chip ? words.chip(current.asked.chip) : "")) : "";
  const pending = session.pending !== null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    submit({ text: draft });
    setDraft("");
  };

  // ── Next steps under the card: ordinary submits (the stepper walks them) ──
  const replyChips: readonly ChipId[] = current ? current.reply.chips : greeting.state === "loading" ? [] : greeting.chips;
  const nextChips: Chip[] = [];
  const used = new Set<ChipId>();
  if (person) {
    // Write letter asks the companion for a NEW draft — offered wherever the answer is not
    // already the queue of drafts waiting.
    if (ctx !== "letters") nextChips.push({ id: "next-write", label: t("next.writeLetter"), onPress: () => submit({ text: writeLetterAsk(person.label) }) });
    const own: [ChipId, string][] = [
      ["calendar", t("next.schedule")],
      ["letters", t("next.letters")],
      ["decisions", t("next.decisions")],
    ];
    for (const [id, label] of own) {
      if ((id === "calendar" && ctx === "calendar") || (id === "letters" && ctx === "letters")) continue;
      used.add(id);
      nextChips.push({ id: `next-${id}`, label, onPress: () => submit({ chip: id }) });
    }
  }
  for (const id of replyChips) {
    if (nextChips.length >= 4) break;
    if (used.has(id)) continue;
    nextChips.push({ id, label: words.chip(id), onPress: () => submit({ chip: id }) });
  }
  const chipRow =
    nextChips.length > 0 ? (
      <div className="-mx-1 shrink-0 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&_.k-chips]:flex-nowrap!" data-role="cards-next" aria-label={t("next.label")}>
        <ChipRow chips={nextChips.slice(0, 4)} />
      </div>
    ) : null;

  // ── The card ────────────────────────────────────────────────────────
  const flipTo = (f: ToolKind) => setFlip({ key: faceKey, face: f });
  const expand = () => person && setExpandedFor(person.entryId);
  const sheetId = (id: string) => (m.reduced ? undefined : `cards-sheet-${id}`);
  const eyebrow = (): string => {
    if (ctx === "letters" && at >= 0 && face === "letter") return t("eyebrow.letterOf", { index: at + 1, total: queue.length });
    // "Longest" only when their wait has a date (an unknown wait is not ranked as long).
    if (ctx === "calendar" && at >= 0 && face === "interview") return at === 0 && entry?.stageChangedAt ? t("eyebrow.longest") : t("eyebrow.waitingOf", { index: at + 1, total: queue.length });
    return selected ? t(`eyebrow.picked.${face}`) : t(`faces.${face}`);
  };
  const faceActs = (p: Selected): ReactNode => {
    if (face === "letter") {
      return (
        <>
          <LetterFaceAct person={p} epoch={epoch} onPropose={session.propose} />
          {ctx === "letters" && rest.length > 0 ? <Button label={t("nextLetter")} icon="right" variant="secondary" size="md" onClick={() => select(rest[0])} data-act="cards-next-letter" /> : null}
        </>
      );
    }
    if (face === "interview") {
      return (
        <>
          <Button label={t("sendLink")} variant="secondary" size="md" onClick={() => session.propose("interviewLink", { entryId: p.entryId, label: p.label })} data-act="interview-link" />
          {ctx === "calendar" && rest.length > 0 ? <Button label={t("nextWaiting")} icon="right" variant="secondary" size="md" onClick={() => select(rest[0])} data-act="cards-next-waiting" /> : null}
        </>
      );
    }
    return null;
  };

  const cardClass = `data-[grows]:flex-auto ${asking ? `min-h-0 ${DENSE_ASKING_TRIM}` : "min-h-fit"}`;
  const fallbackCard = primary
    ? renderPanel(primary, { look: "insight", className: cardClass })
    : !current && firstNeed
      ? renderPanel(firstNeed, {
          look: "insight",
          className: cardClass,
          onExpand: () => {
            session.show(firstNeed.kind, firstNeed.params);
            focusSide();
          },
        })
      : null;

  const personCard = person ? (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div key={`${face}:${person.entryId}`} className="flex min-h-0 shrink flex-col pr-1 pb-1" {...m.answerSwap(1)} data-role="cards-slot">
        <CardShell
          person={person}
          entry={entry}
          face={face}
          onFace={flipTo}
          eyebrow={eyebrow()}
          onExpand={expand}
          onClose={selected ? () => select(null) : undefined}
          acts={faceActs(person)}
          strip={ctx === "letters" || ctx === "calendar" ? <MoreStrip rest={rest} onPick={select} /> : null}
          layoutId={sheetId(person.entryId)}
        >
          {face === "profile" ? (
            <ProfileFaceBody person={person} epoch={epoch} />
          ) : face === "letter" ? (
            <LetterFaceBody person={person} epoch={epoch} compact={asking} />
          ) : (
            <InterviewFaceBody person={person} epoch={epoch} onPropose={session.propose} />
          )}
        </CardShell>
      </motion.div>
    </AnimatePresence>
  ) : null;

  const swap = m.answerSwap(seen.dir);
  const replyLine = `${FACE_DISPLAY} max-w-3xl text-h2 font-bold leading-snug tracking-tight text-balance`;

  const consentStack = asking ? (
    <div ref={consents} className="flex shrink-0 flex-col gap-2 pr-1 pb-1" data-role="cards-consents">
      <AnimatePresence initial={false}>
        {proposals.map((p) => (
          <motion.div key={p.id} {...m.consentEnter}>
            {renderConsent(p)}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  ) : null;

  // ── The dock: the composer and one status line (what changed + keys) ──
  const dock = (
    <div className="flex shrink-0 flex-col gap-2 border-t border-stone-200 pt-2.5 dark:border-t-2 dark:border-dashed" data-role="cards-dock">
      <form className={`${STICKER_COMPOSER} flex items-center gap-2 p-0.5 pl-1.5 focus-within:ring-2 focus-within:ring-coral focus-within:ring-offset-2 focus-within:ring-offset-paper`} onSubmit={onSubmit} data-role="one-composer">
        <span className={`${KEYCAP} shrink-0 text-steel`} aria-hidden>
          /
        </span>
        <input
          ref={composer}
          type="text"
          className={`${FIELD} h-9 min-w-0 flex-1 border-transparent bg-transparent px-1 focus:border-transparent! focus-visible:shadow-none!`}
          aria-label={tc("composer.label")}
          aria-keyshortcuts="/"
          placeholder={tc("composer.placeholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onComposerKey}
        />
        {session.pending ? (
          <Button label={tc("composer.stop")} variant="secondary" size="sm" onClick={session.stop} />
        ) : (
          // The coral primary belongs to the card's act (Approve, the first free time) or a
          // consent card when one is up; otherwise to Send.
          <Button label={tc("composer.send")} variant={asking || person ? "secondary" : "primary"} size="sm" type="submit" disabled={!draft.trim()} />
        )}
      </form>
      <div className="flex min-h-7 items-center justify-between gap-3 lg:pl-11" data-role="cards-status">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-micro" role="status" data-role="one-change">
          {session.lastChange ? (
            <>
              <span className="sr-only">{t("changeLabel")}: </span>
              <span className="min-w-0 flex-1 truncate text-steel before:text-steel before:content-['↳_']">{words.change(session.lastChange)}</span>
              {session.canUndo ? <Button label={tc("change.undo")} variant="link" size="sm" className="shrink-0" onClick={session.undo} /> : null}
            </>
          ) : null}
        </div>
        <p className="flex shrink-0 items-center gap-1 text-micro text-steel" data-role="cards-keys">
          <span className="sr-only">{t("keysLabel")}: </span>
          <kbd className={KEYCAP}>[</kbd>
          <kbd className={KEYCAP}>]</kbd>
          <span>{t("keyStep")}</span>
          {person && !expanded ? (
            <>
              <kbd className={`${KEYCAP} ml-2`}>E</kbd>
              <span>{t("keyExpand")}</span>
            </>
          ) : null}
          <kbd className={`${KEYCAP} ml-2`}>{t("keyEsc")}</kbd>
          <span>{expanded || selected ? t("keyBack") : t("keyList")}</span>
        </p>
      </div>
    </div>
  );

  const stepper =
    position.total > 0 ? (
      <div className="flex shrink-0 items-center gap-0.5" data-role="one-stepper">
        <Button label={tc("step.back")} icon="left" iconOnly variant="ghost" size="sm" disabled={!position.canBack} onClick={stepBack} />
        <span className="k-nums min-w-12 text-center text-micro text-steel" role="status">
          {t("position", { index: position.index + 1, total: position.total })}
        </span>
        <Button label={tc("step.forward")} icon="right" iconOnly variant="ghost" size="sm" disabled={!position.canForward} onClick={stepForward} />
      </div>
    ) : null;

  const rootClass = `grid gap-4 px-4 py-3 [font-variant-numeric:tabular-nums] lg:h-full lg:min-h-0 lg:gap-[var(--one-gap)] ${DENSE_COMPACT} ${LETTER_TRACKS}`;

  // ── Expanded: the face's tool across the page; the side is a slim rail ──
  if (expanded && person) {
    const railView = sideView ?? firstNeed ?? ROSTER;
    return (
      <LayoutGroup>
        <div className={`${rootClass} lg:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]`} data-one-layout={variant} data-finish="dense" data-cards="expanded">
          <section className="flex min-h-0 min-w-0 flex-col gap-2" aria-label={t("expandedLabel", { label: person.label })}>
            <div className="flex min-h-8 shrink-0 items-center gap-3" data-role="cards-sheet-head">
              <Button label={t("collapse")} icon="left" variant="ghost" size="sm" onClick={() => setExpandedFor(null)} aria-keyshortcuts="Escape" data-act="cards-collapse" />
              <div role="tablist" aria-label={t("faces.label")} className={SEG_GROUP}>
                {TOOL_KINDS.map((k) => (
                  <Seg key={k} group={`cards-sheet-face`} active={k === face} role="tab" aria-selected={k === face} onClick={() => flipTo(k)}>
                    {t(`faces.${k}`)}
                  </Seg>
                ))}
              </div>
              <span className="min-w-0 flex-1" />
              {stepper}
            </div>
            <motion.div layoutId={sheetId(person.entryId)} transition={m.panelEnter.transition} className="flex min-h-0 flex-1 flex-col" data-role="cards-sheet">
              {renderTool(face, person, { look: "pane", className: "min-h-0 flex-1" })}
            </motion.div>
            {consentStack}
            {dock}
          </section>
          <aside id={sideId} className="flex min-h-0 min-w-0 flex-col gap-2 max-lg:h-[24rem]" aria-label={tc("meta.regionLabel")} data-role="cards-rail">
            <motion.div key={railView.id} className="flex min-h-0 flex-1 flex-col" {...m.panelEnter}>
              {renderPanel(railView, { look: "list", className: `min-h-0 flex-1 ${NO_CHROME} ${RAIL_QUIET}` })}
            </motion.div>
          </aside>
        </div>
      </LayoutGroup>
    );
  }

  return (
    <LayoutGroup>
      <div
        className={`${rootClass} lg:grid-cols-[minmax(0,max(32rem,38vw))_minmax(0,1fr)]`}
        data-one-layout={variant}
        data-finish="dense"
        data-cards="cards"
      >
        {/* ── Main: the answer and its card ─────────────────────────────── */}
        <section className="flex min-h-0 min-w-0 flex-col gap-2" aria-label={tc("meta.conversationLabel")}>
          <div className="flex min-h-8 shrink-0 items-center justify-between gap-3">
            <p className={`${EYEBROW} min-w-0 truncate`} data-role="cards-asked">
              {current ? (
                <>
                  <span>{t("asked")}</span>
                  <span className="text-steel" aria-hidden>
                    {" · "}
                  </span>
                  <span className="normal-case text-ink">
                    <span className="sr-only">{tc("you")}: </span>
                    {askedWords}
                  </span>
                </>
              ) : (
                t("today")
              )}
            </p>
            {stepper}
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1 [scrollbar-gutter:stable]" data-role="cards-stack">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={answerKey} className={`flex flex-auto flex-col gap-2.5 ${asking || person ? "min-h-0" : ""}`} {...swap} data-role="cards-answer">
                {current ? (
                  <div className="flex shrink-0 flex-col gap-1" data-role="one-answer" data-fallback={current.reply.fallback || undefined}>
                    <h1 className={`${replyLine} text-ink`} aria-live="polite">
                      <span className="sr-only">{tc("one")}: </span>
                      {words.say(current.reply.say)}
                    </h1>
                    {current.reply.fallback ? <p className="text-micro text-steel">{t("notYet")}</p> : null}
                    {current.reply.dropped > 0 ? <p className="text-micro text-steel">{words.dropped(current.reply.dropped)}</p> : null}
                    {current.reply.links.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {current.reply.links.map((l) => (
                          <Link key={l.tab} className="k-btn k-btn--link k-btn--sm" href={consoleHrefFor(l.tab, l.params)}>
                            {tc("meta.console")}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex shrink-0 flex-col gap-1" data-role="one-greeting">
                    <h1 className={`${replyLine} ${greeting.state === "loading" ? "text-steel" : "text-ink"}`} aria-live="polite">
                      {g.status}
                    </h1>
                  </div>
                )}

                {pending ? (
                  <p className="shrink-0 text-micro text-steel" role="status">
                    {tc("composer.working")}
                  </p>
                ) : null}

                {personCard ??
                  (fallbackCard ? (
                    <div className={`relative flex flex-col pr-1 pb-1 has-[[data-grows]]:flex-auto ${asking ? "min-h-0" : "min-h-fit"}`} data-role="cards-panel-card">
                      {fallbackCard}
                    </div>
                  ) : null)}
                {asking ? null : chipRow}
              </motion.div>
            </AnimatePresence>
            {consentStack}
          </div>

          {dock}
        </section>

        {/* ── Side: the answer's list, grouped by role ─────────────────── */}
        <aside id={sideId} className="flex min-h-0 min-w-0 flex-col gap-2 max-lg:h-[36rem]" aria-label={tc("meta.regionLabel")} data-role="cards-side">
          {tabs.length > 1 ? (
            <div className="flex shrink-0 items-center gap-3" data-role="cards-tabs">
              <div {...tablistProps} aria-label={t("tabsLabel")} className={SEG_GROUP}>
                {tabs.map((p) => (
                  <Seg key={p.id} group="cards-side-tabs" active={p.id === sideView?.id} {...tabProps(p.id)}>
                    <span className="truncate font-semibold">{words.view(p.kind, p.params)}</span>
                    {p.pinned ? <span className="shrink-0">· {t("pinned")}</span> : null}
                  </Seg>
                ))}
              </div>
            </div>
          ) : null}
          <div {...(tabs.length > 1 ? panelProps : {})} className="relative flex min-h-0 flex-1 flex-col outline-none">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={sideView?.id ?? "side-host"} className="flex min-h-0 flex-1 flex-col" {...m.panelEnter}>
                {sideView ? (
                  renderPanel(sideView, { look: "table", className: `min-h-0 ${sideView === ROSTER ? NO_CHROME : ""}` })
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col gap-3">
                    {renderPanel(NEEDS_VIEW, { look: "table", className: `shrink-0 ${NO_CHROME}` })}
                    {!current && firstNeed ? renderPanel(firstNeed, { look: "table", className: `min-h-0 flex-1 ${NO_CHROME}` }) : null}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </aside>
      </div>
    </LayoutGroup>
  );
}
