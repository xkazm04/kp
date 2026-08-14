"use client";

import { useState } from "react";
import { VariantSwitcher } from "../VariantSwitcher";
import { ScoringCeilings } from "./ScoringCeilings";
import { ScoringProvenance } from "./ScoringProvenance";
import { ScoringBuckets } from "./ScoringBuckets";

/* PROTOTYPE SCAFFOLD — deleted once a direction wins (see scenes/jd/index.tsx). */

type Variant = "ceilings" | "provenance" | "buckets";

const OPTIONS = [
  { value: "ceilings" as const, label: "A · Ceilings", blurb: "The total is arithmetic, not a verdict." },
  { value: "provenance" as const, label: "B · Provenance", blurb: "The same word, worth different amounts." },
  { value: "buckets" as const, label: "C · Buckets", blurb: "Matched, unproven, missing — and why." },
];

export function ScoringScene() {
  const [variant, setVariant] = useState<Variant>("ceilings");
  return (
    <div>
      <VariantSwitcher label="Chapter 2 direction" options={OPTIONS} value={variant} onChange={setVariant} />
      {variant === "ceilings" ? <ScoringCeilings /> : null}
      {variant === "provenance" ? <ScoringProvenance /> : null}
      {variant === "buckets" ? <ScoringBuckets /> : null}
    </div>
  );
}
