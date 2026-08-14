# Enterprise Readiness — the backlog to ship KP into corporate companies

_Scope date: 2026-07-05, verified against code 2026-07-30. Companion to the
**Enterprise** contact-sales tier (`app/_lib/billing/plans.ts`, `contactSales: true`;
landing band + Billing-tab card, see `docs/features/billing/README.md`). This is the
honest engineering backlog behind that tier: what a corporate buyer — think Česká
spořitelna, the seeded target customer — actually requires in their security/
procurement review before they can sign, and the sequenced work to get there.
Requirements requested: **SOC 2 & adjacent standards, enterprise SSO, audit
expansion, brand customization, a licensed self-host option for full control of the
model + data layer, GDPR/DPA compliance.**_

> **How to read this.** Each track states *why a corporate buyer blocks on it*,
> *what already exists in this repo we can build on*, *the gap*, and *the work
> items*. The catch: almost every enterprise feature is gated on one foundation —
> **real multi-tenancy + user identity** — which is now shipped (§1). §2–§8 are the
> tracks; §9 sequences them; §10 lists the assets that de-risk the whole thing; §11
> is the append-to-backlog row set.

---

## 1. The gating insight: no enterprise feature exists without tenancy + identity

The single fact that shapes this entire backlog (from
`docs/features/organization/README.md`, the org/team/user model):

> **E0 is DONE.** Both halves below have landed on `main`.

- **Identity, shipped.** `organizations`, `users`, `memberships`, `invites`;
  per-user **login/logout/switch-workspace**; sessions carry `sub`/`org`/`role`; a
  real **RBAC** layer (5 roles + capabilities + per-user overrides) with
  `requireCapability()` resolved live from DB membership. Open-mode + operator-
  password sessions fold to owner, so local dev is unchanged.
- **Tenancy scoping, shipped.** `tenancyGaps()` is ZERO and
  `assertTenancyReady(multiWorkspace=true)` passes. Every per-team table's read+write
  paths are workspace-scoped, proven by **20+ colocated `*-tenancy.test.ts`** source
  guards: the pipeline (highest-PII), jobs corpus (shared-tier), channels, schedule
  (per-team calendar), dev-case + onboarding flows, offers/status-links/
  skill-profiles (by-token, safe-by-key), interviews, the background-task queue
  (UI scoped / runner global), and `decision_records` — the tamper-evident hash
  chain, **re-architected to per-tenant chains** (§3's hard item).
  Org/deployment CONFIG + METERING (`billing_*`, `provider_keys`, `brand_settings`,
  `ats_config`, `analytics_targets`, `decision_config`, `jd_templates`, `llm_usage`) is
  classified **exempt** (org-level, not per-team).

- **The console, shipped.** Settings → Workspaces administers teams *and* the
  people on them, in two lenses (by workspace / by person). Memberships were
  always many-to-many; the UI now says so, so one person can hold different roles
  on several teams. `app/_lib/auth/org-authority.ts` states the authority split it
  runs on: administrative capability is **org-wide**, operational capability stays
  **per workspace**. The workspace routes enforce org and membership boundaries
  (`switch-workspace` requires a real seat; `GET /api/workspaces` is org-filtered;
  `POST` is `team:manage`-gated and seats its creator).

**Remaining before the actual `KP_MULTI_WORKSPACE` flip:** per-workspace
export/import is the real blocker — `/api/workspace/export` dumps the whole DB and
`/api/workspace/import` answers 503 once the flag is on, so enabling
multi-workspace disables restore. Billing seats (§6) are the other. The earlier
last-mile list (entry-id scheme, `tasks` dedup index, inbound lead-intake
threading, workspace-blind attention badges and public status/NPS reads) is
**closed** — verified in `app/_lib/tenancy.ts` and
`docs/features/organization/README.md`. The **data layer** — the hard, exhaustive
part — is complete. Full detail: `docs/features/organization/README.md` (Known gaps).

**Consequence — the E0-gated pillars are now UNBLOCKED:** SSO can provision *users into
roles* (they exist), audit can stamp the real `userId`, and the decision chain is already
per-tenant. **E1 (SSO) is the highest-value next step.**

---

## 2. Enterprise SSO & RBAC

**Why buyers block on it.** No enterprise IT will hand out a shared password.
They require SAML/OIDC against their IdP (Okta / Entra ID / Google Workspace),
**SCIM** so joiners/leavers provision and *deprovision* automatically (a
leaver keeping access to a candidate database is an audit finding), enforced SSO
(password login disabled for the org), and roles mapped from IdP groups.

**What exists.** Identity + RBAC per §1: real per-user login, five roles with
server-side capability checks. A fail-closed edge proxy with a public allow-list
(`proxy.ts`); an HMAC-signed session that now carries `sub`/`org`/`role`.
Encryption-at-rest for secrets (`KP_SECRET`, AES-256-GCM).

**Gap.** SAML/OIDC, SCIM, JIT provisioning, enforced-SSO toggle, per-session
revocation (today's stateless 7-day token can't be revoked).

**Work items.**
- ~~**E-SSO-1** Identity model + per-user login~~ — **DONE** (§1).
- **E-SSO-2** SAML 2.0 + OIDC (SP- and IdP-initiated), JIT provisioning, IdP-group
  → role mapping, enforced-SSO toggle per org. **Recommend an SSO provider
  (WorkOS / Stytch / Auth0-Enterprise)** over hand-rolling SAML — it collapses
  this to weeks and ships SCIM with it. — **L** (M with a provider)
- **E-SSO-3** SCIM 2.0 provisioning + **deprovisioning** endpoint. — **M**
- **E-SSO-4** Server-side RBAC: enforce the five roles on every mutating route. —
  **Largely DONE** via `roleCan`/`resolveCapabilities` (`app/_lib/auth/roles.ts`);
  audit remaining routes for full coverage.
- **E-SSO-5** Per-session revocation + session list (kill a device/leaver now). — **S–M**
- **Depends on:** E0 (done). **Blocks:** SOC 2 access-control criteria, audit actor.

---

## 3. Audit expansion

**Why buyers block on it.** Security review and (for a bank) the regulator want a
tamper-evident, **exportable** log of *who did what to which candidate's data,
when* — logins, role changes, config changes, data exports, and every automated
decision. GDPR Art. 30 (records of processing) and the EU AI-Act Art. 14/26
(logging of high-risk AI decisions) both lean on this.

**What exists — a genuine head start.** `decision_records` is a **per-tenant
tamper-evident hash chain** (re-architected per §1) with a `verifyDecisionChain()`,
and the product's whole architecture puts **a human signature on every gate**
(offer, disposition, hire) — exactly the audit primitive enterprises want. There's a
LLM usage ledger (`llm_usage`) and AI-provenance disclosure work in flight.

**Gap.** The chain is (a) scoped only to hiring *decisions*, not admin/security/
data-access events, (b) keyed to `actor` role strings in places, not always real
users, and (c) not exportable to a SIEM.

**Work items.**
- ~~**E-AUD-1** Re-architect the decision chain to per-tenant chains~~ — **DONE** (§1).
- **E-AUD-2** Broaden coverage to an `audit_events` stream: auth events, role/seat
  changes, config changes, PII reads, data exports, billing changes — each
  stamped with the real `userId` (now possible given E0/E-SSO). — **M–L**
- **E-AUD-3** Export + retention: signed CSV/JSON export, SIEM webhook, immutable
  retention window per contract. — **M**
- **E-AUD-4** Admin audit viewer in the Organization console. — **S–M**
- **Depends on:** E0 (done), E-SSO-1 (done). **Feeds:** SOC 2, GDPR RoPA, AI-Act.

---

## 4. Brand customization (white-label)

**Why buyers block on it.** Candidates must see *the employer's* brand on offer
letters, the apply form, self-scheduling, and the voice screen — not a vendor
logo. For a bank, an off-brand candidate touchpoint is a marketing/compliance
problem, not a nicety.

**What exists — a strong foundation.** The app already ships a **dual-theme
token system**: `[data-theme]` re-skins everything through CSS variables in
`app/globals.css` (`docs/design/README.md`),
with a recipe layer (`app/_components/ui/recipes.ts`). Comms are **already
templated per locale** (`render-template.ts`).

**Gap.** No custom domain / sender per-org beyond the single-deployment story;
per-tenant subdomains still gate on multi-workspace going live.

**Work items.**
- **E-BRD-1** Per-org brand settings store (accent color, display name, logo) +
  admin editor. — ✅ **DONE:** `brand_settings` store (`app/_lib/brand-config.ts`),
  `GET/PUT /api/brand` (operator-gated, strict validation), and a **Branding tab**
  (`app/features/settings/branding/`) with a live-preview editor. Logo is
  https-URL for now (upload = follow-up).
- **E-BRD-2** Inject brand tokens per tenant at render. — ✅ **DONE:** a server
  `BrandStyle` component (root layout) overrides the `--color-coral` accent token
  in BOTH themes, re-skinning the whole app **and the candidate-facing offer/
  apply/schedule pages** (they share the layout). Accent is strictly hex-validated
  (no CSS injection).
- **E-BRD-3** White-label the **candidate-facing** surfaces (offer / apply /
  schedule / voice) + branded email/letter templates + custom sender/reply-to. —
  🟡 **mostly DONE:** the accent re-skins the candidate pages, and the brand name +
  logo replace the KandiDate mark in both sidebars via a `BrandProvider` +
  `BrandHeader`. Remaining: branded email/letter copy + sender/reply-to.
- **E-BRD-4** Custom domain / subdomain (CNAME + managed TLS). — ✅ **DONE for
  single-deployment:** documented in `docs/architecture/self-hosting.md` §8b (DNS
  CNAME → reverse proxy TLS + `NEXT_PUBLIC_APP_BASE_URL`/`SITE_URL`). Per-tenant
  subdomains (host-based tenant resolution + wildcard TLS) gate on
  `KP_MULTI_WORKSPACE` going live (§1).
- **Depends on:** E0 (done, per-tenant store). **Low technical risk** — the theme
  seam already exists.

---

## 5. Licensed self-hosting — full control of the model + data layer

**Why buyers block on it.** The requested "licensed open sourcing so companies
have full control over models and data layer" is the classic regulated-enterprise
ask: run it **in our VPC / on-prem, with our models, our database, no data leaving
our boundary, and source access to audit it.** For a bank handling candidate PII
under GDPR, data egress to a third-party SaaS is often a hard blocker.

**What exists — much of the control story is already true.** **BYOM** already
routes *all* AI to the customer's own keys/providers (Gemini, OpenAI, Azure,
Anthropic; ElevenLabs for voice) via a provider-agnostic LLM layer
(`docs/architecture/llm-provider-layer.md`) — "full control over models" is 80%
there. The billing provider sits behind a swappable `BillingGateway`; LightTrack
telemetry is optional; persistence is a single SQLite file (portable). A
Dockerfile/deploy story is already shipped.

**Gap.** No license model; SQLite→Postgres for a real multi-user deployment; a
Models-tab base-URL field for self-hosted endpoints.

**Work items.**
- **E-SH-1 (decision, founder + counsel)** Licensing model. Recommend
  **source-available** (BSL 1.1 / Elastic / Fair-Core) — gives the customer source
  access + the right to self-host and audit *without* open-sourcing the commercial
  core. True OSS (MIT/Apache) gives away the business; pick deliberately. — **decision**
- **E-SH-2** Packaged deploy: Dockerfile, `docker-compose` / **Helm chart**, prod
  env checklist, license-key gating. — ✅ **DONE (first increment):** multi-stage
  `Dockerfile` (Node 24 + Python, native better-sqlite3, non-root, tini),
  `docker-compose.yml`, `.dockerignore`, `.env.example` deploy block, and
  **`docs/architecture/self-hosting.md`** (quick-start, egress inventory, air-gap
  notes, production checklist). Image slimmed via Next `output:"standalone"`
  (traced server + minimal node_modules): 1.78 GB → 465 MB. Helm chart at
  `deploy/helm/kp`: single-replica + Recreate + RWO volume, fail-closed required
  secrets, existingSecret support, ingress, non-root securityContext. Remaining:
  license-key gating (gated on the E-SH-1 license decision).
- **E-SH-3** **Postgres** backend (for multi-replica HA; SQLite+WAL already handles
  KP's 1–2-user-per-team concurrency) behind the existing DB seam. — 🟡 **SCOPED +
  seam landed:** full design/decision doc `docs/architecture/postgres-backend.md`
  — the real blocker is the sync→async DB API (512 sync query sites / 48 files),
  not the SQL; recommends evaluating **distributed-SQLite** (LiteFS / libSQL /
  Turso) for multi-replica *before* a Postgres port. Shipped: the
  `resolveDbBackend()` config seam in `app/_lib/db-path.ts` (fails fast for
  postgres) + a living `pg-portability` audit (`npm run db:pg-audit` + test). The
  migration itself is a dedicated multi-week project, deliberately not started.
- **E-SH-4** **Air-gap / no-egress mode**: a switch that hard-disables every
  external call except the customer's own model endpoints. — ✅ **DONE:**
  `KP_OFFLINE=1` installs a startup `fetch` egress guard (Node,
  `app/_lib/offline.ts`) that refuses any host outside the configured allowlist
  *before the socket opens* (GitHub/Polar/JS-SDK/voice), gates cloud LLM engines
  to deterministic on the Python side (`pipeline/jobfit/llm/offline.py`;
  self-hosted OpenAI + Azure stay usable), and disables Polar billing.
  `KP_OFFLINE_ALLOW_HOSTS` extends the allowlist. Docs:
  `docs/architecture/self-hosting.md` §7.
- **E-SH-5** First-class **self-hosted model endpoints** (Azure OpenAI in-tenant,
  vLLM/Ollama base-URL) — extends BYOM to fully private inference. — ✅ **DONE:**
  the OpenAI adapter takes a `base_url` (from `KP_LLM_CONFIG` `keys.openai.baseUrl`
  or the `OPENAI_BASE_URL` env) and runs **keyless** against vLLM/Ollama/LiteLLM;
  Azure stays isolated on its own endpoint. Docs:
  `docs/architecture/self-hosting.md` §5. Follow-up: a Models-tab base-URL field
  (needs the SSRF-guard relaxed for operator-owned self-host, gated off on the SaaS).
- **E-SH-6** **Data residency**: pin managed hosting to EU regions; document data
  flows. — **S–M** (policy + config)
- **Depends on:** E0 (done) for a credible multi-user self-host.

---

## 6. SOC 2 (+ ISO 27001 adjacency)

**Why buyers block on it.** SOC 2 Type II is the default trust artifact US/EU
enterprises ask for; a bank may also want ISO 27001. It is **not a feature you
ship** — it's an attestation of a *control set operating over 3–6 months*, signed
by an external auditor. The engineering job is to build and evidence the controls;
the rest is time + auditor cost.

**What exists.** CI running typecheck/lint/tests → change-management evidence.
Secret encryption at rest. Fail-closed auth proxy. A test culture.

**Gap.** The controls that depend on other tracks (access control = E-SSO, audit
logging = E-AUD), plus vendor management (sub-processors: Polar, Gemini, OpenAI,
ElevenLabs), encryption-in-transit policy, incident-response runbook, backup/DR,
access reviews, and a pen test.

**Work items.**
- **E-SOC-1** Control-set gap assessment against the SOC 2 Trust Services Criteria;
  pick a compliance-automation platform (Vanta / Drata / Secureframe). — **M**
- **E-SOC-2** Policies + runbooks (incident response, access review, change mgmt,
  vendor mgmt, business continuity). — **M** (mostly writing, some tooling)
- **E-SOC-3** Evidence automation wired to the platform; independent **pen test**;
  then the **Type I** point-in-time, then the **Type II** observation window. — **L + calendar/$$**
- **Depends on:** E-SSO (access control), E-AUD (audit logging). **Runs as a
  wrapper** over the controls built in E0–E4; start the gap assessment early.

---

## 7. GDPR / DPA compliance

**Why buyers block on it.** Non-negotiable for EU hiring on candidate PII —
doubly so for a bank. Procurement will demand a **DPA**, a sub-processor list, a
**DPIA** (mandatory for AI-assisted candidate evaluation), records of processing,
data-subject rights, EU residency, and Art. 22 safeguards for automated decisions.

**What exists — meaningfully ahead here.** Consent capture (`consent_events`),
config-driven retention (`KP_CONSENT_TTL_DAYS`), working erasure links, a GDPR
extensions doc (`docs/_archive/GDPR_AND_HIRING_EXTENSIONS.md`), and — critically — **a
human on every decision gate**, which is the strongest possible answer to GDPR
Art. 22 ("no solely-automated decision with legal/significant effect"). The
AI-Act conformity mapping is done: `docs/features/compliance/ai-act-conformity.md` — Annex III pt. 4
classification, per-article conformity map with code evidence, gap register
G1–G14, Annex IV skeleton, and a deployer quick-sheet. E-GDPR-2's DPIA folds
into its G1.

**Gap.** Legal artifacts (DPA template, RoPA, DPIA), sub-processor list + change
notification, full data-subject-rights flow (access/portability/rectification, not
just erasure), breach-notification runbook (72 h), and EU-pinned residency.

**Work items.**
- **E-GDPR-1** DPA template + sub-processor register + change-notification process. — **M** (legal + eng)
- **E-GDPR-2** DPIA for the AI candidate-evaluation pipeline (leans on the
  human-in-loop gates + audit trail as mitigations); fold in the AI-Act map. — **M**
- **E-GDPR-3** Complete data-subject rights: access + **portability** export +
  rectification, alongside the existing erasure. — **M**
- **E-GDPR-4** RoPA (Art. 30) generated from the audit stream (E-AUD-2). — **S–M**
- **E-GDPR-5** EU data residency guarantee (managed + self-host paths). — **S–M**
- **Depends on:** E-AUD (RoPA/logging); strengthened by the existing gate model.

---

## 8. Org-level billing with seats (the commercial plumbing)

The Enterprise tier is contact-sales, but a *signed* enterprise still needs
org-level billing: one bill per company, seats = users, quotas at the org
(not per-deployment). This is org-plan Phase 3 — `org_id` key on the billing
tables, seat quantity in checkout + webhook, seat enforcement vs. memberships,
per-team metering, `llm_usage` attribution. — **M–L.** Not a security blocker, so
it sequences after the trust tracks, but it's what turns a signed contract into a
serviced account. See `docs/features/billing/README.md` (Known gaps) and
`docs/features/organization/README.md` (Known gaps).

---

## 9. Sequenced roadmap

| Phase | Theme | Contains | Rough effort | Gated by |
|---|---|---|---|---|
| **E0** | **Tenancy + identity foundation** | Org/User/Membership/Invite model; per-user login; `workspace_id` scoping; boot-guard fix; per-tenant export (still open, see §1) | **DONE** (data layer) | — |
| **E1** | **Enterprise SSO & RBAC** | SAML/OIDC + SCIM (recommend a provider), enforced SSO, server-side roles (mostly done), session revocation | **L (M w/ provider)** | E0 (done) |
| **E2** | **Audit + GDPR/DPA** | Per-tenant audit chain (done) + broad event coverage, export; DPA/DPIA/RoPA/residency; AI-Act map (done) | **M–L** | E0, E1 |
| **E3** | **Brand / white-label** | Per-org brand store + token injection (done); white-label candidate surfaces + comms (mostly done); custom domain (done single-deployment) | **M** | E0 |
| **E4** | **Self-host / licensed** | License decision (open); Docker/Helm (done); Postgres (scoped); air-gap mode (done); self-hosted model endpoints (done); residency | **L** | E0 |
| **E5** | **SOC 2 (+ ISO 27001)** | Gap assessment → policies → evidence + pen test → Type I → Type II | **L + 3–6 mo clock + $$** | E1, E2 (consumes their controls) |
| **E6** | **Org billing + seats** | Org-keyed billing tables, seat quantity + enforcement, per-team metering | **M–L** | E0 (done) |

**Critical path:** E1 → E2 unblock the two things *every* security review gates on
(SSO and audit breadth) plus the legal pack, now that E0 has landed. E3/E4/E6
parallelize. **Start the E5 gap assessment early** (it's calendar-bound) but it can
only *finish* once E1/E2 controls are operating. This is a multi-quarter program,
not a sprint — the honest headline for a buyer is "on the roadmap, delivered with
your security and DPO teams during onboarding," which is exactly what the landing
band now says.

---

## 10. Assets that de-risk this (why it's realistic, not a rewrite)

- **Tenancy + identity foundation** — shipped (§1): `organizations`, `users`,
  `memberships`, `invites`, real per-user sessions, RBAC, zero tenancy gaps.
- **Provider-agnostic billing** (`BillingGateway`) — seats/Paddle/self-host swap
  is bounded to one file.
- **Dual-theme token system** — brand customization is a per-tenant token set, the
  cheapest possible layer (§4).
- **Per-tenant decision hash chain + human-on-every-gate** — the audit and
  GDPR-Art.22 primitives already exist; the work is broadening coverage (§3, §7).
- **BYOM multi-provider LLM layer** — "full control over models" is largely done;
  extend to private endpoints (§5, done via E-SH-5).
- **Secret encryption at rest** (`KP_SECRET`, AES-256-GCM) + **fail-closed auth
  proxy** + **CI gates** — SOC 2 control seeds already in place (§6).
- **Consent / erasure / retention / locale** — GDPR is meaningfully ahead (§7).

---

## 11. Backlog rows (also appended to `.claude/ship-loop/backlog.md`)

Numbering continues the ship-loop backlog; `Dim` uses its scheme (2-Func / 6-Sec /
9-Value). Each row points back here.

| S | Dim | Size | Item |
|---|-----|------|------|
| ✅ | 2-Func | L | **E0 Tenancy + identity foundation** — shipped; see §1. → §1 |
| ☐ | 6-Sec | L | **E1 Enterprise SSO & RBAC** — SAML/OIDC + SCIM (recommend WorkOS/Stytch), enforced SSO, session revocation. Server-side roles mostly done. → §2 |
| ☐ | 6-Sec | L | **E2a Audit expansion** — per-tenant decision-chain (done) + broad `audit_events` (auth/role/config/PII/export) + SIEM export → §3 |
| ☐ | 6-Sec | M | **E2b GDPR/DPA pack** — DPA + sub-processor register, DPIA for AI eval, full data-subject rights (access/portability/rectification), RoPA, EU residency → §7 |
| 🟡 | 7-UX | M | **E3 Brand / white-label** — mostly done; remaining: branded email/letter copy + sender/reply-to → §4 |
| ☐ | 8-Ops | L | **E4 Self-host / licensed** — license decision (BSL/source-available) open; Docker/Helm/air-gap/self-hosted endpoints done; Postgres scoped, not built → §5 |
| ☐ | 6-Sec | L | **E5 SOC 2 (+ISO 27001)** — gap assessment (Vanta/Drata) → policies/runbooks → evidence + pen test → Type I → Type II. Calendar-bound; start early → §6 |
| ☐ | 5-Bill | M | **E6 Org billing + seats** — `org_id`-keyed billing tables, seat quantity in checkout+webhook, seat enforcement, per-team metering, `llm_usage` attribution → §8 |

---

## 12. Cross-references

- `docs/features/organization/README.md` — the tenancy/identity foundation (E0), now shipped.
- `docs/features/billing/README.md` — the Enterprise contact-sales tier + the plan catalog.
- `docs/_archive/GDPR_AND_HIRING_EXTENSIONS.md` — existing GDPR groundwork.
- `.claude/ship-loop/backlog.md` — multi-tenancy, AI-Act conformity, deploy-story backlog rows.
- `docs/architecture/llm-provider-layer.md` — BYOM / model-control foundation.
- `docs/design/README.md` — the dual-theme token system behind brand customization.
