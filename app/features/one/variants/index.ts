// The directions, lazy-loaded so a direction's code ships only when it is the one on
// screen. Round 3: `split` is the round-2 baseline; `refined`, `spark` and `dense` are
// three FINISHES of the same Split layout, each owned by its folder
// (`./<id>/<Id>Variant.tsx`, default export, `VariantProps` in) — the map never needs
// editing, so the finish builders never touch the same line.
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { VariantId } from "../types";
import type { VariantProps } from "../variantProps";

export const VARIANTS: Record<VariantId, ComponentType<VariantProps>> = {
  split: dynamic(() => import("./split/SplitVariant")),
  refined: dynamic(() => import("./refined/RefinedVariant")),
  spark: dynamic(() => import("./spark/SparkVariant")),
  dense: dynamic(() => import("./dense/DenseVariant")),
};
