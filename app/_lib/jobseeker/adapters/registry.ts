// adapterFor(name): the closed vocabulary in types.ts → its implementation. Every
// name in SOURCE_ADAPTERS has an entry (pinned in adapters.test.ts), so a source row
// can always be run or refused with a reason, never dropped on the floor.

import type { SourceAdapterName } from "../types";
import { ashbyAdapter } from "./ats/ashby";
import { ASHBY_HOST } from "./ats/ashby";
import { greenhouseAdapter, GREENHOUSE_HOST } from "./ats/greenhouse";
import { leverAdapter, LEVER_EU_HOST, LEVER_HOST } from "./ats/lever";
import { personioAdapter, personioHost } from "./ats/personio";
import { recruiteeAdapter, recruiteeHost } from "./ats/recruitee";
import { smartrecruitersAdapter, SMARTRECRUITERS_HOST } from "./ats/smartrecruiters";
import { teamtailorAdapter, teamtailorHost } from "./ats/teamtailor";
import { workableAdapter, WORKABLE_HOST } from "./ats/workable";
import { arbeitnowAdapter, ARBEITNOW_HOST } from "./arbeitnow";
import { boardRulesAdapter } from "./boardRules";
import { boardSitemapJsonldAdapter } from "./boardSitemapJsonld";
import { euresAdapter } from "./eures";
import { mpsvBulkAdapter, MPSV_FULL_URL } from "./mpsvBulk";
import { cfg, safeSlug } from "./shared";
import type { SourceAdapter } from "./types";

const ADAPTERS: Record<SourceAdapterName, SourceAdapter> = {
  eures: euresAdapter,
  mpsv_bulk: mpsvBulkAdapter,
  ats_greenhouse: greenhouseAdapter,
  ats_lever: leverAdapter,
  ats_recruitee: recruiteeAdapter,
  ats_teamtailor: teamtailorAdapter,
  ats_personio: personioAdapter,
  ats_workable: workableAdapter,
  ats_ashby: ashbyAdapter,
  ats_smartrecruiters: smartrecruitersAdapter,
  board_sitemap_jsonld: boardSitemapJsonldAdapter,
  board_rules: boardRulesAdapter,
  arbeitnow: arbeitnowAdapter,
};

export function adapterFor(name: SourceAdapterName): SourceAdapter {
  return ADAPTERS[name];
}

/** The host a source with this adapter+config talks to (politeness is keyed by it).
 *  Null when the config lacks what the adapter needs — the route refuses the create. */
export function hostForAdapter(adapter: SourceAdapterName, config: Record<string, unknown>): string | null {
  const s = { config };
  switch (adapter) {
    case "eures":
      return "europa.eu";
    case "arbeitnow":
      return ARBEITNOW_HOST;
    case "mpsv_bulk": {
      const url = cfg(s, "url") ?? MPSV_FULL_URL;
      try {
        return new URL(url).host;
      } catch {
        return null;
      }
    }
    case "ats_greenhouse":
      return safeSlug(cfg(s, "token")) ? GREENHOUSE_HOST : null;
    case "ats_lever":
      return safeSlug(cfg(s, "site")) ? (config.eu === true ? LEVER_EU_HOST : LEVER_HOST) : null;
    case "ats_recruitee": {
      const c = safeSlug(cfg(s, "company"));
      return c ? recruiteeHost(c) : null;
    }
    case "ats_teamtailor": {
      const c = safeSlug(cfg(s, "company"));
      return c ? teamtailorHost(c) : null;
    }
    case "ats_personio": {
      const c = safeSlug(cfg(s, "company"));
      return c ? personioHost(c) : null;
    }
    case "ats_workable":
      return safeSlug(cfg(s, "subdomain")) ? WORKABLE_HOST : null;
    case "ats_ashby":
      return safeSlug(cfg(s, "board")) ? ASHBY_HOST : null;
    case "ats_smartrecruiters":
      return safeSlug(cfg(s, "company")) ? SMARTRECRUITERS_HOST : null;
    case "board_sitemap_jsonld": {
      const u = cfg(s, "sitemapUrl");
      try {
        return u ? new URL(u).host : null;
      } catch {
        return null;
      }
    }
    case "board_rules": {
      const list = Array.isArray(config.listingUrls) ? (config.listingUrls as unknown[]) : [];
      const first = list.find((u): u is string => typeof u === "string");
      try {
        return first ? new URL(first.replace("{page}", "1")).host : null;
      } catch {
        return null;
      }
    }
  }
}
