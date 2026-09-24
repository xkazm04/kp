import { snapshot, type MapMetric } from "./data";

export type MarketMapSelection = { region: string; metric: MapMetric };

/** Accept only regions present in the committed snapshot and known metrics. */
export function marketMapSelection(region: unknown, metric: unknown): MarketMapSelection {
  return {
    region: typeof region === "string" && snapshot.regions.some((entry) => entry.code === region) ? region : "CZ010",
    metric: metric === "salary" ? "salary" : "volume",
  };
}
