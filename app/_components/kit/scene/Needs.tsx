"use client";

import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Mark } from "../Mark";
import { CONDITION_MARK, NEED_TONE_CONDITION, type NeedTone } from "./conditions";
import "./scene.css";

/**
 * @catalog "Needs you, worst first": a titled list of the things that need a person, with its count as a numeral; renders nothing when nothing does.
 *
 * The caller ranks and filters (a surface decides what is worth a person's attention); the items
 * are `NeedsItem`s.
 */
export function NeedsList({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const titleId = useId();
  if (count === 0) return null;
  return (
    <section className="k-needlist" aria-labelledby={titleId}>
      <h3 id={titleId} className="k-needlist__title">
        {title} <span className="k-needlist__count">{count}</span>
      </h3>
      <ol>{children}</ol>
    </section>
  );
}

type ItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title" | "children" | "type"> & {
  tone: NeedTone;
  /** What is wrong (rich: a count may wear the pill, `<strong>`). */
  title: ReactNode;
  /** The one sentence of why. */
  detail: ReactNode;
  /** Where it opens ("Configure the relay"). */
  cta: string;
};

/**
 * @catalog One thing that needs a person, as ONE button: its severity as a condition shape, what is wrong, the one sentence of why, and where it opens.
 *
 * Extra button attributes pass through (a surface's focus key: `data-level-key`).
 */
export function NeedsItem({ tone, title, detail, cta, ...rest }: ItemProps) {
  return (
    <li>
      <button type="button" className="k-need" data-tone={tone} {...rest}>
        <span className="k-need__mark" aria-hidden="true">
          <Mark kind={CONDITION_MARK[NEED_TONE_CONDITION[tone]]} />
        </span>
        <span className="k-need__body">
          <span className="k-need__title">{title}</span>
          <span className="k-need__detail">{detail}</span>
        </span>
        <span className="k-need__cta">{cta}</span>
      </button>
    </li>
  );
}
