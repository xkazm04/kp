"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Lightbulb, HelpCircle } from "lucide-react";
import { BTN_PRIMARY, META_LABEL } from "@/app/_components/ui/recipes";
import { choiceMessage, toggleChoice, type IntakeChoiceSet } from "@/app/_lib/intake-choices";

// DECISION CARDS — the agent's offer, under the bubble that made it.
//
// The design constraint the shape comes from: this must not read as a form.
// A form asks; a card set PROPOSES, and proposing carries an obligation the
// asking never had — to say what picking would make true, and to make refusing
// as easy as accepting. So:
//
//  · Each card carries its consequence line (`detail`), because that is what
//    turns "Senior" from a label into a decision the requestor can weigh.
//  · The kind is stated, not implied: a `confirm` set says the agent is
//    checking its own assumption (and its eyebrow reads that way), a `propose`
//    set says these are disposable suggestions. The two ask for different
//    things and a requestor who cannot tell them apart will treat both as the
//    system's opinion.
//  · The escape is IN THE CARD SET, not only in the composer: an explicit
//    "none of these" line under the cards, which just moves focus back to
//    typing. A choice you cannot decline is a field.
//  · Cards go quiet once the turn is answered. They stay on screen as the
//    record of what was offered — the transcript above them is the record of
//    what was picked — but nothing about them invites a second click.
//
// Selecting sends the labels as an ORDINARY MESSAGE (intake-choices.ts): the
// engine, the extraction and the read-back all see the requestor's words, and
// the value lands as `stated` because they did state it.

export function JdsIntakeChoiceCards({
  set,
  disabled,
  onPick,
  onDecline,
}: {
  set: IntakeChoiceSet;
  /** The turn is no longer the live one, the session closed, or a send is in
   *  flight — the cards are then a record, not an offer. */
  disabled: boolean;
  /** Sends the selection as the requestor's next message. Resolves false when
   *  the exchange did not land, so the selection stays on screen to retry. */
  onPick: (message: string) => void | Promise<boolean>;
  /** "None of these" — hands the turn back to the composer. */
  onDecline?: () => void;
}) {
  const t = useTranslations("library.tab.intake.choices");
  const [selected, setSelected] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const busy = sending || disabled;
  const Icon = set.kind === "confirm" ? HelpCircle : Lightbulb;

  const commit = async (ids: string[]) => {
    const message = choiceMessage(set, ids);
    if (!message || busy) return;
    setSending(true);
    try {
      const ok = await onPick(message);
      // Keep the selection when the send was refused — the requestor's pick is
      // the only copy of what they decided, exactly as the composer keeps a
      // refused draft.
      if (ok !== false) setSelected([]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <div className={`flex items-center gap-1.5 ${META_LABEL}`}>
        <Icon size={12} aria-hidden />
        {t(set.kind === "confirm" ? "eyebrowConfirm" : "eyebrowPropose")}
      </div>
      <p className="text-body text-ink">{set.prompt}</p>
      {/* A radiogroup would be a lie for a multi-select and an over-claim for a
          single one that also sends: these are buttons that answer a question,
          announced as a group with the prompt as its name. */}
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label={set.prompt}>
        {set.options.map((option) => {
          const on = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              disabled={busy}
              aria-pressed={on}
              onClick={() => {
                const next = toggleChoice(set, selected, option.id);
                setSelected(next);
                // Single-select is a decision, so it sends on the click — one
                // action for one answer. Multi-select waits for the confirm
                // button, because a list is not finished until they say it is.
                if (!set.multi && next.length > 0) void commit(next);
              }}
              className={`focus-ring rounded-lg border p-2.5 text-left transition-colors disabled:cursor-default disabled:opacity-60 ${
                on ? "border-coral bg-coral/10" : "border-stone-200 bg-white hover:border-coral/50"
              }`}
            >
              <span className="flex items-start gap-1.5">
                {on ? <Check size={14} className="mt-0.5 shrink-0 text-coral" aria-hidden /> : null}
                <span className="min-w-0">
                  <span className="block text-body font-medium text-ink">{option.label}</span>
                  {option.detail ? <span className="mt-0.5 block text-meta leading-5 text-steel">{option.detail}</span> : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {set.multi ? (
          <button
            type="button"
            className={`${BTN_PRIMARY} h-8 px-3 text-sm`}
            disabled={busy || selected.length === 0}
            onClick={() => void commit(selected)}
          >
            {t("confirmSelection", { count: selected.length })}
          </button>
        ) : null}
        {/* Declining is a first-class answer, so it is on the card set rather
            than left implicit in the composer below. */}
        <button
          type="button"
          className="focus-ring rounded text-meta text-steel underline decoration-dotted underline-offset-2 transition-colors hover:text-ink"
          disabled={busy}
          onClick={onDecline}
        >
          {t("none")}
        </button>
      </div>
    </div>
  );
}
