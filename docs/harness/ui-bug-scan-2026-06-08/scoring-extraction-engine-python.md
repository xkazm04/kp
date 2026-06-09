# Scoring & Extraction Engine (Python) — UI+Bug combined scan (TS surface)
> Total: 3 findings (0 crit / 1 high / 2 med / 0 low)
> Group: Candidate Analysis & Scoring | Lens mix: 3 bug / 0 ui | Files read: 1

## 1. `coerceString` returns the UNTRIMMED string, so a padded currency persists with its whitespace
- **Severity**: Medium
- **Lens**: 🐛 Bug Hunter
- **Category**: Validation gap at trust boundary / silent data corruption
- **File**: `app/_lib/salary-band.ts:95`
- **Scenario**: The CLI (or any upstream `as`-cast payload) emits `currency: " CZK "` (LLM/CSV whitespace is common). `coerceString(" CZK ", "CZK")` evaluates `value.trim()` only as a *truthiness gate* — it is truthy, so the function returns the original **untrimmed** `value` (`" CZK "`), not the trimmed form. Same for `confidence`/`summary`.
- **Root cause**: `return typeof value === "string" && value.trim() ? value : fallback;` — the `.trim()` result is discarded; the raw `value` is returned. The function trims only to decide blank-vs-fallback, never to clean the kept value.
- **Impact**: The padded currency is stored on the `MarketSalary` and later rendered by `formatSalaryRange` as `"45 000–60 000  CZK "` (stray/doubled spaces, trailing gap). Worse, any downstream raw `===` currency comparison that does NOT route through `normalizeCurrency` (e.g. a future consumer comparing `marketSalary.currency` to a band currency directly) silently sees `" CZK " !== "CZK"` and mis-classifies an in-currency figure as cross-currency. The file's own header treats whitespace as noise (`normalizeCurrency` strips it) — this helper does not, so the two disagree.
- **Fix sketch**: Return the trimmed value when non-blank: `const t = typeof value === "string" ? value.trim() : ""; return t ? t : fallback;`.

## 2. Currency fallback is the hardcoded literal `"CZK"`, not the imported `APP_CURRENCY` — silent drift if the app currency changes
- **Severity**: High
- **Lens**: 🐛 Bug Hunter
- **Category**: Latent failure / cross-currency comparison hazard (the exact bug the file is built to prevent)
- **File**: `app/_lib/salary-band.ts:118`
- **Scenario**: `normalizeMarketSalary` defaults an absent/blank `currency` to the string literal `"CZK"`. `APP_CURRENCY` is imported at line 1 but used **only in comments** — it is dead at runtime. If `APP_CURRENCY` is ever re-pointed (e.g. to `"EUR"`) — a one-line edit the codebase explicitly advertises as supported ("a locale/currency change is a one-line edit", format.ts:2) — this helper keeps stamping currency-less market-salary payloads as `"CZK"` while every band, expectation, and `formatSalaryRange` default now means EUR.
- **Root cause**: Hardcoded fallback `coerceString(p.currency, "CZK")` instead of `coerceString(p.currency, APP_CURRENCY)`. The whole point of importing `APP_CURRENCY` (the "single source" the format.ts doc describes) is defeated.
- **Impact**: A currency-less CLI band is silently mislabeled in the new currency. Because the app does NO FX and gates verdicts on `isSameCurrency`, this either (a) renders a CZK figure with a EUR app label, or (b) makes a genuinely-matching figure read as cross-currency / "no verdict". This is precisely the "confident-but-meaningless 30% over" failure the module header warns against, reintroduced through a stale default. Currently latent only because `APP_CURRENCY === "CZK"`, so it is invisible until the day someone changes it — the worst kind of trap.
- **Fix sketch**: `currency: coerceString(p.currency, APP_CURRENCY)`. Removes the dead import and closes the drift; add a test asserting the default tracks `APP_CURRENCY`.

## 3. `salaryBandPosition` silently classifies a NaN/Infinity midpoint as "within"
- **Severity**: Medium
- **Lens**: 🐛 Bug Hunter
- **Category**: Edge case / NaN propagation / silent misclassification
- **File**: `app/_lib/salary-band.ts:51`
- **Scenario**: The midpoint is derived from an LLM-extracted expectation that arrives as `NaN` (unparseable figure) or `Infinity`. For `NaN`: `NaN > hi` is `false` and `NaN < lo` is `false`, so both guards fall through and the function returns `{ position: "within", pct: 0 }` — a confident "candidate is within band" verdict for a value that is not a number. For `Infinity`: `Infinity > hi` is true, then `pct = Math.round(((Infinity - hi) / hi) * 100)` = `Infinity`, which renders as `"Infinity%"`/`"∞% over"`.
- **Root cause**: The function validates the *bounds* (`hi > 0`, `lo > 0`) but never validates `midpoint`. The doc says it "ASSUMES … same currency" but says nothing about finiteness, and the only midpoint guard lives implicitly in the (separate) caller.
- **Impact**: A garbage extraction reads as a clean "within band" salary fit on a hiring screen — the most dangerous direction, because it looks correct and gives no signal it is wrong. `Infinity` produces a nonsense percentage. Either way a recruiter trusts a fabricated salary verdict.
- **Fix sketch**: Guard the input first: `if (!Number.isFinite(midpoint)) return { position: "within", pct: 0 };` is acceptable only if "within/0" is the documented degenerate; better is to make the contract explicit and have the caller skip the verdict when `!Number.isFinite(midpoint)`, mirroring how `isSameCurrency` already gates the cross-currency case.
