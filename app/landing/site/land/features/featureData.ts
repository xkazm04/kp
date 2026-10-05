import { PREVIEW_KEYS, type PreviewKey } from "@/app/landing/spark/previews/order";

/*
 * The nine features as data: the prototype's FEATURES (land/art.js), minus its
 * copy. The ORDER is PREVIEW_KEYS (app/landing/spark/previews/order.ts): the
 * funnel order the ring draws, the stepper walks and `/#spotlight-<key>`
 * addresses, pinned by order.test.ts. This file only pairs a key with its scene
 * colours (ground, deep, soft) and says which right-hand panel it shows.
 *
 * Copy lives in the catalog: name and body are today's `landing.features.<key>.*`
 * (verbatim the prototype's), the one-line pitch and the three "Look closer"
 * pins are `siteFeatures.items.<key>.*`.
 */
export type FeatureKey = PreviewKey;

type Palette = { ground: string; deep: string; soft: string };

const PALETTE: Record<FeatureKey, Palette> = {
  inbox: { ground: "#3b7f7d", deep: "#245250", soft: "#a9d2cc" },
  score: { ground: "#526b4f", deep: "#34482f", soft: "#c5d8b8" },
  rediscover: { ground: "#8fa39a", deep: "#566a61", soft: "#dbe6df" },
  voice: { ground: "#d65a4a", deep: "#8f3529", soft: "#f3b5a9" },
  cases: { ground: "#7a5478", deep: "#4a2f49", soft: "#e0c4de" },
  schedule: { ground: "#4f6d8f", deep: "#2f435c", soft: "#bcd0e6" },
  salary: { ground: "#c9a13f", deep: "#8a6b18", soft: "#f1dc9d" },
  offer: { ground: "#9c3d3a", deep: "#5f2020", soft: "#efb3ad" },
  gates: { ground: "#1d2a37", deep: "#0c141c", soft: "#8fa9bd" }
};

/** Which features take their right-hand panel from the console variant (B/3's
 *  mocks, redrawn in this page's language); the other three keep B/1's own. */
const CONSOLE_PANEL: ReadonlySet<FeatureKey> = new Set<FeatureKey>(["inbox", "voice", "cases", "salary", "offer", "gates"]);

export type Feature = Palette & { key: FeatureKey; n: number; console: boolean };

export const FEATURES: readonly Feature[] = PREVIEW_KEYS.map((key, i) => ({
  key,
  n: i + 1,
  console: CONSOLE_PANEL.has(key),
  ...PALETTE[key]
}));

export const FEATURE_COUNT = FEATURES.length;

/** "01" for the scene's count line. */
export function twoDigits(n: number): string {
  return String(n).padStart(2, "0");
}
