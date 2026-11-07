"use client";

// `?v=spark` — the "spark" FINISH of the Split layout: bold landing stickers, springy
// (SparkLayout.tsx, the finish's block in finish.css, motion.ts's spring flavor + ./motion.ts).
import type { VariantProps } from "../../variantProps";
import { SparkLayout } from "./SparkLayout";

export default function SparkVariant(props: VariantProps) {
  return <SparkLayout {...props} finish="spark" />;
}
