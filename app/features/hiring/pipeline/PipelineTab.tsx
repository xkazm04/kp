"use client";

import { PipelineOrbitView } from "./orbit/PipelineOrbitView";

/*
 * Hiring > Pipeline is the Orbit (orbit/PipelineOrbitView.tsx): the /contest pipeline-l0-l1 winner,
 * promoted 2026-09-28 in place of the kit roles board.
 *
 * A static import, not next/dynamic: this module IS the tab's lazy chunk (shell/tabChunks.ts), so a
 * second dynamic boundary would only add a chunk round-trip and a loading placeholder between the tab
 * click and the first frame. The candidate record stays split out inside the view.
 */
export function PipelineTab() {
  return <PipelineOrbitView />;
}
