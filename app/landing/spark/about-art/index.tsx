"use client";

/*
 * The /about step illustrations — one module per pipeline phase.
 *
 * These were a single 416-line aboutIllustrations.tsx whose in-art micro-labels
 * were all hardcoded English, on the (then-reasonable) grounds that they were
 * stylised mockups. /about is now a real indexed public page served in four
 * languages, so those labels live in `aboutPage.art.*` alongside the rest of
 * the page's copy. What genuinely should not translate stayed put and is
 * commented as such: fictional candidate names, technology names, and the
 * illustrative numbers.
 */
import type { ComponentType } from "react";
import DesignArt from "./DesignArt";
import SourceArt from "./SourceArt";
import IntakeArt from "./IntakeArt";
import ScreenArt from "./ScreenArt";
import InterviewArt from "./InterviewArt";
import OfferArt from "./OfferArt";
import HiredArt from "./HiredArt";
import type { AboutStepKey } from "./shared";

export type { AboutStepKey };

const ART: Record<AboutStepKey, ComponentType<{ color?: string }>> = {
  design: DesignArt,
  source: SourceArt,
  intake: IntakeArt,
  screen: ScreenArt,
  interview: InterviewArt,
  offer: OfferArt,
  hired: HiredArt
};

/** Dispatch a pipeline phase to its illustration. */
export function StepArt({ stepKey, color }: { stepKey: AboutStepKey; color: string }) {
  const Art = ART[stepKey];
  return <Art color={color} />;
}
