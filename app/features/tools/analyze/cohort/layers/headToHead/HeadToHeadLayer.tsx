"use client";

// STUB (spark analyze-v2-cohort round 2): the HeadToHead structure of the nested dimension layer.
// Its builder replaces the body; keep the export name and DimensionLayerProps.
import type { DimensionLayerProps } from "../../cohortTypes";

export function HeadToHeadLayer({ dimension, view }: DimensionLayerProps) {
  return <div data-cohort-layer="headToHead" data-dimension={dimension} data-members={view.members.length} />;
}
