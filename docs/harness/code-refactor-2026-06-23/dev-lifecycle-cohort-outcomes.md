> Total: 5 findings (0c critical, 1h high, 2m medium, 2l low)

## 1. `getPosting` / `getPostingByToken` / `listPostings` repeat an identical Posting row→object mapping
- **Severity**: High
- **Category**: duplication
- **File**: app/_lib/db/devcase.ts:403-413 (listPostings), :419-429 (getPostingByToken), :620-630 (getPosting)
- **Scenario**: The same 8-field `Posting` projection (`id, caseId, channel, token, roleTitle, caseTitle, status, createdAt`) is hand-written three times. `getPostingByToken` and `getPosting` are byte-for-byte identical bodies — `diff` of the two function bodies shows the ONLY differences are the signature line and the SQL predicate (`WHERE token = ?` vs `WHERE id = ?`). `listPostings` repeats the same mapping a third time, adding `submissionCount`. Confirmed via `grep -n "caseId: (r.case_id as string)" app/_lib/db/devcase.ts` → 4 hits (lines 153/405/422/623; 153 is the unrelated lifecycle map).
- **Root cause**: Each read accessor was added independently (token lookup for the apply page, id lookup for the resend route W6-1) without extracting a mapper — even though the same file already uses the `rowToSubmission` / `rowToOutboxEntry` / `rowToSession` / `rowToLifecycle` helper pattern for every other entity.
- **Impact**: Any Posting shape change (a new column, a coercion fix) must be applied in three places; the two identical functions are a drift hazard — a fix to one lookup silently won't apply to the other. ~25 redundant lines.
- **Fix sketch**: Add `function rowToPosting(r: Record<string, unknown>): Posting { … }` (mirroring the existing `rowToSubmission`). Have `getPosting`/`getPostingByToken` return `r ? rowToPosting(r) : null`; have `listPostings` map `rowToPosting` then attach `submissionCount: Number(r.submission_count ?? 0)`. Behavior-preserving, fully covered by existing posting reads.

## 2. `revokeSkillProfile` is dead — exported but never called, with no revoke route or UI
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/_lib/db/skill-profiles.ts:128-131
- **Scenario**: `revokeSkillProfile(token)` is defined and re-exported through the db barrel (`app/_lib/db.ts:15 export * from "./db/skill-profiles"`) but has zero callers. `grep -rn "revokeSkillProfile" app` returns only its definition; there is no `app/api/skill-profile/[token]/revoke` route (the only skill-profile API routes are `skill-profile/route.ts` (issue) and `skill-profile/[token]/verify/route.ts`), no UI button calls it, and no test exercises it. Contrast the parallel `revokeChannelWebhook` and `revokeInterviewSession`, which each have a route + UI control wired (`grep` shows their callers). The revoked path IS otherwise plumbed read-side: `verifySkillProfileToken` / the `/skill/[token]` page render a "revoked" state — so the writer exists but nothing can ever set it.
- **Root cause**: Built proactively as the write half of the revoke contract (the read half — `revoked_at`, the verdict's `revoked`, the page badge — all ship), but the recruiter-facing revoke action was never added.
- **Impact**: A "verified" credential can never actually be revoked despite the UI advertising a revoked state — a latent gap masquerading as a feature, plus an unreachable export to maintain. Either dead code to remove or an unfinished feature to flag.
- **Fix sketch**: Decide intent. If revoke is wanted, wire a POST `app/api/devcase/skill-profile/[token]/revoke` route calling it (recruiter-triggered, mirroring the channels-webhook revoke). If not, delete `revokeSkillProfile` to drop the unreachable export. Do NOT silently leave it — the read-side already promises the capability.

## 3. `methodologyVersion` field always equals `version` — a redundant, never-read column
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/_lib/skill-profile.ts:22 (type), :59 (assigned `methodologyVersion: DSP_VERSION`)
- **Scenario**: `DurableSkillProfile.methodologyVersion` is set to `DSP_VERSION` — the exact same value already stored in `version` (also `DSP_VERSION`, line 56-ish). It is then signed and persisted as part of `profile_json`, but `grep -rn "methodologyVersion" app` shows it is NEVER read: the verify API summary (`verify/route.ts:25-32`) and the public page (`skill/[token]/page.tsx`) surface only `version`, `transferScore`, `confidence`, `issuedAt`, `axes`. `skill-profile.test.ts` doesn't reference it either.
- **Root cause**: Added as a forward-looking "methodology vs artifact-shape can version independently" hook, but both are pinned to the single `DSP_VERSION` constant and no consumer distinguishes them — so it's a duplicate of `version` today.
- **Impact**: A signed, persisted field that carries no independent information and is never displayed; it widens the signed payload and invites confusion ("which version field do I check?"). Low functional risk but real cognitive/maintenance cost.
- **Fix sketch**: Either drop `methodologyVersion` (and the type field) until methodology actually forks from artifact shape, OR introduce a distinct `DSP_METHODOLOGY_VERSION` constant and surface it where it matters. Changing the signed shape requires care (existing signatures recompute on the new shape), so prefer leaving issued rows alone and only adjusting `buildDurableSkillProfile` going forward — flag rather than rip out blind.

## 4. `unionChangedPaths` reimplemented inline in repo-snapshot.ts
- **Severity**: Low
- **Category**: duplication
- **File**: app/_lib/devcase-seed-diff.ts:37-45 (canonical) and app/_lib/repo-snapshot.ts:206-212 (inline copy)
- **Scenario**: The exported `unionChangedPaths` (dedupe of `files[].filename` with `.trim().replace(/\\/g,"/").replace(/^\.\//,"")` normalization) is duplicated as an inline loop in `repo-snapshot.ts`. `grep -rn "unionChangedPaths" app` confirms `repo-snapshot.ts` does NOT import it — it re-derives the same `changedSet` by hand, and a code comment at :204 explicitly says "Inline union (mirrors devcase-seed-diff.unionChangedPaths) to keep this module import-free for its colocated test."
- **Root cause**: A deliberate codebase convention — these dev-case helpers advertise "Pure + import-free so the contract is unit-testable under bare `node --test`," so repo-snapshot avoids importing to stay test-isolated.
- **Impact**: Low and intentional, but the two normalizers can drift (e.g. a future case-folding tweak applied to one and not the other would silently mis-match seed paths). Two copies of the same path-normalization rule.
- **Fix sketch**: Low priority given the documented intent. If consolidating, `repo-snapshot.ts` could import `unionChangedPaths` (it already imports from other libs) — or, to honor the import-free test rule, extract the one-line `normPath` into a shared zero-dependency util both call. Acceptable to leave as-is given the explicit rationale.

## 5. Interview-kit intro sentence duplicated between the Markdown export and the on-screen panel
- **Severity**: Low
- **Category**: duplication
- **File**: app/_lib/devcase-interview-kit.ts:32-34 and app/features/sub_dev/InterviewKit.tsx:66-69
- **Scenario**: The same explanatory blurb — "Each question verifies the candidate owns a real decision from their submission. … listen-for / red-flag notes are interviewer-internal" — is written twice: once in the exported Markdown (`interviewKitMarkdown`) and once as the rendered `<p>` in the UI panel. `grep -rn "Each question verifies the candidate owns a real decision"` returns exactly these two hits, with slightly different phrasings of the second clause ("never read them aloud" vs "are interviewer-internal").
- **Root cause**: The Markdown contract (copy/export) and the live panel were authored separately; both needed the same caption, and the wording was hand-copied rather than shared.
- **Impact**: Minor — the two captions can drift so the exported `.md` and the on-screen kit describe the same thing differently. Cosmetic/wording-consistency risk only.
- **Fix sketch**: Optional. Export the caption as a shared constant from `devcase-interview-kit.ts` (e.g. `export const INTERVIEW_KIT_CAPTION`) and render it in both places, or accept the minor divergence since UI copy and exported-doc copy legitimately differ in tone. Lowest priority of the set.
