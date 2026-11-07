"use client";

// The WORKBENCH layout (round 4, docs/design/one-interface.md "Round 4 variants"). A fork of
// the Dense layout (variants/dense/DenseLayout.tsx): with nothing picked it IS Dense — the
// answer's card on the left, the role-grouped table on the right. Picking a person splits the
// page:
//
//   - LEFT becomes that person's workbench: a Profile · Email · Interview strip (the core
//     tools, `renderTool`), the name and their role · stage, × to close. The CV and the score
//     sit side by side inside it (styles.ts TOOL_TWO_COLS).
//   - RIGHT keeps the list, narrower, the picked row marked — ↑ ↓ Enter walk people while the
//     workbench follows, keeping the tab you are on.
//   - The global views open on the left as a DESK (same strip, no person): Letters (the drafts
//     table) or Calendar (the week beside the waiting list). Pressing a person there opens
//     them with the desk's tool (Email / Interview) and the desk moves to the right as the
//     list. With a desk open and no other view on screen, the right holds the candidates by
//     role (a host-drawn pipeline table), so the list is reachable in every state.
//   - The reply shrinks to one line and the dock to the composer + the status line, so the
//     conversation is never lost but the tool gets the height.
//   - Keys: Dense's (/ composer, [ ] answers) plus Esc = back one level (person → list),
//     1 2 3 = the three tools while a person is open.
//   - Motion: the list slides into its new place (framer layout, snap), a tool or desk swap
//     uses panelEnter; under reduced motion both are still.
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
import { usePipeline } from "../../tools/reads";
import { TOOL_KINDS, type ChipId, type PanelInstance, type PanelKind, type ToolKind } from "../../types";
import type { VariantProps } from "../../variantProps";
import { primaryOf, sideOf, tabsOf } from "../shared/side";
import { FACE_DISPLAY, NO_CHROME, STICKER_COMPOSER } from "../shared/styles";
import { ASKING_TRIM, DESK_CALENDAR, TOOL_HEADLESS, KEYCAP, SIDE_CALENDAR, TOOL_TWO_COLS, TRACKS_NARROW, TRACKS_WIDE, WB_COMPACT } from "./styles";

/** The views the host draws itself before anything is on screen (the first beat). */
const NEEDS_VIEW: PanelInstance = { id: "wb-needs", kind: "needs", params: {}, pinned: false };
/** The candidates by role, drawn on the right while a desk holds the left alone. */
const CANDIDATES_VIEW: PanelInstance = { id: "wb-candidates", kind: "pipelineSlice", params: {}, pinned: false };

/** The global views that open on the left as a desk, and the tool a person opens with there. */
const DESKS = ["letters", "calendar"] as const;
type Desk = (typeof DESKS)[number];
const isDesk = (k: PanelKind): k is Desk => (DESKS as readonly PanelKind[]).includes(k);
const DESK_TOOL: Record<Desk, ToolKind> = { letters: "letter", calendar: "interview" };

/** True when a key press belongs to a text field (the page keys stay out of its way). */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

export function WorkbenchLayout({
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
  const t = useTranslations("one.workbench");
  const tc = useTranslations("one.core");
  const m = useOneMotion();
  const [draft, setDraft] = useState("");
  const sideId = useId();
  const composer = useRef<HTMLInputElement>(null);

  // ── Where each view goes ────────────────────────────────────────────
  const primary = primaryOf(session.panels, session.focusId);
  const desk: Desk | null = primary && isDesk(primary.kind) ? primary.kind : null;
  const open = selected !== null;
  const split = open || desk !== null;
  const tabs = tabsOf(session.panels, primary);
  // The right holds LISTS, never a desk: a desk on screen is reached through the desk strip
  // on the left. Once a person is opened from a desk, that desk moves right and becomes the
  // list (its picked row marked), ahead of the other views.
  const lists = tabs.filter((p) => !isDesk(p.kind));
  const rightTabs = desk && primary ? (open ? [primary, ...lists] : lists) : open ? tabs : lists;
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedFor, setPickedFor] = useState<string | null>(primary?.id ?? null);
  if ((primary?.id ?? null) !== pickedFor) {
    setPickedFor(primary?.id ?? null);
    setPicked(null);
  }
  const sideView = sideOf(rightTabs, picked);
  const sideTabs = useTablist({ ids: rightTabs.map((p) => p.id), active: sideView?.id ?? "", onSelect: setPicked });

  // ── The tool in front: a person opened from a desk opens on the desk's tool; walking to the
  //    next person keeps the tab you are on. ──
  const [tool, setTool] = useState<ToolKind>("profile");
  const [toolFor, setToolFor] = useState<string | null>(selected?.entryId ?? null);
  if ((selected?.entryId ?? null) !== toolFor) {
    setToolFor(selected?.entryId ?? null);
    if (selected && toolFor === null) setTool(desk ? DESK_TOOL[desk] : "profile");
  }
  const toolTabs = useTablist({ ids: TOOL_KINDS, active: tool, onSelect: setTool });
  const deskTabs = useTablist({ ids: DESKS, active: desk ?? "letters", onSelect: (k) => session.show(k) });

  // The person's role and stage for the workbench head (the shared pipeline read, one request).
  const pipeline = usePipeline(session.epoch);
  const person = selected && pipeline.state === "ready" ? (pipeline.data.entries.find((e) => e.id === selected.entryId) ?? null) : null;

  // ── The swap direction: back = from the left, forward / new = from the right ──
  const answerKey = current ? current.reply.id : "first-beat";
  const [seen, setSeen] = useState({ key: answerKey, index: position.index, dir: 1 as 1 | -1 });
  if (seen.key !== answerKey) setSeen({ key: answerKey, index: position.index, dir: position.index < seen.index ? -1 : 1 });

  /** Hand focus to the list: the given row, else the picked / focused row, else the first. */
  const focusSide = useCallback(
    (row?: HTMLElement | null) => {
      requestAnimationFrame(() => {
        const side = document.getElementById(sideId);
        const target =
          (row && row.isConnected ? row : null) ??
          side?.querySelector<HTMLElement>("[data-row][data-picked]") ??
          side?.querySelector<HTMLElement>("[data-row][data-selected]") ??
          side?.querySelector<HTMLElement>("[data-row]");
        target?.focus();
      });
    },
    [sideId]
  );

  /** Close the person: back to the list, focus on the row they were picked from. */
  const closePerson = useCallback(() => {
    const row = document.getElementById(sideId)?.querySelector<HTMLElement>("[data-row][data-picked]") ?? null;
    select(null);
    focusSide(row);
  }, [focusSide, select, sideId]);

  // ── The page keys: / composer, [ ] answers, Esc back one level, 1 2 3 tools. Never while a
  //    field has the cursor; a row's own Esc (it clears the pick) wins. ──
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
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (open) closePerson();
        else focusSide();
      } else if (open && (e.key === "1" || e.key === "2" || e.key === "3")) {
        e.preventDefault();
        setTool(TOOL_KINDS[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [position.canBack, position.canForward, stepBack, stepForward, open, closePerson, focusSide]);

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
    greeting.state === "needs" ? { id: "wb-first", kind: greeting.first.panel, params: greeting.first.params, pinned: false } : null;

  const chips: readonly ChipId[] = current ? current.reply.chips : greeting.state === "loading" ? [] : greeting.chips;
  const chipRow = !split && chips.length > 0 ? <ChipRow chips={chips.map((id) => ({ id, label: words.chip(id), onPress: () => submit({ chip: id }) }))} /> : null;

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

  // ── LEFT, no person and no desk: the answer's insight card (Dense) ───
  const cardClass = `data-[grows]:flex-auto ${asking ? `min-h-0 ${ASKING_TRIM}` : "min-h-fit"}`;
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

  // ── LEFT, a person: the workbench ───────────────────────────────────
  const personSub = person ? [person.jobTitle, person.stageLabel].filter(Boolean).join(" · ") : "";
  const workbench = selected ? (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-role="workbench" aria-label={t("benchFor", { label: selected.label })}>
      <div className="flex min-h-10 shrink-0 items-center gap-3" data-role="workbench-head">
        <div {...toolTabs.tablistProps} aria-label={t("tools.label")} className={SEG_GROUP}>
          {TOOL_KINDS.map((k, i) => (
            <Seg key={k} group="wb-tools" active={k === tool} {...toolTabs.tabProps(k)} aria-keyshortcuts={String(i + 1)}>
              {t(`tools.${k}`)}
            </Seg>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col" data-role="workbench-person">
          <span className="truncate text-micro font-semibold leading-5 text-ink">{selected.label}</span>
          {personSub ? <span className="truncate text-micro leading-5 text-steel">{personSub}</span> : null}
        </div>
        <Link className="k-btn k-btn--link k-btn--sm shrink-0" href={consoleHrefFor("pipeline", { q: selected.label })} data-role="one-console-link">
          {t("openConsole")}
        </Link>
        <Button label={t("tools.close")} icon="x" iconOnly variant="ghost" size="sm" onClick={closePerson} aria-keyshortcuts="Escape" />
      </div>
      <div {...toolTabs.panelProps} className={`relative flex min-h-0 flex-1 flex-col outline-none ${TOOL_TWO_COLS} ${TOOL_HEADLESS}`}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={`${tool}-${selected.entryId}`} className="flex min-h-0 flex-1 flex-col" {...m.panelEnter}>
            {renderTool(tool, selected, { className: "min-h-0 flex-1" })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  ) : null;

  // ── LEFT, a desk (Letters / Calendar, no person) ────────────────────
  const deskView =
    !selected && desk && primary ? (
      <div className="flex min-h-0 flex-1 flex-col gap-2" data-role="workbench-desk" data-desk={desk}>
        <div className="flex min-h-10 shrink-0 items-center gap-3" data-role="workbench-head">
          <div {...deskTabs.tablistProps} aria-label={t("desk.label")} className={SEG_GROUP}>
            {DESKS.map((k) => (
              <Seg key={k} group="wb-desks" active={k === desk} {...deskTabs.tabProps(k)}>
                {t(`desk.${k}`)}
              </Seg>
            ))}
          </div>
          <span className="min-w-0 flex-1 truncate text-micro text-steel">{t(`desk.${desk}Hint`)}</span>
        </div>
        <div {...deskTabs.panelProps} className={`relative flex min-h-0 flex-1 flex-col outline-none ${desk === "calendar" ? DESK_CALENDAR : ""}`}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={primary.id} className="flex min-h-0 flex-1 flex-col" {...m.panelEnter}>
              {renderPanel(primary, { look: desk === "calendar" ? "pane" : "table", className: "min-h-0 flex-1" })}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    ) : null;

  // ── RIGHT: the list ─────────────────────────────────────────────────
  let side: ReactNode;
  if (sideView) {
    side = renderPanel(sideView, { look: "table", className: `min-h-0 ${sideView.kind === "calendar" ? SIDE_CALENDAR : ""}` });
  } else if (desk) {
    side = renderPanel(CANDIDATES_VIEW, { look: "table", className: `min-h-0 flex-1 ${NO_CHROME}` });
  } else {
    side = (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {renderPanel(NEEDS_VIEW, { look: "table", className: `shrink-0 ${NO_CHROME}` })}
        {!current && firstNeed ? renderPanel(firstNeed, { look: "table", className: `min-h-0 flex-1 ${NO_CHROME}` }) : null}
      </div>
    );
  }

  const swap = m.answerSwap(seen.dir);
  const replyLine = split
    ? `${FACE_DISPLAY} min-w-0 truncate text-h3 font-bold leading-snug tracking-tight`
    : `${FACE_DISPLAY} max-w-3xl text-h2 font-bold leading-snug tracking-tight text-balance`;
  const slide = m.reduced ? false : ("position" as const);
  return (
    <div
      className={`grid gap-4 px-4 py-3 [font-variant-numeric:tabular-nums] lg:h-full lg:min-h-0 lg:gap-[var(--one-gap)] ${
        split ? `lg:grid-cols-[minmax(0,1fr)_minmax(34rem,0.82fr)] ${TRACKS_NARROW}` : `lg:grid-cols-[minmax(0,max(30rem,34vw))_minmax(0,1fr)] ${TRACKS_WIDE}`
      } ${WB_COMPACT}`}
      data-one-layout={variant}
      data-finish="dense"
      data-split={split ? (open ? "person" : "desk") : undefined}
    >
      {/* ── LEFT: the answer, a desk, or a person's workbench ─────────── */}
      <section className="flex min-h-0 min-w-0 flex-col gap-2" aria-label={tc("meta.conversationLabel")}>
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

        {/* The stack that distributes: reply, then the card / desk / workbench, consent. */}
        <div
          className={`relative flex min-h-0 flex-1 flex-col gap-2 pr-1 ${split ? "overflow-hidden" : "overflow-y-auto [scrollbar-gutter:stable]"}`}
          data-role="split-stack"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={answerKey}
              className={`flex flex-col ${split ? "min-h-0 flex-1 gap-2" : `flex-auto gap-2.5 ${asking ? "min-h-0" : ""}`}`}
              {...swap}
              data-role="split-answer"
            >
              {current ? (
                <div className="flex shrink-0 flex-col gap-1" data-role="one-answer" data-fallback={current.reply.fallback || undefined}>
                  <h1 className={`${replyLine} text-ink`} aria-live="polite">
                    <span className="sr-only">{tc("one")}: </span>
                    {words.say(current.reply.say)}
                  </h1>
                  {current.reply.fallback ? <p className="text-micro text-steel">{t("notYet")}</p> : null}
                  {current.reply.dropped > 0 ? <p className="text-micro text-steel">{words.dropped(current.reply.dropped)}</p> : null}
                  {!split && current.reply.links.length > 0 ? (
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

              {workbench ??
                deskView ??
                (card ? (
                  <div className={`relative flex flex-col pr-1 pb-1 has-[[data-grows]]:flex-auto ${asking ? "min-h-0" : "min-h-fit"}`} data-role="split-card">
                    {card}
                  </div>
                ) : null)}
            </motion.div>
          </AnimatePresence>

          {asking ? (
            <div ref={consents} className={`flex shrink-0 flex-col gap-2 pr-1 pb-1 ${split ? "max-h-[45%] overflow-y-auto" : ""}`} data-role="split-consents">
              <AnimatePresence initial={false}>
                {proposals.map((p) => (
                  <motion.div key={p.id} {...m.consentEnter}>
                    {renderConsent(p)}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : null}
        </div>

        {/* ── The dock: follow-ups (not while a person or desk holds the left), the composer, and
            one status line (what changed + keys) ── */}
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
              // The one coral primary — unless a consent card or a tool's own act holds it.
              <Button label={tc("composer.send")} variant={asking || open ? "secondary" : "primary"} size="sm" type="submit" disabled={!draft.trim()} />
            )}
          </form>
          <div className="flex min-h-7 items-center justify-between gap-3 lg:pl-11" data-role="workbench-status">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-micro" role="status" data-role="one-change">
              {session.lastChange ? (
                <>
                  <span className="sr-only">{t("changeLabel")}: </span>
                  <span className="min-w-0 flex-1 truncate text-steel before:text-steel before:content-['↳_']">{words.change(session.lastChange)}</span>
                  {session.canUndo ? <Button label={tc("change.undo")} variant="link" size="sm" className="shrink-0" onClick={session.undo} /> : null}
                </>
              ) : null}
            </div>
            <p className="flex shrink-0 items-center gap-1 text-micro text-steel" data-role="workbench-keys">
              <span className="sr-only">{t("keysLabel")}: </span>
              {open ? (
                <>
                  <kbd className={KEYCAP}>1</kbd>
                  <kbd className={KEYCAP}>3</kbd>
                  <span>{t("keyTools")}</span>
                  <kbd className={`${KEYCAP} ml-2`}>{t("keyEsc")}</kbd>
                  <span>{t("keyBack")}</span>
                </>
              ) : (
                <>
                  <kbd className={KEYCAP}>[</kbd>
                  <kbd className={KEYCAP}>]</kbd>
                  <span>{t("keyStep")}</span>
                  <kbd className={`${KEYCAP} ml-2`}>{t("keyEsc")}</kbd>
                  <span>{t("keyList")}</span>
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* ── RIGHT: the list (role-grouped), narrower while the left is split ── */}
      <motion.aside
        layout={slide}
        transition={m.panelEnter.transition}
        id={sideId}
        className="flex min-h-0 min-w-0 flex-col gap-2 max-lg:h-[36rem]"
        aria-label={tc("meta.regionLabel")}
        data-role="split-side"
      >
        {rightTabs.length > 1 ? (
          <div className="flex shrink-0 items-center gap-3" data-role="split-tabs">
            <div {...sideTabs.tablistProps} aria-label={t("tabsLabel")} className={SEG_GROUP}>
              {rightTabs.map((p) => (
                <Seg key={p.id} group="wb-side-tabs" active={p.id === sideView?.id} {...sideTabs.tabProps(p.id)}>
                  <span className="truncate font-semibold">{words.view(p.kind, p.params)}</span>
                  {p.pinned ? <span className="shrink-0">· {t("pinned")}</span> : null}
                </Seg>
              ))}
            </div>
          </div>
        ) : null}
        <div {...(rightTabs.length > 1 ? sideTabs.panelProps : {})} className="relative flex min-h-0 flex-1 flex-col outline-none">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={sideView?.id ?? (desk ? "wb-candidates" : "side-host")} className="flex min-h-0 flex-1 flex-col" {...m.panelEnter}>
              {side}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.aside>
    </div>
  );
}
