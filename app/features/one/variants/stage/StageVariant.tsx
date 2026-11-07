"use client";

// /one — the "Stage" direction (round 1). A composer bar over a STAGE: a declared
// three-slot grid (slots.ts — spans, never coordinates) where One places up to three
// module views. Pinned views keep their slot, a new view takes the oldest unpinned slot,
// focus lifts one view and lets the others sit flat — nothing is removed by focus. The
// conversation is a thin strip (the last reply sentence, history on demand), and the
// "what changed" line + Undo sit on the stage's own edge.
//
// Register: PINNED — one printed sticker sheet in both themes (stage.css; token-only).
// Composer on TOP, deliberately: cause reads before effect (ask → answer → stage), the
// stage is never under a docked bar, and the tab order runs input → chips → views.
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "framer-motion";
import { Button, ChipRow, Tag, TextField } from "@/app/_components/kit";
import { consoleHref } from "../../panels/PanelShell";
import type { ChipId, PanelInstance, Turn } from "../../types";
import type { VariantProps } from "../../variantProps";
import { assignSlots, STAGE_SLOTS, type SlotMemory } from "./slots";
import "./stage.css";

type OneTurn = Extract<Turn, { who: "one" }>;

const OUTLINE = "rounded-lg border-2 border-ink";

export default function StageVariant({ variant, session, submit, greeting, renderPanel, renderConsent, words }: VariantProps) {
  const t = useTranslations("one.stage");
  const core = useTranslations("one.core");
  const reduce = useReducedMotion();
  const [draft, setDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  // Seat the views. "Adjust state while rendering" (React docs): the plan is recomputed
  // only when the reducer hands us a new panels array, and its memory survives so Undo
  // puts a restored view back in the slot it held.
  const [seating, setSeating] = useState<{ panels: PanelInstance[]; memory: SlotMemory; bySlot: (string | null)[] }>(() => {
    const plan = assignSlots({}, session.panels.map((p) => p.id));
    return { panels: session.panels, ...plan };
  });
  let plan = seating;
  if (seating.panels !== session.panels) {
    plan = { panels: session.panels, ...assignSlots(seating.memory, session.panels.map((p) => p.id)) };
    setSeating(plan);
  }
  const byId = new Map(session.panels.map((p) => [p.id, p]));

  const g = words.greeting(greeting);
  const lastOne = [...session.turns].reverse().find((x): x is OneTurn => x.who === "one") ?? null;
  const lastUser = [...session.turns].reverse().find((x) => x.who === "user") ?? null;
  const chips: ChipId[] = lastOne ? lastOne.chips : greeting.state === "loading" ? [] : greeting.chips;
  // One coral primary per view: an open consent card owns it, so Send steps down.
  const consentOpen = session.proposals.length > 0;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit({ text: draft });
    setDraft("");
  };

  const multi = session.panels.length > 1;

  return (
    <div className="one-stage" data-one-layout={variant}>
      <div className="one-stage__sheet flex flex-col gap-5 px-4 pb-12 pt-4">
        {/* ── Composer bar ─────────────────────────────────────────── */}
        <form
          className={`${OUTLINE} flex flex-col gap-3 bg-white p-3 shadow-sticker-sm`}
          onSubmit={onSubmit}
          data-role="one-composer"
        >
          <div className="flex items-center gap-2">
            <TextField
              label={core("composer.label")}
              placeholder={core("composer.placeholder")}
              value={draft}
              onChange={setDraft}
              className="flex-1"
            />
            {session.pending ? (
              <Button label={core("composer.stop")} variant="secondary" onClick={session.stop} />
            ) : (
              <Button label={core("composer.send")} variant={consentOpen ? "secondary" : "primary"} type="submit" disabled={!draft.trim()} />
            )}
          </div>
          {chips.length > 0 ? (
            <ChipRow chips={chips.slice(0, 4).map((id) => ({ id, label: words.chip(id), onPress: () => submit({ chip: id }) }))} />
          ) : null}
        </form>

        {/* ── Conversation strip ───────────────────────────────────── */}
        <section className="flex flex-col gap-2" aria-label={core("meta.conversationLabel")} data-role="one-strip">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="font-serif text-h2 text-ink" data-role={lastOne ? "one-reply" : "one-greeting"} aria-live="polite">
              {lastOne ? words.say(lastOne.say) : g.status}
            </p>
            {lastOne?.fallback ? <Tag label={t("fallback")} /> : null}
            {session.turns.length > 0 ? (
              <Button
                label={historyOpen ? t("historyHide") : t("historyShow", { count: session.turns.length / 2 })}
                variant="link"
                size="sm"
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen((v) => !v)}
              />
            ) : null}
          </div>
          {lastUser && lastUser.who === "user" ? (
            <p className="text-meta text-steel">
              {t("asked", { words: lastUser.text ?? (lastUser.chip ? words.chip(lastUser.chip) : "") })}
            </p>
          ) : null}
          {lastOne && lastOne.dropped > 0 ? <p className="text-meta text-steel">{words.dropped(lastOne.dropped)}</p> : null}
          {lastOne && lastOne.links.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {lastOne.links.map((l) => (
                <Link key={l.tab} className="k-btn k-btn--link k-btn--sm" href={consoleHref(l.tab, l.params)}>
                  {core("meta.console")}
                </Link>
              ))}
            </div>
          ) : null}
          {session.pending ? (
            <p className="text-meta text-steel" role="status">
              {core("composer.working")}
            </p>
          ) : null}

          {historyOpen ? (
            <ol className={`${OUTLINE} flex flex-col gap-2 bg-white p-4`} data-role="one-turns">
              {session.turns.map((turn) =>
                turn.who === "user" ? (
                  <li key={turn.id} className="text-body text-ink" data-who="user">
                    <span className="text-meta text-steel">{core("you")}</span> {turn.text ?? (turn.chip ? words.chip(turn.chip) : "")}
                  </li>
                ) : (
                  <li key={turn.id} className="text-body text-ink" data-who="one" data-fallback={turn.fallback || undefined}>
                    <span className="text-meta text-steel">{core("one")}</span> {words.say(turn.say)}
                  </li>
                )
              )}
            </ol>
          ) : null}

          {session.proposals.length > 0 ? (
            <div className="flex flex-col gap-3" data-role="one-consents">
              <p className="text-meta text-steel">{t("waiting")}</p>
              {session.proposals.map((p) => renderConsent(p, { className: "border-2 border-ink shadow-sticker-sm" }))}
            </div>
          ) : null}
        </section>

        {/* ── The stage ─────────────────────────────────────────────── */}
        <section className="flex flex-col gap-3" aria-label={core("meta.regionLabel")} data-role="one-region">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-ink pb-2" data-role="one-stage-edge">
            <h2 className="font-serif text-h3 text-ink">{t("stage")}</h2>
            <p className="min-w-0 flex-1 text-meta text-ink" role="status" aria-live="polite" data-role="one-change">
              {session.lastChange ? words.change(session.lastChange) : t("noChange")}
            </p>
            {session.canUndo ? <Button label={core("change.undo")} variant="secondary" size="sm" onClick={session.undo} /> : null}
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-6" data-role="one-slots">
            {STAGE_SLOTS.map((slot, i) => {
              const id = plan.bySlot[i];
              const panel = id ? byId.get(id) : undefined;
              const lead = slot.span === "lead";
              const span = lead ? "lg:col-span-4 lg:row-span-2" : "lg:col-span-2";
              if (!panel) {
                return (
                  <Slot key={slot.name} name={slot.name} className={span} label={t("slotFree", { name: slot.name })}>
                    {lead && session.panels.length === 0 ? (
                      <FirstBeat greeting={greeting} words={words} onShow={session.show} />
                    ) : (
                      <div className="flex min-h-40 flex-col justify-center gap-1 rounded-lg border-2 border-dashed border-stone-300 p-4" data-role="one-slot-free">
                        <p className="font-serif text-h3 text-steel">{t("slot", { name: slot.name })}</p>
                        <p className="text-meta text-steel">{t("slotFreeHint")}</p>
                      </div>
                    )}
                  </Slot>
                );
              }
              const focused = session.focusId === panel.id;
              const look = focused && multi ? "spotlight" : lead ? "default" : "compact";
              return (
                <Slot key={slot.name} name={slot.name} className={span} label={t("slotHolds", { name: slot.name, view: words.panel(panel.kind) })}>
                  <div className="flex items-center gap-2" data-role="one-slot-tags">
                    <span className="font-serif text-h3 text-ink" aria-hidden="true">
                      {slot.name}
                    </span>
                    {panel.pinned ? <Tag label={t("pinned")} /> : null}
                    {focused && multi ? <Tag label={t("inFocus")} /> : null}
                  </div>
                  <motion.div
                    key={panel.id}
                    initial={reduce ? false : { opacity: 0, y: -8, rotate: -0.6 }}
                    animate={{ opacity: 1, y: 0, rotate: 0 }}
                    transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 30 }}
                    className={`${OUTLINE} bg-white p-4 transition-shadow ${
                      focused && multi ? "shadow-pop" : multi ? "shadow-none" : "shadow-sticker-sm"
                    }`}
                    data-slot-state={focused && multi ? "focus" : multi ? "flat" : "solo"}
                  >
                    {renderPanel(panel, { look })}
                  </motion.div>
                </Slot>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function Slot({ name, label, className, children }: { name: string; label: string; className: string; children: ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className}`} role="group" aria-label={label} data-slot={name}>
      {children}
    </div>
  );
}

/** Before the first composition: the first need as a card in the lead slot (the fixed
 *  default the region shows before One has placed anything). */
function FirstBeat({
  greeting,
  words,
  onShow,
}: {
  greeting: VariantProps["greeting"];
  words: VariantProps["words"];
  onShow: VariantProps["session"]["show"];
}) {
  const t = useTranslations("one.stage");
  const core = useTranslations("one.core");
  const g = words.greeting(greeting);
  return (
    <div className={`${OUTLINE} flex min-h-40 flex-col gap-3 bg-white p-5 shadow-pop`} data-role="one-first-need">
      <p className="text-meta text-steel">{t("firstUp")}</p>
      <p className="font-serif text-h2 text-ink">{g.first ?? core("meta.regionEmpty")}</p>
      {greeting.state === "needs" ? (
        <div>
          <Button
            label={core("greeting.show")}
            variant="secondary"
            onClick={() => onShow(greeting.first.panel, greeting.first.params)}
          />
        </div>
      ) : null}
    </div>
  );
}
