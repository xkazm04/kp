"use client";

// The "Ticker" direction (round 2) — a data page under the hero header
// (docs/design/one-interface.md; spark `one-interface`).
//
// The header's stat tiles are the main navigation (the core draws them; a press asks).
// Under them: ONE reply line (what was asked, small; One's sentence; the stepper and the
// "what changed" hand note with Undo on its right), then the answer FULL-WIDTH as one table
// in the sticker frame, filling the height and scrolling inside itself. Other views the
// answer left open are sheet tabs on the table. The side rail keeps up to two pinned
// views (list look) and, under them, this session's answers as an index. The composer is
// a slim bar at the foot of the main column, its chips over it. No transcript: only the
// answer in view.
//
// Everything that moves the screen or the data comes from the core (VariantProps): this
// file is layout and paint only.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, ChipRow } from "@/app/_components/kit";
import { BTN_GHOST, EYEBROW, FIELD, META_LABEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { mkBody, mkHand } from "@/app/landing/site/chrome/fonts";
import { consoleHref as consoleHrefFor } from "../../panels/PanelShell";
import { MAX_PINS, type ChipId, type OneInput, type PanelInstance, type PanelKind } from "../../types";
import type { VariantProps } from "../../variantProps";
import { pick, stepsTo } from "./pick";
import { ARRIVE, FACE_BODY, FACE_DISPLAY, FACE_HAND, PIN_SLOT, STICKER_TABLE } from "./styles";

/** Questions the header's tiles do not ask; the side offers them while nothing is pinned. */
const MORE_TO_ASK: readonly ChipId[] = ["needs", "pipeline", "funnel", "outbox"];

/** The pipeline slice's filters, named by the chip that asks for them. */
const SLICE_CHIP: Record<string, ChipId> = { aging: "stalled", new: "arrivals" };

export default function TickerVariant({
  variant,
  session,
  submit,
  greeting,
  renderPanel,
  renderConsent,
  words,
  consoleHref,
  current,
  position,
  stepBack,
  stepForward,
}: VariantProps) {
  const t = useTranslations("one.ticker");
  const tc = useTranslations("one.core");
  const [draft, setDraft] = useState("");

  // The first beat puts the first need on the table — the same press as the core's
  // "Show me", made once when the attention read lands and nothing is on screen yet.
  const opened = useRef(false);
  const { show } = session;
  const firstKind: PanelKind | null = greeting.state === "loading" ? null : greeting.state === "needs" ? greeting.first.panel : "needs";
  const firstParams = greeting.state === "needs" ? greeting.first.params : undefined;
  const untouched = session.turns.length === 0 && session.panels.length === 0 && session.history.length === 0;
  useEffect(() => {
    if (opened.current || !firstKind || !untouched) return;
    opened.current = true;
    show(firstKind, firstParams);
  }, [firstKind, firstParams, untouched, show]);

  const { main, sheets, pins } = useMemo(() => pick(session.panels, session.focusId), [session.panels, session.focusId]);
  const g = words.greeting(greeting);

  const askedWords = (input: OneInput) => input.text ?? (input.chip ? words.chip(input.chip) : "");
  // A sheet tab names the view as the question did: the pipeline slice is "stalled" or "new
  // arrivals" by its filter, not the bare module name.
  const sheetName = (p: PanelInstance) => {
    const chip = p.kind === "pipelineSlice" ? SLICE_CHIP[p.params.filter ?? ""] : undefined;
    return chip ? words.chip(chip) : words.panel(p.kind);
  };
  const chips: ChipId[] = current ? current.reply.chips : greeting.state === "loading" ? [] : greeting.chips;
  const proposals = [
    ...(current ? current.proposals : []),
    ...session.proposals.filter((p) => p.turnId === null && !current?.proposals.includes(p)),
  ];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    submit({ text: draft });
    setDraft("");
  };

  const jumpTo = (target: number) => {
    const n = stepsTo(position.index, target);
    for (let i = 0; i < Math.abs(n); i += 1) (n < 0 ? stepBack : stepForward)();
  };

  return (
    <div
      className={`${mkBody.variable} ${mkHand.variable} ${FACE_BODY} grid h-full min-h-0 gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]`}
      data-one-layout={variant}
    >
      {/* ── The answer ───────────────────────────────────────────────── */}
      <section className="flex min-h-0 min-w-0 flex-col gap-4" aria-label={tc("meta.conversationLabel")}>
        <header className="flex shrink-0 flex-wrap items-end justify-between gap-x-8 gap-y-2" data-role="ticker-reply">
          {current ? (
            <div className={`flex min-w-0 flex-1 flex-col gap-1 ${ARRIVE}`} key={current.reply.id} data-role="one-answer">
              <p className={`${META_LABEL} truncate`}>
                <span>{t("reply.asked")}</span>
                <span aria-hidden> · </span>
                <span className="normal-case tracking-normal text-ink">{askedWords(current.asked)}</span>
              </p>
              <p className={`${FACE_DISPLAY} text-h2 font-extrabold leading-tight tracking-tight text-ink`} aria-live="polite">
                <span className="sr-only">{tc("one")}: </span>
                {words.say(current.reply.say)}
              </p>
              {current.reply.fallback || current.reply.dropped > 0 || current.reply.links.length > 0 ? (
                <p className="flex flex-wrap items-center gap-x-3 text-micro text-steel">
                  {current.reply.fallback ? <span>{t("reply.notYet")}</span> : null}
                  {current.reply.dropped > 0 ? <span>{words.dropped(current.reply.dropped)}</span> : null}
                  {current.reply.links.map((l) => (
                    <Link key={l.tab} className="k-btn k-btn--link k-btn--sm" href={consoleHrefFor(l.tab, l.params)}>
                      {tc("meta.console")}
                    </Link>
                  ))}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-col gap-1" data-role="one-greeting">
              <p className={EYEBROW}>{t("reply.today")}</p>
              <p className={`${FACE_DISPLAY} text-h2 font-extrabold leading-tight tracking-tight ${greeting.state === "loading" ? "text-steel" : "text-ink"}`} aria-live="polite">
                {g.status}
                {g.first ? <span className="font-semibold text-steel"> {g.first}</span> : null}
              </p>
            </div>
          )}

          <div className="flex shrink-0 flex-col items-end gap-1">
            {position.total > 0 ? (
              <div className="flex items-center gap-1" data-role="one-stepper">
                <Button label={tc("step.back")} icon="left" iconOnly variant="ghost" size="sm" disabled={!position.canBack} onClick={stepBack} />
                <span className="k-nums min-w-24 text-center text-micro font-semibold text-ink" role="status">
                  {tc("step.position", { index: position.index + 1, total: position.total })}
                </span>
                <Button label={tc("step.forward")} icon="right" iconOnly variant="ghost" size="sm" disabled={!position.canForward} onClick={stepForward} />
              </div>
            ) : null}
            <div className="flex min-h-8 items-center gap-3" role="status" data-role="one-change">
              {session.pending ? (
                <span className={`${FACE_HAND} text-h2 leading-none text-steel`}>{tc("composer.working")}</span>
              ) : session.lastChange ? (
                <>
                  <span className="sr-only">{t("change.label")}: </span>
                  <span className={`${FACE_HAND} max-w-[28rem] truncate text-h2 leading-none text-ink before:content-['↳_']`}>
                    {words.change(session.lastChange)}
                  </span>
                  {session.canUndo ? <Button label={tc("change.undo")} variant="link" size="sm" onClick={session.undo} /> : null}
                </>
              ) : null}
            </div>
          </div>
        </header>

        {proposals.length > 0 ? (
          <div className="flex shrink-0 gap-4 overflow-x-auto pb-1" data-role="ticker-consent">
            {proposals.map((p) => renderConsent(p, { className: "w-[22rem] shrink-0" }))}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col" data-role="one-region" aria-label={tc("meta.regionLabel")}>
          {sheets.length > 1 ? (
            <div className="flex shrink-0 items-end gap-1 pl-4" role="tablist" aria-label={t("sheets.label")} data-role="ticker-sheets">
              {sheets.map((p) => {
                const on = p.id === main?.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => session.focus(p.id)}
                    className={
                      on
                        ? "focus-ring relative -mb-0.5 h-9 rounded-t-lg border-2 border-b-0 border-ink bg-white px-4 text-micro font-semibold text-ink dark:border-stone-300"
                        : `${BTN_GHOST} h-9 px-4 text-micro`
                    }
                  >
                    {sheetName(p)}
                  </button>
                );
              })}
            </div>
          ) : null}
          {main ? (
            <div className={`${STICKER_TABLE} min-h-0 flex-1 ${ARRIVE}`} key={main.id} data-role="ticker-table">
              {renderPanel(main, { look: "table" })}
            </div>
          ) : (
            <div className={`${PANEL_SUNKEN} flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center`} data-role="ticker-empty">
              <p className={`${FACE_DISPLAY} text-h3 font-bold text-ink`}>{t("empty.title")}</p>
              <p className="max-w-md text-body text-steel">{t("empty.body")}</p>
            </div>
          )}
        </div>

        {/* ── The composer: the follow-ups, then the slim bar ──────────── */}
        <div className="flex shrink-0 flex-col gap-2" data-role="ticker-dock">
          {chips.length > 0 ? (
            <ChipRow chips={chips.map((id) => ({ id, label: words.chip(id), onPress: () => submit({ chip: id }) }))} />
          ) : null}
          <form className="flex items-center gap-3" onSubmit={onSubmit} data-role="one-composer">
            <KandidateMark className="size-10 shrink-0 text-ink [--k-fg:var(--color-paper)]" />
            <input
              type="text"
              className={`${FIELD} h-12 min-w-0 flex-1 rounded-xl border-2 px-4 dark:rounded-2xl`}
              aria-label={tc("composer.label")}
              placeholder={tc("composer.placeholder")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            {session.pending ? (
              <Button label={tc("composer.stop")} variant="secondary" size="lg" onClick={session.stop} />
            ) : (
              <Button
                label={tc("composer.send")}
                variant={proposals.length > 0 ? "secondary" : "primary"}
                size="lg"
                type="submit"
                disabled={!draft.trim()}
              />
            )}
          </form>
        </div>
      </section>

      {/* ── The side: what is kept, then this session ─────────────────── */}
      <aside className="flex min-h-0 flex-col gap-6" aria-label={t("side.label")}>
        <section className="flex min-h-0 flex-col gap-3 [&:has([data-one-panel])]:flex-[3]" aria-label={t("pins.heading")} data-role="ticker-pins">
          <div className="flex shrink-0 items-baseline justify-between gap-3">
            <h2 className={`${FACE_DISPLAY} text-h3 font-bold text-ink`}>{t("pins.heading")}</h2>
            <span className="k-nums text-micro text-steel">{t("pins.count", { count: pins.length, max: MAX_PINS })}</span>
          </div>
          {pins.length > 0 ? (
            pins.map((p) => (
              <div key={p.id} className={`${PIN_SLOT} ${ARRIVE}`}>
                {renderPanel(p, { look: "list" })}
              </div>
            ))
          ) : (
            <div className={`${PANEL_SUNKEN} flex shrink-0 flex-col gap-1 px-4 py-4`} data-role="ticker-pins-empty">
              <p className="text-body font-semibold text-ink">{t("pins.emptyTitle")}</p>
              <p className="text-micro text-steel">{t("pins.emptyBody")}</p>
            </div>
          )}
        </section>

        {session.answers.length > 0 ? (
          <nav className="flex min-h-24 shrink flex-col gap-3" aria-label={t("session.label")} data-role="ticker-session">
            <div className="flex shrink-0 items-baseline justify-between gap-3 border-t border-stone-200 pt-4 dark:border-t-2 dark:border-dashed">
              <h2 className={`${FACE_DISPLAY} text-h3 font-bold text-ink`}>{t("session.heading")}</h2>
              <span className="k-nums text-micro text-steel">{session.answers.length}</span>
            </div>
            <ol className="flex min-h-0 flex-col overflow-y-auto">
              {session.answers
                .map((a, i) => ({ a, i }))
                .reverse()
                .map(({ a, i }) => {
                  const on = i === position.index;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        className={`${BTN_GHOST} h-10 w-full justify-start gap-3 px-3 text-left text-micro ${on ? "bg-stone-100 font-semibold text-ink shadow-[inset_3px_0_0_var(--color-ink)]" : ""}`}
                        aria-current={on ? "true" : undefined}
                        disabled={!!session.pending}
                        onClick={() => jumpTo(i)}
                      >
                        <span className="k-nums w-6 shrink-0 text-steel">{i + 1}</span>
                        <span className="truncate">{askedWords(a.asked)}</span>
                      </button>
                    </li>
                  );
                })}
            </ol>
          </nav>
        ) : null}

        {pins.length === 0 ? (
          <nav className="flex shrink-0 flex-col gap-3" aria-label={t("more.label")} data-role="ticker-more">
            <div className="flex shrink-0 items-baseline justify-between gap-3 border-t border-stone-200 pt-4 dark:border-t-2 dark:border-dashed">
              <h2 className={`${FACE_DISPLAY} text-h3 font-bold text-ink`}>{t("more.heading")}</h2>
            </div>
            <ul className="flex flex-col">
              {MORE_TO_ASK.map((id) => (
                <li key={id}>
                  <button type="button" className={`${BTN_GHOST} h-10 w-full justify-between gap-3 px-3 text-left text-micro`} onClick={() => submit({ chip: id })}>
                    <span className="truncate">{words.chip(id)}</span>
                    <span aria-hidden>→</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <p className="mt-auto shrink-0 text-micro text-steel">
          <Link className="k-btn k-btn--link k-btn--sm" href={consoleHref}>
            {tc("meta.console")}
          </Link>{" "}
          {t("side.consoleKeys")}
        </p>
      </aside>
    </div>
  );
}
