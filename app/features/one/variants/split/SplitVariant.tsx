"use client";

// The "Split" direction (round 2, the lead) — docs/design/one-interface.md; spark `one-interface`.
//
// One page, no scroll, no transcript. The MAIN column (left, ~55%) holds the answer in view:
// what was asked (a small eyebrow, the ‹ n of m › stepper beside it), One's reply in display
// type, and the answer's SUMMARY card — the one sticker on screen — whose See all puts the
// full table in front on the side. Consent cards and the follow-up chips sit under it; the
// composer is pinned to the column's foot with the "what changed" line + Undo as a hand note
// above it. The SIDE (right, ~45%, full body height) holds the answer's full TABLE, scrolling
// inside itself, with a tab strip when more than one view is on screen (the answer's + the
// pinned ones). Picking a tab is local: it never re-forms the main column.
//
// The first beat fills the same frame: main = the status line + the first need as a summary,
// side = the needs table. Everything that moves the screen or the data comes from the core
// (VariantProps); this file is layout and paint only.
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useTranslations } from "next-intl";
import { Button, ChipRow } from "@/app/_components/kit";
import {
  EYEBROW,
  FIELD,
  TOGGLE_GROUP,
  toggleBtn,
} from "@/app/_components/ui/recipes";
import { useTablist } from "@/app/_components/ui/useTablist";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { mkBody, mkHand } from "@/app/landing/site/chrome/fonts";
import { consoleHref as consoleHrefFor } from "../../panels/PanelShell";
import type { ChipId, PanelInstance } from "../../types";
import type { VariantProps } from "../../variantProps";
import { primaryOf, sideOf, tabsOf } from "./side";
import {
  ARRIVE,
  FACE_BODY,
  FACE_DISPLAY,
  FACE_HAND,
  ASKING_TRIM,
  NO_CHROME,
  SHORT_TRIM,
  STICKER_COMPOSER,
  STICKER_SUMMARY,
} from "./styles";

/** The views the host draws itself before anything is on screen (the first beat). */
const NEEDS_VIEW: PanelInstance = {
  id: "split-needs",
  kind: "needs",
  params: {},
  pinned: false,
};

export default function SplitVariant({
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
  const [draft, setDraft] = useState("");
  const sideId = useId();

  // ── Where each view goes ────────────────────────────────────────────
  const primary = primaryOf(session.panels, session.focusId);
  const tabs = tabsOf(session.panels, primary);
  // The side's tab is the user's pick until a new answer brings a new primary forward.
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedFor, setPickedFor] = useState<string | null>(
    primary?.id ?? null,
  );
  if ((primary?.id ?? null) !== pickedFor) {
    setPickedFor(primary?.id ?? null);
    setPicked(null);
  }
  const sideView = sideOf(tabs, picked);
  const tabIds = tabs.map((p) => p.id);
  const { tablistProps, tabProps, panelProps } = useTablist({
    ids: tabIds,
    active: sideView?.id ?? "",
    onSelect: setPicked,
  });

  /** See all: the full table in front on the side, keyboard landing on its first row. */
  const expand = useCallback(
    (id: string | null) => {
      if (id) setPicked(id);
      requestAnimationFrame(() =>
        document
          .getElementById(sideId)
          ?.querySelector<HTMLElement>("[data-row]")
          ?.focus(),
      );
    },
    [sideId],
  );

  // ── The first beat (nothing asked yet) ──────────────────────────────
  const g = words.greeting(greeting);
  const firstNeed: PanelInstance | null =
    greeting.state === "needs"
      ? {
          id: "split-first",
          kind: greeting.first.panel,
          params: greeting.first.params,
          pinned: false,
        }
      : null;

  const chips: readonly ChipId[] = current
    ? current.reply.chips
    : greeting.state === "loading"
      ? []
      : greeting.chips;
  const chipRow =
    chips.length > 0 ? (
      <ChipRow
        chips={chips.map((id) => ({
          id,
          label: words.chip(id),
          onPress: () => submit({ chip: id }),
        }))}
      />
    ) : null;

  const handProposals = session.proposals.filter(
    (p) => p.turnId === null && !current?.proposals.includes(p),
  );
  const proposals = [...(current?.proposals ?? []), ...handProposals];
  // A consent card outranks the summary's rows: while one is open the summary keeps its
  // headline + See all (the side table carries every row) so the card fits the sight, and a
  // NEW card is scrolled into reach.
  const asking = proposals.length > 0;
  const summaryFit = asking ? ASKING_TRIM : SHORT_TRIM;
  const reduced = useReducedMotion();
  const consents = useRef<HTMLDivElement>(null);
  const newestProposal = proposals.at(-1)?.id ?? null;
  useEffect(() => {
    if (!newestProposal) return;
    consents.current?.lastElementChild?.scrollIntoView({
      block: "nearest",
      behavior: reduced ? "auto" : "smooth",
    });
  }, [newestProposal, reduced]);

  const askedWords = current
    ? (current.asked.text ??
      (current.asked.chip ? words.chip(current.asked.chip) : ""))
    : "";
  const pending = session.pending !== null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    submit({ text: draft });
    setDraft("");
  };

  // ── The main surface: the answer's summary (or the first need's) ────
  const summary = (() => {
    if (primary) {
      return renderPanel(primary, {
        look: "summary",
        className: `${STICKER_SUMMARY} ${NO_CHROME} ${summaryFit} shrink-0`,
        onExpand: () => expand(primary.id),
      });
    }
    if (!current && firstNeed) {
      return renderPanel(firstNeed, {
        look: "summary",
        className: `${STICKER_SUMMARY} ${NO_CHROME} ${summaryFit} shrink-0`,
        onExpand: () => session.show(firstNeed.kind, firstNeed.params),
      });
    }
    return null;
  })();

  return (
    <div
      className={`${mkBody.variable} ${mkHand.variable} ${FACE_BODY} grid gap-6 px-4 py-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,max(30rem,34vw))_minmax(0,1fr)] lg:gap-8`}
      data-one-layout={variant}
    >
      {/* ── Main: the answer in view ─────────────────────────────────── */}
      <section
        className="flex min-h-0 min-w-0 flex-col gap-2"
        aria-label={tc("meta.conversationLabel")}
      >
        {/* What was asked + the stepper — one line. */}
        <div className="flex min-h-12 shrink-0 items-center justify-between gap-4 pr-2">
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
            <div
              className="flex shrink-0 items-center gap-1"
              data-role="one-stepper"
            >
              <Button
                label={tc("step.back")}
                icon="left"
                iconOnly
                variant="ghost"
                size="sm"
                disabled={!position.canBack}
                onClick={stepBack}
              />
              <span
                className="k-nums min-w-16 text-center text-micro text-steel"
                role="status"
              >
                {t("position", {
                  index: position.index + 1,
                  total: position.total,
                })}
              </span>
              <Button
                label={tc("step.forward")}
                icon="right"
                iconOnly
                variant="ghost"
                size="sm"
                disabled={!position.canForward}
                onClick={stepForward}
              />
            </div>
          ) : null}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-2 pr-2 [scrollbar-gutter:stable]">
          {/* The reply — the one display line on screen. */}
          {current ? (
            <div
              key={current.reply.id}
              className={`flex flex-col gap-2 ${ARRIVE}`}
              data-role="one-answer"
              data-fallback={current.reply.fallback || undefined}
            >
              <h1
                className={`${FACE_DISPLAY} max-w-3xl text-display font-extrabold leading-tight tracking-tight text-ink`}
                aria-live="polite"
              >
                <span className="sr-only">{tc("one")}: </span>
                {words.say(current.reply.say)}
              </h1>
              {current.reply.fallback ? (
                <p className={`${FACE_HAND} text-h2 leading-none text-steel`}>
                  {t("notYet")}
                </p>
              ) : null}
              {current.reply.dropped > 0 ? (
                <p className="text-micro text-steel">
                  {words.dropped(current.reply.dropped)}
                </p>
              ) : null}
              {current.reply.links.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {current.reply.links.map((l) => (
                    <Link
                      key={l.tab}
                      className="k-btn k-btn--link k-btn--sm"
                      href={consoleHrefFor(l.tab, l.params)}
                    >
                      {tc("meta.console")}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2" data-role="one-greeting">
              <h1
                className={`${FACE_DISPLAY} max-w-3xl text-display font-extrabold leading-tight tracking-tight ${greeting.state === "loading" ? "text-steel" : "text-ink"}`}
                aria-live="polite"
              >
                {g.status}
              </h1>
            </div>
          )}

          {pending ? (
            <p
              className={`${FACE_HAND} text-h2 leading-none text-steel`}
              role="status"
            >
              {tc("composer.working")}
            </p>
          ) : null}

          {summary ? (
            <div className={`relative max-w-2xl pr-1.5 ${ARRIVE}`}>
              {!current && firstNeed ? (
                <p
                  className={`${FACE_HAND} absolute -top-6 right-6 rotate-2 text-h2 leading-none text-coral-ink`}
                  aria-hidden
                >
                  {t("startHere")}
                </p>
              ) : null}
              {summary}
            </div>
          ) : null}

          {asking ? (
            <div ref={consents} className="flex max-w-2xl flex-col gap-3">
              {proposals.map((p) => renderConsent(p))}
            </div>
          ) : null}
        </div>

        {/* ── The dock: follow-ups, the composer, and what changed + Undo under it ── */}
        <div
          className="flex shrink-0 flex-col gap-3 border-t border-stone-200 pt-4 dark:border-t-2 dark:border-dashed"
          data-role="split-dock"
        >
          {chipRow ? (
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-2"
              data-role="split-chips"
            >
              {chipRow}
            </div>
          ) : null}
          <form
            className={`${STICKER_COMPOSER} flex items-center gap-2 p-1.5 pl-2`}
            onSubmit={onSubmit}
            data-role="one-composer"
          >
            <input
              type="text"
              className={`${FIELD} h-10 min-w-0 flex-1 border-transparent bg-transparent`}
              aria-label={tc("composer.label")}
              placeholder={tc("composer.placeholder")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            {session.pending ? (
              <Button
                label={tc("composer.stop")}
                variant="secondary"
                onClick={session.stop}
              />
            ) : (
              // The one coral primary — unless a consent card holds it.
              <Button
                label={tc("composer.send")}
                variant={asking ? "secondary" : "primary"}
                type="submit"
                disabled={!draft.trim()}
              />
            )}
          </form>
          {/* The hand note hangs under the composer, indented clear of the page's corner. */}
          <div
            className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 lg:pl-12"
            role="status"
            data-role="one-change"
          >
            {session.lastChange ? (
              <>
                <span className="sr-only">{t("changeLabel")}: </span>
                <span
                  className={`${FACE_HAND} text-h2 leading-none text-ink before:content-['↳_']`}
                >
                  {words.change(session.lastChange)}
                </span>
                {session.canUndo ? (
                  <Button
                    label={tc("change.undo")}
                    variant="link"
                    size="sm"
                    onClick={session.undo}
                  />
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── Side: the answer's full table ────────────────────────────── */}
      <aside
        id={sideId}
        className="flex min-h-0 min-w-0 flex-col gap-3 max-lg:h-[36rem]"
        aria-label={tc("meta.regionLabel")}
        data-role="split-side"
      >
        {tabs.length > 1 ? (
          <div
            className="flex shrink-0 items-center gap-3"
            data-role="split-tabs"
          >
            <div
              {...tablistProps}
              aria-label={t("tabsLabel")}
              className={`${TOGGLE_GROUP} min-w-0 dark:rounded-lg`}
            >
              {tabs.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  {...tabProps(p.id)}
                  className={`${toggleBtn(p.id === sideView?.id)} focus-ring flex h-8 min-w-0 items-center gap-2 rounded-sm px-3 text-micro font-semibold transition-colors`}
                >
                  <span className="truncate">{words.panel(p.kind)}</span>
                  {p.pinned ? (
                    <span className="shrink-0 font-normal">
                      · {t("pinned")}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div
          {...(tabs.length > 1 ? panelProps : {})}
          className="flex min-h-0 flex-1 flex-col outline-none"
        >
          {sideView ? (
            renderPanel(sideView, { look: "table", className: "min-h-0" })
          ) : (
            // Nothing on screen yet: what needs you, and — on the first beat — the first
            // need's full list under it (its summary is the main column's sticker).
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              {renderPanel(NEEDS_VIEW, {
                look: "table",
                className: `shrink-0 ${NO_CHROME}`,
              })}
              {!current && firstNeed
                ? renderPanel(firstNeed, {
                    look: "table",
                    className: `min-h-0 flex-1 ${NO_CHROME}`,
                  })
                : null}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
