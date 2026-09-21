---
id: "0009"
title: One HTML parser dependency, for owner-consented acquisition only
status: accepted
date: 2026-09-16
supersedes: []
superseded-by: null
tags: [dependencies, acquisition, jobseeker, legal]
sources:
  - app/_lib/jobseeker/types.ts
  - app/_lib/job-posting-fetch.ts
  - pipeline/jobfit/jobseeker_cli.py
---

## Context

kp had no HTML parser in either toolchain. Every fetch of a third-party page went
through the dependency-free `htmlToText` in `app/_lib/job-posting-fetch.ts`, which is
enough for "paste one advert" and useless for a board listing page that must be read
as structure. `CONTRIBUTING.md` treats a new dependency as a governance decision and
`app/_lib/pull-pass.ts` refused IMAP on exactly that ground.

The job-seeker module (2026-09-16 spark `candidate-jobseeker`) needs to discover
postings for the person running the install. The design converged on three tiers of
source: **A** rights-clean feeds (the MPSV open-data vacancy file, the EURES public
search API, ATS vendors' public job endpoints), **B** boards whose `robots.txt`
permits fetching but whose terms forbid automated processing (startupjobs.cz,
prace.cz, profesia.sk, cocuma.cz, jobs.cz), and **C** boards that block or forbid
outright (LinkedIn, Indeed, StepStone). Tier A needs no parser. Tier B needs
`schema.org/JobPosting` JSON-LD from detail pages — a regex over `<script
type="application/ld+json">` suffices — except jobs.cz, the richest Czech IT source,
which publishes neither a sitemap nor JSON-LD and therefore needs **authored
extraction rules** over server-rendered listing HTML.

The registry's web-scraping standard says rules are the asset and must be
form-editable, previewable against the live page through the production engine, and
diagnosable per rule when a redesign makes them miss. Three locator kinds cover real
pages: a structural (CSS) selector, a pattern, a pointer. The structural kind is the
default and the reason a parser is needed at all; regex-only rules are the most
fragile kind and the standard warns against making them the only one.

## Decision

1. **Add exactly one runtime dependency, `linkedom`** (MIT, pure JavaScript, no native
   build), used only by `app/_lib/jobseeker/rules/**` — the rule engine and its dry-run
   preview. Nothing else in the tree may import it; a second consumer reopens this
   record.
2. **The engine is model-as-author, never model-as-extractor.** An LLM may propose
   rules once per page shape, grounded in the actually fetched markup; harvests run the
   rules deterministically. A model reading each page at harvest time is the failure
   smell the standard names and is not built.
3. **Acquisition is owner-consented.** The fetcher honours `robots.txt`, spaces
   requests per host with seeded jitter, identifies itself as
   `kp-jobseeker/1.0 (+https://github.com/xkazm04/kp; owner-operated)`, treats a denial
   status or interstitial as `blocked` (pause the source, tell the owner, never retry),
   and returns `offline` under `KP_OFFLINE` before any egress. A tier-B source cannot be
   enabled without the owner acknowledging the quoted terms clause; a tier-C source has
   no enable control at all. The owner of the install is the party taking the terms
   exposure, and the UI says so where the decision is made.
4. **The crawler lives in Node**, beside the scheduler clock, the offline fetch guard
   and the politeness state, not across the Python process boundary.

## Consequences

- `package.json` / `package-lock.json` gain one entry; `npm run sbom` and
  `npm run security:*` cover it like any other.
- The alternative "regex-only DSL, zero dependencies" was rejected as buying fragility
  at the most exposed source; "beautifulsoup4 + lxml in Python" was rejected because
  the fetch policy would then be split across two runtimes.
- A block is a relationship signal, so a paused source stays paused across scans until
  the owner resumes it; `scheduler_runs` records `blocked` and `collapsed` as failure
  outcomes, never as a green run with zero rows.

## What would reopen this

- A second module needs an HTML parser: fold the engine into a shared primitive and
  amend the "only consumer" clause, or pick a different parser deliberately.
- `linkedom` gains a native dependency, changes licence, or goes unmaintained for a
  year: swap for `cheerio` or `parse5` behind the same `rules/engine.ts` seam.
- A board publishes an authored feed or API: the tier-B adapter for it is deleted, not
  kept "in case".
- A legal review of the DSM Art. 4 text-and-data-mining exception or of the accepted
  terms changes the owner's position: the acknowledgement copy and the tier table
  change with it, in the same commit.
