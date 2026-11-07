"use client";

// The DENSE finish of the Split layout (round 3, docs/design/one-interface.md "Round 3
// finishes"). A fork of `variants/split/SplitLayout.tsx` that keeps every region where Split
// puts it and changes only finish: type, spacing, surfaces, motion and keys.
//
//   - The reply is an h2 in the display face, not a display line: the answer's card and the
//     table get the height back.
//   - Rows are one line at 36px (`--one-row-h`, styles.ts DENSE_COMPACT), so the side shows
//     ~18 candidates at 1440x900 instead of ~13. The main column is narrower
//     (max(30rem, 34vw)); the side, where the list is, takes the rest.
//   - Keyboard-first: `/` puts the cursor in the composer, `[` and `]` step through the
//     answers, ↓ (on an empty composer) or Esc hands focus to the table, where the core's
//     ↑↓ a r keys work. The keys are named in ONE hint line at the foot of the dock, beside
//     what changed + Undo, so the dock is three thin lines (chips, composer, status).
//   - Quiet surfaces: one face for display (Bricolage), the hand face is not used; numbers
//     are tabular everywhere on the surface.
//   - Motion is the `snap` flavor (motion.ts, ≤ 120ms, small offsets, no spring); the still
//     forms apply under reduced motion.
//   - Round 4 (minimal hosting, so the layout builders see the tools work): a candidate picked
//     from the side's list (a row press / Enter) takes the main column's card slot — a
//     Profile · Email · Interview strip over `renderTool(...)`, × (or Esc on the row) closes.
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, ChipRow } from "@/app/_components/kit";
import { EYEBROW, FIELD } from "@/app/_components/ui/recipes";
import { useTablist } from "@/app/_components/ui/useTablist";
import { useOneMotion } from "../../motion";
import { consoleHref as consoleHrefFor } from "../../panels/PanelShell";
import { SEG_GROUP, Seg } from "../../Seg";
import { TOOL_KINDS, type ChipId, type PanelInstance, type ToolKind } from "../../types";
import type { VariantProps } from "../../variantProps";
import { primaryOf, sideOf, tabsOf } from "../shared/side";
import { FACE_DISPLAY, NO_CHROME, STICKER_COMPOSER } from "../shared/styles";
import { DENSE_ASKING_TRIM, DENSE_COMPACT, KEYCAP } from "./styles";

/** The views the host draws itself before anything is on screen (the first beat). */
const NEEDS_VIEW: PanelInstance = { id: "dense-needs", kind: "needs", params: {}, pinned: false };

/** True when a key press belongs to a text field (the page keys stay out of its way). */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

export function DenseLayout({
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
  const td = useTranslations("one.dense");
  const t = td;
  const tc = useTranslations("one.core");
  const m = useOneMotion();
  const [draft, setDraft] = useState("");
  const sideId = useId();
  const composer = useRef<HTMLInputElement>(null);

  // ── Where each view goes ────────────────────────────────────────────
  const primary = primaryOf(session.panels, session.focusId);
  const tabs = tabsOf(session.panels, primary);
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

  /** Hand focus to the side's table: the selected row if there is one, else the first. */
  const focusSide = useCallback(() => {
    requestAnimationFrame(() => {
      const side = document.getElementById(sideId);
      (side?.querySelector<HTMLElement>("[data-row][data-selected]") ?? side?.querySelector<HTMLElement>("[data-row]"))?.focus();
    });
  }, [sideId]);

  // ── The page keys: / composer, [ ] answers. Never while a field has the cursor. ──
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [position.canBack, position.canForward, stepBack, stepForward]);

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
    greeting.state === "needs" ? { id: "dense-first", kind: greeting.first.panel, params: greeting.first.params, pinned: false } : null;

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

  // ── Round 4: the picked candidate's tool takes the card slot ─────────
  const [tool, setTool] = useState<ToolKind>("profile");
  const toolView = selected ? (
    <div className="flex min-h-0 flex-auto flex-col gap-2 pr-1 pb-1" data-role="dense-tool">
      <div className="flex shrink-0 items-center gap-2">
        <div role="tablist" aria-label={td("tools.label")} className={SEG_GROUP}>
          {TOOL_KINDS.map((k) => (
            <Seg key={k} group="dense-tools" active={k === tool} role="tab" aria-selected={k === tool} onClick={() => setTool(k)}>
              {td(`tools.${k}`)}
            </Seg>
          ))}
        </div>
        <span className="min-w-0 flex-1 truncate text-micro font-semibold text-ink">{selected.label}</span>
        <Button label={td("tools.close")} icon="x" iconOnly variant="ghost" size="sm" onClick={() => select(null)} />
      </div>
      {renderTool(tool, selected, { className: "min-h-0 flex-1" })}
    </div>
  ) : null;

  const swap = m.answerSwap(seen.dir);
  const replyLine = `${FACE_DISPLAY} max-w-3xl text-h2 font-bold leading-snug tracking-tight text-balance`;
  return (
    <div
      className={`grid gap-4 px-4 py-3 [font-variant-numeric:tabular-nums] lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,max(30rem,34vw))_minmax(0,1fr)] lg:gap-[var(--one-gap)] ${DENSE_COMPACT}`}
      data-one-layout={variant}
      data-finish="dense"
    >
      {/* ── Main: the answer in view ─────────────────────────────────── */}
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

              {toolView ?? (card ? (
                <div className={`relative flex flex-col pr-1 pb-1 has-[[data-grows]]:flex-auto ${asking ? "min-h-0" : "min-h-fit"}`} data-role="split-card">
                  {card}
                </div>
              ) : null)}
            </motion.div>
          </AnimatePresence>

          {asking ? (
            <div ref={consents} className="flex shrink-0 flex-col gap-2 pr-1 pb-1" data-role="split-consents">
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
              <span className="sr-only">{td("keysLabel")}: </span>
              <kbd className={KEYCAP}>[</kbd>
              <kbd className={KEYCAP}>]</kbd>
              <span>{td("keyStep")}</span>
              <kbd className={`${KEYCAP} ml-2`}>{td("keyEsc")}</kbd>
              <span>{td("keyList")}</span>
            </p>
          </div>
        </div>
      </section>

      {/* ── Side: the answer's full table ────────────────────────────── */}
      <aside id={sideId} className="flex min-h-0 min-w-0 flex-col gap-2 max-lg:h-[36rem]" aria-label={tc("meta.regionLabel")} data-role="split-side">
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
  );
}
