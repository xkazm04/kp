"use client";

import type { HTMLAttributes, ReactNode, Ref } from "react";
import { outcomeClass, type OutcomeTone } from "./doc";
import "./kit.css";
import "./doc.css";

/**
 * @catalog The calm document (a candidate's token page: an offer, a credential): a public bar (language, print; hidden in print) over ONE letter, an 800px sheet with the register's top rule. Mount it inside a calm KitSurface.
 */
export function Letter({ bar, children }: { bar?: ReactNode; children: ReactNode }) {
  return (
    <div className="k-doc" data-part="letter">
      {bar ? <div className="k-public print:hidden">{bar}</div> : null}
      <article className="k-letter" data-role="kit-letter">{children}</article>
    </div>
  );
}

/**
 * @catalog The letter's head: an optional brand (a sender's monogram) beside the coral eyebrow, the page's ONE h1 in the display face, one quiet context line. No figures or actions: a letter's terms sit in a StatStrip under it.
 */
export function LetterHead({
  brand, eyebrow, title, context,
}: { brand?: ReactNode; eyebrow?: string; title: string; context?: ReactNode }) {
  return (
    <header className="k-head k-head--calm" data-part="page-head">
      {brand || eyebrow ? (
        <div className="k-letter__brand">
          {brand}
          {eyebrow ? <div className="k-eyebrow" data-role="kit-eyebrow">{eyebrow}</div> : null}
        </div>
      ) : null}
      <h1 className="k-title" data-role="kit-title">{title}</h1>
      {context ? <p className="k-context" data-role="kit-context">{context}</p> : null}
    </header>
  );
}

/**
 * @catalog A labelled block of the letter (the team's notes, the disclosure, a verdict): a quiet label over free content, one rhythm below the strip.
 */
export function LetterBlock({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`k-letter__block${className ? ` ${className}` : ""}`}>
      {label ? <div className="k-letter__label">{label}</div> : null}
      {children}
    </div>
  );
}

/** @catalog A sender's monogram (a logo stand-in): initials on the steel tile, decoration only (aria-hidden). */
export function Monogram({ text }: { text: string }) {
  return <span className="k-letter__mono" aria-hidden="true">{text}</span>;
}

/** @catalog The letter's action row: 48px buttons side by side, wrapping on a phone. */
export function LetterActs({ children }: { children: ReactNode }) {
  return <div className="k-letter__acts">{children}</div>;
}

/**
 * @catalog An outcome block (a decision's result, a confirm step, a dead link): serif title, one quiet line, optional actions; `ok` is the moss wash. role / aria / tabIndex / ref pass through, so it can be a live status or an alertdialog.
 */
export function Outcome({
  tone = "default", title, titleId, bodyId, children, actions, ref, className, ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  tone?: OutcomeTone;
  title?: ReactNode;
  titleId?: string;
  bodyId?: string;
  actions?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} className={`${outcomeClass(tone)}${className ? ` ${className}` : ""}`} data-part="outcome" {...rest}>
      {title ? <h2 id={titleId} className="k-result__title">{title}</h2> : null}
      {children ? <p id={bodyId}>{children}</p> : null}
      {actions ? <div className="k-letter__acts">{actions}</div> : null}
    </div>
  );
}
