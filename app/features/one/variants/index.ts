// The directions, lazy-loaded so a direction's code ships only when it is the one on
// screen. Round 4: `dense` is the round-3 pick (the baseline); `workbench`, `sheets` and
// `cards` are three LAYOUTS of the round-4 tools, each owned by its folder
// (`./<id>/<Id>Variant.tsx`, default export, `VariantProps` in) — the map never needs
// editing, so the layout builders never touch the same line.
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { VariantId } from "../types";
import type { VariantProps } from "../variantProps";

export const VARIANTS: Record<VariantId, ComponentType<VariantProps>> = {
  dense: dynamic(() => import("./dense/DenseVariant")),
  workbench: dynamic(() => import("./workbench/WorkbenchVariant")),
  sheets: dynamic(() => import("./sheets/SheetsVariant")),
  cards: dynamic(() => import("./cards/CardsVariant")),
};
