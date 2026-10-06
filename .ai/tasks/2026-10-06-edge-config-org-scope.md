# The edge pairing belongs to the organization that saved it

Branch `autopilot/codebase-security-scan-89dfcccd`, cut from the `main` tip
`189bb1e4`. Three commits: the red proofs, the fix, then the ADR the pattern now
owes.

**Naming.** This is the App Master's queue item **F-3**, the third table in the
org-owner pattern after `ats_config` (F-1, `17c2bbe9d`) and `comms_relay_config`
(F-2, `189bb1e4e`). It is *not* the F-3 of
`.ai/tasks/2026-10-06-security-scan-ats-mirror.md` (the mirror-retry finding,
ADR 0013), which is untouched here.

Checked first, as the brief asked: `edge_config` on `main` had no `owner_org_id`
column, so nothing was already shipped.

## The defect

`edge_config` (`app/_lib/edge-config.ts`) is ONE row — `CHECK (id = 1)` — with no
owner, and two things reach across the organization boundary through it.

1. **The doors.** `POST /api/edge` and `POST /api/edge/pair` are gated on
   `org:manage`, which is held **per organization**. So any owner of any
   organization could re-point the install's edge, unpair it (which resets the
   drain cursor, skipping every event below it) or re-key the pairing — i.e.
   rewrite the single inbound transport every organization on the install depends
   on.
2. **Receipts.** A delivery receipt drained from a UI-saved edge carries only
   `(ref, kind, outcome)`, and `ref` alone decides whose outbox gets a `bounced`
   row (`comms-receipt.ts` `receiptWorkspace`). A ref naming another
   organization's pipeline entry filed a red row into that organization's Comms
   Center, from this organization's edge.

## Why the shape differs from F-2 — deliberately

`edge_config` is **install-level by design**: `ensureEdgeKeypair` mints one
sealing keypair and never rotates it, there is one drain cursor, one URL. Drained
lead/mail events are routed per event by their **receiver token**
(`ingestInboundLeadByToken`), which is a workspace capability — so the tenancy is
already carried per event by the thing that authenticates it.

Org-checking leads would therefore turn one organization's pairing into a filter
on every other organization's inbound mail and webhooks: inbound would work for
the owner and silently stop for everyone else. That is a worse failure than the
one being fixed, and the lead branch of `applyEvent` now says so in a comment —
the asymmetry with the receipt branch a few lines above is exactly what a later
reader would "correct".

## What changed

1. **Schema.** `owner_org_id TEXT`, nullable, no default, through `addColumns()`
   (`app/_lib/db/add-columns.ts`). The two existing ALTERs (`last_error_kind`,
   `pending`) moved onto it and the swallow-all `try/catch` loop is gone, so
   `app/_lib/edge-config.ts` leaves the `CEILING` map in
   `app/_lib/db/store-migrations-guard.test.ts` entirely (the ratchet tightens by
   one). `EdgePublicConfig` and `ResolvedEdge` both gain `ownerOrgId` — it is an
   id, not a secret, and `ResolvedEdge` already carried `source`.

2. **Write side.** `setEdgeConfig` takes `ownerOrgId` — the **caller's** org — and
   it is both the authorization and the stamp. The refusal
   (`EdgeOwnershipError`, which subclasses `EdgeConfigError` so existing
   `instanceof` catches still see it) is raised **inside the write's own IMMEDIATE
   transaction**, not as a read before it: a concurrent save landing between a
   pre-check and the write would hand the pairing to an org the call never
   authorized, and a throw inside the transaction rolls it back so nothing is
   written. Unpairing (`url: ""`) clears the owner as well as the cursor, so an
   unpaired install is claimable by whoever pairs it next.

   `POST /api/edge` reads `currentOrgId(await currentSession()) ?? DEFAULT_ORG_ID`
   and spreads it over the body, exactly as `/api/comms/relay` does, so an
   `ownerOrgId` in the request body has no effect. `POST /api/edge/pair` calls the
   exported `assertEdgeWritableBy(...)` **before** `pairEdge`, i.e. before
   `ensureEdgeKeypair` mints the never-rotated keypair and before any fetch; it is
   a plain read there, because publishing a key does not rewrite the pairing and
   there is nothing for a concurrent save to clobber. Both answer **403
   `EDGE_OWNED_BY_OTHER_ORG`** via `jsonRefusal`, checked before the existing
   `EdgeConfigError` branch so an authorization answer is not reported as a bad
   field. `POST /api/edge/drain` is unchanged — it runs what the clock runs — and
   `GET /api/edge` only gained `ownerOrgId`.

3. **Receipts.** `applyEvent` now takes the whole `ResolvedEdge` and checks the
   boundary **only when `edge.source === "config"`**. The env pairing
   (`KP_EDGE_URL`) is host-level and not org-checked, as the env relay is in F-2,
   and env is told from config by `source` — never by a null owner, because a
   legacy stored row has one too and that one *is* checked. The ref's org is
   resolved the way `crossOrgRefusal` resolves a message's (entry → team → org,
   NULL folding to the default org) through a new `receiptOrgId` export in
   `comms-receipt.ts`; an unplaceable ref answers `null` and is left to the
   existing `unknown_ref` refusal rather than folded to the default org. A
   mismatch returns **`skipped`**, never `hold` — a hold wedges the queue behind
   bytes the edge will hand back forever — logs a line naming the two org ids and
   nothing else, and files no outbox row.

4. **NULL on either side is `DEFAULT_ORG_ID`.** A row written before the column
   existed, and a team with no `org_id`, both fold to `org-default`. Every shipped
   single-org self-host is unchanged, and the boundary only bites where there
   really are two organizations.

Also updated: the `edge_config` comment in `app/_lib/tenancy.ts` (still EXEMPT,
still install-level, but it now records its owner — with the door/receipt boundary
and the env exemption in one sentence), §9 and §11's tenancy note in
`docs/concepts/local-first-edge.md`, the L1 edge section of
`docs/features/comms/README.md` (the doc the source→doc map couples
`app/_lib/edge-*.ts` and `app/api/edge/**` to), and a third bullet beside the ATS
and relay owner paragraphs in `docs/features/integrations/README.md`.
`docs/features/organization/README.md` describes neither owner rule, so it got
nothing — the brief made that conditional.

New refusal code `EDGE_OWNED_BY_OTHER_ORG` in `REFUSAL_ERRORS`
(`app/_lib/api-response.ts`) plus its four catalog entries, on
`EDGE_CONFIG_REJECTED`'s exact path.

## The ADR

`docs/architecture/decisions/0014-org-owned-singleton-integration-config.md`,
listed in the index and in the routing list above it. It states the rule for all
three tables with each one's commit, and names F-3's **variant** — where the
config is the install's shared transport, the boundary is on the doors and on
ref-addressed effects, not on per-event delivery. Consequences recorded:
`KP_MULTI_ORG` installs share one edge and one relay owner; a per-org edge means a
per-org keypair and cursor and is out of scope; and the sharpest edge of the
design — a new *writer* that forgets to pass the caller's org stamps NULL, which
silently means the default org.

## Proofs — `app/_lib/edge-org-scope.test.ts`

Committed RED first (`655239df`), green after the fix. The "before" column was
measured with the **final** test file against the pre-fix sources (the fix's six
source files checked out from the red commit's tree, then restored), so the table
is the same eight assertions in both states rather than two different files.

| | | before |
|---|---|---|
| (a) | org B's `POST /api/edge` on a row org A paired → 403 `EDGE_OWNED_BY_OTHER_ORG`, url and owner unchanged | **red** |
| (b) | org A re-saving its own pairing lands and keeps the owner | **red** |
| (c) | a legacy NULL-owner paired row is writable by a default-org caller and refused to a non-default org | **red** |
| (d) | after an unpair the owner is cleared and the next org to pair becomes owner | **red** |
| (e) | `POST /api/edge` stamps the session's org and ignores `ownerOrgId` in the body | **red** |
| (f) | a drained receipt whose ref is another org's is skipped and files no row, while the owner's own ref files its `bounced` row (the control, in the same test) | **red** |
| (g) | with `KP_EDGE_URL` + `KP_EDGE_SECRET` set, the receipt for another org's ref is NOT refused | green (the control) |
| (h) | a lead event for another org's receiver token still applies | green (the control) |

6 red, 2 green → 8 green. (g) and (h) are the invariants F-3 must **not** change,
so they are green on both sides; without them "nothing was delivered" would be
indistinguishable from the fix having broken the edge outright, and (f)'s control
half plays the same role for the receipt path.

Pipeline/org/workspace helpers are imported from their **slice** modules
(`./db/pipeline.ts`, `./db/organizations.ts`, `./db/workspaces.ts`,
`./db/channels.ts`), never the `db.ts` barrel — `perf-budget.json` caps barrel
importers.

### Two adjustments the proofs forced

- **The pairing is released between proofs.** `edge_config` is one install-level
  row, so a pairing left owned by the previous test refused the next test's own
  setup, and the refusal under test became indistinguishable from the fixture
  failing. The `afterEach` unpairs as the current owner — the only authorized way
  back to unowned, and itself the shape (d) asserts.
- **Sequence numbers climb across the whole file.** The drain cursor is
  install-level too, and a `seq` at or below it is correctly discarded as
  already-applied — which first made (g) and (h) fail for a reason that had
  nothing to do with the org boundary.

- **The refusal is matched by the error's NAME**, not by importing
  `EdgeOwnershipError` at the top of the file: a missing top-level import would
  have made the red commit one module error instead of eight separate verdicts.

## Gates

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass — 0 errors, 49 warnings (all pre-existing, none in the touched files) |
| `npm run test:unit` | pass — 12767/12767 |
| `npm run i18n:check` | pass — 4 locales in parity, 13839 strings each |
| `npm run docs:check` | pass (ADR 0014's `sources:` paths and the index) |

`test:perf` and `test:docs` were **already red on the base commit** for reasons
that are not this change's, and neither got worse:

| | before | after |
|---|---|---|
| `test:perf` (static import-graph budget) | 58 over-budget entries | 58, and no entry naming `app/api/edge/**` or a comms route |
| `test:docs` | fails on `missing doc: docs/design/app-contest-kit.md` (untracked in the operator's checkout) | same single failure |

The perf count mattered here: `edge-config.ts` gained an import of
`db/organizations.ts` (for `DEFAULT_ORG_ID`) and `comms-receipt.ts` one of
`db/org-benchmarks.ts` (for `orgIdForWorkspace`), either of which could have
pushed a route over its module ceiling. Measured before and after: unchanged.

Three generated files (`app/_lib/*.generated.ts`) are rewritten with CRLF by
`schemas:gen` on Windows with no content change; they were restored rather than
committed.
