"use client";

// The Split LAYOUT (the owner's round-2 pick) — docs/design/one-interface.md; spark `one-interface`.
// Round 3 shares it between the baseline (`?v=split`) and three FINISHES (refined, spark,
// dense), which pass `finish` and may fork this file into their own folder; a finish
// differs in type, spacing, surfaces and motion, never in where things are.
//
// One page, no scroll, no transcript.
//   MAIN (left): what was asked + the ‹ n of m › stepper; One's reply in the display face;
//     the answer's INSIGHT card (the shape of the answer and at most one suggested act —
//     never the table's rows again); consent cards; and, anchored to the foot, the chips,
//     the composer and the "what changed" line + Undo. The column is a vertical stack that
//     DISTRIBUTES: the insight card grows into whatever height is left (its spread
//     stretches), so there is never an empty band.
//   SIDE (right): the answer's full TABLE, scrolling inside itself; a segmented tab strip
//     (shared-layout pill) when more than one view is on screen. Tabs name a view by its
//     TITLE ("Stalled candidates"). Picking a tab is local: it never re-forms the main column.
//
// Motion (motion.ts, flavor from the shell or the finish): the reply + card swap keyed by
// answer id (back = from the left, forward / new = from the right; `popLayout`, so the old
// answer fades out OVER the new one arriving — never a blank beat), the side view enters,
// consent cards rise and settle; every move has a still form under reduced motion.
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, ChipRow } from "@/app/_components/kit";
import { EYEBROW, FIELD } from "@/app/_components/ui/recipes";
import { useTablist } from "@/app/_components/ui/useTablist";
import { useOneMotion } from "../../motion";
import { consoleHref as consoleHrefFor } from "../../panels/PanelShell";
import { SEG_GROUP, Seg } from "../../Seg";
import type { ChipId, FinishId, PanelInstance } from "../../types";
import type { VariantProps } from "../../variantProps";
import { primaryOf, sideOf, tabsOf } from "./side";
import { ASKING_TRIM, FACE_DISPLAY, FACE_HAND, NO_CHROME, STICKER_COMPOSER } from "./styles";

/** The views the host draws itself before anything is on screen (the first beat). */
const NEEDS_VIEW: PanelInstance = { id: "split-needs", kind: "needs", params: {}, pinned: false };

export type SplitLayoutProps = VariantProps & { finish?: FinishId };

export function SplitLayout({
  variant,
  finish,
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
}: SplitLayoutProps) {
  const t = useTranslations("one.split");
  const tc = useTranslations("one.core");
  const m = useOneMotion();
  const [draft, setDraft] = useState("");
  const sideId = useId();

  // ── Where each view goes ────────────────────────────────────────────
  const primary = primaryOf(session.panels, session.focusId);
  const tabs = tabsOf(session.panels, primary);
  // The side's tab is the user's pick until a new answer brings a new primary forward.
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

  /** See all on the first beat: ask for the first need's view (a real hand action). */
  const focusSide = useCallback(() => {
    requestAnimationFrame(() => document.getElementById(sideId)?.querySelector<HTMLElement>("[data-row]")?.focus());
  }, [sideId]);

  // ── The first beat (nothing asked yet) ──────────────────────────────
  const g = words.greeting(greeting);
  const firstNeed: PanelInstance | null =
    greeting.state === "needs" ? { id: "split-first", kind: greeting.first.panel, params: greeting.first.params, pinned: false } : null;

  const chips: readonly ChipId[] = current ? current.reply.chips : greeting.state === "loading" ? [] : greeting.chips;
  const chipRow = chips.length > 0 ? <ChipRow chips={chips.map((id) => ({ id, label: words.chip(id), onPress: () => submit({ chip: id }) }))} /> : null;

  const handProposals = session.proposals.filter((p) => p.turnId === null && !current?.proposals.includes(p));
  const proposals = [...(current?.proposals ?? []), ...handProposals];
  // A consent card outranks the insight's spread: while one is open the card keeps its
  // shape + facts (the act is the card's), and a NEW card is scrolled into reach.
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
  // The card takes what the column leaves (flex-auto); with a consent card open it may
  // shrink too (min-h-0), and only its spread gives way (ASKING_TRIM).
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

  const swap = m.answerSwap(seen.dir);
  return (
    <div
      className="grid gap-6 px-4 py-5 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,max(32rem,36vw))_minmax(0,1fr)] lg:gap-[var(--one-gap)]"
      data-one-layout={variant}
      data-finish={finish}
    >
      {/* ── Main: the answer in view ─────────────────────────────────── */}
      <section className="flex min-h-0 min-w-0 flex-col gap-3" aria-label={tc("meta.conversationLabel")}>
        {/* What was asked + the stepper — one line. */}
        <div className="flex min-h-10 shrink-0 items-center justify-between gap-4">
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
            <div className="flex shrink-0 items-center gap-1" data-role="one-stepper">
              <Button label={tc("step.back")} icon="left" iconOnly variant="ghost" size="sm" disabled={!position.canBack} onClick={stepBack} />
              <span className="k-nums min-w-14 text-center text-micro text-steel" role="status">
                {t("position", { index: position.index + 1, total: position.total })}
              </span>
              <Button label={tc("step.forward")} icon="right" iconOnly variant="ghost" size="sm" disabled={!position.canForward} onClick={stepForward} />
            </div>
          ) : null}
        </div>

        {/* The stack that distributes: reply, the insight card (grows), consent. */}
        <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-2 pb-1.5 [scrollbar-gutter:stable]" data-role="split-stack">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={answerKey} className={`flex flex-auto flex-col gap-3 ${asking ? "min-h-0" : ""}`} {...swap} data-role="split-answer">
              {current ? (
                <div className="flex shrink-0 flex-col gap-2" data-role="one-answer" data-fallback={current.reply.fallback || undefined}>
                  <h1 className={`${FACE_DISPLAY} max-w-3xl text-display font-extrabold leading-tight tracking-tight text-ink`} aria-live="polite">
                    <span className="sr-only">{tc("one")}: </span>
                    {words.say(current.reply.say)}
                  </h1>
                  {current.reply.fallback ? <p className={`${FACE_HAND} text-h2 leading-none text-steel`}>{t("notYet")}</p> : null}
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
                <div className="flex shrink-0 flex-col gap-2" data-role="one-greeting">
                  <h1
                    className={`${FACE_DISPLAY} max-w-3xl text-display font-extrabold leading-tight tracking-tight ${greeting.state === "loading" ? "text-steel" : "text-ink"}`}
                    aria-live="polite"
                  >
                    {g.status}
                  </h1>
                </div>
              )}

              {pending ? (
                <p className={`${FACE_HAND} shrink-0 text-h2 leading-none text-steel`} role="status">
                  {tc("composer.working")}
                </p>
              ) : null}

              {card ? (
                <div className={`relative flex flex-col pr-1.5 pb-1.5 has-[[data-grows]]:flex-auto ${asking ? "min-h-0" : "min-h-fit"}`} data-role="split-card">
                  {!current && firstNeed ? (
                    <p className={`${FACE_HAND} absolute -top-5 right-6 z-10 rotate-2 text-h2 leading-none text-coral-ink`} aria-hidden>
                      {t("startHere")}
                    </p>
                  ) : null}
                  {card}
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>

          {asking ? (
            <div ref={consents} className="flex shrink-0 flex-col gap-3 pr-1.5 pb-1.5" data-role="split-consents">
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

        {/* ── The dock: follow-ups, the composer, and what changed + Undo under it ── */}
        <div className="flex shrink-0 flex-col gap-2.5 border-t border-stone-200 pt-3 dark:border-t-2 dark:border-dashed" data-role="split-dock">
          {chipRow ? (
            // One line, never a second: the chips scroll sideways rather than push the composer.
            <div className="-mx-1 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&_.k-chips]:flex-nowrap!" data-role="split-chips">
              {chipRow}
            </div>
          ) : null}
          <form className={`${STICKER_COMPOSER} flex items-center gap-2 p-1 pl-2 focus-within:ring-2 focus-within:ring-coral focus-within:ring-offset-2 focus-within:ring-offset-paper`} onSubmit={onSubmit} data-role="one-composer">
            <input
              type="text"
              className={`${FIELD} h-10 min-w-0 flex-1 border-transparent bg-transparent focus:border-transparent! focus-visible:shadow-none!`}
              aria-label={tc("composer.label")}
              placeholder={tc("composer.placeholder")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            {session.pending ? (
              <Button label={tc("composer.stop")} variant="secondary" onClick={session.stop} />
            ) : (
              // The one coral primary — unless a consent card holds it.
              <Button label={tc("composer.send")} variant={asking ? "secondary" : "primary"} type="submit" disabled={!draft.trim()} />
            )}
          </form>
          {/* The hand note hangs under the composer, indented clear of the page's corner. */}
          <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1 lg:pl-12" role="status" data-role="one-change">
            {session.lastChange ? (
              <>
                <span className="sr-only">{t("changeLabel")}: </span>
                <span className={`${FACE_HAND} text-h2 leading-none text-ink before:content-['↳_']`}>{words.change(session.lastChange)}</span>
                {session.canUndo ? <Button label={tc("change.undo")} variant="link" size="sm" onClick={session.undo} /> : null}
              </>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── Side: the answer's full table ────────────────────────────── */}
      <aside id={sideId} className="flex min-h-0 min-w-0 flex-col gap-3 max-lg:h-[36rem]" aria-label={tc("meta.regionLabel")} data-role="split-side">
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
            <motion.div key={sideView?.id ?? "side-host"} className="flex min-h-0 flex-1 flex-col" {...m.panelEnter}>
              {sideView ? (
                renderPanel(sideView, { look: "table", className: "min-h-0" })
              ) : (
                // Nothing on screen yet: what needs you, and — on the first beat — the first
                // need's full list under it (its insight is the main column's card).
                <div className="flex min-h-0 flex-1 flex-col gap-4">
                  {renderPanel(NEEDS_VIEW, { look: "table", className: `shrink-0 ${NO_CHROME}` })}
                  {!current && firstNeed ? renderPanel(firstNeed, { look: "table", className: `min-h-0 flex-1 ${NO_CHROME}` }) : null}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </aside>
    </div>
  );
}
