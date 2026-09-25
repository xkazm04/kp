"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SieveFrame, type RailStep } from "./SieveFrame";

// The frame for the two pages beside the flow — custom boards and extraction rules
// (/me/sources) and scan history (/me/scans). Same top bar, same step rail, so the
// seeker never leaves the flow's map; the steps are links back into /me, and the page
// being shown is marked in the rail's links. The steps carry no live counts here — those
// are derived from the rows, and this page does not page them in.
export function SieveSideFrame({ page, children }: { page: "sources" | "scans"; children: ReactNode }) {
  const t = useTranslations("me.sieve.rail");
  const ids = ["arrive", "cv", "you", "want", "sieve", "evening", "weigh", "sources"] as const;
  const steps: RailStep[] = ids.map((id) => ({ id, anchor: `s-${id}`, label: t(id), count: "", state: "reached" }));
  return (
    <SieveFrame who={null} tally={null} steps={steps} active={null} hrefBase="/me" page={page}>
      <div className="frame-main">{children}</div>
    </SieveFrame>
  );
}
