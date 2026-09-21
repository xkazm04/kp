// Assumed-fact chips for a campaign pack's `defaultedFields` list. The pack
// already withholds those phantoms from the copy; this is the honesty line that
// names which facts the studio invented (medior / Praha) so a recruiter copying
// the pack onto a board can tell assumed from missing. Pure so a .tsx panel is
// not required to pin the two fixtures.

export const CAMPAIGN_DEFAULTED_KNOWN = [
  "company",
  "location",
  "work_mode",
  "seniority",
  "salary_band",
] as const;

export type CampaignDefaultedKnown = (typeof CAMPAIGN_DEFAULTED_KNOWN)[number];

export type CampaignDefaultedChip =
  | { slug: CampaignDefaultedKnown; kind: "known" }
  | { slug: string; kind: "generic" };

const KNOWN = new Set<string>(CAMPAIGN_DEFAULTED_KNOWN);

/** Chips to paint under the pack warnings. `[]` paints none; unknown slugs use
 *  the generic "assumed {field}" key rather than being dropped. */
export function campaignDefaultedChips(fields: unknown): CampaignDefaultedChip[] {
  if (!Array.isArray(fields)) return [];
  const out: CampaignDefaultedChip[] = [];
  const seen = new Set<string>();
  for (const raw of fields) {
    if (typeof raw !== "string") continue;
    const slug = raw.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(KNOWN.has(slug) ? { slug: slug as CampaignDefaultedKnown, kind: "known" } : { slug, kind: "generic" });
  }
  return out;
}

/** Localized labels for the chips. `t` is a `jobs.campaign.defaulted` translator. */
export function campaignDefaultedLabels(
  fields: unknown,
  t: (key: string, values?: { field: string }) => string
): string[] {
  return campaignDefaultedChips(fields).map((chip) =>
    chip.kind === "known" ? t(chip.slug) : t("generic", { field: chip.slug })
  );
}
