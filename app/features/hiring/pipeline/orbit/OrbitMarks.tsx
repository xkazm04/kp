"use client";

import type { ReactElement } from "react";
import type { Absence, OrbitPerson } from "./orbitModel";
import { kindOf } from "./orbitLayout";

export type OrbitMarkKind = "needs" | "late" | "moving" | "quiet" | Absence;

/** The winner's shape vocabulary: a diamond needs a human, a triangle is late, a square is an empty role. */
const PATHS: Record<OrbitMarkKind, ReactElement> = {
  needs: <path d="M8 1.2 14.8 8 8 14.8 1.2 8Z" fill="currentColor" />,
  late: <path d="M8 2.2 14.6 13.6H1.4Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  moving: <circle cx="8" cy="8" r="5" fill="currentColor" />,
  quiet: <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" />,
  draft: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
      <path d="M4.5 11.5 11.5 4.5" stroke="currentColor" strokeWidth="1.5" />
    </>
  ),
  vacant: <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />,
};

/** A 16px shape mark. Decorative unless `label` names it (then it is an image with that name). */
export function OrbitMark({ kind, label, small = false }: { kind: OrbitMarkKind; label?: string; small?: boolean }) {
  return (
    <span className={`ob-mk ob-mk--${kind}${small ? " is-sm" : ""}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 16 16">{PATHS[kind]}</svg>
    </span>
  );
}

/** One person as a bead: the orbit's dot, in the DOM (the flight lands on it by `data-p`). */
export function Bead({ p, as = "i" }: { p: OrbitPerson; as?: "i" | "span" }) {
  const Tag = as;
  return <Tag className={`ob-bd ob-bd--${kindOf(p)}${p.walked ? "" : " is-placed"}`} data-p={p.id} aria-hidden />;
}

/** A legend bead (no person). */
export function LegendBead({ kind, placed = false }: { kind: "w" | "a" | "h" | "q"; placed?: boolean }) {
  return <i className={`ob-bd ob-bd--${kind}${placed ? " is-placed" : ""}`} aria-hidden />;
}

/** The quiet middle dot between two facts on one line (drawn by CSS, so no literal sits in the markup). */
export function Sep() {
  return <span className="ob-sep" aria-hidden />;
}
