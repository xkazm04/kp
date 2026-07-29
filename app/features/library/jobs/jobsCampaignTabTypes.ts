// Wire types + label-key maps for JobsCampaignTab.tsx — extracted verbatim so
// the tab file stays under the 200-line split threshold.

export type VideoScript = { hook: string; offer: string; proof: string; cta: string };
// variantId/applyUrl are written by campaign.py (E5 per-variant &v= attribution).
// Both are optional so packs generated BEFORE per-variant links existed still type
// and render (no tracked-link row, no broken URL).
export type Variant = {
  hookType: string;
  hook: string;
  adCopy: string;
  videoScript: VideoScript;
  variantId?: string;
  applyUrl?: string;
};
export type Pack = { variants?: Variant[]; warnings?: string[]; applyUrl?: string; language?: string };
export type PackRecord = { jobId: string; lang: string; payload: Pack; source: string; createdAt: string };

// Canonical wire codes → catalog keys. Kept as an explicit map (not string
// interpolation into t()) so next-intl's typed keys stay checkable.
export const HOOK_LABEL_KEY = {
  number: "hookNumber",
  location: "hookLocation",
  problem: "hookProblem",
  skills: "hookSkills",
} as const;
export const WARN_KEY = {
  no_salary: "warnNoSalary",
  no_location: "warnNoLocation",
  no_skills: "warnNoSkills",
} as const;

export const BEATS = [
  ["hook", "beatHook"],
  ["offer", "beatOffer"],
  ["proof", "beatProof"],
  ["cta", "beatCta"],
] as const;

export function isHookType(v: string): v is keyof typeof HOOK_LABEL_KEY {
  return v in HOOK_LABEL_KEY;
}
