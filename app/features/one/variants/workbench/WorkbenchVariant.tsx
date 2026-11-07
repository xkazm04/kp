"use client";

// `?v=workbench` — round 4. Pressing a person splits the page: their workbench (Profile ·
// Email · Interview) on the left, the role-grouped list on the right; Letters and Calendar
// open on the left as desks. Layout only — WorkbenchLayout.tsx (a fork of Dense).
import type { VariantProps } from "../../variantProps";
import { WorkbenchLayout } from "./WorkbenchLayout";

export default function WorkbenchVariant(props: VariantProps) {
  return <WorkbenchLayout {...props} />;
}
