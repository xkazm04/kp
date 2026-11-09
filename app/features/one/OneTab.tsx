"use client";

// One as a workspace tab (`/?tab=one`, round 5 — docs/design/one-interface.md "The tab").
// The same OneShell as `/one`, in the `tab` frame: no brand, no Console link (the workspace
// IS the console), and it fills the tab panel instead of the viewport.
//
// The workspace's content frame is content-sized (Workspace.tsx: `py-8 pb-24` around the
// panel), so the panel has no height of its own to fill. From lg this box takes the viewport
// less the frame's top padding (2rem) and less whichever is taller at the foot: the frame's
// 6rem, or the fixed simulation dock's live strip (`--sim-bar-h`, published by the dock —
// globals.css), so One's composer is never under the raised dock. The document stays one
// viewport tall (no page scroll; the sheets and lists scroll inside). Below lg One flows and
// the page scrolls, as on `/one`. Change the frame's padding and this calc changes with it.
import { OneShell } from "./OneShell";

export function OneTab() {
  return (
    <div className="flex flex-col lg:h-[calc(100dvh-2rem-max(6rem,var(--sim-bar-h)))]" data-role="one-tab">
      <OneShell frame="tab" />
    </div>
  );
}
