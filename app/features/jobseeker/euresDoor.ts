"use client";

import type { JobseekerProfile } from "@/app/_lib/jobseeker/types";
import { euresCountries } from "./feedModel";
import { callJson, type ApiFailure } from "./sourcesApi";

// The ONE derivation behind both doors that switch EURES on — the feed's one-click
// EnableEuresButton and the EURES card on the Sources step. EURES searches the
// seeker's own `preferences.countries` (adapters/eures.ts), and an empty list is a
// query for nothing: the adapter now refuses it (config_invalid) rather than run
// empty. So a door that switches EURES on with no country set WRITES the country it
// names, and says so — the sentence beside the control is the query the scan sends.

export type EuresCountryPlan = {
  /** The markets EURES will be asked for (ISO-2 lower, deduplicated). */
  countries: string[];
  /** True when the seeker named none, so the door must write `countries` first. */
  defaulted: boolean;
  /** The countries as the seeker reads them ("CZ, DE"). */
  label: string;
};

export function euresCountryPlan(countries: readonly string[] | null | undefined): EuresCountryPlan {
  const wanted = euresCountries(countries);
  const defaulted = (countries ?? []).every((c) => !c.trim());
  return { countries: wanted, defaulted, label: wanted.map((c) => c.toUpperCase()).join(", ") };
}

/** Write the plan's countries onto the profile when it defaulted; a plan the seeker
 *  already owns is never overwritten. `profile` is null when nothing was written. */
export async function saveEuresCountries(plan: EuresCountryPlan): Promise<{ ok: true; profile: JobseekerProfile | null } | { ok: false; fail: ApiFailure }> {
  if (!plan.defaulted) return { ok: true, profile: null };
  const saved = await callJson<JobseekerProfile>("/api/jobseeker/profile", { method: "PUT", body: JSON.stringify({ preferences: { countries: plan.countries } }) });
  return saved.ok ? { ok: true, profile: saved.body } : { ok: false, fail: saved.fail };
}

/** Read the seeker's countries from the server, for a door that was not handed them. */
export async function readPreferredCountries(): Promise<{ ok: true; countries: string[] } | { ok: false; fail: ApiFailure }> {
  const read = await callJson<JobseekerProfile>("/api/jobseeker/profile");
  return read.ok ? { ok: true, countries: read.body.preferences?.countries ?? [] } : { ok: false, fail: read.fail };
}

const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** The source a running scan is reading, by name. The scan reports the HOST of the
 *  source it is acquiring as its progress message (scan.ts), and phase codes
 *  ("structure", "match", …) after that — those are not sources, so they name none. */
export function scanningSourceName(catalog: readonly { host: string; label: string }[], progressMsg: string | null | undefined): string | null {
  const host = (progressMsg ?? "").trim().toLowerCase();
  if (!HOST_RE.test(host)) return null;
  const entry = catalog.find((e) => e.host === host) ?? catalog.find((e) => host.endsWith(`.${e.host}`));
  return entry ? entry.label.split(" (")[0]! : host;
}
