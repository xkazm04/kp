"use client";

// The "Spotlight" direction (round 2) — one answer at a time, shown on a stage
// (docs/design/one-interface.md; spark `one-interface`).
//
//   ┌ caption band ─────────────────────────────────────┬ answer cell ───────────┐
//   │ You asked · "decisions"                            │ ‹ Answer 2 of 3 ›      │
//   │ The reply sentence, in display type                │ ↳ what changed · Undo  │
//   ├ stage ────────────────────────────────────────────┼ standing side ─────────┤
//   │ THE view the answer opened, large (table look,     │ consent cards (if any) │
//   │ the one sticker on screen) │ other views: summary  │ Worklist (needs list)  │
//   ├ dock ──────────────────────────────────────────────┤ Kept beside you (pins) │
//   │ next-question chips · composer                     │                        │
//   └────────────────────────────────────────────────────┴────────────────────────┘
//
// The page never scrolls at lg+: the grid fills the shell's body and each region scrolls
// inside itself. The side is STANDING — the same worklist on every answer — so the stage is
// the only thing an answer moves. Consent cards sit at the top of the side, directly under
// the answer cell: the act stays beside the data it acts on (the stage never shrinks to make
// room for it) and in the column the eye already treats as "what is waiting on me".
//
// Everything that moves the screen or the data comes from the core (VariantProps): this file
// is layout and paint only.
import Link from "next/link";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, ChipRow } from "@/app/_components/kit";
import { BTN_GHOST, EYEBROW, FIELD, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { mkBody, mkHand } from "@/app/landing/site/chrome/fonts";
import { consoleHref as consoleHrefFor } from "../../panels/PanelShell";
import { PANEL_VIEWS } from "../../panels/registry";
import { PANEL_KINDS, type ChipId, type PanelInstance, type PanelKind } from "../../types";
import type { VariantProps } from "../../variantProps";
import { arrangeStage } from "./stage";
import { ARRIVE, FACE_BODY, FACE_DISPLAY, FACE_HAND, HERO_STICKER } from "./styles";

/** A module on the empty stage asks the question that opens it; the role card needs a
 *  role in the user's own words, so it starts the sentence in the composer instead. */
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

/** The standing worklist is the needs view, always — host-rendered here, not a session
 *  view, so it has no pin / close chrome and never counts against the region's three. */
const WORKLIST: PanelInstance = { id: "spotlight-worklist", kind: "needs", params: {}, pinned: false };

export default function SpotlightVariant({
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
  const t = useTranslations("one.spotlight");
  const tc = useTranslations("one.core");
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const g = words.greeting(greeting);
  const plan = useMemo(() => arrangeStage(session.panels, session.focusId), [session.panels, session.focusId]);

  // First beat, nothing on screen yet: the stage previews the first need's view. It is
  // host-rendered (no chrome) until the user keeps it or asks anything.
  const firstNeed = useMemo<PanelInstance | null>(() => {
    if (greeting.state === "needs") return { id: "spotlight-first", kind: greeting.first.panel, params: greeting.first.params, pinned: false };
    if (greeting.state === "clear") return { id: "spotlight-first", kind: "funnel", params: {}, pinned: false };
    return null;
  }, [greeting]);
  const preview = !current && session.panels.length === 0 ? firstNeed : null;

  const chips: ChipId[] = current ? current.reply.chips : greeting.state === "loading" ? [] : greeting.chips;
  const askedWords = current ? (current.asked.text ?? (current.asked.chip ? words.chip(current.asked.chip) : "")) : "";
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
  const askModule = (kind: PanelKind) => {
    const chip = MODULE_ASK[kind];
    if (chip) {
      submit({ chip });
      return;
    }
    const start = t("stage.rolePrefill");
    setDraft(start);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start.length, start.length);
    });
  };

  const hostView = (p: PanelInstance, look: "table" | "list", className: string) => {
    const View = PANEL_VIEWS[p.kind];
    return <View panel={p} epoch={session.epoch} look={look} className={className} onPropose={session.propose} onShow={session.show} />;
  };

  /* ── caption band ─────────────────────────────────────────────────── */
  const caption = current ? (
    <div key={current.reply.id} className={`flex min-w-0 flex-col gap-2 ${ARRIVE}`} data-role="one-answer">
      <p className="flex min-w-0 items-baseline gap-2 text-micro text-steel">
        <span className={`${EYEBROW} shrink-0`}>{t("caption.asked")}</span>
        <span className="truncate text-ink">“{askedWords}”</span>
      </p>
      <h1 className={`${FACE_DISPLAY} line-clamp-2 text-display font-extrabold leading-tight tracking-tight text-ink`} aria-live="polite">
        <span className="sr-only">{tc("one")}: </span>
        {words.say(current.reply.say)}
      </h1>
      {current.reply.fallback || current.reply.dropped > 0 || current.reply.links.length > 0 || session.pending ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-micro text-steel">
          {session.pending ? <span role="status">{tc("composer.working")}</span> : null}
          {current.reply.fallback ? <span>{t("caption.notYet")}</span> : null}
          {current.reply.dropped > 0 ? <span>{words.dropped(current.reply.dropped)}</span> : null}
          {current.reply.links.map((l) => (
            <Link key={l.tab} className="k-btn k-btn--link k-btn--sm" href={consoleHrefFor(l.tab, l.params)}>
              {tc("meta.console")}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  ) : (
    <div className="flex min-w-0 flex-col gap-2" data-role="one-greeting">
      <p className={EYEBROW}>{t("caption.today")}</p>
      <h1
        className={`${FACE_DISPLAY} line-clamp-2 text-display font-extrabold leading-tight tracking-tight ${greeting.state === "loading" ? "text-steel" : "text-ink"}`}
        aria-live="polite"
      >
        {g.status}
      </h1>
      {g.first ? (
        <p className="flex items-center gap-2 text-body text-ink">
          <span className="size-2.5 shrink-0 rounded-full bg-coral" aria-hidden />
          {g.first}
        </p>
      ) : null}
    </div>
  );

  /* ── answer cell: stepper + what changed (or the first beat's hand note) ── */
  const answerCell = (
    <div className="flex min-w-0 flex-col items-start justify-end gap-2 lg:items-stretch" data-role="spotlight-answer-cell">
      {position.total > 0 ? (
        <div className="flex items-center gap-1" data-role="one-stepper">
          <Button label={tc("step.back")} icon="left" iconOnly variant="secondary" size="sm" disabled={!position.canBack} onClick={stepBack} />
          <span className="k-nums min-w-28 px-2 text-center text-body font-semibold text-ink" role="status">
            {tc("step.position", { index: position.index + 1, total: position.total })}
          </span>
          <Button label={tc("step.forward")} icon="right" iconOnly variant="secondary" size="sm" disabled={!position.canForward} onClick={stepForward} />
        </div>
      ) : null}
      <div className="flex min-h-7 min-w-0 items-baseline gap-3" role="status" data-role="one-change">
        {session.lastChange ? (
          <>
            <span className="sr-only">{t("change.label")}: </span>
            <span
              className={`${FACE_HAND} min-w-0 truncate text-h2 leading-7 text-ink before:content-['↳_']`}
              data-tip={words.change(session.lastChange)}
              tabIndex={0}
            >
              {words.change(session.lastChange)}
            </span>
            {session.canUndo ? <Button label={tc("change.undo")} variant="link" size="sm" className="shrink-0" onClick={session.undo} /> : null}
          </>
        ) : !current && preview ? (
          <span className={`${FACE_HAND} -rotate-2 text-h2 leading-tight text-coral-ink`} aria-hidden>
            {t("caption.startHere")}
          </span>
        ) : null}
      </div>
    </div>
  );

  /* ── the stage ────────────────────────────────────────────────────── */
  const stageViews = preview ? (
    hostView(preview, "table", `h-full min-h-0 ${HERO_STICKER}`)
  ) : plan.hero ? (
    <div className={`grid h-full min-h-0 gap-4 ${plan.beside.length > 0 ? "lg:grid-cols-[minmax(0,1fr)_17rem] xl:grid-cols-[minmax(0,1fr)_20rem]" : ""}`}>
      {renderPanel(plan.hero, { look: "table", className: `h-full min-h-0 ${HERO_STICKER}` })}
      {plan.beside.length > 0 ? (
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto" data-role="spotlight-beside">
          {plan.beside.map((p) => renderPanel(p, { look: "list", className: "min-h-48 flex-1" }))}
        </div>
      ) : null}
    </div>
  ) : (
    <div className={`${PANEL_SUNKEN} flex h-full min-h-0 flex-col items-start justify-center gap-2 overflow-y-auto p-8`} data-role="spotlight-empty">
      <h2 className={`${FACE_DISPLAY} text-h2 font-bold text-ink`}>{t("stage.emptyTitle")}</h2>
      <p className="max-w-prose text-body text-steel">{t("stage.emptyBody")}</p>
    </div>
  );

  return (
    <div
      className={`${mkBody.variable} ${mkHand.variable} ${FACE_BODY} grid h-full min-h-0 gap-x-6 gap-y-4 px-4 pb-4 pt-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_20rem]`}
      data-one-layout={variant}
    >
      {/* Row 1 — the caption band, spanning stage + side, split on the same column line. */}
      <header className="flex min-w-0 flex-col justify-end" aria-label={t("caption.label")}>
        {caption}
      </header>
      {answerCell}

      {/* Row 2, left — the stage, then the dock. */}
      <section className="flex min-h-0 min-w-0 flex-col gap-4" aria-label={tc("meta.regionLabel")} data-role="one-region">
        <div className="min-h-[24rem] flex-1 lg:min-h-0" data-role="spotlight-stage">
          {stageViews}
        </div>

        <div className="flex shrink-0 flex-col gap-3" data-role="spotlight-dock">
          {chips.length > 0 ? (
            <div className="flex min-w-0 items-center gap-3 lg:pl-14">
              <span className={`${EYEBROW} shrink-0`}>{t("dock.next")}</span>
              <ChipRow chips={chips.map((id) => ({ id, label: words.chip(id), onPress: () => submit({ chip: id }) }))} />
            </div>
          ) : null}
          <form className="flex items-center gap-3" onSubmit={onSubmit} data-role="one-composer">
            <KandidateMark className="hidden size-11 shrink-0 text-ink [--k-fg:var(--color-paper)] lg:block" />
            <input
              ref={input}
              type="text"
              className={`${FIELD} h-11 min-w-0 flex-1`}
              aria-label={tc("composer.label")}
              placeholder={tc("composer.placeholder")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            {session.pending ? (
              <Button label={tc("composer.stop")} variant="secondary" className="h-11 px-5" onClick={session.stop} />
            ) : (
              <Button label={tc("composer.send")} variant={proposals.length > 0 ? "secondary" : "primary"} className="h-11 px-5" type="submit" disabled={!draft.trim()} />
            )}
          </form>
        </div>
      </section>

      {/* Row 2, right — the standing side: consent, the worklist, what is kept. */}
      <aside className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto" aria-label={t("side.label")} data-role="spotlight-side">
        {proposals.length > 0 ? <div className="flex shrink-0 flex-col gap-3">{proposals.map((p) => renderConsent(p))}</div> : null}

        {hostView(WORKLIST, "list", plan.pinned.length > 0 || proposals.length > 0 ? "min-h-40 shrink" : "shrink-0")}

        <section className={`flex flex-col gap-2 ${plan.pinned.length > 0 ? "min-h-0 flex-1" : "shrink-0"}`} aria-label={t("side.kept")} data-role="spotlight-pinned">
          <h2 className={`${FACE_DISPLAY} shrink-0 text-h3 font-bold text-ink`}>{t("side.kept")}</h2>
          {plan.pinned.length > 0 ? (
            plan.pinned.map((p) => renderPanel(p, { look: "list", className: "min-h-32 flex-1" }))
          ) : (
            <p className="text-micro text-steel">{t("side.keptEmpty")}</p>
          )}
        </section>

        {plan.pinned.length === 0 && proposals.length === 0 ? (
          <nav className="mt-auto flex shrink-0 flex-col gap-2 border-t border-stone-200 pt-3 dark:border-dashed" aria-label={t("side.views")} data-role="spotlight-index">
            <h2 className={`${FACE_DISPLAY} text-h3 font-bold text-ink`}>{t("side.views")}</h2>
            <ul className="grid grid-cols-2 gap-x-2">
              {PANEL_KINDS.map((kind) => {
                const onStage = plan.hero?.kind === kind || plan.beside.some((p) => p.kind === kind);
                return (
                  <li key={kind} className="min-w-0">
                    <button
                      type="button"
                      className={`${BTN_GHOST} h-8 w-full min-w-0 px-2 text-left text-micro ${onStage ? "font-semibold text-ink" : ""}`}
                      aria-current={onStage ? "true" : undefined}
                      onClick={() => askModule(kind)}
                      data-kind={kind}
                    >
                      <span className={`size-1.5 shrink-0 rounded-full ${onStage ? "bg-coral" : "bg-stone-300"}`} aria-hidden />
                      <span className="truncate">{words.panel(kind)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}
      </aside>
    </div>
  );
}
