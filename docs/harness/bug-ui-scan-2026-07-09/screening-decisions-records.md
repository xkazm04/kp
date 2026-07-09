# Screening Decisions & Records — bug-hunter + ui-perfectionist scan

> Context: Configure screening rules, run AI-assisted role decisions, reconsider candidates, and persist an auditable tamper-evident decision record. Covers the Decisions tab, compliance posture, and the screen-wave approval gate.
> Files reviewed: 16 of 25
> Total: 5

## 1. The "tamper-evident" decision chain is not evident against anyone who can write the DB

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: security / integrity-misrepresentation
- **File**: `app/_lib/decision-hash.ts:34-40`, `app/_lib/decision-record-store.ts:204-227`, surfaced by `app/api/decisions/records/route.ts:27`
- **Scenario**: A recruiter (or an operator under a discrimination complaint) edits one `decision_records` row in SQLite to change a rationale, reason code, or `candidate_ref` — then, because every input to the hash is public, recomputes that row's `content_hash` and every downstream row's `content_hash`/`prev_hash` with the same `sha256(prevHash + "\n" + canonicalize(payload))`. `verifyDecisionChain()` then returns `{ ok: true }`.
- **Root cause**: The chain is a **keyless** hash chain. `decisionContentHash` uses a plain `createHash("sha256")` with no HMAC secret, no signature, and no external anchor (no periodically published chain head). The cascade only detects tampering by someone who edits a row **without** rebuilding the chain — i.e. accidental/partial corruption. A deliberate insider with DB write access runs the exact same deterministic code and produces a valid chain. Yet the module, store, and `/api/decisions/records` all present this as "tamper-evident" for regulated adverse-action audit.
- **Impact**: The compliance value proposition (a defensible, tamper-evident audit trail for automated rejections) is materially weaker than claimed. Against the one adversary that matters for adverse-action legal exposure — a party with system access motivated to rewrite history — the chain provides no evidence at all.
- **Fix sketch**: Key the links: HMAC-SHA256 with a secret held **outside** the DB (env `KP_DECISION_HMAC_KEY`), so a rewritten row can't produce a valid MAC without the key. Additionally/alternatively anchor the chain head periodically to an append-only external sink. Then honestly scope the UI copy to what the mechanism guarantees. This makes silent row-editing impossible, not just detectable-if-clumsy.

## 2. The Art. 22 "who approved" field in the sealed record is caller-supplied, not authenticated

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap / audit-integrity
- **File**: `app/api/decisions/screen-wave/route.ts:50-55`, consumed by `app/_lib/screen-wave.ts:216,254,303`
- **Scenario**: A commit request to `/api/decisions/screen-wave` includes `approvedBy: "Jane Partner"`. The route takes that string straight from the body, and `runScreenWave` seals it into the immutable record (`inputs.approvedBy`) and the committed rationale (`… · approved by Jane Partner`). Nothing checks it against the authenticated session; the operator can attribute the human review to anyone.
- **Root cause**: The single most legally load-bearing field of the human-in-the-loop record — who reviewed the automated adverse decision — is an unverified client assertion, not derived from the session. `operatorApprover()` is only the fallback when the body omits it; a present value always wins.
- **Impact**: The "human-approved, not solely automated" claim the seal is meant to substantiate can name a person who never approved. Blast radius is limited today by single-operator + operator-gating, but the audit trail records an assertion, not a proof.
- **Fix sketch**: Ignore any client-provided `approvedBy`; derive the approver server-side from the authenticated session/operator identity. If per-user identity doesn't exist yet, seal `operatorApprover()` unconditionally so the record can't over-claim a specific reviewer.

## 3. Jurisdiction save is optimistic with no rollback, so a failed save silently diverges recruiter view from candidate disclosure

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption / silent-failure
- **File**: `app/features/sub_decisions/ComplianceSection.tsx:67-86`
- **Scenario**: A recruiter switches jurisdiction from EU to US. `pick()` calls `setJurisdiction(j)` optimistically, then POSTs. The POST fails (network/500). The catch only does `setNote(t("saveFailed"))` — it never reverts `jurisdiction`. The panel now shows US selected plus the US named instruments and the four-fifths standard, while the server and the public candidate-facing `/api/compliance` disclosure still return EU. Also, rapid successive picks fire overlapping POSTs with no sequencing, so the last-persisted value can differ from the last-selected one.
- **Root cause**: Optimistic UI without a committed-state fallback and without response ordering. The rendered `regime = getRegime(jurisdiction)` derives entirely from the optimistic value, so the whole posture block asserts a framing that was never persisted.
- **Impact**: The recruiter believes candidates are seeing (e.g.) the correct US FCRA/EEOC framing when the disclosure still says GDPR — a compliance-relevant misstatement that surfaces no error beyond a small "save failed" note that's easy to miss.
- **Fix sketch**: Keep a `savedJurisdiction` ref; on failure revert `setJurisdiction(savedJurisdiction)`. Disable the `<Select>` (or use an AbortController + latest-request token) while `saving` so a stale response can't overwrite a newer selection.

## 4. The four-fifths adverse-impact check silently drops malformed input lines, which can flip the verdict

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: validation-gap / missing-error-state
- **File**: `app/features/sub_decisions/ComplianceSection.tsx:24-36,89-90` (with `app/_lib/adverse-impact.ts:67-104`)
- **Scenario**: A recruiter pastes group counts; one line is mistyped ("Female, 12" — only two fields, or a stray non-numeric). `parseGroups` `continue`s past it with no feedback. Because the reference group is "highest selection rate among whatever parsed" (`computeAdverseImpact`), dropping a line can change which group becomes the reference and flip a group between "OK" and the coral "adverse impact" status — on a check the panel presents as an authoritative fairness result.
- **Root cause**: Silent skip on parse failure, and a single empty/hint state (`aiCheckHint`) that can't distinguish "no input yet" from "your input didn't parse and was computed on a subset."
- **Impact**: A recruiter can read a confident adverse/OK verdict computed on fewer rows than they pasted, with nothing telling them rows were ignored — misleading on a compliance surface.
- **Fix sketch**: Show a parse summary near the textarea ("3 of 4 rows read; row 2 ignored — expected `group, selected, total`") and render a distinct malformed-input state instead of quietly computing on whatever parsed. Reuse the `aria-live` note pattern already in the panel.

## 5. [STILL-OPEN] The irreversible screen-wave commit is one click from preview, with a title-only disabled reason

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: unguarded-destructive-action / a11y
- **File**: `app/features/sub_decisions/ScreenWaveModal.tsx:213-221`
- **Scenario**: In the wave modal, "Reject and notify N" is one click from the preview; clicking it irreversibly flips statuses, queues rejection emails, and seals records for the whole previewed cohort. When the button is disabled, the reason lives only in `title` (`enableToCommit` / `nothingToReject`) — not announced to screen readers, invisible to keyboard/touch users. Still present since the 2026-06-20 report (#5).
- **Root cause**: The server-side approval-token gate defends against a **stale** set (409 → re-preview), but not against an accidental click on a **fresh** one; the preview doubles as the review, so there is no explicit second confirmation before the emailed, sealed, irreversible dispatch. Disabled-state reasoning is `title`-only.
- **Impact**: One misclick fires a batch of irreversible, emailed, audited candidate rejections; assistive-tech users get no explanation for the greyed-out primary action. It still matters because this is the highest-stakes action in the context and the token gate does not cover accidental commits.
- **Fix sketch**: Add an inline `aria-live` helper line beside the button carrying the disabled reason, and a lightweight two-step confirm ("Confirm rejection of N candidates") reusing the existing `Modal` stack before dispatch.
