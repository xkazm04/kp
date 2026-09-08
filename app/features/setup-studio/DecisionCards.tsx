"use client";

/*
 * The three things the assistant can ask for, as three cards.
 *
 * A question (pick one, or several), a secret (a value that must never reach the
 * model), a permission (a command that wants to run). They share a shell so the
 * stage has one shape, and differ in exactly the ways the decisions differ:
 *
 *  - the JOURNEY question is the pivot of a run — the moment a silent assessment
 *    becomes a proposal — so it gets the weight: a coral rule, the display face,
 *    and every option's full description rather than a truncated line;
 *  - a secret says, in the card, that the value goes straight to `.env.local`
 *    and is never shown back — a promise the operator is entitled to read at the
 *    moment they are typing, not in a doc;
 *  - a permission shows the command verbatim in a mono block, because "would you
 *    like to allow PowerShell" is not a question anyone can answer.
 *
 * Allow/deny is the one place BTN_AFFIRM belongs: a positive half with a real
 * counterpart beside it. Continue and Save are a surface's single main action,
 * so they are coral.
 */

import { useState } from "react";
import { KeyRound, TerminalSquare } from "lucide-react";
import {
  BTN_AFFIRM,
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD_PAD,
  EYEBROW,
  FIELD,
  PANEL,
} from "@/app/_components/ui/recipes";
import type { Card } from "./protocol";
import { isJourneyCard } from "./protocol";
import { CommandBlock, Prose } from "./StudioBits";
import { COPY } from "./copy";

const OTHER = "__other__";

function CardShell({
  kicker,
  title,
  journey,
  children,
}: {
  kicker: string;
  title: string;
  journey?: boolean;
  children: React.ReactNode;
}) {
  return (
    <article
      className={`${PANEL} ${CARD_PAD} ${journey ? "border-coral/40 shadow-pop dark:border-coral/50" : ""}`}
    >
      <p className={EYEBROW}>{kicker}</p>
      <h2 className={`mt-1 text-ink ${journey ? "font-serif text-display" : "font-serif text-h2"}`}>{title}</h2>
      {children}
    </article>
  );
}

/* ── question ───────────────────────────────────────────────────────────── */

function QuestionCard({
  card,
  onAnswer,
}: {
  card: Card & { kind: "question" };
  onAnswer: (picked: string[]) => void;
}) {
  const journey = isJourneyCard(card);
  const [picked, setPicked] = useState<string[]>(card.multiSelect ? [] : [card.options[0]?.label ?? OTHER]);
  const [free, setFree] = useState("");

  const toggle = (label: string) => {
    if (card.multiSelect) setPicked((prev) => (prev.includes(label) ? prev.filter((p) => p !== label) : [...prev, label]));
    else setPicked([label]);
  };

  const resolved = picked.map((p) => (p === OTHER ? free.trim() || "Other" : p)).filter(Boolean);
  const type = card.multiSelect ? "checkbox" : "radio";

  return (
    <CardShell kicker={card.header} title={card.question} journey={journey}>
      <div className="mt-4 space-y-2">
        {[...card.options.map((o) => ({ ...o })), { label: OTHER, description: null }].map((option) => {
          const isOther = option.label === OTHER;
          const checked = picked.includes(option.label);
          return (
            <label
              key={option.label}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors dark:rounded-2xl ${
                checked ? "border-coral bg-coral/5" : "border-stone-200 hover:border-coral/40"
              }`}
            >
              <input
                type={type}
                name={`q-${card.id}`}
                checked={checked}
                onChange={() => toggle(option.label)}
                className="mt-1 h-4 w-4 shrink-0 accent-coral"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold text-ink">
                  {isOther ? COPY.otherOption : option.label}
                </span>
                {option.description ? (
                  <span className="mt-0.5 block text-sm text-steel">
                    <Prose text={option.description} />
                  </span>
                ) : null}
                {isOther ? (
                  <input
                    type="text"
                    value={free}
                    placeholder={COPY.otherPlaceholder}
                    onChange={(e) => {
                      setFree(e.target.value);
                      if (e.target.value) toggle(OTHER);
                    }}
                    className={`${FIELD} mt-2 w-full`}
                  />
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={!resolved.length}
          onClick={() => onAnswer(resolved)}
          className={`${BTN_PRIMARY} h-10 px-5`}
        >
          {COPY.continue}
        </button>
      </div>
    </CardShell>
  );
}

/* ── secret ─────────────────────────────────────────────────────────────── */

function SecretCard({
  card,
  onSubmit,
}: {
  card: Card & { kind: "secret" };
  onSubmit: (action: "save" | "keep" | "skip", value?: string) => void;
}) {
  // `replacing` exists only for the already-set case: the three-way opens as
  // keep / replace / skip, and the password box appears only once Replace is
  // chosen — an empty field beside a "Keep current" button reads as an
  // unfinished form for a value that is already fine.
  const [replacing, setReplacing] = useState(!card.alreadySet);
  const [value, setValue] = useState("");

  return (
    <CardShell kicker={COPY.secretKicker} title={card.name}>
      <div className="mt-3 space-y-2">
        {card.note ? (
          <p className="text-body text-steel">
            <Prose text={card.note} />
          </p>
        ) : null}
        <p className="flex gap-2 text-sm text-steel">
          <KeyRound size={15} aria-hidden className="mt-0.5 shrink-0 text-coral" />
          <span>{COPY.secretNote}</span>
        </p>
        {card.alreadySet ? <p className="text-sm font-semibold text-ink">{COPY.secretAlreadySet}</p> : null}
      </div>

      {replacing ? (
        <input
          type="password"
          value={value}
          autoComplete="off"
          spellCheck={false}
          placeholder={card.name}
          aria-label={card.name}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value) onSubmit("save", value);
          }}
          className={`${FIELD} mt-4 w-full font-mono`}
        />
      ) : null}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {card.alreadySet && !replacing ? (
          <>
            <button type="button" onClick={() => onSubmit("keep")} className={`${BTN_PRIMARY} h-10 px-4`}>
              {COPY.keep}
            </button>
            <button type="button" onClick={() => setReplacing(true)} className={`${BTN_SECONDARY} h-10 px-4`}>
              {COPY.replace}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!value}
            onClick={() => onSubmit("save", value)}
            className={`${BTN_PRIMARY} h-10 px-4`}
          >
            {COPY.save}
          </button>
        )}
        <button type="button" onClick={() => onSubmit("skip")} className={`${BTN_GHOST} h-10 px-3`}>
          {COPY.skip}
        </button>
      </div>
    </CardShell>
  );
}

/* ── permission ─────────────────────────────────────────────────────────── */

function PermissionCard({
  card,
  onDecide,
}: {
  card: Card & { kind: "permission" };
  onDecide: (allow: boolean) => void;
}) {
  return (
    <CardShell kicker={card.tool} title={COPY.permTitle}>
      <div className="mt-3 space-y-2">
        <CommandBlock>{card.command}</CommandBlock>
        {card.description ? (
          <p className="text-body text-steel">
            <Prose text={card.description} />
          </p>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => onDecide(true)} className={`${BTN_AFFIRM} h-10 px-4`}>
          <TerminalSquare size={16} aria-hidden />
          {COPY.allow}
        </button>
        <button type="button" onClick={() => onDecide(false)} className={`${BTN_SECONDARY} h-10 px-4`}>
          {COPY.deny}
        </button>
      </div>
    </CardShell>
  );
}

/* ── the stage's one card ───────────────────────────────────────────────── */

export function DecisionCard({
  card,
  onAnswer,
  onDecide,
  onSecret,
}: {
  card: Card;
  onAnswer: (card: Card & { kind: "question" }, picked: string[]) => void;
  onDecide: (id: string, allow: boolean) => void;
  onSecret: (id: string, name: string, action: "save" | "keep" | "skip", value?: string) => void;
}) {
  if (card.kind === "question") return <QuestionCard card={card} onAnswer={(picked) => onAnswer(card, picked)} />;
  if (card.kind === "secret") {
    return <SecretCard card={card} onSubmit={(action, value) => onSecret(card.id, card.name, action, value)} />;
  }
  return <PermissionCard card={card} onDecide={(allow) => onDecide(card.id, allow)} />;
}
