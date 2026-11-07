"use client";

// `?v=cards` — round 4, the ANSWER CARDS layout (docs/design/one-interface.md "Round 4
// variants"): conversation-led, the answer's card in the main column IS the tool. Letters
// waiting → a letter card; the calendar → a scheduling card; a person picked from any list →
// their card (profile, letter or interview face), with Expand to a full-width two-half pane.
// Forked from the Dense layout (CardsLayout.tsx); it keeps the dense finish and keys.
import type { VariantProps } from "../../variantProps";
import { CardsLayout } from "./CardsLayout";

export default function CardsVariant(props: VariantProps) {
  return <CardsLayout {...props} />;
}
