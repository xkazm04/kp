"use client";

import { useId, type ReactNode } from "react";
import { Mark } from "@/app/_components/kit";
import { ConditionMark, type Condition } from "@/app/_components/kit/scene";

/**
 * The small parts every channel's setup is written with (tokens and the kit only; setup.css):
 *  - SetupStatus: the channel's condition in shape and words, then its one fact. Its border says the
 *    condition a third way (dashed = not set up or not read, coral = failing or the page's loudest).
 *  - SetupResult: what an action's REAL answer was, in shape and words; a success is announced politely,
 *    a failure or refusal as an alert (the retired cards' urgency).
 *  - SetupField: a label bound to its control, and one help line bound to it by aria-describedby.
 *  - SetupCard: one thing that is set up (a receiver, a feed): its name, its condition, its body.
 */
export function SetupStatus({ condition, title, fact, loud = false, extra }: {
  condition: Condition;
  title: string;
  fact?: ReactNode;
  loud?: boolean;
  extra?: ReactNode;
}) {
  return (
    <div className="cns-status" data-cond={condition} data-loud={loud ? "1" : undefined}>
      <ConditionMark condition={condition} label={title} loud={loud} />
      {fact ? <p className="cns-status__fact">{fact}</p> : null}
      {extra ? <div className="cns-status__extra">{extra}</div> : null}
    </div>
  );
}

export function SetupResult({ ok, lead, children }: { ok: boolean; lead?: string; children: ReactNode }) {
  return (
    <p className="cns-result" data-ok={ok ? "1" : undefined} role={ok ? "status" : "alert"}>
      <span aria-hidden="true">
        <Mark kind={ok ? "ok" : "fail"} />
      </span>
      <span>
        {lead ? <b>{lead} </b> : null}
        {children}
      </span>
    </p>
  );
}

/** `children` receives the control's id and the help line's id (for aria-describedby). */
export function SetupField({ label, help, children }: { label: string; help?: ReactNode; children: (ids: { id: string; helpId: string | undefined }) => ReactNode }) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  return (
    <div className="cns-field">
      <label className="cns-field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, helpId })}
      {help ? (
        <p className="cns-help" id={helpId}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

export function SetupCard({ title, condition, words, tags, focus = false, fresh = false, children, cardRef }: {
  title: string;
  condition: Condition;
  words: string;
  tags?: ReactNode;
  /** The card the level was opened on (a need, a deep link): drawn as the one to look at. */
  focus?: boolean;
  /** Just created here. */
  fresh?: boolean;
  children: ReactNode;
  cardRef?: (el: HTMLElement | null) => void;
}) {
  const headId = useId();
  return (
    <li className="cns-card" data-cond={condition} data-focus={focus ? "1" : undefined} data-fresh={fresh ? "1" : undefined} ref={cardRef} aria-labelledby={headId}>
      <div className="cns-card__head">
        <h3 className="cns-card__title" id={headId}>
          {title}
        </h3>
        <span className="cns-card__tags">
          {tags}
          <ConditionMark condition={condition} label={words} loud={condition === "fail"} />
        </span>
      </div>
      {children}
    </li>
  );
}
