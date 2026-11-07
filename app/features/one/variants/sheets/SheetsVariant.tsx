"use client";

// `?v=sheets` — the round-4 slide-over SHEETS layout: the Dense page, every tool a sheet over
// the main column (SheetsLayout.tsx; the stack rules in stack.ts).
import type { VariantProps } from "../../variantProps";
import { SheetsLayout } from "./SheetsLayout";

export default function SheetsVariant(props: VariantProps) {
  return <SheetsLayout {...props} />;
}
