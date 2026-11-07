"use client";

// `?v=sheets` — the round-4 SLIDE-OVER SHEETS layout (docs/design/one-interface.md "Round 4
// variants"). A fork of the Dense layout (../dense/DenseLayout.tsx): the page stays Dense —
// the answer and its insight card on the left, the role-grouped list on the right — and every
// TOOL opens as a full-height sheet sliding in over the main column.
//
//   - Sheets: letters (the drafts waiting) · calendar (the week + who waits, pick → Book / Send
//     a link) · profile (CV | score, the main column widens to half the body so both halves sit
//     side by side while the list keeps the other half) · letter · schedule. The profile carries
//     Letter and Schedule, which push a second sheet.
//   - They STACK (stack.ts): two are drawn, the lower one peeks 24px at its edge as a spine you
//     can press; a breadcrumb names the stack; Esc pops one (and, with no person sheet left,
//     lets go of the candidate).
//   - Not a modal: no scrim, the list stays live — a press on another row swaps the top sheet's
//     person; Enter on a row opens their profile.
//   - The header counts open the matching sheet: Letters asks `letters`, Interviews asks
//     `calendar`, and an answer whose view is one of the sheets' opens that sheet (the side
//     then keeps a candidate list instead of repeating the sheet as a table).
//   - Consent cards ride at the foot of the top sheet while one is open.
//   - Motion: the sheet slide is the core snap preset (`sheetEnter`), the column change a 150ms
//     track move; reduced motion = at once.
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, ChipRow } from "@/app/_components/kit";
import { EYEBROW, FIELD } from "@/app/_components/ui/recipes";
import { useTablist } from "@/app/_components/ui/useTablist";
import { useOneMotion } from "../../motion";
import { consoleHref as consoleHrefFor } from "../../panels/PanelShell";
import { SEG_GROUP, Seg } from "../../Seg";
import type { ChipId, PanelInstance, Selected } from "../../types";
import type { VariantProps } from "../../variantProps";
import { DENSE_ASKING_TRIM, DENSE_COMPACT, KEYCAP } from "../dense/styles";
import { primaryOf, sideOf, tabsOf } from "../shared/side";
import { FACE_DISPLAY, NO_CHROME, STICKER_COMPOSER } from "../shared/styles";
import { forAnswer, isPersonSheet, isWide, onClear, onPick, pop, popTo, push, sheetEnter, SHEET_PANELS, VISIBLE, type PickSource, type SheetKind } from "./stack";
import { CAL_BESIDE, COLS_MOVE, COLS_NARROW, COLS_NONE, COLS_WIDE, FORCE_TWO, LETTERS_TRACKS, NO_HEAD, SPINE } from "./styles";

/** The views the host draws itself. */
const NEEDS_VIEW: PanelInstance = { id: "sheets-needs", kind: "needs", params: {}, pinned: false };
/** The side's list while a sheet answers the question: every active candidate, by role. */
const LIST_VIEW: PanelInstance = { id: "sheets-list", kind: "pipelineSlice", params: {}, pinned: false };
const LETTERS_VIEW: PanelInstance = { id: "sheets-letters", kind: "letters", params: {}, pinned: false };
const CALENDAR_VIEW: PanelInstance = { id: "sheets-calendar", kind: "calendar", params: {}, pinned: false };

/** True when a key press belongs to a text field (the page keys stay out of its way). */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

/** A press (or Enter / Space) inside a region: note where the pick came from. */
function pickFrom(set: (s: PickSource) => void, src: PickSource) {
  return {
    onPointerDownCapture: () => set(src),
    onKeyDownCapture: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") set(src);
    },
  };
}

export function SheetsLayout({
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
  const t = useTranslations("one.sheets");
  const tc = useTranslations("one.core");
  const m = useOneMotion();
  const [draft, setDraft] = useState("");
  const sideId = useId();
  const composer = useRef<HTMLInputElement>(null);

  // ── Where each view goes ────────────────────────────────────────────
  const primary = primaryOf(session.panels, session.focusId);
  // A view a sheet draws is never repeated as the side's table.
  const tabs = tabsOf(session.panels, primary).filter((p) => !SHEET_PANELS.includes(p.kind));
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedFor, setPickedFor] = useState<string | null>(primary?.id ?? null);
  if ((primary?.id ?? null) !== pickedFor) {
    setPickedFor(primary?.id ?? null);
    setPicked(null);
  }
  const sideView = sideOf(tabs, picked);
  const { tablistProps, tabProps, panelProps } = useTablist({
    ids: tabs.map((p) => p.id),
    active: sideView?.id ?? "",
    onSelect: setPicked,
  });

  // ── The swap direction: back = from the left, forward / new = from the right ──
  const answerKey = current ? current.reply.id : "first-beat";
  const [seen, setSeen] = useState({ key: answerKey, index: position.index, dir: 1 as 1 | -1 });
  if (seen.key !== answerKey) setSeen({ key: answerKey, index: position.index, dir: position.index < seen.index ? -1 : 1 });

  // ── The sheet stack ─────────────────────────────────────────────────
  // The answer's own person (an "open <name>" answer) until the user picks someone.
  const answerPerson: Selected | null =
    primary && (primary.kind === "profile" || primary.kind === "letter") && primary.params.entryId
      ? { entryId: primary.params.entryId, label: primary.params.label ?? "" }
      : null;
  const person = selected ?? answerPerson;
  const stackKey = `${answerKey}|${primary?.id ?? ""}`;
  const selId = selected?.entryId ?? null;
  const [stack, setStack] = useState<SheetKind[]>(() => forAnswer(primary?.kind));
  const [source, setSource] = useState<PickSource>(null);
  // The candidate picked IN the calendar's waiting list — the one a link may go to.
  const [calPick, setCalPick] = useState<string | null>(null);
  const [track, setTrack] = useState({ key: stackKey, sel: selId });
  if (track.key !== stackKey) {
    // A new answer (or a step to another): the sheet that answers it, or none.
    setTrack({ key: stackKey, sel: selId });
    setStack(forAnswer(primary?.kind));
    setSource(null);
  } else if (track.sel !== selId) {
    setTrack({ key: stackKey, sel: selId });
    setStack(selId ? onPick(stack, source) : onClear(stack));
    setCalPick(selId && source === "calendar" ? selId : null);
    setSource(null);
  }
  const open = stack.length > 0;
  const top = stack.at(-1);
  const visible = stack.slice(-VISIBLE);

  /** Change the stack by hand; with no person sheet left, let go of the candidate. */
  const reshape = useCallback(
    (next: SheetKind[]) => {
      setStack(next);
      if (!next.some(isPersonSheet) && selected) select(null);
    },
    [selected, select]
  );

  /** Hand focus to the side's table: the selected row if there is one, else the first. */
  const focusSide = useCallback(() => {
    requestAnimationFrame(() => {
      const side = document.getElementById(sideId);
      (side?.querySelector<HTMLElement>("[data-row][data-picked]") ?? side?.querySelector<HTMLElement>("[data-row][data-selected]") ?? side?.querySelector<HTMLElement>("[data-row]"))?.focus();
    });
  }, [sideId]);

  // ── The page keys: Esc pops a sheet; / composer (closes the sheets); [ ] answers. ──
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && open && !typing(e.target)) {
        // Capture phase: a row's own Esc would let go of the candidate AND every sheet.
        e.preventDefault();
        e.stopPropagation();
        reshape(pop(stack));
        return;
      }
      if (e.defaultPrevented || typing(e.target)) return;
      if (e.key === "/") {
        e.preventDefault();
        if (open) reshape([]);
        requestAnimationFrame(() => composer.current?.focus());
      } else if (e.key === "[" && position.canBack) {
        e.preventDefault();
        stepBack();
      } else if (e.key === "]" && position.canForward) {
        e.preventDefault();
        stepForward();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, stack, reshape, position.canBack, position.canForward, stepBack, stepForward]);

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
    greeting.state === "needs" ? { id: "sheets-first", kind: greeting.first.panel, params: greeting.first.params, pinned: false } : null;

  const chips: readonly ChipId[] = current ? current.reply.chips : greeting.state === "loading" ? [] : greeting.chips;
  const chipRow = chips.length > 0 ? <ChipRow chips={chips.map((id) => ({ id, label: words.chip(id), onPress: () => submit({ chip: id }) }))} /> : null;

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

  // ── The main card: the answer's insight (or the first need's) ───────
  const cardClass = `data-[grows]:flex-auto ${asking ? `min-h-0 ${DENSE_ASKING_TRIM}` : "min-h-fit"}`;
  const card = primary
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

  const consentStack = (
    <div ref={consents} className="flex shrink-0 flex-col gap-2 pr-1 pb-1" data-role="split-consents">
      <AnimatePresence initial={false}>
        {proposals.map((p) => (
          <motion.div key={p.id} {...m.consentEnter}>
            {renderConsent(p)}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );

  // ── The sheets ──────────────────────────────────────────────────────
  const nameOf = (k: SheetKind): string =>
    k === "letters" ? t("sheet.letters") : k === "calendar" ? t("sheet.calendar") : t(`sheet.${k}`, { label: person?.label ?? "" });

  const crumbs = (
    <nav aria-label={t("stackLabel")} className="min-w-0 flex-1" data-role="sheets-crumbs">
      <ol className="flex min-w-0 items-center gap-1 text-micro">
        {stack.map((k, i) => {
          const last = i === stack.length - 1;
          return (
            <li key={`${i}-${k}`} className={`flex items-center gap-1 ${last ? "min-w-0" : "shrink-0"}`}>
              {i > 0 ? (
                <span className="text-steel" aria-hidden>
                  ›
                </span>
              ) : null}
              {last ? (
                <span className="truncate font-semibold text-ink" aria-current="page">
                  {nameOf(k)}
                </span>
              ) : (
                <Button label={nameOf(k)} variant="link" size="sm" onClick={() => reshape(popTo(stack, i))} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );

  const bodyOf = (k: SheetKind): ReactNode => {
    const fill = "min-h-0 flex-1";
    switch (k) {
      case "letters":
        return <div className={`flex min-h-0 flex-1 flex-col ${LETTERS_TRACKS}`} {...pickFrom(setSource, "letters")}>{renderPanel(LETTERS_VIEW, { look: "table", className: `${fill} ${NO_CHROME}` })}</div>;
      case "calendar":
        return <div className={`flex min-h-0 flex-1 flex-col ${CAL_BESIDE}`} {...pickFrom(setSource, "calendar")}>{renderPanel(CALENDAR_VIEW, { look: "table", className: `${fill} ${NO_CHROME}` })}</div>;
      case "profile":
        return person ? <div className={`flex min-h-0 flex-1 flex-col ${NO_HEAD} ${FORCE_TWO}`}>{renderTool("profile", person, { className: fill })}</div> : null;
      case "letter":
        return person ? <div className={`flex min-h-0 flex-1 flex-col ${NO_HEAD}`}>{renderTool("letter", person, { className: fill })}</div> : null;
      case "schedule":
        return person ? <div className={`flex min-h-0 flex-1 flex-col ${NO_HEAD} ${FORCE_TWO}`}>{renderTool("interview", person, { className: fill })}</div> : null;
    }
  };

  /** The top sheet's own acts, at the end of its bar. */
  const actsOf = (k: SheetKind): ReactNode => {
    if (k === "profile" && person) {
      return (
        <div className="flex shrink-0 items-center gap-1.5" data-role="sheets-push">
          <Button label={t("push.letter")} variant="secondary" size="sm" onClick={() => reshape(push(stack, "letter"))} />
          <Button label={t("push.schedule")} variant="secondary" size="sm" onClick={() => reshape(push(stack, "schedule"))} />
        </div>
      );
    }
    return null;
  };

  const calendarLine =
    top === "calendar" ? (
      <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-1 text-micro text-steel" data-role="sheets-cal-pick">
        {selected && calPick === selected.entryId ? (
          <>
            <span className="text-ink">{t("calendar.picked", { label: selected.label })}</span>
            <Button label={t("calendar.link")} variant="link" size="sm" onClick={() => session.propose("interviewLink", { entryId: selected.entryId, label: selected.label })} data-act="interview-link" />
          </>
        ) : (
          <span>{t("calendar.pick")}</span>
        )}
      </div>
    ) : null;

  const enter = sheetEnter(m);
  const sheets = (
    <div className="absolute inset-0 z-20 bg-paper" data-role="sheets-layer">
      <AnimatePresence initial={false}>
        {visible.map((k, i) => {
          const isTop = i === visible.length - 1;
          const lower = !isTop;
          const index = stack.length - visible.length + i;
          return (
            <motion.div
              key={`${index}-${k}`}
              {...enter}
              className={`absolute inset-y-0 right-0 isolate flex min-h-0 flex-col gap-2 bg-paper ${lower ? "invisible left-0 z-0" : visible.length > 1 ? "left-7 z-[2]" : "left-0 z-[2]"}`}
              data-sheet={k}
              data-top={isTop || undefined}
              role={isTop ? "region" : undefined}
              aria-label={isTop ? nameOf(k) : undefined}
              aria-hidden={lower || undefined}
              inert={lower || undefined}
            >
              {isTop ? (
                <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-stone-200 pb-1.5 dark:border-b-2 dark:border-dashed" data-role="sheets-bar">
                  <Button label={stack.length > 1 ? t("back", { name: nameOf(stack[stack.length - 2]) }) : t("close", { name: nameOf(k) })} icon={stack.length > 1 ? "left" : "x"} iconOnly variant="ghost" size="sm" onClick={() => reshape(pop(stack))} />
                  {crumbs}
                  {actsOf(k)}
                  <span className="hidden shrink-0 items-center gap-1 text-micro text-steel xl:flex" aria-hidden>
                    <kbd className={KEYCAP}>{t("keyEsc")}</kbd>
                    {t("keyBack")}
                  </span>
                </div>
              ) : null}
              {isTop ? calendarLine : null}
              {bodyOf(k)}
              {isTop && asking ? <div className="max-h-[45%] shrink-0 overflow-y-auto">{consentStack}</div> : null}
            </motion.div>
          );
        })}
      </AnimatePresence>
      {visible.length > 1 ? (
        <button type="button" className={SPINE} onClick={() => reshape(pop(stack))} aria-label={t("back", { name: nameOf(visible[0]) })} data-role="sheets-spine">
          <span className="rotate-180 truncate whitespace-nowrap [writing-mode:vertical-rl]">{nameOf(visible[0])}</span>
        </button>
      ) : null}
    </div>
  );

  const swap = m.answerSwap(seen.dir);
  const replyLine = `${FACE_DISPLAY} max-w-3xl text-h2 font-bold leading-snug tracking-tight text-balance`;
  const cols = !open ? COLS_NONE : isWide(stack) ? COLS_WIDE : COLS_NARROW;
  return (
    <div
      className={`grid gap-4 px-4 py-3 [font-variant-numeric:tabular-nums] lg:h-full lg:min-h-0 lg:gap-[var(--one-gap)] ${cols} ${COLS_MOVE} ${DENSE_COMPACT}`}
      data-one-layout={variant}
      data-finish="dense"
      data-sheets={open ? stack.join(" ") : undefined}
    >
      {/* ── Main: the answer in view, the sheets over it ─────────────── */}
      <section className="relative flex min-h-0 min-w-0 flex-col gap-2 max-lg:min-h-[40rem]" aria-label={tc("meta.conversationLabel")}>
        <div className="flex min-h-0 flex-1 flex-col gap-2" inert={open || undefined} data-role="sheets-under">
          {/* What was asked + the stepper — one line. */}
          <div className="flex min-h-8 shrink-0 items-center justify-between gap-3">
            <p className={`${EYEBROW} min-w-0 truncate`} data-role="split-asked">
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
            {position.total > 0 ? (
              <div className="flex shrink-0 items-center gap-0.5" data-role="one-stepper">
                <Button label={tc("step.back")} icon="left" iconOnly variant="ghost" size="sm" disabled={!position.canBack} onClick={stepBack} />
                <span className="k-nums min-w-12 text-center text-micro text-steel" role="status">
                  {t("position", { index: position.index + 1, total: position.total })}
                </span>
                <Button label={tc("step.forward")} icon="right" iconOnly variant="ghost" size="sm" disabled={!position.canForward} onClick={stepForward} />
              </div>
            ) : null}
          </div>

          {/* The stack that distributes: reply, the insight card (grows), consent. */}
          <div className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1 [scrollbar-gutter:stable]" data-role="split-stack">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={answerKey} className={`flex flex-auto flex-col gap-2.5 ${asking ? "min-h-0" : ""}`} {...swap} data-role="split-answer">
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

                {card ? (
                  <div className={`relative flex flex-col pr-1 pb-1 has-[[data-grows]]:flex-auto ${asking ? "min-h-0" : "min-h-fit"}`} data-role="split-card">
                    {card}
                  </div>
                ) : null}
              </motion.div>
            </AnimatePresence>

            {asking && !open ? consentStack : null}
          </div>

          {/* ── The dock: follow-ups, the composer, and one status line (what changed + keys) ── */}
          <div className="flex shrink-0 flex-col gap-2 border-t border-stone-200 pt-2.5 dark:border-t-2 dark:border-dashed" data-role="split-dock">
            {chipRow ? (
              <div className="-mx-1 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&_.k-chips]:flex-nowrap!" data-role="split-chips">
                {chipRow}
              </div>
            ) : null}
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
                // The one coral primary — unless a consent card holds it.
                <Button label={tc("composer.send")} variant={asking ? "secondary" : "primary"} size="sm" type="submit" disabled={!draft.trim()} />
              )}
            </form>
            <div className="flex min-h-7 items-center justify-between gap-3 lg:pl-11" data-role="dense-status">
              <div className="flex min-w-0 flex-1 items-center gap-2 text-micro" role="status" data-role="one-change">
                {session.lastChange ? (
                  <>
                    <span className="sr-only">{t("changeLabel")}: </span>
                    <span className="min-w-0 flex-1 truncate text-steel before:text-steel before:content-['↳_']">{words.change(session.lastChange)}</span>
                    {session.canUndo ? <Button label={tc("change.undo")} variant="link" size="sm" className="shrink-0" onClick={session.undo} /> : null}
                  </>
                ) : null}
              </div>
              <p className="flex shrink-0 items-center gap-1 text-micro text-steel" data-role="dense-keys">
                <span className="sr-only">{t("keysLabel")}: </span>
                <kbd className={KEYCAP}>[</kbd>
                <kbd className={KEYCAP}>]</kbd>
                <span>{t("keyStep")}</span>
                <kbd className={`${KEYCAP} ml-2`}>{t("keyEnter")}</kbd>
                <span>{t("keyOpen")}</span>
              </p>
            </div>
          </div>
        </div>

        {open ? sheets : null}
      </section>

      {/* ── Side: the role-grouped list — live under any sheet ─────────── */}
      <aside id={sideId} className="flex min-h-0 min-w-0 flex-col gap-2 max-lg:h-[36rem]" aria-label={tc("meta.regionLabel")} data-role="split-side" {...pickFrom(setSource, "side")}>
        {tabs.length > 1 ? (
          <div className="flex shrink-0 items-center gap-3" data-role="split-tabs">
            <div {...tablistProps} aria-label={t("tabsLabel")} className={SEG_GROUP}>
              {tabs.map((p) => (
                <Seg key={p.id} group="side-tabs" active={p.id === sideView?.id} {...tabProps(p.id)}>
                  <span className="truncate font-semibold">{words.view(p.kind, p.params)}</span>
                  {p.pinned ? <span className="shrink-0">· {t("pinned")}</span> : null}
                </Seg>
              ))}
            </div>
          </div>
        ) : null}
        <div {...(tabs.length > 1 ? panelProps : {})} className="relative flex min-h-0 flex-1 flex-col outline-none">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={sideView?.id ?? (current ? LIST_VIEW.id : "side-host")} className="flex min-h-0 flex-1 flex-col" {...m.panelEnter}>
              {sideView ? (
                renderPanel(sideView, { look: "table", className: "min-h-0" })
              ) : current ? (
                renderPanel(LIST_VIEW, { look: "table", className: `min-h-0 ${NO_CHROME}` })
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  {renderPanel(NEEDS_VIEW, { look: "table", className: `shrink-0 ${NO_CHROME}` })}
                  {firstNeed ? renderPanel(firstNeed, { look: "table", className: `min-h-0 flex-1 ${NO_CHROME}` }) : null}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </aside>
    </div>
  );
}
