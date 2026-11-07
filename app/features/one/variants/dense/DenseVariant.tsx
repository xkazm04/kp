"use client";

// `?v=dense` — the "dense" FINISH of the Split layout (compact, keyboard-first). Round 3 stub: the shared
// SplitLayout under `data-finish="dense"`, so the finish's block in finish.css and its motion
// flavor (motion.ts FLAVOR_OF) already apply. The finish builder owns this folder and may
// fork SplitLayout here to diverge in markup, spacing and motion — never in layout.
import type { VariantProps } from "../../variantProps";
import { SplitLayout } from "../split/SplitLayout";

export default function DenseVariant(props: VariantProps) {
  return <SplitLayout {...props} finish="dense" />;
}
