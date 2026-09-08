"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { META_LABEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { Collapse } from "@/app/features/hiring/pipeline/PipelineMotion";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { JdsIntakeChoiceCards } from "../../JdsIntakeChoiceCards";
import { CONSOLE_EASE, CONSOLE_SPRING, type ConsoleExchange } from "./consoleModel";

// THE PROMPT STAGE — the current question, at the size of the thing it is.
//
// This is the coat's whole argument. In a scrolling chat log the live question
// is the last bubble: same face, same size, same tint as the nineteen answered
// ones above it, and the requestor's eye has to FIND the work before doing it.
// The intake craft is one question per turn — so the current question stops
// being a log entry and becomes a stage: the display face at reading measure,
// alone above the field that answers it, with the agent's reflection set quietly
// on top of it in the meta voice, because "here is what I understood" and "here
// is what I need" are two different speech acts and reading them as one
// paragraph is what makes an intake feel like a form.
//
// MOTION. Answering advances the stage: the answered question leaves UPWARD
// (`mode="wait"`, so the outgoing one is gone before the next arrives and the
// two never stack), and the small mark at the stage's head — which carries the
// shared `console-tick-<index>` layout id — is at that moment re-drawn by the
// rail, so framer morphs it from the stage down onto the timeline. One object,
// followed by the eye, rather than a disappearance and an appearance.

/** The record of an exchange the reader opened from the rail (or arrived at by
 *  clicking a dossier card's citation): the question as it was asked, and the
 *  answer as it was given. It is not a bubble pair — it is a quotation. */
function ExchangeRecord({ exchange, flash }: { exchange: ConsoleExchange; flash: boolean }) {
  const t = useTranslations("library.tab.intake.roles");
  return (
    <div className={`${PANEL_SUNKEN} space-y-3 p-4 ${flash ? "animate-arrive-in" : ""}`}>
      <div>
        <div className={META_LABEL}>{t("agent")}</div>
        <p className="mt-1 whitespace-pre-line text-body text-ink">
          {[exchange.reflection, exchange.question].filter(Boolean).join("\n\n")}
        </p>
      </div>
      {exchange.answer ? (
        <div>
          <div className={META_LABEL}>{t("requestor")}</div>
          <p className="mt-1 whitespace-pre-line text-body text-steel">{exchange.answer}</p>
        </div>
      ) : null}
      {exchange.notes.map((note, i) => (
        <p key={`${i}:${note}`} className="text-meta text-steel">
          {note}
        </p>
      ))}
    </div>
  );
}

export function ConsolePromptStage({
  exchange,
  openExchange,
  flashOpen,
  sending,
  interactiveChoices,
  onPick,
  onDecline,
  composer,
}: {
  /** The hero. Null before the agent has asked anything. */
  exchange: ConsoleExchange | null;
  /** An earlier exchange the reader pulled up, or null. */
  openExchange: ConsoleExchange | null;
  /** The record was opened by a brief citation — flash it once. */
  flashOpen: boolean;
  sending: boolean;
  /** Decision cards answer the CURRENT question only; an older set is a record
   *  of what was offered, never a second conversation surface. */
  interactiveChoices: boolean;
  onPick: (message: string) => void | Promise<boolean>;
  onDecline: () => void;
  /** The answer field, or nothing at all on a closed session — a session that
   *  cannot be answered shows no field, which says it without a sentence. */
  composer: React.ReactNode;
}) {
  const t = useTranslations("library.tab.intake");
  const reduced = useReducedMotion();

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto p-1">
      <Collapse show={openExchange !== null}>
        <div className="mb-5">{openExchange ? <ExchangeRecord exchange={openExchange} flash={flashOpen} /> : null}</div>
      </Collapse>

      <AnimatePresence mode="wait" initial={false}>
        {exchange ? (
          <motion.div
            key={exchange.index}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            // Upward: the question that was answered is behind you now.
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -20 }}
            transition={{ duration: reduced ? 0.12 : 0.28, ease: CONSOLE_EASE }}
            className="flex gap-3"
          >
            <span className="flex w-3 shrink-0 justify-center pt-3" aria-hidden>
              {/* The object the rail takes over when this question is answered. */}
              <motion.span
                layoutId={reduced ? undefined : `console-tick-${exchange.index}`}
                transition={CONSOLE_SPRING}
                className="h-3 w-3 rounded-full bg-coral"
              />
            </span>
            <div className="min-w-0 flex-1">
              {exchange.reflection ? (
                <p className="mb-2 max-w-[54ch] whitespace-pre-line text-meta leading-6 text-steel">{exchange.reflection}</p>
              ) : null}
              <h2 className="max-w-[42ch] whitespace-pre-line font-serif text-h2 text-ink">
                {exchange.compacted > 0 ? t("compactedNote", { count: exchange.compacted }) : exchange.question}
              </h2>
              {sending ? (
                <span className="mt-3 inline-flex items-center gap-1.5 text-meta text-coral" aria-live="polite">
                  <span className="h-1.5 w-1.5 rounded-full bg-coral" aria-hidden />
                  {t("thinking")}
                </span>
              ) : null}
              {exchange.choices ? (
                <JdsIntakeChoiceCards
                  set={exchange.choices}
                  disabled={!interactiveChoices || sending}
                  onPick={onPick}
                  onDecline={onDecline}
                />
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {composer}
    </div>
  );
}
