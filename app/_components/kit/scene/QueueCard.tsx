"use client";

import type { FocusEvent, HTMLAttributes } from "react";
import { Button } from "../Button";
import "./scene.css";

/** A name on a queue card: a button to the item's record. */
export type QueueName = { key: string; label: string; onSelect: () => void };

type Props = Omit<HTMLAttributes<HTMLElement>, "children" | "onFocus" | "onBlur" | "onPointerEnter" | "onPointerLeave"> & {
  /** The count, already formatted in the reader's locale. */
  count: string;
  /** What the queue is, after the numeral ("new applications"). */
  noun: string;
  /** The main press's accessible name (what it does, with the queue's full sentence). */
  openLabel: string;
  /** The main press (the Overview: light the queue's people and open the orbit). */
  onOpen: () => void;
  /** The most urgent names; the rest are `more`. */
  names: readonly QueueName[];
  /** "+N more", or null. */
  more?: string | null;
  /** Where its items stand ("on Accepted · Interview"), or null. */
  on?: string | null;
  /** Where the queue is worked. */
  door: { label: string; onSelect: () => void };
  /** Waiting on YOU: a coral edge and the needs ink on the numeral. */
  needs?: boolean;
  /** Pointed at from elsewhere (its wire is lit). */
  hot?: boolean;
  /** Pointing at the card, or focusing anything inside it, lights its items; leaving it clears them.
   *  `via` says which way it was asked, so the caller can keep a pointer slot and a focus slot (with
   *  focus in one card, pointing at another and leaving it falls back to the focused one). */
  onHot: (on: boolean, via: "pointer" | "focus") => void;
  cardRef?: (el: HTMLElement | null) => void;
};

/**
 * @catalog A queue as a card: its count and what it is (one press), the most urgent names (each a press to its record), where they stand, and the door where the queue is worked; pointing at it or focusing inside it lights its items.
 *
 * Copy-free: every word arrives formatted. Extra attributes pass through to the `<article>`
 * (`data-role`, `data-key`). Studio Light: a hairline card that lifts on hover; Spark Dark: a drawn
 * outline and a sticker shadow that presses out to the pop shadow.
 */
export function QueueCard({ count, noun, openLabel, onOpen, names, more, on, door, needs = false, hot = false, onHot, cardRef, className, ...rest }: Props) {
  const leave = (e: FocusEvent<HTMLElement>) => {
    if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) onHot(false, "focus");
  };
  const cls = ["k-queue", needs ? "is-needs" : "", hot ? "is-hot" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <article
      ref={cardRef}
      className={cls}
      {...rest}
      onPointerEnter={() => onHot(true, "pointer")}
      onPointerLeave={() => onHot(false, "pointer")}
      onFocus={() => onHot(true, "focus")}
      onBlur={leave}
    >
      <button type="button" className="k-queue__top" onClick={onOpen} aria-label={openLabel}>
        <span className="k-queue__n">{count}</span>
        <span className="k-queue__l">{noun}</span>
      </button>
      {names.length ? (
        <p className="k-queue__names">
          {names.map((x) => (
            <button key={x.key} type="button" className="k-queue__name" onClick={x.onSelect}>{x.label}</button>
          ))}
          {more ? <span className="k-queue__more">{more}</span> : null}
        </p>
      ) : null}
      <div className="k-queue__foot">
        {on ? <span className="k-queue__on">{on}</span> : null}
        <Button label={door.label} variant="link" size="sm" onClick={door.onSelect} />
      </div>
    </article>
  );
}
