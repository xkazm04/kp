"use client";

// `?v=refined` — the REFINED finish of the Split layout (round 3, docs/design/one-interface.md).
// A fork of `variants/split/SplitLayout.tsx`: the layout is unchanged — left = what was asked
// + the stepper, the reply, the answer's insight card, consent, chips, composer and what
// changed; right = the answer's table with tabs for pins — and only the finish differs.
//
// Calm editorial:
//   type     one display face, once: the reply line, set like a pull-quote (medium weight).
//            The "asked" line, the hand note and every label are the body face; there is no
//            hand-lettered note and no coral eyebrow.
//   spacing  an 8-pt rhythm: 16px page edge (the header's), 24px column gap, 16px stack gap;
//            table rows 2px tighter, so more of the answer is in sight.
//   surfaces hairlines and the soft panel shadow (finish.css); the insight card is the same
//            surface as the table, not a louder sticker; its chart is small and slim.
//   colour   ink, steel and stone; coral only for the act (Send, a consent's primary) and
//            the score tiers.
//   motion   ./motion.ts — 4–8px slides and short crossfades, ease-out, no spring.
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, ChipRow } from "@/app/_components/kit";
import { FIELD, META_LABEL } from "@/app/_components/ui/recipes";
import { useTablist } from "@/app/_components/ui/useTablist";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { OneMotion } from "../../motion";
import { consoleHref as consoleHrefFor } from "../../panels/PanelShell";
import { SEG_GROUP, Seg } from "../../Seg";
import type { ChipId, PanelInstance } from "../../types";
import type { VariantProps } from "../../variantProps";
import { primaryOf, sideOf, tabsOf } from "../split/side";
import { REFINED_SIDE_FLAVOR, refinedMotion } from "./motion";
import { ASKING_TRIM, COMPOSER, INSIGHT_SET, NO_CHROME, REPLY, SHORT_STILL, TABLE_SET } from "./styles";

/** The views the host draws itself before anything is on screen (the first beat). */
const NEEDS_VIEW: PanelInstance = { id: "split-needs", kind: "needs", params: {}, pinned: false };

export function RefinedLayout({
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
}: VariantProps) {
  const t = useTranslations("one.split");
  const tc = useTranslations("one.core");
  const reduced = useReducedMotion();
  const m = useMemo(() => refinedMotion(reduced), [reduced]);
  const [draft, setDraft] = useState("");
  const sideId = useId();

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
  const asking = proposals.length > 0;
  const consents = useRef<HTMLDivElement>(null);
  const newestProposal = proposals.at(-1)?.id ?? null;
  useEffect(() => {
    if (!newestProposal) return;
    consents.current?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [newestProposal, reduced]);

  const askedWords = current ? (current.asked.text ?? (current.asked.chip ? words.chip(current.asked.chip) : "")) : "";
  const pending = session.pending !== null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    submit({ text: draft });
    setDraft("");
  };

  // ── The main card: the answer's insight (or the first need's) ───────
  const cardClass = `data-[grows]:flex-auto ${asking ? `min-h-0 ${ASKING_TRIM} ${SHORT_STILL}` : "min-h-fit"}`;
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
      className="grid gap-6 px-4 py-4 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,max(32rem,36vw))_minmax(0,1fr)] lg:gap-[var(--one-gap)]"
      data-one-layout={variant}
      data-finish="refined"
    >
      {/* ── Main: the answer in view ─────────────────────────────────── */}
      <section className="flex min-h-0 min-w-0 flex-col gap-4" aria-label={tc("meta.conversationLabel")}>
        {/* What was asked + the stepper — one quiet line. */}
        <div className="flex h-8 shrink-0 items-center justify-between gap-4">
          <p className={`${META_LABEL} min-w-0 truncate`} data-role="split-asked">
            {current ? (
              <>
                <span>{t("asked")}</span>
                <span aria-hidden>{" · "}</span>
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
            <div className="-mr-1 flex shrink-0 items-center" data-role="one-stepper">
              <Button label={tc("step.back")} icon="left" iconOnly variant="ghost" size="sm" disabled={!position.canBack} onClick={stepBack} />
              <span className="k-nums min-w-12 text-center text-micro text-steel" role="status">
                {t("position", { index: position.index + 1, total: position.total })}
              </span>
              <Button label={tc("step.forward")} icon="right" iconOnly variant="ghost" size="sm" disabled={!position.canForward} onClick={stepForward} />
            </div>
          ) : null}
        </div>

        {/* The stack that distributes: reply, the insight card (grows), consent. */}
        <div className="relative -mx-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-2 [scrollbar-width:thin]" data-role="split-stack">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={answerKey} className={`flex flex-auto flex-col gap-4 ${asking ? "min-h-0" : ""}`} {...swap} data-role="split-answer">
              {current ? (
                <div className="flex shrink-0 flex-col gap-1.5" data-role="one-answer" data-fallback={current.reply.fallback || undefined}>
                  <h1 className={`${REPLY} text-ink`} aria-live="polite">
                    <span className="sr-only">{tc("one")}: </span>
                    {words.say(current.reply.say)}
                  </h1>
                  {current.reply.fallback ? <p className="text-body text-steel">{t("notYet")}</p> : null}
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
                <div className="flex shrink-0 flex-col gap-1.5" data-role="one-greeting">
                  <h1 className={`${REPLY} ${greeting.state === "loading" ? "text-steel" : "text-ink"}`} aria-live="polite">
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
                <div className={`relative flex flex-col has-[[data-grows]]:flex-auto ${asking ? `min-h-0 ${SHORT_STILL}` : "min-h-fit"} ${INSIGHT_SET}`} data-role="split-card">
                  {card}
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>

          {asking ? (
            <div ref={consents} className="flex shrink-0 flex-col gap-3" data-role="split-consents">
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
        <div className="flex shrink-0 flex-col gap-2" data-role="split-dock">
          {chipRow ? (
            <div className="-mx-1 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&_.k-chips]:flex-nowrap!" data-role="split-chips">
              {chipRow}
            </div>
          ) : null}
          <form className={COMPOSER} onSubmit={onSubmit} data-role="one-composer">
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
          {/* What changed: one quiet body-face line under the composer, clear of the page's corner. */}
          <div className="flex min-h-7 items-center gap-3 lg:pl-12" role="status" data-role="one-change">
            {session.lastChange ? (
              <>
                <span className="sr-only">{t("changeLabel")}: </span>
                <span className="min-w-0 truncate text-micro text-steel before:content-['↳_']">{words.change(session.lastChange)}</span>
                {session.canUndo ? <Button label={tc("change.undo")} variant="link" size="sm" onClick={session.undo} /> : null}
              </>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── Side: the answer's full table ────────────────────────────── */}
      <OneMotion.Provider value={REFINED_SIDE_FLAVOR}>
        <aside id={sideId} className={`flex min-h-0 min-w-0 flex-col gap-3 max-lg:h-[36rem] ${TABLE_SET}`} aria-label={tc("meta.regionLabel")} data-role="split-side">
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
                  <div className="flex min-h-0 flex-1 flex-col gap-4">
                    {renderPanel(NEEDS_VIEW, { look: "table", className: `shrink-0 ${NO_CHROME}` })}
                    {!current && firstNeed ? renderPanel(firstNeed, { look: "table", className: `min-h-0 flex-1 ${NO_CHROME}` }) : null}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </aside>
      </OneMotion.Provider>
    </div>
  );
}
