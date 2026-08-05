/*
 * The Responsible-AI story registry.
 *
 * Four pillars, one illustration each, wired to the key its tab uses in the
 * #trust band. Same shape as ../previews/index.ts: this file only pairs a key
 * with an accent and an animated body — every visible string resolves through
 * `landing.trust.*` alongside the component that renders it.
 */
import type { ComponentType } from "react";
import { AMBER, CORAL, MOSS, STEEL } from "../tokens";
import HumanLoopArt from "./HumanLoopArt";
import OversightArt from "./OversightArt";
import GdprArt from "./GdprArt";
import AuditArt from "./AuditArt";

export type TrustKey = "human" | "oversight" | "gdpr" | "audit";

// Order is the argument's order: the human gate is the claim everything else
// qualifies, so it leads and is the tab open on arrival. Accents are the four
// brand hues, one each, so a tab's dot identifies its story at a glance.
export const TRUST_PILLARS = [
  { key: "human", color: CORAL, Art: HumanLoopArt },
  { key: "oversight", color: AMBER, Art: OversightArt },
  { key: "gdpr", color: STEEL, Art: GdprArt },
  { key: "audit", color: MOSS, Art: AuditArt }
] as const satisfies ReadonlyArray<{ key: TrustKey; color: string; Art: ComponentType }>;
