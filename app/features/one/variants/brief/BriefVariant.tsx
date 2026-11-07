"use client";

// The "Brief" direction (round 1, spark `one-interface`) — today's hiring as an
// EDITORIAL PAGE in the Spark Dark register (landing bands), calmer in Studio Light.
//
//   masthead   the status line as the headline, dated
//   the lead   the first need as the lead story (lit ground, a margin note, one door)
//   on the page now   the views a reply (or the user's hand) put on screen, inserted
//              under the masthead as bands — ≤ 3, ≤ 2 pinned; the page scrolls to the
//              one that came forward
//   news bands one band per other module with news: its numeral, its sentence, 2-3
//              ask-chips; modules with nothing to say collapse into ONE quiet line
//   columns    the questions with no attention bucket (funnel, outbox, pipeline)
//   the desk   the conversation dock (BriefDesk): what changed + Undo, the latest
//              answer and its acts, follow-up chips, the composer
//
// A band never draws a panel of its own (bands.ts says why): it asks, and when the view
// that answers it is on the page it says so and jumps to it.
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { Button, ChipRow, formatCount } from "@/app/_components/kit";
import { HandNote, LitGround } from "@/app/_components/kit/scene";
import { EYEBROW, PANEL } from "@/app/_components/ui/recipes";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { NEED_PANEL, type NeedKey } from "../../engine/greeting";
import { MAX_PANELS, MAX_PINS, type ChipId } from "../../types";
import type { VariantProps } from "../../variantProps";
import { BriefDesk } from "./BriefDesk";
import { COLUMN_CHIPS, answeringPanel, frontPage } from "./bands";

const SPRING = { type: "spring", stiffness: 380, damping: 32 } as const;
/** The dateline has nothing to subscribe to: the day is read once per render. */
const noSubscribe = () => () => {};

/** Scroll a view into sight and hand it the keyboard (its wrapper is tabIndex -1). */
function bringToView(panelId: string, reduced: boolean) {
  const el = document.querySelector<HTMLElement>(`[data-brief-band="${panelId}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  el.focus({ preventScroll: true });
}

export default function BriefVariant(props: VariantProps) {
  const { variant, session, submit, greeting, attention, renderPanel, renderConsent, words } = props;
  const core = useTranslations("one.core");
  const t = useTranslations("one.brief");
  const locale = useLocale();
  const reduced = useReducedMotion();
  const g = words.greeting(greeting);
  const page = greeting.state === "loading" ? null : frontPage(attention);

  // The dateline is the reader's own day: null on the server snapshot, so the server's
  // clock and time zone never reach the markup (and hydration never mismatches).
  const fmt = useDateFormat();
  const dateline = useSyncExternalStore(
    noSubscribe,
    () => fmt.date(new Date()),
    () => null
  );

  // When a view comes forward (a reply's show, a jump, a hand focus), the page brings it
  // into sight. Not on first paint, and not when the view is already where the eye is.
  const lastFocus = useRef<string | null>(session.focusId);
  useEffect(() => {
    if (session.focusId === lastFocus.current) return;
    lastFocus.current = session.focusId;
    if (session.focusId) bringToView(session.focusId, reduced);
  }, [session.focusId, reduced]);

  const chipsFor = (ids: readonly ChipId[]) => ids.map((id) => ({ id, label: words.chip(id), onPress: () => submit({ chip: id }) }));
  const quietLine = useMemo(() => {
    if (!page || page.state !== "read" || page.quiet.length === 0) return null;
    const names = page.quiet.map((k) => t(`bands.${k}`));
    return t("bands.quiet", { list: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(names) });
  }, [page, locale, t]);

  const pinned = session.panels.filter((p) => p.pinned).length;
  const handProposals = session.proposals.filter((p) => p.turnId === null);
  const jump = (key: NeedKey) => {
    const p = answeringPanel(key, session.panels);
    if (!p) return;
    if (session.focusId === p.id) bringToView(p.id, reduced);
    else session.focus(p.id);
  };

  const enter = reduced ? false : { opacity: 0, y: 14, rotate: -0.6 };
  const settle = { opacity: 1, y: 0, rotate: 0 };
  const leave = reduced ? { opacity: 0 } : { opacity: 0, y: -8 };

  return (
    <div
      className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start"
      data-one-layout={variant}
    >
      <div className="flex min-w-0 flex-col gap-10">
        {/* ── masthead ── */}
        <div className="flex flex-col gap-3 border-b-2 border-ink pb-6 dark:border-dashed" data-role="one-greeting">
          <p className={EYEBROW}>
            {t("masthead.kicker")}
            {dateline ? <span className="text-steel"> · {dateline}</span> : null}
          </p>
          <SectionTitle>{g.status}</SectionTitle>
        </div>

        {/* ── the lead story ── */}
        {greeting.state === "needs" ? (
          <section aria-label={t("lead.kicker")} data-role="one-lead">
            <LitGround>
              <div className={`${PANEL} flex flex-col gap-4 p-6 dark:-rotate-[0.4deg] dark:border-2 dark:border-ink dark:shadow-sticker-sm`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className={EYEBROW}>{t("lead.kicker")}</p>
                  <HandNote pointer>{t("lead.note")}</HandNote>
                </div>
                <p className="font-serif text-h2 text-ink">{g.first}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    label={t("lead.open")}
                    variant="secondary"
                    onClick={() => session.show(greeting.first.panel, greeting.first.params)}
                  />
                  <ChipRow chips={chipsFor(greeting.chips)} />
                </div>
              </div>
            </LitGround>
          </section>
        ) : greeting.state === "loading" ? null : (
          <section aria-label={t("lead.kicker")} data-role="one-lead">
            <div className="flex flex-col gap-3">
              <p className={EYEBROW}>{t("lead.kicker")}</p>
              <p className="text-body text-steel">{greeting.state === "clear" ? t("lead.clear") : t("lead.unknown")}</p>
              <ChipRow chips={chipsFor(greeting.chips)} />
            </div>
          </section>
        )}

        {/* ── on the page now: the views, inserted under the masthead ── */}
        <section className="flex flex-col gap-4" aria-label={core("meta.regionLabel")} data-role="one-region">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-stone-200 pb-2 dark:border-b-2 dark:border-dashed">
            <h2 className="font-serif text-h3 text-ink">{t("page.kicker")}</h2>
            <p className="text-meta text-steel" data-role="one-capacity">
              {t("page.capacity", {
                shown: formatCount(session.panels.length, locale),
                max: formatCount(MAX_PANELS, locale),
                pinned: formatCount(pinned, locale),
                pins: formatCount(MAX_PINS, locale),
              })}
            </p>
          </div>

          {handProposals.length > 0 ? <div className="flex flex-col gap-3">{handProposals.map((p) => renderConsent(p))}</div> : null}

          {session.panels.length === 0 ? <p className="text-body text-steel">{core("meta.regionEmpty")}</p> : null}

          <AnimatePresence initial={false} mode="popLayout">
            {session.panels.map((p) => {
              const focused = session.focusId === p.id;
              return (
                <motion.div
                  key={p.id}
                  layout={!reduced}
                  initial={enter}
                  animate={settle}
                  exit={leave}
                  transition={reduced ? { duration: 0 } : SPRING}
                  tabIndex={-1}
                  data-brief-band={p.id}
                  data-focused={focused || undefined}
                  className={[
                    "relative rounded-lg border bg-white px-4 pb-4 outline-none focus-visible:ring-2 focus-visible:ring-coral",
                    "dark:border-2 dark:bg-paper",
                    focused ? "border-ink shadow-panel dark:shadow-sticker-sm" : "border-stone-200 dark:border-stone-300",
                  ].join(" ")}
                >
                  {p.pinned || focused ? (
                    <p className="flex gap-3 pt-3 text-meta font-semibold text-ink">
                      {focused ? <span className="text-coral-ink">{t("page.forward")}</span> : null}
                      {p.pinned ? <span>{t("page.pinned")}</span> : null}
                    </p>
                  ) : null}
                  {renderPanel(p, { look: focused ? "spotlight" : "default" })}
                </motion.div>
              );
            })}
          </AnimatePresence>
          {session.panels.length > 0 ? <HandNote className="self-end">{t("page.note")}</HandNote> : null}
        </section>

        {/* ── the news: one band per other module with something to say ── */}
        {page ? (
          <section className="flex flex-col gap-6" aria-label={t("bands.label")} data-role="one-bands">
            <h2 className="border-b border-stone-200 pb-2 font-serif text-h3 text-ink dark:border-b-2 dark:border-dashed">{t("bands.kicker")}</h2>
            {page.state === "unknown" ? <p className="text-body text-steel">{t("bands.unknown")}</p> : null}
            {page.state === "read" && page.bands.length === 0 ? <p className="text-body text-steel">{t("bands.none")}</p> : null}
            {page.state === "read"
              ? page.bands.map((band) => {
                  const answer = answeringPanel(band.key, session.panels);
                  return (
                    <article
                      key={band.key}
                      className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]"
                      data-band={band.key}
                      data-answered={answer ? "true" : undefined}
                      aria-labelledby={`one-brief-band-${band.key}`}
                    >
                      <div className="flex flex-col items-start gap-1">
                        <span
                          className="inline-block rounded-full border border-stone-200 bg-white px-3 py-1 text-meta font-semibold text-ink dark:-rotate-2 dark:border-2 dark:border-ink dark:bg-dial-amber dark:text-paper dark:shadow-sticker-xs"
                          id={`one-brief-band-${band.key}`}
                        >
                          {t(`bands.${band.key}`)}
                        </span>
                        <span className="font-serif text-display text-ink">{formatCount(band.count, locale)}</span>
                      </div>
                      <div className="flex min-w-0 flex-col gap-3">
                        <p className="font-serif text-h3 text-ink">{core(`greeting.first.${band.key}`, { count: band.count })}</p>
                        {answer ? (
                          <div className="flex flex-wrap items-center gap-3 text-meta text-ink">
                            <span className="font-semibold">↑ {t("bands.answered", { view: words.panel(NEED_PANEL[band.key].panel) })}</span>
                            <Button label={t("bands.jump")} variant="link" size="sm" onClick={() => jump(band.key)} />
                          </div>
                        ) : null}
                        <ChipRow chips={chipsFor(band.chips)} />
                      </div>
                    </article>
                  );
                })
              : null}
            {quietLine ? (
              <p className="border-t border-dashed border-stone-200 pt-3 text-body text-steel" data-role="one-quiet">
                {quietLine}
              </p>
            ) : null}
          </section>
        ) : null}

        {/* ── the regular columns ── */}
        <section className="flex flex-col gap-3" aria-label={t("columns.kicker")} data-role="one-columns">
          <p className={EYEBROW}>{t("columns.kicker")}</p>
          <ChipRow chips={chipsFor(COLUMN_CHIPS)} />
        </section>
      </div>

      {/* ── the desk: the conversation dock ── */}
      <aside
        className="sticky bottom-0 z-10 max-h-[60vh] overflow-y-auto lg:top-4 lg:bottom-auto lg:max-h-[calc(100vh-2rem)]"
        aria-label={core("meta.conversationLabel")}
        data-role="one-desk"
      >
        <BriefDesk session={session} submit={submit} words={words} renderConsent={renderConsent} />
      </aside>
    </div>
  );
}
