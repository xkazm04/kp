"use client";

// The "Greet" direction (round 1) — the home is a conversation, drawn in the landing's
// register (docs/design/one-interface.md; spark `one-interface`).
//
// What the user sees first: one big status line and the first need as a sticker card,
// with ≤ 4 chips under it. Answers land INLINE: each reply is a turn in the conversation
// column and the views it opened sit under it as sticker cards (placement.ts says which
// turn owns which view). Pinning a view lifts it out of the conversation onto the side
// ("kept beside you"), under a quiet index of the 8 modules where a click is a question.
// The "what changed" line is a hand note docked above the composer with its Undo, so it is
// in reach after every screen change however far the conversation scrolled.
//
// Everything that moves the screen or the data comes from the core (VariantProps): this
// file is layout and paint only.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, ChipRow, formatCount } from "@/app/_components/kit";
import { BTN_GHOST, EYEBROW, FIELD } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { mkBody, mkHand } from "@/app/landing/site/chrome/fonts";
import type { AttentionCounts } from "@/app/_lib/attention";
import { consoleHref as consoleHrefFor } from "../../panels/PanelShell";
import { PANEL_KINDS, type ChipId, type PanelInstance, type PanelKind, type Turn } from "../../types";
import type { VariantProps } from "../../variantProps";
import { arrange, GREETING_OWNER, place, type Owners } from "./placement";
import { ARRIVE, FACE_BODY, FACE_DISPLAY, FACE_HAND, PANEL_IN_CARD, STICKER, STICKER_FRONT, STICKER_SAY } from "./styles";

/** A module in the index asks the question that opens it. The role card needs a role in
 *  the user's own words, so it starts the sentence in the composer instead. */
const MODULE_ASK: Record<PanelKind, ChipId | null> = {
  needs: "needs",
  decisionsQueue: "decisions",
  pipelineSlice: "pipeline",
  scheduleAhead: "interviews",
  funnel: "funnel",
  jobDrafts: "drafts",
  outbox: "outbox",
  roleCard: null,
};

/** The modules whose waiting count the attention read carries (fetched, so a numeral
 *  may show; an absent read is "—", never 0). */
const MODULE_COUNT: Partial<Record<PanelKind, keyof AttentionCounts>> = {
  decisionsQueue: "decisions",
  scheduleAhead: "schedule",
  jobDrafts: "jobs",
};

const userWords = (turn: Extract<Turn, { who: "user" }>, chip: (c: ChipId) => string) =>
  turn.text ?? (turn.chip ? chip(turn.chip) : "");

export default function GreetVariant({ variant, session, submit, greeting, attention, renderPanel, renderConsent, words, consoleHref }: VariantProps) {
  const t = useTranslations("one.greet");
  const tc = useTranslations("one.core");
  const locale = useLocale();
  const reduced = useReducedMotion();
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  const oneTurns = session.turns.filter((x): x is Extract<Turn, { who: "one" }> => x.who === "one");
  const newestReply = oneTurns.at(-1) ?? null;
  const newestTurnId = newestReply?.id ?? null;

  // Which turn each view belongs to — remembered for good, so Undo puts a view back
  // under the reply it came from.
  // Derived during render (React's "adjust state when props change"): place() returns the
  // same object once every id is placed, so this settles in one extra render.
  const [owners, setOwners] = useState<Owners>({});
  const nextOwners = place(owners, session.panels.map((p) => p.id), newestTurnId);
  if (nextOwners !== owners) setOwners(nextOwners);
  const placed = useMemo(() => arrange(session.panels, nextOwners, newestTurnId ?? GREETING_OWNER), [session.panels, nextOwners, newestTurnId]);

  // The view brought forward is scrolled into reach (instantly under reduced motion).
  useEffect(() => {
    if (!session.focusId) return;
    const el = root.current?.querySelector(`[data-panel-id="${session.focusId}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [session.focusId, reduced]);

  // A new question scrolls its own turn to the top, so the reply reads downward from it.
  const turnCount = session.turns.length;
  useEffect(() => {
    if (turnCount === 0) return;
    const el = root.current?.querySelector('[data-role="greet-turns"] > li:nth-last-child(2)');
    el?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }, [turnCount, reduced]);

  const g = words.greeting(greeting);
  const chips: ChipId[] = newestReply ? newestReply.chips : greeting.state === "loading" ? [] : greeting.chips;
  const chipRow = (ids: readonly ChipId[]) =>
    ids.length > 0 ? <ChipRow chips={ids.map((id) => ({ id, label: words.chip(id), onPress: () => submit({ chip: id }) }))} /> : null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    submit({ text: draft });
    setDraft("");
  };

  const askModule = (kind: PanelKind) => {
    const chip = MODULE_ASK[kind];
    if (chip) {
      submit({ chip });
      return;
    }
    const start = t("index.rolePrefill");
    setDraft(start);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start.length, start.length);
    });
  };

  const view = (p: PanelInstance, side = false) => {
    const front = session.focusId === p.id && !side && session.panels.length > 1;
    return (
      <div key={p.id} className={`relative ${ARRIVE}`}>
        {front ? (
          <span className={`${FACE_HAND} absolute -top-5 right-4 text-h3 text-coral-ink`} data-role="greet-front">
            {t("view.front")}
          </span>
        ) : null}
        {renderPanel(p, {
          look: side ? "compact" : front ? "spotlight" : "default",
          className: `${front ? STICKER_FRONT : STICKER} ${PANEL_IN_CARD}`,
        })}
      </div>
    );
  };
  const viewsOf = (owner: string) => {
    const list = placed.byOwner[owner] ?? [];
    return list.length > 0 ? <div className="flex flex-col gap-6 pt-2">{list.map((p) => view(p))}</div> : null;
  };

  const onScreen = new Map(session.panels.map((p) => [p.kind, p.pinned ? "pinned" : "onScreen"] as const));

  return (
    <div
      ref={root}
      className={`${mkBody.variable} ${mkHand.variable} ${FACE_BODY} mx-auto grid max-w-6xl gap-10 px-4 pb-10 pt-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]`}
      data-one-layout={variant}
    >
      {/* ── The conversation ─────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-col" aria-label={tc("meta.conversationLabel")}>
        <div className="flex flex-col gap-6" data-role="one-greeting">
          <p className={EYEBROW}>{t("greeting.eyebrow")}</p>
          <h1
            className={`${FACE_DISPLAY} text-display font-extrabold leading-tight tracking-tight ${greeting.state === "loading" ? "text-steel" : "text-ink"}`}
            aria-live="polite"
          >
            {g.status}
          </h1>

          {greeting.state === "needs" ? (
            <div className="relative max-w-xl">
              <p className={`${FACE_HAND} absolute -top-7 left-6 -rotate-2 text-h2 text-coral-ink`} aria-hidden>
                {t("greeting.startHere")}
              </p>
              <div className={`${STICKER} flex flex-col gap-4 p-5 sm:-rotate-1 sm:p-6`} data-role="greet-first-need">
                <p className="flex items-start gap-3 text-h2 text-ink">
                  <span className="mt-2 size-3 shrink-0 rounded-full bg-coral" aria-hidden />
                  <span>{g.first}</span>
                </p>
                <div>
                  <Button
                    label={tc("greeting.show")}
                    variant="secondary"
                    onClick={() => session.show(greeting.first.panel, greeting.first.params)}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {viewsOf(GREETING_OWNER)}
          {newestReply ? null : chipRow(chips)}
        </div>

        <ol className="mt-10 flex flex-col gap-8" data-role="greet-turns">
          {session.turns.map((turn) =>
            turn.who === "user" ? (
              <li key={turn.id} className={`flex scroll-mt-6 justify-end ${ARRIVE}`} data-who="user">
                <p className={`${STICKER_SAY} max-w-[85%] px-4 py-2 text-body text-ink`}>
                  <span className="sr-only">{tc("you")}: </span>
                  {userWords(turn, words.chip)}
                </p>
              </li>
            ) : (
              <li key={turn.id} className={`flex flex-col gap-3 ${ARRIVE}`} data-who="one" data-fallback={turn.fallback || undefined}>
                <div className="flex items-start gap-3">
                  <KandidateMark className="mt-0.5 size-8 shrink-0 text-ink [--k-fg:var(--color-paper)]" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-h3 text-ink">
                      <span className="sr-only">{tc("one")}: </span>
                      {words.say(turn.say)}
                    </p>
                    {turn.fallback ? <p className={`${FACE_HAND} text-h3 text-steel`}>{t("turn.notYet")}</p> : null}
                    {turn.dropped > 0 ? <p className="text-meta text-steel">{words.dropped(turn.dropped)}</p> : null}
                    {turn.links.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {turn.links.map((l) => (
                          <Link key={l.tab} className="k-btn k-btn--link k-btn--sm" href={consoleHrefFor(l.tab, l.params)}>
                            {tc("meta.console")}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                {session.pending?.turnId === turn.id ? (
                  <p className={`${FACE_HAND} pl-11 text-h3 text-steel`} role="status">
                    {tc("composer.working")}
                  </p>
                ) : null}
                {session.proposals
                  .filter((p) => p.turnId === turn.id)
                  .map((p) => (
                    <div key={p.id} className="pl-11">
                      {renderConsent(p)}
                    </div>
                  ))}
                {viewsOf(turn.id)}
                {turn.id === newestTurnId ? <div className="pl-11 pt-1">{chipRow(chips)}</div> : null}
              </li>
            )
          )}
        </ol>

        {/* An act the user's own hand asked for (a panel row's Advance / Reject). */}
        {session.proposals.filter((p) => p.turnId === null).length > 0 ? (
          <div className="mt-6 flex flex-col gap-4">{session.proposals.filter((p) => p.turnId === null).map((p) => renderConsent(p))}</div>
        ) : null}

        {/* ── The dock: what changed + Undo, then the composer ─────────── */}
        <div className="sticky bottom-0 z-10 mt-10 flex flex-col gap-2 bg-paper pb-4 pt-3" data-role="greet-dock">
          <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1" role="status" data-role="one-change">
            {session.lastChange ? (
              <>
                <span className="sr-only">{t("change.label")}: </span>
                <span className={`${FACE_HAND} text-h2 leading-none text-ink before:content-['↳_']`}>
                  {words.change(session.lastChange)}
                </span>
                {session.canUndo ? <Button label={tc("change.undo")} variant="link" size="sm" onClick={session.undo} /> : null}
              </>
            ) : null}
          </div>
          <form
            className={`${STICKER} flex items-center gap-2 p-2`}
            onSubmit={onSubmit}
            data-role="one-composer"
          >
            <input
              ref={input}
              type="text"
              className={`${FIELD} h-11 min-w-0 flex-1 border-transparent bg-transparent`}
              aria-label={tc("composer.label")}
              placeholder={tc("composer.placeholder")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            {session.pending ? (
              <Button label={tc("composer.stop")} variant="secondary" onClick={session.stop} />
            ) : (
              <Button label={tc("composer.send")} variant="secondary" type="submit" disabled={!draft.trim()} />
            )}
          </form>
        </div>
      </section>

      {/* ── The side: the module index, then what is kept beside you ──── */}
      <aside className="flex flex-col gap-8 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto lg:pb-4" aria-label={t("side.label")}>
        <nav className="flex flex-col gap-2" aria-label={t("index.label")}>
          <h2 className={`${FACE_DISPLAY} text-h3 font-bold text-ink`}>{t("index.heading")}</h2>
          <p className="text-meta text-steel">{t("index.hint")}</p>
          <ul className="flex flex-col">
            {PANEL_KINDS.map((kind) => {
              const state = onScreen.get(kind);
              const countKey = MODULE_COUNT[kind];
              const count = countKey ? (attention ? formatCount(attention[countKey], locale) : "—") : null;
              return (
                <li key={kind}>
                  <button
                    type="button"
                    className={`${BTN_GHOST} h-10 w-full justify-between gap-3 px-3 text-left text-body`}
                    onClick={() => askModule(kind)}
                    data-role="greet-module"
                    data-kind={kind}
                    aria-current={state ? "true" : undefined}
                  >
                    <span className={`truncate ${state ? "font-semibold text-ink" : ""}`}>{words.panel(kind)}</span>
                    <span className="flex shrink-0 items-center gap-2 text-meta">
                      {state ? <span className={`${FACE_HAND} text-h3 text-coral-ink`}>{t(`index.${state}`)}</span> : null}
                      {count != null ? <span className="tabular-nums text-ink">{count}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {placed.pinned.length > 0 ? (
          <section className="flex flex-col gap-5" aria-label={t("pinned.heading")} data-role="greet-pinned">
            <h2 className={`${FACE_DISPLAY} text-h3 font-bold text-ink`}>{t("pinned.heading")}</h2>
            {placed.pinned.map((p) => view(p, true))}
          </section>
        ) : null}

        <p className="text-meta text-steel">
          <Link className="k-btn k-btn--link k-btn--sm" href={consoleHref}>
            {tc("meta.console")}
          </Link>{" "}
          {t("side.consoleKeys")}
        </p>
      </aside>
    </div>
  );
}
