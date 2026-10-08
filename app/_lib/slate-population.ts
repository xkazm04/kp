/** ADR-0012 — the two populations that can appear on one role's slate. */
export const SLATE_POPULATIONS = ["human", "agent"] as const;
export type SlatePopulation = (typeof SLATE_POPULATIONS)[number];

/** Narrow the free-form TEXT column at the read boundary. An unrecognized value
 *  reads as 'human' (the column default) rather than throwing. */
export function coerceSlatePopulation(value: unknown): SlatePopulation {
  return value === "agent" ? "agent" : "human";
}

/** True for an AI-agent slate entry. Machines never count one as a hire. */
export function isAgentPopulation(entry: { population?: string | null }): boolean {
  return entry.population === "agent";
}

/** SQL twin of `isAgentPopulation`, negated (column is NOT NULL DEFAULT 'human'). */
export function notAgentSql(alias = ""): string {
  return `${alias}population <> 'agent'`;
}
