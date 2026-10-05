"use client";

import { Button } from "../Button";
import "./scene.css";

/** One step of a trail: its words, and how to return to it (none for the current level). */
export type Crumb = { label: string; onSelect?: () => void };

/**
 * @catalog The visible way back at every level below the top: a back button that names where it goes, then the breadcrumb (every step but the last is a button; the last is the current page).
 *
 * Copy-free: the caller passes `backLabel` ("Back to {place}", with the parent crumb's label) and
 * `label` (the breadcrumb's accessible name) in the reader's language. The back button carries
 * `data-level-key="back"`, so a sideways step that keeps focus on it finds it again.
 */
export function LevelTrail({ crumbs, onBack, backLabel, label }: {
  crumbs: readonly Crumb[];
  onBack: () => void;
  /** The back button's words; only shown when there is a level to go back to. */
  backLabel: string;
  /** The breadcrumb's accessible name ("Where you are"). */
  label: string;
}) {
  const parent = crumbs[crumbs.length - 2];
  return (
    <div className="k-trail">
      {parent ? <Button label={backLabel} icon="left" onClick={onBack} data-level-key="back" /> : null}
      <nav aria-label={label} className="k-crumbs">
        <ol>
          {crumbs.map((c, i) => (
            <li key={`${i}-${c.label}`}>
              {i === crumbs.length - 1 || !c.onSelect ? (
                <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>
              ) : (
                <Button label={c.label} variant="link" onClick={c.onSelect} />
              )}
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
