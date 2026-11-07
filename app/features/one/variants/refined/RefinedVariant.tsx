"use client";

// `?v=refined` — the "refined" FINISH of the Split layout (calm editorial). The layout is
// forked into this folder (RefinedLayout) for its type, spacing and motion; the hooks live
// in finish.css `[data-finish="refined"]`. Never a different layout.
import type { VariantProps } from "../../variantProps";
import { RefinedLayout } from "./RefinedLayout";

export default function RefinedVariant(props: VariantProps) {
  return <RefinedLayout {...props} />;
}
