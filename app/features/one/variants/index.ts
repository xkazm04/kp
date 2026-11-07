// The layout directions, lazy-loaded so a direction's code ships only when it is the one
// on screen. Each builder REPLACES its own file (`./<id>/<Id>Variant.tsx`, default
// export, `VariantProps` in) — the map itself never needs editing, so the three builders
// never touch the same line.
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { VariantId } from "../types";
import type { VariantProps } from "../variantProps";

export const VARIANTS: Record<VariantId, ComponentType<VariantProps>> = {
  greet: dynamic(() => import("./greet/GreetVariant")),
  stage: dynamic(() => import("./stage/StageVariant")),
  brief: dynamic(() => import("./brief/BriefVariant")),
};
