> Total: 5 findings (0c critical, 1h high, 2m medium, 2l low)

## 1. `salaryBandError` is dead code — exported but never called
- **Severity**: High
- **Category**: dead-code
- **File**: app/_lib/salary-band.ts:62
- **Scenario**: `salaryBandError(min, max)` is exported with a JSDoc claiming it is "Used by the form to block rendering a corrupted JD." I ran `rg -n "salaryBandError" --glob '*.ts' --glob '*.tsx'` across the whole repo: the ONLY hit is its own definition line — zero callers, zero re-exports, zero test references (the `salary-band.test.ts` suite never imports it; it tests `normalizeSalaryBand`/`normalizeMarketSalary`/`salaryBandPosition`/`isSameCurrency` instead). The validation it claims to provide (`min <= 0 || max <= 0`, `min > max`) is in fact done at the live write boundary by `normalizeSalaryBand` (used by `ingest-job.ts`, `offer-draft/route.ts`), which is the path that actually runs.
- **Root cause**: A form-side validator written speculatively (or whose caller was later refactored to use `normalizeSalaryBand` instead), leaving the helper stranded. Its sibling `normalizeSalaryBand` superseded its job.
- **Impact**: A reader trusts the JSDoc ("Used by the form…"), wastes time looking for the form that uses it, and may "fix" or extend it under the false belief it's load-bearing. It also gives a false sense that JD authoring is guarded by THIS function when the real guard is elsewhere — masking where validation actually lives.
- **Fix sketch**: Delete the `salaryBandError` export (lines 60–68). It has a unit-tested replacement already in active use, so removal is safe. If a desire exists to keep a form-facing message helper, wire it into the actual JD authoring form first; otherwise drop it.

## 2. `fmtBand` in CoachPanel re-implements salary formatting ad-hoc, bypassing `formatSalaryRange`
- **Severity**: Medium
- **Category**: duplication
- **File**: app/features/sub_jobs/CoachPanel.tsx:29-30 (vs app/_lib/format.ts:39 `formatSalaryRange`)
- **Scenario**: CoachPanel defines `const fmtBand = (band) => band ? \`${band[0].toLocaleString("cs-CZ")} – ${band[1].toLocaleString("cs-CZ")} CZK\` : null;`. This hand-rolls exactly what `formatSalaryRange(min, max, { currency })` already produces (grouped integers, en-dash, currency suffix). `format.ts`'s own module header says "Components should reach for these helpers instead of formatting values ad-hoc" and `APP_CURRENCY` exists precisely so the literal `"CZK"` and `"cs-CZ"` are never hardcoded per-component. I confirmed via `rg -n 'toLocaleString\("cs-CZ"\)'` that CoachPanel is the only place in sub_jobs doing this inline, and `rg` confirms `formatSalaryRange`/`formatCzk` are the established shared formatters (used by JdBuilder, jd-build-run, etc.).
- **Root cause**: Quick inline formatter written when CoachPanel was added (idea-aa039d0c), unaware of / not reaching for the shared `format.ts` helper.
- **Impact**: A locale or currency change (the whole reason `format.ts` centralizes this) silently skips CoachPanel — its bands would still read "CZK"/"cs-CZ" while the rest of the app updates. Subtly different rendering too: `formatSalaryRange` collapses an equal band to one figure and normalizes inverted bands; `fmtBand` does neither.
- **Fix sketch**: Replace `fmtBand` with `formatSalaryRange(band[0], band[1])` (returning the empty-string/"" path mapped to the existing `?? t("salaryUnset")` / `?? ""` fallbacks), or keep a thin `fmtBand = (b) => b ? formatSalaryRange(b[0], b[1]) : null` wrapper that delegates. Import from `@/app/_lib/format`.

## 3. `PRIOR_STYLE` map duplicated verbatim across RediscoverPanel and RediscoveryFeed
- **Severity**: Medium
- **Category**: duplication
- **File**: app/features/sub_jobs/RediscoverPanel.tsx:15-19 and app/features/sub_jobs/RediscoveryFeed.tsx:20-24
- **Scenario**: Both files declare an identical `const PRIOR_STYLE: Record<string, string> = { rejected: "bg-coral/10 text-coral", closed: "bg-dial-amber/20 text-ink", elsewhere: "bg-steel/10 text-steel" };` and use it to color the prior-outcome chip. `rg -n "PRIOR_STYLE"` shows the same three-key map copy-pasted in both. They render the same conceptual badge (rediscovery prior outcome) from the same `prior.kind` values (`rejected`/`closed`/`elsewhere`) produced by `rediscover.ts:pickPrior`. (Feed adds a `?? PRIOR_STYLE.elsewhere` fallback the Panel lacks — a latent inconsistency the duplication causes.)
- **Root cause**: The standing feed (RediscoveryFeed, idea-fdb45cd0) was built after the on-demand panel and copied its styling rather than sharing it.
- **Impact**: Two sources of truth for one visual contract. A new prior kind, or a color tweak, must be made in two places; they have already drifted (the missing fallback). Both also live in the same `sub_jobs/` directory, so sharing is trivial.
- **Fix sketch**: Lift `PRIOR_STYLE` (with the `?? elsewhere` fallback accessor) into the shared `sub_jobs/JobsShared.tsx` (or `JobsTypes.ts`) module both already import from, export it, and import in both components. One map, one fallback.

## 4. RediscoveryFeed hand-rolls an `Alert` type that mirrors the store's `RediscoveryAlert`
- **Severity**: Low
- **Category**: duplication
- **File**: app/features/sub_jobs/RediscoveryFeed.tsx:9-18 (vs app/_lib/rediscovery-alert-store.ts:53 `RediscoveryAlert`)
- **Scenario**: RediscoveryFeed declares a local `type Alert = { id, jobId, jobTitle, candidateId, label, archetype, score, prior: { kind, label } }`. The store already exports `RediscoveryAlert` with the same fields (plus `createdAt`), and the `/api/rediscovery/alerts` route returns exactly that shape. The sibling RediscoverPanel demonstrates the safe pattern: it does `import type { Rediscovered } from "@/app/_lib/rediscover"` even though that module transitively imports better-sqlite3 — a type-only import is erased and never pulls the runtime into the client bundle. I confirmed precedent: `DecisionRecordsPanel.tsx` and `InviteLifecyclePanel.tsx` both `import type` from `*-store` modules that import better-sqlite3.
- **Root cause**: Author avoided importing from a store that pulls in better-sqlite3, not realizing `import type` is erased (the precedent existed but wasn't followed here).
- **Impact**: Low — a redeclared wire type that can silently drift from the server shape (e.g. if `prior` gains a field). Minor maintenance duplication.
- **Fix sketch**: Replace the local `type Alert` with `import type { RediscoveryAlert } from "@/app/_lib/rediscovery-alert-store"` (createdAt is optional to the view but harmless), mirroring RediscoverPanel's type-only import. Verify the client bundle stays clean (it will — type-only).

## 5. CampaignTab's `PackRecord` type restates `CampaignPackRecord`
- **Severity**: Low
- **Category**: duplication
- **File**: app/features/sub_jobs/CampaignTab.tsx:18 (vs app/_lib/db/campaign.ts:9 `CampaignPackRecord`)
- **Scenario**: CampaignTab declares `type PackRecord = { jobId; lang; payload: Pack; source; createdAt }`; `db/campaign.ts` exports `CampaignPackRecord` with the identical field set, differing only in `payload` (typed `Pack` client-side vs `unknown` server-side, since the payload is a Python-produced campaign pack). `rg` confirms `CampaignPackRecord` is exported and the wire shape returned by `/api/jobs/[id]/campaign`. The `Pack`/`Variant`/`VideoScript` types ARE genuinely client-only (no TS producer — they describe the Python `campaign_cli` output), so those are NOT duplication; only the envelope `PackRecord` overlaps.
- **Root cause**: The client needed to narrow `payload` from `unknown` to `Pack`, so it redeclared the whole record instead of extending the server type.
- **Impact**: Very low — a 5-field envelope restated. If the persisted record gains/loses a column the two can drift, but the blast radius is one tab.
- **Fix sketch**: Optional. `type PackRecord = Omit<CampaignPackRecord, "payload"> & { payload: Pack }` via `import type { CampaignPackRecord } from "@/app/_lib/db/campaign"`, so the envelope stays single-sourced while the client keeps its narrowed `payload`. Defensible to leave as-is given the deliberate `unknown` vs `Pack` split.
