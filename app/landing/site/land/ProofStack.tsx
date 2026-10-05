"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * The proof band's motion (prototype app.js "proof" block, A/1's structure): the
 * three pillars scroll past on the left while the three plates sit in a sticky
 * stack on the right. The pillar crossing the middle of the viewport is the one
 * "on"; its plate comes to the front, the ones after it wait behind, tilted and
 * dimmed, and the one before it lifts away (data-pos -1 / 0 / 1 / 2, see
 * land-proof.css). On phones the stack is hidden and each pillar shows its own
 * mini plate instead (CSS).
 *
 * Copy and art arrive rendered from the server; this only tracks which pillar
 * is on. Without scripts the first pillar is on and the stack stands in order.
 */

export type ProofPillar = {
  key: string;
  label: string;
  title: string;
  body: string;
  art: ReactNode;
  plateBg: string;
  caption: string;
};

export function ProofStack({
  intro,
  pillars,
  stylised,
  stageLabel
}: {
  /** The left column's heading block (hint, h2, lede), server-rendered. */
  intro: ReactNode;
  pillars: readonly ProofPillar[];
  stylised: string;
  stageLabel: string;
}) {
  const [on, setOn] = useState(0);
  const list = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    const ol = list.current;
    if (!ol || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setOn(Number((e.target as HTMLElement).dataset.i ?? 0));
        });
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    ol.querySelectorAll(".pillar").forEach((p) => io.observe(p));
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div className="pf-left">
        {intro}
        <ol className="pillars" ref={list}>
          {pillars.map((p, i) => (
            <li key={p.key} className={i === on ? "pillar on" : "pillar"} data-i={i}>
              <p className="pl-k">
                <span className="pl-n" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="hand">{p.label}</span>
              </p>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
              <div className="mini" style={{ background: p.plateBg }}>
                {p.art}
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="proof-stage" role="img" aria-label={stageLabel}>
        {pillars.map((p, j) => (
          <div key={p.key} className="plate" data-pos={j < on ? "-1" : String(j - on)} style={{ background: p.plateBg }}>
            {p.art}
            <div className="plate-cap">
              <span>{p.caption}</span>
              <span>{stylised}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
