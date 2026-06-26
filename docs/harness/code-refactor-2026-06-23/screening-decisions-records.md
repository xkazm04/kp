> Total: 5 findings (0c critical, 1h high, 2m medium, 2l low)

## 1. `policyVersion` template literal duplicated inside `runScreenWave` (drift risk on the audit/approval contract)
- **Severity**: High
- **Category**: duplication
- **File**: app/_lib/screen-wave.ts:162 (and re-inlined at app/_lib/screen-wave.ts:265)
- **Scenario**: Line 162 builds `const policyVersion = \`screen-wave/bottom${cfg.rejectBottomPercent}/maxMatch${cfg.maxMatchToReject}\`;` and uses it to sign the approval token (line 172). Then line 265, inside the `sealDecisionSafe({...})` call, re-inlines the *identical* template literal as the `policyVersion` field instead of reusing the const already in scope. Verified by grep: three hits for `screen-wave/bottom` — the const definition, the token call, and the inlined copy. The const is visible at line 265 (same function body), so the inline is pure duplication.
- **Root cause**: The seal-record block (moonshot D) was added after the approval-token gate; the author copied the format string rather than referencing the existing variable.
- **Impact**: The string is the policy fingerprint that ties the signed approval token to the sealed, tamper-evident decision record. If the format is ever changed (e.g. to add a field), changing one occurrence and missing the other silently desyncs the audit record's `policyVersion` from the version the approval token was signed against — exactly the kind of integrity drift this hash-chain subsystem exists to prevent.
- **Fix sketch**: Replace the inlined literal at line 265 with `policyVersion,` (reuse the const). Behavior-identical today; removes the drift surface. No test change needed (the literal is not pinned by a unit test).

## 2. Hand-mirrored `Decision` / `WaveResult` types in `ScreenWaveModal` duplicate the server's `ScreenDecision` / `runScreenWave` return shape
- **Severity**: Medium
- **Category**: duplication
- **File**: app/features/sub_decisions/ScreenWaveModal.tsx:12-23 (source of truth: app/_lib/screen-wave.ts:18-38 `ScreenDecision`, and the `runScreenWave` return type at app/_lib/screen-wave.ts:109-128)
- **Scenario**: The modal declares a local `type Decision = {...}` whose own comment says "(mirrors ScreenDecision in screen-wave.ts)", plus `type WaveResult = {...}` mirroring the `runScreenWave` result envelope (`decisions/rejected/kept/cohort/commsFailures/dryRun/approvalToken`). These are hand-copied subsets of exported server types. Confirmed by reading both files: every field in the local `Decision` exists on the exported `ScreenDecision`, and `WaveResult` re-lists the runScreenWave return fields. The server already exports `ScreenDecision`; the result envelope type is anonymous (inline return type) so it can't be imported as-is today.
- **Root cause**: The route returns JSON, so the client re-typed the wire shape by hand instead of importing the source types; the result envelope being an inline (un-named) return type made importing it impossible without a small refactor.
- **Impact**: Two copies of the same contract that drift independently — a new field on `ScreenDecision` (e.g. another `reasonCode`, or a per-row flag like `commsFailed` was) silently won't type-check against the client until someone manually mirrors it; type errors won't catch the mismatch because the client type is self-consistent.
- **Fix sketch**: (a) Import `ScreenDecision` in the modal and define `type Decision = Pick<ScreenDecision, ...>` (or use it directly). (b) Promote the `runScreenWave` return to a named exported type (e.g. `export type ScreenWaveResult = {...}`) in screen-wave.ts and import it for the client `WaveResult` (the client can subset it). Keep it `type`-only import so no DB code is pulled into the bundle (the existing `SCREENING_DEFAULT` value import already proves the schema module is browser-safe; types erase at build).

## 3. Unused `STAGES` import in `DecisionsShared.tsx`
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/features/sub_decisions/DecisionsShared.tsx:6
- **Scenario**: `import { STAGES, styleFor, type Entry } from "./DecisionsTypes";` — but `STAGES` is never referenced anywhere in DecisionsShared.tsx. Verified by grep: the only hit for `STAGES` in the file is the import line itself (the follow-up grep returned just line 6). `styleFor` and `Entry` ARE used; only `STAGES` is dead. `STAGES` itself is a live export (used elsewhere, e.g. the value in DecisionsTypes mirrors PipelineTypes), so the export stays — only this import binding is dead.
- **Root cause**: Leftover from an earlier version of the shared module (likely a stage chip/badge that was moved out), the import wasn't trimmed when the usage was removed.
- **Impact**: Low functional risk, but it's a real dead binding that survives because the project's lint evidently doesn't fail the build on unused imports here; it misleads readers into thinking DecisionsShared depends on the stage list.
- **Fix sketch**: Change line 6 to `import { styleFor, type Entry } from "./DecisionsTypes";`. One-line, zero behavior change.

## 4. `KindTranslator` helper alias in `decision-attribution.ts` is over-engineered for a never-used generic position
- **Severity**: Low
- **Category**: cleanup
- **File**: app/_lib/decision-attribution.ts:94-104 (`type KindTranslator` + `kindLabel`)
- **Scenario**: `kindLabel<T extends KindTranslator>(t: T, kind: string)` is parameterized over a translator type whose call signature is `(key: never) => string`, then internally casts `kind` to `Parameters<T>[0]`. The generic adds no caller-side type safety (every caller passes a next-intl translator and the key is force-cast to `never`'s param anyway). It's used (analytics DecisionLog / RoiLedger CSV per the comment), so it's not dead — but the generic indirection is cruft that obscures a simple "translator-in, string-out" helper. Confirmed `kindLabel` has external consumers via the module's own doc comment and the broad usage of `DECISION_META`.
- **Root cause**: Written to stay free of a direct `next-intl` import in a pure module; the structural-typing trick grew more complex than the problem warrants.
- **Impact**: Pure readability/maintenance cost — a future reader spends time decoding the `(key: never)` shape and the `Parameters<T>[0]` cast for what is effectively `(t: (k: string) => string, kind: string) => string`.
- **Fix sketch**: Optional. Simplify to a non-generic signature accepting a minimal `(key: string) => string` callback (callers already pass a function); drop `KindTranslator`. Behavior-identical. Leave as-is if the team prefers the import-free pure-module discipline — flagging only as low-value cleanup, not a defect.

## 5. `import "./compliance-regimes.ts"` (extension) vs `import "./compliance-regimes"` (no extension) for the same module across sibling files
- **Severity**: Low
- **Category**: cleanup
- **File**: app/_lib/decision-config-schema.ts:11 (with `.ts`) vs app/_lib/decision-config-store.ts:10 (without `.ts`)
- **Scenario**: Both import `compliance-regimes`, one with the `.ts` suffix and one without. Investigated whether this is accidental: grep shows `.ts`-suffixed sibling imports are a deliberate repo convention for *pure, `node --test`-loadable* `_lib` modules (ats-*, comparison, schemas, skill-profile, db.ts, etc. all do it), and `decision-config-schema.ts`'s own header documents that it avoids `@/` aliases and stays test-runner-loadable. `decision-config-store.ts` is a `better-sqlite3`-backed module (not test-loaded) so it correctly omits the extension. So this is **mostly by-design, not a bug** — flagged only as a readability inconsistency for the same target module.
- **Root cause**: Two different load contexts (bare `node --test` strip-types vs Next bundler) have different extension expectations; the convention is real but undocumented at the call site, so it reads as inconsistency.
- **Impact**: None functionally. Minor confusion for a reader who notices the same module imported two ways and may "fix" the wrong one (removing `.ts` from the schema module would break `npm run test:unit`).
- **Fix sketch**: No code change recommended — both are correct for their context. If desired, add a one-line comment on decision-config-schema.ts:11 noting the `.ts` is required for the bare test runner (the module header already explains it generally). Treat as documentation, not a refactor.
