"use client";

import type { ReactNode } from "react";

/*
 * Pieces every scene repeats, hoisted the moment a second chapter needed them.
 *
 * The status line is part of the deck's contract, not decoration: each scene
 * carries exactly ONE line of monospace text under the field, phase-mapped,
 * naming what the machine is doing in its own vocabulary. The picture carries
 * the shape of the mechanism; the line carries the identifier a sceptical
 * reader could go and grep for. Keeping it to one line is what stops these
 * scenes from growing captions that explain the animation instead of the
 * mechanism.
 */

/**
 * The phase → text lookup, re-exported so scenes keep one import.
 *
 * It moved to `scenes/status.ts` when it earned a test: it is pure, six scenes
 * depend on it, and the node test runner cannot load a TSX file. Everything
 * else in this file needs React, which is why only this one left.
 */
export { statusPicker } from "./status";

/**
 * The status line itself.
 *
 * Crossfades on change via a CSS transition on a keyed span rather than
 * `AnimatePresence`: the text is replaced in place, nothing needs to animate
 * out, and a JS presence wrapper here would be a third animation system in a
 * scene that already has two.
 */
export function SceneStatus({ text, reduced }: { phase: number; text: string; reduced: boolean }) {
  return (
    <p className="mt-4 min-h-[1.5rem] font-mono text-meta text-steel">
      <span
        key={text}
        className="inline-block"
        style={{
          animation: reduced ? undefined : "fade-in 320ms ease-out both",
        }}
      >
        {text}
      </span>
    </p>
  );
}

/** A lane's human name — uppercase tracking reads as a section marker. */
export function LaneLabel({ children }: { children: ReactNode }) {
  return <p className="text-meta uppercase tracking-wide text-steel">{children}</p>;
}

/**
 * A lane labelled by its real code identifier.
 *
 * Deliberately NOT uppercased: `statedVsRealGaps` shouted as STATEDVSREALGAPS
 * loses the camel case that makes it greppable, which is the only reason to
 * print an identifier at all.
 *
 * The identifier arrives as the `code` PROP rather than as children, and that
 * is a statement about localization rather than a styling choice. These strings
 * are function and column names in the running code; they are Do-Not-Translate
 * by the same rule that protects product nouns and ICU placeholders, and
 * putting them in the message catalog would invite four translators to render
 * `ko_filter()` four different ways. Passing them as a prop keeps them out of
 * the catalog and out of the i18n linter's path at the same time.
 *
 * `children` stays available for the rare label that IS prose and should come
 * from `t()`.
 */
export function CodeLabel({ code, children }: { code?: string; children?: ReactNode }) {
  return <p className="truncate font-mono text-meta text-steel">{code ?? children}</p>;
}

/**
 * A weight/score bar that grows from its left edge.
 *
 * CSS, not framer: these appear a dozen at a time inside scenes that re-render
 * every 900ms, and a JS-driven animation per bar is both wasteful and — as the
 * chapter-1 cascade bug showed — fragile under that much re-rendering.
 */
export function Bar({
  value,
  shown,
  reduced,
  tone = "moss",
  className = "",
}: {
  /** 0..1 */
  value: number;
  shown: boolean;
  reduced: boolean;
  tone?: "moss" | "amber" | "coral" | "steel";
  className?: string;
}) {
  const fill = {
    moss: "bg-moss",
    amber: "bg-dial-amber",
    coral: "bg-coral",
    steel: "bg-steel",
  }[tone];
  return (
    <span className={`block h-1.5 overflow-hidden rounded-full bg-stone-100 ${className}`}>
      <span
        className={`block h-full rounded-full ${fill}`}
        style={{
          width: shown ? `${Math.round(value * 100)}%` : "0%",
          transition: reduced ? "none" : "width 560ms cubic-bezier(0.16,1,0.3,1)",
        }}
      />
    </span>
  );
}
