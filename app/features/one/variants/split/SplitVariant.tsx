"use client";

// Round-2 placeholder for the "split" direction: the shared core's reference layout until the
// split builder replaces this file (default export, VariantProps in).
import type { VariantProps } from "../../variantProps";
import { PlaceholderLayout } from "../PlaceholderLayout";

export default function SplitVariant(props: VariantProps) {
  return <PlaceholderLayout {...props} />;
}
