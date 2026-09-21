"use client";

import type { ReactNode } from "react";
import { PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { GLYPH_SIZE } from "@/app/_components/glyph/glyphSizes";
import { JOBS_GLYPH } from "@/app/_components/glyph/glyphs/jobsGlyph";

// The feed's chain-aware empty state, in the house empty-state register.
//
// It is `ChainEmptyState`'s layout — recessed `PANEL_SUNKEN` well, centred, a traced
// /motionize glyph that draws itself, one semibold line, one quiet body line, the ONE
// next step underneath — but not `ChainEmptyState` itself: that component navigates by
// `WorkspaceTabId` through `buildTabSwitchUrl`, and /me is not the workspace SPA. Its
// next steps are ordinary routes (`/me`, `/me/sources`) and, for two of the five
// states, not a link at all but the scan door. So the CTA is a slot, and the layout is
// inherited rather than re-invented.
//
// The glyph is the Jobs mark already traced for `JobsEmptyLaunchpad` — the recruiter
// side's "no jobs yet" surface. Reusing it is deliberate: the seeker's empty feed and
// the recruiter's empty job list are the same sentence on two sides of the product,
// and nothing here generates new art.
//
// `data-empty-state` stays on the outer element: it is the hook the keyless e2e spec
// reads to assert WHICH link of the chain is being named.

export function FeedEmptyState({ state, title, body, cta }: { state: string; title: string; body: string; cta?: ReactNode }) {
  return (
    <section className={`${PANEL_SUNKEN} p-6 text-center`} data-empty-state={state}>
      <MotionizedGlyph data={JOBS_GLYPH.data} viewBox={JOBS_GLYPH.viewBox} className={`mx-auto ${GLYPH_SIZE.lg}`} />
      <h2 className="mt-2 text-base font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-1 max-w-prose text-sm text-steel">{body}</p>
      {cta ? <div className="mt-4 flex flex-col items-center gap-2">{cta}</div> : null}
    </section>
  );
}
