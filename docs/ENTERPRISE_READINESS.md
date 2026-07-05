# Enterprise Readiness — the backlog to ship KP into corporate companies

_Scope date: 2026-07-05. Companion to the new **Enterprise** contact-sales tier
(`app/_lib/billing/plans.ts`, `contactSales: true`; landing band + Billing-tab
card). This is the honest engineering backlog behind that tier: what a corporate
buyer — think Česká spořitelna, the seeded target customer — actually requires in
their security/procurement review before they can sign, and the sequenced work to
get there. Requirements requested: **SOC 2 & adjacent standards, enterprise SSO,
audit expansion, brand customization, a licensed self-host option for full control
of the model + data layer, GDPR/DPA compliance.**_

> **How to read this.** Each track states *why a corporate buyer blocks on it*,
> *what already exists in this repo we can build on*, *the gap*, and *the work
> items*. The catch: almost every enterprise feature is gated on one foundation —
> **real multi-tenancy + user identity** — which today is ~10 % built. §1 makes
> that dependency explicit; §2–§8 are the tracks; §9 sequences them; §10 lists the
> assets that de-risk the whole thing; §11 is the append-to-backlog row set.

---

## 1. The gating insight: no enterprise feature exists without tenancy + identity

The single fact that shapes this entire backlog (from
`docs/ORGANIZATION_MULTIUSER_PLAN.md`, scanned 2026-07-05):

- **There is no user identity.** Auth is one shared `KP_OPERATOR_PASSWORD`; the
  session is `{ workspace, iat, exp, epoch }` with no `userId`/email/role
  (`app/_lib/auth/session.ts`). The five UI roles (Owner/Admin/Recruiter/Hiring
  manager/Viewer) have **no server-side meaning**.
- **The tenancy boundary is ~10 % wired.** `workspace_id` is the tenant key and a
  boot guard (`assertTenancyReady`) exists, but **only 2 of ~40 tables are
  verified scoped** (`analyses`, `profiles`); `jobs` — which everything pivots on
  — has no `workspace_id` at all.

**Consequence:** SSO provisions *users into roles* (no users yet). Audit records
*who did what* (no "who" yet). Brand customization and data residency are
*per-tenant* (tenancy inert). A per-customer self-host still needs the tenancy
model to be coherent. **So Phase E0 below is non-negotiable and mostly sequential
— it is the org/multi-user plan's Phases 0–1, and it is the long pole.** The good
news (§10): the seams are already cut for it.

---

## 2. Enterprise SSO & RBAC

**Why buyers block on it.** No enterprise IT will hand out a shared password.
They require SAML/OIDC against their IdP (Okta / Entra ID / Google Workspace),
**SCIM** so joiners/leavers provision and *deprovision* automatically (a
leaver keeping access to a candidate database is an audit finding), enforced SSO
(password login disabled for the org), and roles mapped from IdP groups.

**What exists.** A fail-closed edge proxy with a public allow-list
(`proxy.ts`); an HMAC-signed stateless session; a *conceptual* five-role model in
the Organization UI. Encryption-at-rest for secrets (`KP_SECRET`, AES-256-GCM).

**Gap.** Everything real: identity, per-user login, SAML/OIDC, SCIM, JIT
provisioning, server-side role enforcement, per-session revocation (today's
stateless 7-day token can't be revoked).

**Work items.**
- **E-SSO-1** Identity model + per-user login (org plan Phase 0): `organizations`,
  `users`, `memberships`, `invites`; session gains `userId/orgId/role`. — **L**
- **E-SSO-2** SAML 2.0 + OIDC (SP- and IdP-initiated), JIT provisioning, IdP-group
  → role mapping, enforced-SSO toggle per org. **Recommend an SSO provider
  (WorkOS / Stytch / Auth0-Enterprise)** over hand-rolling SAML — it collapses
  this to weeks and ships SCIM with it. — **L** (M with a provider)
- **E-SSO-3** SCIM 2.0 provisioning + **deprovisioning** endpoint. — **M**
- **E-SSO-4** Server-side RBAC: enforce the five roles on every mutating route
  (today `isOperator()` is binary). — **M**
- **E-SSO-5** Per-session revocation + session list (kill a device/leaver now). — **S–M**
- **Depends on:** E0. **Blocks:** SOC 2 access-control criteria, audit actor.

---

## 3. Audit expansion

**Why buyers block on it.** Security review and (for a bank) the regulator want a
tamper-evident, **exportable** log of *who did what to which candidate's data,
when* — logins, role changes, config changes, data exports, and every automated
decision. GDPR Art. 30 (records of processing) and the EU AI-Act Art. 14/26
(logging of high-risk AI decisions) both lean on this.

**What exists — a genuine head start.** `decision_records` is already a
**tamper-evident global hash chain** with a `verifyDecisionChain()`, and the
product's whole architecture puts **a human signature on every gate** (offer,
disposition, hire) — exactly the audit primitive enterprises want. There's a
LLM usage ledger (`llm_usage`) and AI-provenance disclosure work in flight.

**Gap.** The chain is (a) **single global** — one tenant's proof reads another's
sealed rows (org plan §6, the hard structural item), (b) scoped only to hiring
*decisions*, not admin/security/data-access events, (c) keyed to `actor` role
strings, not real users, and (d) not exportable to a SIEM.

**Work items.**
- **E-AUD-1** Re-architect the decision chain to **per-tenant chains** (per-org
  head hash, per-org verify). — **L** (design change, not a column add)
- **E-AUD-2** Broaden coverage to an `audit_events` stream: auth events, role/seat
  changes, config changes, PII reads, data exports, billing changes — each
  stamped with the real `userId` (needs E0/E-SSO). — **M–L**
- **E-AUD-3** Export + retention: signed CSV/JSON export, SIEM webhook, immutable
  retention window per contract. — **M**
- **E-AUD-4** Admin audit viewer in the Organization console. — **S–M**
- **Depends on:** E0, E-SSO-1. **Feeds:** SOC 2, GDPR RoPA, AI-Act (#26).

---

## 4. Brand customization (white-label)

**Why buyers block on it.** Candidates must see *the employer's* brand on offer
letters, the apply form, self-scheduling, and the voice screen — not a vendor
logo. For a bank, an off-brand candidate touchpoint is a marketing/compliance
problem, not a nicety.

**What exists — a strong foundation.** The app already ships a **dual-theme
token system**: `[data-theme]` re-skins everything through CSS variables in
`app/globals.css` (`docs/DESIGN.md`), with a recipe layer (`recipes.ts`). Comms
are **already templated per locale** (`render-template.ts`). The Organization
page already models a `domain` and a branding concept (currently hardcoded /
not persisted).

**Gap.** No per-tenant brand store; tokens are global not per-org; candidate
surfaces carry KP branding; no custom domain / sender.

**Work items.**
- **E-BRD-1** Per-org brand settings store (logo, primary/accent color, display
  name) + admin editor (wire the Organization page's mocked branding to real
  persistence). — **M**
- **E-BRD-2** Inject brand tokens per tenant at render (reuse the CSS-variable
  theme layer — this is the cheap-layer win the design system was built for). — **M**
- **E-BRD-3** White-label the **candidate-facing** surfaces (offer / apply /
  schedule / voice) + branded email/letter templates + custom sender/reply-to. — **M**
- **E-BRD-4** Custom domain / subdomain (CNAME + managed TLS). — **M**
- **Depends on:** E0 (per-tenant store). **Low technical risk** — the theme seam
  already exists.

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
(`docs/LLM_PROVIDER_LAYER.md`) — "full control over models" is 80 % there. The
billing provider sits behind a swappable `BillingGateway`; LightTrack telemetry is
optional; persistence is a single SQLite file (portable). A Dockerfile/deploy
story is already an open backlog item (#27).

**Gap.** No license model; SQLite→Postgres for a real multi-user deployment; no
packaged/air-gapped deploy; egress isn't provably off; self-hosted model
*endpoints* (Azure OpenAI in their tenant, vLLM/Ollama) not first-class.

**Work items.**
- **E-SH-1 (decision, founder + counsel)** Licensing model. Recommend
  **source-available** (BSL 1.1 / Elastic / Fair-Core) — gives the customer source
  access + the right to self-host and audit *without* open-sourcing the commercial
  core. True OSS (MIT/Apache) gives away the business; pick deliberately. — **decision**
- **E-SH-2** Packaged deploy: finish #27 (Dockerfile), add `docker-compose` /
  **Helm chart**, prod env checklist, license-key gating. — **M–L** — ✅ **DONE
  (first increment, 2026-07-05):** multi-stage `Dockerfile` (Node 24 + Python,
  native better-sqlite3, non-root, tini), `docker-compose.yml`, `.dockerignore`,
  `.env.example` deploy block, and **docs/SELF_HOSTING.md** (quick-start, egress
  inventory, air-gap notes, production checklist). Remaining: Helm chart +
  license-key gating.
- **E-SH-3** **Postgres** backend (SQLite is single-writer; a real org needs
  concurrent multi-user) behind the existing DB seam. — **L**
- **E-SH-4** **Air-gap / no-egress mode**: a switch that hard-disables every
  external call except the customer's own model endpoints; document the full
  egress list (Polar, model providers, LightTrack) and make each optional. — **M**
  — egress list + air-gap-via-config **documented** (SELF_HOSTING.md §6–7); the
  hard `KP_OFFLINE` enforcement flag is still open.
- **E-SH-5** First-class **self-hosted model endpoints** (Azure OpenAI in-tenant,
  vLLM/Ollama base-URL) — extends BYOM to fully private inference. — **M** ← **next
  increment on this branch.**
- **E-SH-6** **Data residency**: pin managed hosting to EU regions; document data
  flows. — **S–M** (policy + config)
- **Depends on:** E0 (coherent tenancy) for a credible multi-user self-host.

---

## 6. SOC 2 (+ ISO 27001 adjacency)

**Why buyers block on it.** SOC 2 Type II is the default trust artifact US/EU
enterprises ask for; a bank may also want ISO 27001. It is **not a feature you
ship** — it's an attestation of a *control set operating over 3–6 months*, signed
by an external auditor. The engineering job is to build and evidence the controls;
the rest is time + auditor cost.

**What exists.** CI running typecheck/lint/tests (#5) → change-management
evidence. Secret encryption at rest. Fail-closed auth proxy. A test culture.

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
config-driven retention (`KP_CONSENT_TTL_DAYS`), working erasure links (UAT item
35 fixed), a GDPR extensions doc (`docs/GDPR_AND_HIRING_EXTENSIONS.md`), and —
critically — **a human on every decision gate**, which is the strongest possible
answer to GDPR Art. 22 ("no solely-automated decision with legal/significant
effect"). The AI-Act conformity mapping is already backlogged (#26).

**Gap.** Legal artifacts (DPA template, RoPA, DPIA), sub-processor list + change
notification, full data-subject-rights flow (access/portability/rectification, not
just erasure), breach-notification runbook (72 h), and EU-pinned residency.

**Work items.**
- **E-GDPR-1** DPA template + sub-processor register + change-notification process. — **M** (legal + eng)
- **E-GDPR-2** DPIA for the AI candidate-evaluation pipeline (leans on the
  human-in-loop gates + audit trail as mitigations); fold in the AI-Act map (#26). — **M**
- **E-GDPR-3** Complete data-subject rights: access + **portability** export +
  rectification, alongside the existing erasure. — **M**
- **E-GDPR-4** RoPA (Art. 30) generated from the audit stream (E-AUD-2). — **S–M**
- **E-GDPR-5** EU data residency guarantee (managed + self-host paths). — **S–M**
- **Depends on:** E-AUD (RoPA/logging); strengthened by the existing gate model.

---

## 8. Org-level billing with seats (the commercial plumbing)

The Enterprise tier is contact-sales, but a *signed* enterprise still needs
org-level billing: one bill per company, seats = users, quotas at the org
(not per-deployment). This is org plan **Phase 3** — `org_id` key on the billing
tables, seat quantity in checkout + webhook, seat enforcement vs. memberships,
per-team metering, `llm_usage` attribution. — **M–L.** Not a security blocker, so
it sequences after the trust tracks, but it's what turns a signed contract into a
serviced account.

---

## 9. Sequenced roadmap

| Phase | Theme | Contains | Rough effort | Gated by |
|---|---|---|---|---|
| **E0** | **Tenancy + identity foundation** | Org/User/Membership/Invite model; per-user login; finish `workspace_id` on `jobs` + the ~38 gap tables; fix the boot-guard hole; per-tenant export | **L (long pole)** | — |
| **E1** | **Enterprise SSO & RBAC** | SAML/OIDC + SCIM (recommend a provider), enforced SSO, server-side roles, session revocation | **L (M w/ provider)** | E0 |
| **E2** | **Audit + GDPR/DPA** | Per-tenant audit chain, broad event coverage, export; DPA/DPIA/RoPA/residency; AI-Act map (#26) | **M–L** | E0, E1 |
| **E3** | **Brand / white-label** | Per-org brand store + token injection; white-label candidate surfaces + comms; custom domain | **M** | E0 |
| **E4** | **Self-host / licensed** | License decision; Docker/Helm (#27); Postgres; air-gap mode; self-hosted model endpoints; residency | **L** | E0 |
| **E5** | **SOC 2 (+ ISO 27001)** | Gap assessment → policies → evidence + pen test → Type I → Type II | **L + 3–6 mo clock + $$** | E1, E2 (consumes their controls) |
| **E6** | **Org billing + seats** | Org-keyed billing tables, seat quantity + enforcement, per-team metering | **M–L** | E0 |

**Critical path:** E0 → E1 → E2 unblock the two things *every* security review
gates on (identity/SSO and audit) plus the legal pack. E3/E4/E6 parallelize after
E0. **Start the E5 gap assessment early** (it's calendar-bound) but it can only
*finish* once E1/E2 controls are operating. This is a multi-quarter program, not a
sprint — the honest headline for a buyer is "on the roadmap, delivered with your
security and DPO teams during onboarding," which is exactly what the landing band
now says.

---

## 10. Assets that de-risk this (why it's realistic, not a rewrite)

The architecture was already built with these seams — enterprise is mostly
*finishing* them, not inventing them:

- **Half-built tenancy seam** — `workspace_id`, `currentWorkspace()`,
  `assertTenancyReady`, `createWorkspace()` all exist (org plan §2).
- **Provider-agnostic billing** (`BillingGateway`) — seats/Paddle/self-host swap
  is bounded to one file.
- **Dual-theme token system** — brand customization is a per-tenant token set, the
  cheapest possible layer (§4).
- **Global decision hash chain + human-on-every-gate** — the audit and GDPR-Art.22
  primitives already exist; the work is scoping + breadth (§3, §7).
- **BYOM multi-provider LLM layer** — "full control over models" is largely done;
  extend to private endpoints (§5).
- **Secret encryption at rest** (`KP_SECRET`, AES-256-GCM) + **fail-closed auth
  proxy** + **CI gates** — SOC 2 control seeds already in place (§6).
- **Consent / erasure / retention / locale** — GDPR is meaningfully ahead (§7).

---

## 11. Backlog rows (also appended to `.claude/ship-loop/backlog.md`)

Numbering continues the ship-loop backlog; `Dim` uses its scheme (2-Func / 6-Sec /
9-Value). Each row points back here.

| S | Dim | Size | Item |
|---|-----|------|------|
| ☐ | 2-Func | L | **E0 Tenancy + identity foundation** — Org/User/Membership/Invite, per-user login, finish `workspace_id` (jobs + ~38 tables), boot-guard fix. Gates all enterprise. (org plan Ph 0–1; overlaps backlog #2) → ENTERPRISE_READINESS.md §1 |
| ☐ | 6-Sec | L | **E1 Enterprise SSO & RBAC** — SAML/OIDC + SCIM (recommend WorkOS/Stytch), enforced SSO, server-side roles, session revocation. Gated on E0 → §2 |
| ☐ | 6-Sec | L | **E2a Audit expansion** — per-tenant decision-chain re-architecture (org plan §6) + broad `audit_events` (auth/role/config/PII/export) + SIEM export. Gated on E0/E1 → §3 |
| ☐ | 6-Sec | M | **E2b GDPR/DPA pack** — DPA + sub-processor register, DPIA for AI eval, full data-subject rights (access/portability/rectification), RoPA, EU residency; fold in AI-Act #26 → §7 |
| ☐ | 7-UX | M | **E3 Brand / white-label** — per-org brand store + token injection over the dual-theme layer; white-label candidate surfaces + branded comms; custom domain → §4 |
| ☐ | 8-Ops | L | **E4 Self-host / licensed** — license decision (BSL/source-available); Docker/Helm (#27); Postgres; air-gap/no-egress mode; self-hosted model endpoints; residency → §5 |
| ☐ | 6-Sec | L | **E5 SOC 2 (+ISO 27001)** — gap assessment (Vanta/Drata) → policies/runbooks → evidence + pen test → Type I → Type II. Calendar-bound; start early → §6 |
| ☐ | 5-Bill | M | **E6 Org billing + seats** — `org_id`-keyed billing tables, seat quantity in checkout+webhook, seat enforcement, per-team metering, `llm_usage` attribution (org plan Ph 3) → §8 |

---

## 12. Cross-references

- `docs/ORGANIZATION_MULTIUSER_PLAN.md` — the tenancy/identity foundation (E0), scanned in detail.
- `docs/BILLING.md` — the Enterprise contact-sales tier + the plan catalog.
- `docs/GDPR_AND_HIRING_EXTENSIONS.md` — existing GDPR groundwork.
- `.claude/ship-loop/backlog.md` — #2 multi-tenancy, #26 AI-Act conformity, #27 deploy story.
- `docs/LLM_PROVIDER_LAYER.md` — BYOM / model-control foundation.
- `docs/DESIGN.md` — the dual-theme token system behind brand customization.
