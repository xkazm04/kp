"use client";

// `?v=split` — the round-2 baseline the owner picked, with every round-3 CORE improvement
// flowing through (insight card, quiet row acts, title-named views, one control language,
// motion presets) and no finish of its own: the hooks' defaults (finish.css).
import type { VariantProps } from "../../variantProps";
import { SplitLayout } from "./SplitLayout";

export default function SplitVariant(props: VariantProps) {
  return <SplitLayout {...props} />;
}
