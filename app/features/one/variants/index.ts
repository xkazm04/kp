// The layout directions, lazy-loaded so a direction's code ships only when it is the one
// on screen. Each builder REPLACES its own file (`./<id>/<Id>Variant.tsx`, default
// export, `VariantProps` in) — the map itself never needs editing, so the builders
// never touch the same line.
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { HeaderSize } from "../OneHeader";
import type { VariantId } from "../types";
import type { VariantProps } from "../variantProps";

export const VARIANTS: Record<VariantId, ComponentType<VariantProps>> = {
  greet: dynamic(() => import("./greet/GreetVariant")),
  split: dynamic(() => import("./split/SplitVariant")),
  spotlight: dynamic(() => import("./spotlight/SpotlightVariant")),
  ticker: dynamic(() => import("./ticker/TickerVariant")),
};

/** The header each layout asks the shell for: inline stats, or big stat tiles. */
export const HEADER_SIZE: Record<VariantId, HeaderSize> = {
  greet: "compact",
  split: "compact",
  spotlight: "compact",
  ticker: "hero",
};
