"use client";

// `?v=refined` — the "refined" FINISH of the Split layout (calm editorial). Round 3 stub: the shared
// SplitLayout under `data-finish="refined"`, so the finish's block in finish.css and its motion
// flavor (motion.ts FLAVOR_OF) already apply. The finish builder owns this folder and may
// fork SplitLayout here to diverge in markup, spacing and motion — never in layout.
import type { VariantProps } from "../../variantProps";
import { SplitLayout } from "../split/SplitLayout";

export default function RefinedVariant(props: VariantProps) {
  return <SplitLayout {...props} finish="refined" />;
}
