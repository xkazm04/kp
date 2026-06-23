> Total: 5 findings (0c critical, 1h high, 2m medium, 2l low)

## 1. In-module duplicate of `APPLY_EMAIL_RE` defeats the "single email-shape check" it was created to be
- **Severity**: High
- **Category**: duplication
- **File**: app/_lib/apply-intake.ts:266 (the canonical constant is app/_lib/apply-intake.ts:103)
- **Scenario**: `APPLY_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/` is defined at line 103 with a doc comment (lines 94–102) explicitly stating it was hoisted "so the four copies can't drift" across the apply surfaces. Yet 160 lines down, `seedLeadPrefillAnswers` (line 266) re-inlines the *identical* literal `/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)` instead of calling the constant that lives in the same file. Confirmed with `grep -rFn '/^[^\s@]+@[^\s@]+\.[^\s@]+$/' app`: three hits — the constant (103), the inline copy (266), and lead-payload.ts (49, deliberately a different module/contract). All four genuine apply surfaces (both routes, both client forms) correctly import the constant (`grep APPLY_EMAIL_RE`), so line 266 is the *one* place that quietly drifted — a 5th copy the consolidation missed.
- **Root cause**: `seedLeadPrefillAnswers` was added after the regex was centralized and the author hand-copied the literal (matching the prefill JSDoc note "re-checked against the same shape gate") rather than referencing the symbol now sitting above it.
- **Impact**: A future tightening of the email shape (e.g. to bar leading dots) will be applied to `APPLY_EMAIL_RE` and silently skip the prefill seeder — so the seeded email and the POST-time validation would accept different strings, the exact "client accepts what the server rejects → a 400 that wipes the conversation" failure the centralization comment warns against. It is also actively misleading: the prose promises one source of truth that the code does not honor.
- **Fix sketch**: Replace the inline literal at line 266 with `APPLY_EMAIL_RE.test(email)` (the constant is already in scope, no import needed). The existing `seedLeadPrefillAnswers` tests in apply-intake.test.ts (lines 537–543, the non-email contact case) pin the behavior, so the change is verifiable.

## 2. `buildIntakeProfile` hand-rolls the comma/semicolon split that `splitList` exists to own
- **Severity**: Medium
- **Category**: duplication
- **File**: app/_lib/apply-intake.ts:326-329 (canonical helper: app/_lib/split-list.ts:8)
- **Scenario**: `buildIntakeProfile` splits the skills answer with `answers.skills.split(/[,;]/).map((s) => s.trim()).filter(Boolean)` (lines 326–329). `split-list.ts` defines `splitList(text)` which, in its default (non-newlines) branch, does exactly `text.split(/[,;]/).map(trim).filter(Boolean)` — and its own doc comment says it exists "so a future tweak … lands in one place instead of drifting across hand-copied closures." `grep -rn 'split(/\[,;\]'` finds this inline closure is the only remaining hand-copy; `completeness-followup.ts` (the sibling intake merge) already imports and uses `splitList`. apply-intake.ts is `@/`-import-free by design, but `splitList` lives in the same `_lib` dir and is imported relatively elsewhere (`./split-list.ts`), so it is reachable without breaking that constraint.
- **Root cause**: The skills split predates (or was written in parallel with) the `splitList` extraction and was never folded in when the helper was created for precisely this list-of-candidate-free-text use case.
- **Impact**: The "drifting across hand-copied closures" the helper was built to prevent: a delimiter change (the comment cites "also split on '/'") would update completeness follow-up's skills/languages but silently miss the apply flow's skills parsing, yielding inconsistent skill extraction between the two intake paths.
- **Fix sketch**: `import { splitList } from "./split-list.ts";` and replace lines 326–329 with `const skillList = splitList(answers.skills);`. The split test (apply-intake.test.ts:166-170, "splits skills on commas and semicolons") locks the contract.

## 3. Best-effort consent-record wrapper is duplicated inline in the apply route instead of shared
- **Severity**: Medium
- **Category**: duplication
- **File**: app/api/apply/[id]/route.ts:395-399 and :447-451 (sibling helper: app/_lib/lead-intake.ts:32-38)
- **Scenario**: `lead-intake.ts` wraps consent bookkeeping in a named `recordLeadConsent(entryId, source)` helper — a try/catch around `recordEntryConsent` that logs `[lead-intake] consent record failed …` and never throws. The conversational apply route re-implements the *same* best-effort pattern inline, twice: the re-apply path (lines 395–399, "consent refresh failed") and the first-apply path (lines 447–451, "consent record failed"). Confirmed with `grep -rn 'recordEntryConsent|consent record failed'`: three try/catch sites for one identical concern (don't let consent bookkeeping undo a filed application), two of them copy-pasted in the route.
- **Root cause**: The two apply surfaces (route + lead-intake core) evolved separately; lead-intake extracted the wrapper, the conversational route kept its inline copies.
- **Impact**: Low-risk but real maintenance drift — three places must stay in agreement on "consent failure is swallowed + logged, never fatal." A change to the policy (e.g. record a metric on failure) has to be made in three spots and the route's two copies can diverge from each other.
- **Fix sketch**: Lift a tiny `safeRecordConsent(entryId, source)` helper (mirroring the existing `safeStatusLink` already in route.ts at lines 32–39) and call it from both route sites; optionally have lead-intake's `recordLeadConsent` delegate to it. Keep distinct log prefixes if desired by passing a tag. Pure refactor, no behavior change.

## 4. Unused `buildApplyScript` import in the apply route
- **Severity**: Low
- **Category**: dead-code
- **File**: app/api/apply/[id]/route.ts:18
- **Scenario**: Line 18 imports `buildApplyScript` alongside the symbols the route actually uses (`applyKoSteps`, `applyDedupeKey`, `buildApplyProfileDraft`, `FALLBACK_ARCHETYPE`). `grep -rn 'buildApplyScript('` shows real call sites only at page.tsx:47 and inside apply.ts:255 (where `applyKoSteps` calls it). In route.ts the name appears only in the import (18) and a prose comment (264, "step ids from buildApplyScript") — never invoked. The route derives its KO ids via `applyKoSteps(job, t)` (line 238), not the full script.
- **Root cause**: Leftover from an earlier version where the route likely built the full script itself before `applyKoSteps` was extracted as the narrower public surface.
- **Impact**: Dead import — trips `noUnusedLocals`/eslint, and slightly muddies what the route depends on. Harmless at runtime.
- **Fix sketch**: Drop `buildApplyScript` from the import on line 18, leaving `import { applyDedupeKey, applyKoSteps, buildApplyProfileDraft, FALLBACK_ARCHETYPE } from "@/app/_lib/apply";`.

## 5. Stale comment references a non-existent apply GET route
- **Severity**: Low
- **Category**: cleanup
- **File**: app/apply/[id]/page.tsx:46
- **Scenario**: The comment reads "The GET route still serves the same script for any standalone use." `grep -rn 'export (async )?function GET|export const GET' app/api/apply` returns nothing — there is no GET handler in `app/api/apply/[id]/` (the route file exports only POST). The script is built server-side in `page.tsx` (line 47) and passed as a prop; nothing else consumes a GET. The comment describes a GET endpoint that either was removed or never existed.
- **Root cause**: The page was refactored to build the script server-side and hand it to the client as a prop (the surrounding comment block, lines 42–46, documents exactly that change), but the trailing sentence about the old GET fetch path was left behind.
- **Impact**: Misleading documentation — a maintainer may go looking for (or hesitate to delete) a GET route that isn't there, or assume a second consumer of the script exists.
- **Fix sketch**: Delete the final sentence on line 46 (keep lines 42–45, which correctly explain the prop hand-off and no-round-trip rationale).
