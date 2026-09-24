import { createHash } from "node:crypto";
import {
  GIG_ADAPTERS,
  GIG_ADAPTER_ARENA,
  GIG_ADAPTER_TIER,
  type GigAdapterName,
  type GigArena,
  type GigSource,
  type GigSourceTier,
} from "./types";

// The research record behind each gig adapter - what the Sources panel shows before the
// operator enables one: its tier, the host it talks to, the keys it reads, and for a
// tier-B adapter the TERMS SUMMARY the operator acknowledges (the job-seeker
// sources-catalog.json convention: a short, factual paraphrase that states the EXPOSURE -
// whose account the terms bind and what can go wrong for it - with `termsUrl` to read
// the original). `termsHash` is sha256 of the summary, so an edited summary re-asks.
//
// Hosts are written out here rather than imported from adapters/registry.ts: that module
// reaches every adapter, and this catalog sits on the sources route. sources-catalog.test.ts
// pins every host to gigHostForAdapter so the two cannot drift.
//
// Checked 2026-09-24. Verify a summary against its termsUrl before relying on it; the
// summary is kp's reading, not the provider's text.

export type GigCatalogEntry = {
  adapter: GigAdapterName;
  /** The arena the adapter's listings belong to; null for `manual` (the operator names it). */
  arena: GigArena | null;
  tier: GigSourceTier;
  label: string;
  /** Null for `manual`: a forwarded brief is fetched from nowhere. */
  host: string | null;
  /** True when the adapter cannot run at all without its key. */
  needsKey: boolean;
  /** Env var NAMES the adapter reads (never values). A keyless adapter may list an
   *  optional key that only raises its rate limit. */
  envVars: string[];
  /** What happens without the key, in one line. */
  keylessBehaviour: string;
  termsSummary: string;
  termsUrl: string | null;
  /** sha256 of termsSummary for a tier-B adapter (what the operator acknowledges);
   *  null for tier A, which needs no acknowledgement. */
  termsHash: string | null;
  /** Why the adapter declines to run (it can still be created; its runs are recorded
   *  `skipped` with this reason). Null when it runs. */
  declines: "no_public_api" | "manual_only" | null;
  /** Whether a source row can be created for it (false for `manual`). */
  creatable: boolean;
  checkedOn: string;
};

export function gigTermsHashOf(summary: string): string {
  return createHash("sha256").update(summary, "utf8").digest("hex");
}

type RawEntry = Omit<GigCatalogEntry, "adapter" | "arena" | "tier" | "termsHash">;

const RAW: Readonly<Record<GigAdapterName, RawEntry>> = {
  manual: {
    label: "Forwarded brief (manual)",
    host: null,
    needsKey: false,
    envVars: [],
    keylessBehaviour: "Nothing is fetched: the operator forwards a brief on the Gig desk.",
    termsSummary: "No provider is contacted. The operator is responsible for having the right to forward the brief.",
    termsUrl: null,
    declines: "manual_only",
    creatable: false,
    checkedOn: "2026-09-24",
  },
  github_bounty: {
    label: "GitHub issues labelled as bounties",
    host: "api.github.com",
    needsKey: false,
    envVars: ["GITHUB_TOKEN", "GH_TOKEN"],
    keylessBehaviour: "Runs keyless at GitHub's lower unauthenticated search rate; a token only raises the limit.",
    termsSummary:
      "GitHub's Terms of Service allow API use within its rate limits; issue text is public and user-written. kp only reads search results and one bot comment per issue. A claim, comment or pull request is the operator's act, under the operator's GitHub account and the project's own contribution rules.",
    termsUrl: "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service",
    declines: null,
    creatable: true,
    checkedOn: "2026-09-24",
  },
  algora: {
    label: "Algora bounties",
    host: "algora.io",
    needsKey: false,
    envVars: [],
    keylessBehaviour: "Declines every run: Algora publishes no documented JSON bounty API. Its bounties reach the desk as GitHub issues labelled \"💎 Bounty\" through the GitHub source.",
    termsSummary: "Nothing is fetched from Algora. Bounty claims and payouts run through Algora and GitHub under the operator's own accounts.",
    termsUrl: "https://algora.io/terms",
    declines: "no_public_api",
    creatable: true,
    checkedOn: "2026-09-24",
  },
  kaggle: {
    label: "Kaggle competitions",
    host: "www.kaggle.com",
    needsKey: true,
    envVars: ["KAGGLE_USERNAME", "KAGGLE_KEY"],
    keylessBehaviour: "Paused as no_key until both variables are set: the list endpoint answers 401 without them.",
    termsSummary:
      "The API key is the operator's Kaggle account, and Kaggle's Terms of Use bind that account. Each competition's rules bind whoever submits: one account per person, team and submission limits, outside-data rules, and for a prize, obligations such as licensing the winning code. Rule breaches can disqualify the entry or suspend the account. kp reads competition lists and, after the deadline, the account's own submissions. It never submits.",
    termsUrl: "https://www.kaggle.com/terms",
    declines: null,
    creatable: true,
    checkedOn: "2026-09-24",
  },
  hackerone: {
    label: "HackerOne bounty programs",
    host: "api.hackerone.com",
    needsKey: false,
    envVars: ["HACKERONE_API_USERNAME", "HACKERONE_API_TOKEN"],
    keylessBehaviour: "Without a key, programs come from the public bounty-targets dataset (daily snapshot, no reward tables).",
    termsSummary:
      "The Hacker API token is tied to the operator's HackerOne account; HackerOne's Terms and each program's policy bind it. Invalid, out-of-scope or duplicate reports lower the account's Signal and reputation and can cost access to programs, which is why kp pauses a source after 5 rejected outcomes in a row. Testing beyond a program's rules can breach its safe harbour. kp only reads program listings and policies. Reports are written and submitted by the operator.",
    termsUrl: "https://www.hackerone.com/terms/general",
    declines: null,
    creatable: true,
    checkedOn: "2026-09-24",
  },
  freelancer_api: {
    label: "Freelancer.com projects",
    host: "www.freelancer.com",
    needsKey: false,
    envVars: [],
    keylessBehaviour: "Runs keyless: the active-projects endpoint is public.",
    termsSummary:
      "Freelancer.com's User Agreement binds the account that bids: proposals, their truthfulness and any contact with a client are the account holder's responsibility. Payment or contact off the platform is prohibited and can close the account. kp only reads active project listings; bids are written and placed by the operator.",
    termsUrl: "https://www.freelancer.com/about/terms",
    declines: null,
    creatable: true,
    checkedOn: "2026-09-24",
  },
  upwork_api: {
    label: "Upwork job postings",
    host: "api.upwork.com",
    needsKey: true,
    envVars: ["UPWORK_API_TOKEN"],
    keylessBehaviour:
      "Paused as no_key without a token. Even with one, api.upwork.com's robots.txt disallows all paths and kp's fetch door honours it, so runs currently end robots_disallowed.",
    termsSummary:
      "The API token belongs to the operator's own Upwork API key, and Upwork's API Terms of Use bind that account: they limit how job data may be stored and shown, and Upwork's Terms of Service forbid automated or bulk proposals. Breaches can suspend the key or the freelancer account. kp only reads postings; proposals are written and sent by the operator.",
    termsUrl: "https://www.upwork.com/legal#api",
    declines: null,
    creatable: true,
    checkedOn: "2026-09-24",
  },
};

const ENTRIES: readonly GigCatalogEntry[] = GIG_ADAPTERS.map((adapter) => {
  const raw = RAW[adapter];
  const tier = GIG_ADAPTER_TIER[adapter];
  return {
    adapter,
    arena: GIG_ADAPTER_ARENA[adapter],
    tier,
    ...raw,
    termsHash: tier === "B" ? gigTermsHashOf(raw.termsSummary) : null,
    envVars: [...raw.envVars],
  };
});

/** One entry per GIG_ADAPTERS name, in vocabulary order (fresh copies). */
export function gigSourcesCatalog(): GigCatalogEntry[] {
  return ENTRIES.map((e) => ({ ...e, envVars: [...e.envVars] }));
}

export function gigCatalogEntry(adapter: GigAdapterName): GigCatalogEntry {
  const e = ENTRIES.find((x) => x.adapter === adapter)!;
  return { ...e, envVars: [...e.envVars] };
}

/** Whether a source's recorded acknowledgement matches the terms as summarized NOW.
 *  Tier A needs none (always current); tier B is current only on the same hash. */
export function gigSourceTermsCurrent(source: Pick<GigSource, "adapter" | "tier" | "acknowledgedTermsHash">): boolean {
  if (source.tier === "A") return true;
  const hash = gigCatalogEntry(source.adapter).termsHash;
  return hash !== null && source.acknowledgedTermsHash === hash;
}
