"use client";

import { useState } from "react";
import { VariantSwitcher } from "../VariantSwitcher";
import { ScreeningLadder } from "./ScreeningLadder";
import { ScreeningClamp } from "./ScreeningClamp";
import { ScreeningToken } from "./ScreeningToken";

/* PROTOTYPE SCAFFOLD — deleted once a direction wins (see scenes/jd/index.tsx). */

type Variant = "ladder" | "clamp" | "token";

const OPTIONS = [
  { value: "ladder" as const, label: "A · Cost ladder", blurb: "The paid step runs last, on eight people." },
  { value: "clamp" as const, label: "B · The clamp", blurb: "The model gives an opinion, not a decision." },
  { value: "token" as const, label: "C · Approval token", blurb: "You approved a set, not a rule." },
];

export function ScreeningScene() {
  const [variant, setVariant] = useState<Variant>("ladder");
  return (
    <div>
      <VariantSwitcher label="Chapter 3 direction" options={OPTIONS} value={variant} onChange={setVariant} />
      {variant === "ladder" ? <ScreeningLadder /> : null}
      {variant === "clamp" ? <ScreeningClamp /> : null}
      {variant === "token" ? <ScreeningToken /> : null}
    </div>
  );
}
