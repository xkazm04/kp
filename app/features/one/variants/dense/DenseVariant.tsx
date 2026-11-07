"use client";

// `?v=dense` — the "dense" FINISH of the Split layout (compact, keyboard-first): Split's
// regions, forked into DenseLayout for one-line 36px rows, an h2 reply, a narrower main
// column and the page keys (/ composer, [ ] answers, Esc / ↓ to the list). Hooks in the
// `[data-finish="dense"]` block of finish.css; motion is the `snap` flavor (FLAVOR_OF).
import type { VariantProps } from "../../variantProps";
import { DenseLayout } from "./DenseLayout";

export default function DenseVariant(props: VariantProps) {
  return <DenseLayout {...props} />;
}
