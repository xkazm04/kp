"use client";

import type { ReactNode } from "react";
import { Button } from "@/app/_components/kit";
import type { Crumb } from "@/app/_components/kit/scene";

/**
 * The way back at a level, in the winner's form: the back button naming where it goes, the breadcrumb, then this
 * level's own position and sideways steps (`children`). The kit's LevelTrail has the same markup without the extras
 * slot; the back button carries `data-level-key="back"` so a sideways step that kept focus on it finds it again.
 */
export function WorkforceTrail({ crumbs, onBack, backLabel, label, children }: {
  crumbs: readonly Crumb[];
  onBack: () => void;
  backLabel: string;
  label: string;
  children?: ReactNode;
}) {
  const parent = crumbs[crumbs.length - 2];
  return (
    <div className="k-lvl__bar k-trail">
      {parent ? <Button label={backLabel} icon="left" size="sm" onClick={onBack} data-level-key="back" /> : null}
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
      {children}
    </div>
  );
}
