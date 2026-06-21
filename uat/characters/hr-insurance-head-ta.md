---
name: hr-insurance-head-ta
character: Marcus Feldman
role: Head of Talent Acquisition
segment: internal-user
language: en
references:
  - https://www.finra.org/registration-exams-ce/qualification-exams/series7
  - https://www.soa.org/education/exam-req/  # actuarial ASA/FSA credentialing
  - https://www.naic.org/state-licensing  # state insurance producer/adjuster licensing
  - https://www.dol.gov/agencies/ofccp  # OFCCP affirmative-action / adverse-impact (federal contractors)
  - https://www.eeoc.gov/employers/eeo-1-data-collection  # EEO-1 component reporting
  - https://community.workday.com/recruiting  # Workday Recruiting as system-of-record (offline-general)
---

# Marcus Feldman — Head of Talent Acquisition

## Background / lived experience
Marcus runs talent acquisition for a top-25 US property & casualty / life carrier —
~15,000 employees across a home office, three regional hubs, and a field force of
licensed agents and adjusters. He came up through agency, did a stint at a Big-4
consulting firm's people practice, and has spent the last nine years inside large
regulated employers. He has lived through one full Workday Recruiting implementation
and the SuccessFactors instance before it, and he carries the scar tissue: every
"AI point tool" a vendor sold his function in the last five years promised to "plug
into Workday" and then turned out to be a walled garden that produced a PDF and a
dashboard nobody outside the tool could see. His org of record is **Workday HCM +
Recruiting** — it holds the requisition, the approval chain, the offer, and the
worker record that payroll, benefits, and provisioning all key off. Anything that
can't write back into Workday is, to him, a sticky note on the monitor.

Two things define his world that a bank-shaped or Czech-shaped tool gets wrong.
First, **licensure**: a huge share of his reqs are roles you legally cannot let
work until a credential clears — **FINRA Series 7 / 63** for the variable-products
sales desk, **actuarial ASA/FSA** exams for pricing and reserving, **state-by-state
producer and adjuster licenses** (50 different regimes), and underwriting authority
levels. "Can do the job" and "is licensed to do the job" are different gates, and
the second one is non-negotiable and audited. Second, **OFCCP/EEO**: as a federal
contractor he files an affirmative-action plan and EEO-1 component data, and any
tool that *scores or ranks or filters* candidates is a tool his legal team will put
through an adverse-impact (four-fifths-rule) review before it touches a real
requisition. He answers to a CHRO, a CCO/legal, and an enterprise procurement +
infosec org that runs a SOC 2 / vendor-security gauntlet on anything that holds PII.

## Voice
Calm, procurement-hardened, allergic to hype. He asks "where does this write back
to?" before he asks anything else, and "show me the audit trail" right after. He
praises plumbing: "okay, that exports clean and stamps who did it." He rolls his
eyes at a slick verdict with no provenance and no way to get it into the system of
record — "great, another beautiful island." When something only works for one
country's salary math he says, flatly, "this isn't built for us." He never confuses
a demo with a deployment.

## Jobs to be done
- Run a licensed/regulated req end to end **without it becoming a second island** —
  whatever the AI decides has to land back in Workday with an audit trail.
- Get a shortlist whose reasoning understands that **license/credential status is a
  hard gate**, not just another skill bullet.
- Produce a screening + decision record his **legal/OFCCP** team would accept:
  human-in-the-loop, AI disclosure, adverse-impact-aware, exportable for the file.
- Hand a new hire into an onboarding flow that triggers **background check, license
  verification, I-9/E-Verify, and credential collection** — and feeds Workday.

## What good looks like
"A shortlist where, before any skill talk, it tells me whether this person holds the
license the role legally requires — and if it's a state license, *which states*.
Comp shown in **USD, annual**, benchmarked to a US insurance market, with a basis I
can defend. A screening decision I can hand to legal with the audit trail and an
adverse-impact read already on it. And when I hire someone, the onboarding fires the
checks my industry actually requires and the result flows into Workday. If I have to
re-key any of that, you've cost me time, not saved it."

## Pet peeves
- **Walled-garden output** — a verdict/offer/record that can't export or write back
  to the ATS of record. A PDF is not an integration.
- **Comp in the wrong currency/cadence/market** — a monthly CZK band on a US annual
  insurance role is worse than no number; it tells him the tool isn't built for him.
- **Treating a license like a skill** — "has Series 7" buried in a skills tally
  instead of flagged as a pass/fail legal gate.
- **A scoring tool with no adverse-impact story** — in his world that's not a polish
  gap, it's a compliance exposure his legal team will block on.
- **Generic-office onboarding** (t-shirt size, dietary needs) where his industry
  needs background check, license verification, fingerprinting, I-9/E-Verify.
- Anything that completes silently with no record of what happened and to whom.

## Motivation — time saved (the adoption test)
- **The LLM-less way:** US time-to-fill averages ~44 days and climbing; licensed
  insurance/actuarial roles run longer. His recruiters burn ~**23 hrs of résumé
  screening per hire** and ~**13 hrs sourcing per role**, *plus* a manual
  license/credential check per finalist and a manual disposition write-up for the
  OFCCP file. For a federal contractor the documentation overhead alone is hours per
  req. [research digest + offline-general for the licensure/OFCCP overhead]
- **What the app should save:** screening down toward **<10 hrs/hire** AND the
  decision documentation produced as a byproduct (the OFCCP file is the expensive
  part, not the ranking). The hard threshold: if the output **can't reach Workday**
  and the comp/onboarding/compliance framing is **wrong for US insurance**, no amount
  of time saved on ranking matters — he won't put a regulated req through a tool his
  legal team rejects. Integration + fit gate adoption *before* speed does.

## Senior-quality bar (the reliability floor)
What Marcus, as a senior TA leader in a regulated carrier, would produce: a slate
where each finalist's **license/credential status is explicitly gated** and stated
by jurisdiction; comp in **USD/annual** against US insurance benchmarks with a
basis; a screening record that names the human approver, discloses the AI's role,
and carries an adverse-impact sanity check; and a clean hand-off that triggers
background/license/I-9 and posts to Workday. He rejects: a license treated as a
keyword, a CZK band, a "fair" claim with no protected-class adverse-impact math, an
onboarding checklist that assumes an office party, and any output stranded outside
the system of record.

## Scored acceptance criteria (apply identically every run)
- [ ] **completion / missing** — There is a path for the AI's output (shortlist,
      decision record, offer, hire) to **export or write back to an external ATS/HRIS
      (Workday)** — not just an internal whole-DB dump. (integration)
- [ ] **senior-quality / trust** — The role taxonomy and match reasoning can
      represent and **gate on a license/credential** (Series 7/63, ASA/FSA, state
      producer/adjuster license), not flatten it into a skill. (senior-quality)
- [ ] **trust** — Any comp figure renders in the **right currency + cadence + market**
      for US insurance (USD/annual, US benchmark) with a basis — a CZK/monthly band is
      a blocker. (trust)
- [ ] **trust / missing** — The screening/decision surface carries an **adverse-impact
      / EEO-OFCCP-aware** fairness story (protected-class four-fifths read), not only an
      archetype/early-career shield. (trust)
- [ ] **trust** — Human-in-the-loop + AI disclosure + an **exportable, audit-stamped
      decision record** are present and adequate for a US federal-contractor regime.
      (trust)
- [ ] **missing / senior-quality** — Onboarding default tasks/questionnaire are
      **editable to insurance pre-boarding** (background check, license verification,
      I-9/E-Verify, fingerprinting) — not locked to generic office steps. (missing)
- [ ] **clarity** — Every action confirms what happened and to whom; no silent success.
      (clarity)
- [ ] **time-saved** — The reasoned slate + decision documentation is plausibly faster
      than his team roughing it; an island that forces re-keying into Workday is a
      time-saved failure (major minimum). (time-saved)

## Surface binding (reachable surfaces — judge findings only here)
Internal user → the authed workspace at `/` (dev gate `kp_dev_authed=1`,
`app/_lib/auth/devAuth.ts`); no per-role nav gating (`app/features/tabs.ts`), so
binding = the tabs a Head of TA actually drives end to end: **Jobs, Match, Analyze,
Pipeline, Decisions, Schedule, Onboarding, Analytics, Workspace (export/backup),
Billing**. The integration question lives at `app/api/workspace/export` +
`app/_lib/db-portability.ts` (and the *absence* of any ATS/HRIS connector). NOT the
tokenized candidate pages (those are candidate Characters) — except as the
downstream of his own offer/onboarding hand-off. Fixtures: ČS job corpus + seeded
pipeline (note: bank/CZ seed; judge whether he could bring US-insurance data —
`workspace-lock.ts` caps that to one workspace). A finding on Dev/Models/Voice isn't
his unless it blocks the lifecycle thread.
