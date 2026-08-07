# Value Case & Market Reality — kp (backlog item 14)

Date: 2026-07-02. Lens: VALUE & MARKET REALITY. Repo claims verified by direct read/grep; market claims cited inline.
Context: kp = AI hiring workspace (CV analysis + job-fit, cs/en voice screening, dev-case assessment, matching, automation + audit, Polar billing scaffold). Demo customer: Česká spořitelna. Prior finding: structurally industry-locked (0/20 non-bank HR personas would adopt).

---

## 1. Competitor map (2025/2026)

| Player | What it is | Pricing signal | The ONE thing they have that kp doesn't | The ONE thing kp has that they don't |
|---|---|---|---|---|
| [HireVue](https://www.hirevue.com/) | Enterprise video interview + assessment; 60% of Fortune 100 | ~[$35K/yr floor, avg ~$50K, multi-year only](https://www.vendr.com/buyer-guides/hirevue); [coding assessments cost extra](https://www.pin.com/blog/hirevue-pricing/) | Scale trust: FedRAMP, 40+ languages, validated I/O-psych assessments | Live conversational voice (HireVue is async video); per-unit pricing possible |
| [Paradox (Olivia)](https://www.paradox.ai/) | Conversational ATS for high-volume hourly hiring; screening + scheduling | [$15K–$50K+/yr, $5–20K implementation](https://www.index.dev/blog/paradox-ai-recruitment-chatbot-review) | Self-scheduling at massive scale (Chipotle: 12→4 days time-to-hire), 100+ languages, SMS-first | Deep technical evaluation (dev-case); decision audit trail |
| [Mercor](https://talent.docs.mercor.com/support/ai-interview) | AI talent marketplace: interview once (~20 min AI interview), get matched forever | Marketplace take-rate; [$10B valuation](https://www.eesel.ai/blog/mercor-ai) | Two-sided network: candidates apply once, scores persist cross-employer | Employer-owned pipeline; EU/GDPR posture; marketplace conflicts don't apply |
| [micro1 (Zara)](https://www.micro1.ai/zara/ai-interviewer) | AI recruiter for technical vetting (coding, system design) | [$89/mo Early, $399/mo Growth, custom Enterprise](https://www.eesel.ai/blog/micro1-pricing) | Cheap self-serve entry price; proctoring/anti-cheat at scale | Full lifecycle (offer→onboarding); human approval gates; cs locale |
| [Alex (Apriora)](https://www.apriora.ai/) | Live AI video/phone interviewer that screens + schedules | [Free tier; paid from ~$30/mo; enterprise custom](https://www.hrstacks.com/product/apriora-ai/) | Polished live AI video interviewing as the whole product | Salary estimation, matching, offers — the surrounding workflow |
| [Braintrust AIR](https://www.usebraintrust.com/air-ai-recruiter) | AI interview screening; claims [interview cost $125→$18 (−86%)](https://www.usebraintrust.com/blog/healthcarerecruiting) | Custom; sells "80% cheaper per interview" | Published ROI case studies as the sales motion | Automation with human gates + EU-framed audit trail |
| [Maki People](https://www.makipeople.com/) | AI screening agents; 300+ skills, [voice screening in 45+ languages](https://www.makipeople.com/); 80+ Fortune-2000 customers | [Credit-based, per candidate interaction; enterprise custom](https://xobin.com/blog/maki-people-pricing-and-review/) | Multilingual voice at 45+ languages; validated skills library | Dev-case depth; end-to-end pipeline incl. offers/onboarding |
| [ConverzAI](https://www.converzai.com/) | Voice AI recruiter for **staffing firms**; calls/texts/emails, updates ATS | Custom; pay-per-placement option; SOC 2 Type II, bias-audited | 8+ staffing-ATS integrations (Bullhorn, Ceipal…); SOC 2 + bias audit as trust assets | Direct-employer workflow; technical assessment |
| [Ashby](https://www.ashbyhq.com/compare/ashby-vs-greenhouse) | Modern all-in-one ATS; AI match criteria, AI notes, NL analytics, [AI ships monthly](https://100hires.com/ashby-vs-greenhouse.html) | Seat-based SaaS (mid-market) | The system of record + analytics recruiters live in | AI voice interviewing; dev-case; salary estimation |
| [Greenhouse](https://www.lever.co/blog/greenhouse-vs-ashby) | Enterprise ATS; AI talent filtering, fraud detection, AI scheduling | Seat/volume enterprise SaaS | Marketplace of 400+ integrations; enterprise trust | Whole AI-screening layer (Greenhouse buys/partners for it) |
| [Workable](https://www.index.dev/blog/greenhouse-vs-lever-vs-ashby-ats-comparison) | SMB ATS; [AI sourcing over 400M profiles](https://www.index.dev/blog/greenhouse-vs-lever-vs-ashby-ats-comparison) | ~$149+/mo self-serve | Sourcing database + self-serve SMB motion | Voice screening, structured AI decisions with audit |
| [Teamio (Alma Career)](https://cz.teamio.com/en/) | The default Czech ATS (1,000+ companies, 10+ yrs); [no advanced AI features](https://recruitis.io/en/comparison/recruitis-vs-teamio/) | Local-market SaaS (low hundreds €/mo) | Czech market ownership + jobs.cz distribution; [public API](https://integrations.almacareer.com/teamio/) | Literally the entire AI layer — Teamio has none |

**Read:** kp's breadth (screen→interview→assess→offer→onboard, with audit) is unusual; every competitor is deeper on one slice plus trust assets (SOC 2, integrations, case studies) kp lacks. Nobody found does **Czech-first AI voice screening + LLM-era dev-case + EU-AI-Act-shaped audit** in one product. Maki (45+ language voice) is the closest threat to the language wedge.

---

## 2. Per-feature ROI

Assumptions: fully-loaded recruiter ≈ $35/hr, senior engineer ≈ $85/hr. LLM prices: [Gemini 2.5 Flash $0.30/M input, $2.50/M output tokens](https://ai.google.dev/gemini-api/docs/pricing); [ElevenLabs agents ≈ $0.08–0.10/min + LLM](https://elevenlabs.io/blog/we-cut-our-pricing-for-conversational-ai) ([overage $0.08/min](https://elevenlabs.io/pricing/agents)); [OpenAI Realtime ≈ $0.06/min audio in, $0.24/min out (legacy gpt-realtime); newer models ~2–3× cheaper](https://developers.openai.com/api/docs/pricing) ([per-minute breakdown](https://skywork.ai/blog/agent/openai-realtime-api-pricing-2025-cost-calculator/)).

| kp feature | Human work replaced (benchmark) | Human cost/unit | kp marginal LLM cost/unit | Multiple |
|---|---|---|---|---|
| CV analysis + job-fit | [2–3 min real review per passing resume; ~23 hrs screening labor per hire](https://www.zivaro.ai/blog/recruiter-time-per-hire); [30–90 s/scan](https://onehour.digital/blog/recruiter-screening-behavior-statistics) | ~$1.20–1.75/CV; ~$800/hire | ~8K in + 2.5K out tok ≈ **$0.009** | **~130–200×** |
| Voice screening (cs/en) | [Phone screen = 25–30 min incl. scheduling + notes](https://hireology.com/blog/the-hidden-cost-of-the-phone-screen-what-your-recruiting-teams-time-is-actually-worth/) | ~$15–18/screen (Braintrust market ref: [$125 healthcare](https://www.usebraintrust.com/blog/healthcarerecruiting)) | 15-min call: ElevenLabs ≈ **$1.5–2**; OpenAI Realtime ≈ **$2–3** | **~6–10×** (vs $125: 40–80×) + 24/7, zero scheduling |
| Dev-case assessment | Senior eng designs case + reviews submission: 1–2 hrs; HireVue [charges coding assessments as a paid add-on](https://www.pin.com/blog/hirevue-pricing/) | ~$85–170/candidate | Generation + grading ≈ 30–60K tok ≈ **$0.10–0.25** | **~500–1000×** |
| Matching / talent rediscovery | Sourcing slice of [cost-per-hire $5,475 (SHRM 2025; exec $35,879)](https://www.shrm.org/about/press-room/shrm-releases-2025-benchmarking-reports--how-does-your-organizat); rediscovery mines already-paid-for candidates | $1–2K sourcing/hire | Re-rank of stored profiles ≈ **cents/job** | **~100×+** on the sourcing slice |
| Automation + audit trail | Status chasing, follow-ups, documenting decisions (~[7–10 min admin per screen](https://hireology.com/blog/the-hidden-cost-of-the-phone-screen-what-your-recruiting-teams-time-is-actually-worth/)); plus mandated [EU AI Act log-keeping ≥6 months for deployers](https://euaicompass.com/eu-ai-act-high-risk-deployer-guide.html) | ~$4–6/candidate + compliance labor | Deterministic code ≈ **$0** | Efficiency **plus** a compliance artifact competitors sell separately |
| Self-scheduling | No-show/abandonment control: [42% of candidates abandon slow scheduling; hourly no-shows up to 90% at seasonal peaks](https://workwolf.com/blog/interview-no-shows-front-line-hiring/); [responding within 48h materially lifts follow-through](https://www.careerplug.com/recruiting-metrics-and-kpis/) | Rebooking + lost-slot waste, ~$10–20/no-show | **~$0** | Pure margin; this is Paradox's whole business |

**Unit economics headline:** a full AI screen (CV + 15-min voice + dev-case) costs kp **≈ $2–3.50 in COGS** and replaces **$100–200** of human effort. At a $5–10 per-candidate price the gross margin is 60–80% and still 10–20× cheaper than the human alternative — the Polar minute-pack scaffold (`.env.example` POLAR_PRODUCT_MINUTE_PACK) matches this per-unit motion.

---

## 3. Production-reality checklist (demo → sellable)

Repo-verified state (file paths are the evidence):

| Gap | Verified state in repo | Market demand |
|---|---|---|
| Multi-tenancy | `app/_lib/tenancy.ts`: only **2 tables** (`analyses`, `profiles`) verified workspace-scoped; `KP_MULTI_WORKSPACE` boot guard **fails closed** — effectively single-tenant | SaaS table stakes; blocks any second customer |
| Auth | `app/_lib/auth/require-operator.ts`: `KP_OPERATOR_PASSWORD` unset → "**open mode (the app runs open by design)**"; dev localStorage gate (`devAuth.ts`) | SSO/SAML + RBAC is enterprise-HR baseline |
| Comms delivery | `app/_lib/comms-dispatch.ts`: durable **local outbox by default**; real relay only when `COMMS_WEBHOOK_URL` set; no ESP/SMTP integration | Candidates must actually receive email/SMS; deliverability, unsubscribes, DKIM |
| Data layer | `better-sqlite3` (package.json) — single-node embedded SQLite | Postgres-class multi-writer + backup/DR for PII |
| Deploy story | Only `.github/workflows/ci.yml`; no Dockerfile/IaC/hosting config | Reproducible deploy, envs, secrets mgmt, uptime SLO |
| Currency | `app/_lib/salary-band.ts`: single `APP_CURRENCY` per deployment (CZK-lock softened, not multi-currency) | Multi-currency per job/market |
| Compliance framing | `app/_lib/compliance-regimes.ts`: 7-jurisdiction catalog (eu/uk/us/sg/in/ae/global) incl. US four-fifths rule — **framing only, explicitly "not certified conformance"** | See below |
| Billing | Polar scaffold present, `POLAR_SERVER=sandbox` (`.env.example`) | Production billing, tax, invoicing |
| GDPR self-service | Erasure tokens + `/data/[token]` page exist (`comms-dispatch.ts`) — genuine asset | Keep; extend to DPA + subprocessor list |

What the market demands beyond code:

- **EU AI Act — the clock is at 31 days.** Recruitment/candidate-evaluation AI is high-risk under [Annex III point 4](https://artificialintelligenceact.eu/annex/3/); the full high-risk regime becomes enforceable **2 August 2026** ([staffing-business guide](https://artificialintelligenceact.eu/what-the-act-means-for-staffing-businesses/)). Selling kp makes it a **provider** (Art. 9–17: risk mgmt system, data governance, technical documentation, logging, human oversight, accuracy/robustness, conformity assessment + CE marking + EU database registration); customers become **deployers** (Art. 26: human oversight, log retention ≥6 months, worker notification, FRIA for some) ([deployer guide](https://euaicompass.com/eu-ai-act-high-risk-deployer-guide.html)). kp's approval gates + audit trail + `AiDisclosure` are real head starts on Art. 14/26 — but technical documentation and conformity assessment do not exist.
- **SOC 2 Type II** — [the #1 procurement blocker in enterprise HR-tech sales; cuts security review from 8–12 weeks to <2](https://www.brightdefense.com/resources/soc-2-for-enterprise-clients/) ([why every HR-tech vendor](https://www.visier.com/blog/soc-2-compliance-why-every-hr-tech-vendor-needs-it/)). ConverzAI already advertises SOC 2 + bias audit.
- **ATS integrations** — every competitor leads with them (ConverzAI: 8+ staffing ATSs; Greenhouse marketplace; [Teamio/Alma Career public API](https://integrations.almacareer.com/teamio/)). kp has none; an AI screening layer without an ATS connector forces rip-and-replace.
- **US entry (if ever): NYC Local Law 144** — [annual independent bias audit of any AEDT, public results summary, 10-business-day candidate notice](https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page); kp's `computeAdverseImpact` four-fifths primitive is the right substrate but an audit must be independent.

---

## 4. Verdicts (CP-ready)

**V1 — Czech/CEE voice screening is a real but perishable wedge.**
Teamio, the default Czech ATS, [has no AI features](https://recruitis.io/en/comparison/recruitis-vs-teamio/); no found competitor sells Czech-first AI voice screening; Maki's 45+-language voice is the nearest threat. Falsifiable: dead if Alma Career ships AI or Maki opens a Prague sales motion. **Options:** (a) build a Teamio connector via the [Alma Career API](https://integrations.almacareer.com/teamio/) and sell "AI layer for Teamio shops" — fastest defensible path; (b) pitch Alma Career itself as OEM/partner; (c) ignore CEE and go pan-EU, losing the wedge.

**V2 — EU-AI-Act-native is the positioning; 2 Aug 2026 makes it urgent and testable.**
Enforcement lands in 31 days; every EU deployer of hiring AI suddenly needs Art. 26 evidence (oversight, ≥6-month logs, disclosures). kp's human gates + decision audit + AI disclosure map onto exactly that; US-centric rivals mostly don't lead with it. Falsifiable: if enterprise buyers don't put AI-Act evidence in RFPs by Q4 2026, the positioning is worthless. **Options:** (a) productize a "deployer evidence pack" (exportable logs, oversight attestations, FRIA template) and market it now; (b) pursue full provider conformity (Art. 9–17 + CE) — months of work, needed before any real EU sale anyway; (c) sell as "internal tool" pilot to defer provider duties (weak, buyers' lawyers will ask).

**V3 — Price per screen, not per seat; the COGS supports it and incumbents can't follow.**
~$0.01/CV, ~$2/voice screen, ~$0.20/dev-case vs HireVue's [$35K/yr floor + multi-year lock-in](https://www.vendr.com/buyer-guides/hirevue) and Braintrust's $18–125/interview framing. A $3–5/candidate price undercuts everyone at 60–80% margin; Polar minute-packs already model it. Falsifiable: fails if voice minutes (the dominant COGS) exceed ~$0.15/min all-in or if buyers demand seat pricing. **Options:** (a) self-serve per-unit (micro1 plays here at [$89–399/mo](https://www.eesel.ai/blog/micro1-pricing) — the comp to beat); (b) hybrid platform fee + usage; (c) enterprise custom (surrenders the differentiation).

**V4 — Industry lock: partially softened in code, unfalsified in market.**
`compliance-regimes.ts` (7 jurisdictions) and `APP_CURRENCY` soften the GDPR/CZK locks at the framing layer, but taxonomy, archetypes, and dev-case content remain bank/tech-flavored — the 0/20 non-bank adoption finding stands. Un-locking = role-taxonomy-as-workspace-config, per-job currency, and 2–3 non-tech vertical templates (assessment content is the hard part; voice + scheduling generalize free). **Options:** (a) stay vertical: "hiring AI for banks/regulated firms" — turns the lock into a moat (SOC 2-adjacent trust, Czech banking references); (b) fund the un-lock (est. multi-week taxonomy/content work) before any horizontal sales motion; (c) high-volume hourly pivot — where no-show pain is worst — but that's Paradox's fortress.

**V5 — Don't fight the ATS layer; the CV-screening slice is commoditizing under it.**
[Ashby ships AI monthly](https://100hires.com/ashby-vs-greenhouse.html), Greenhouse and [Workable (400M-profile sourcing)](https://www.index.dev/blog/greenhouse-vs-lever-vs-ashby-ats-comparison) bundle AI screening into the system of record — standalone CV scoring will be a checkbox by 2027. kp's defensible slices are voice + dev-case + audit **on top of** an ATS. Falsifiable: if ATS-bundled AI reaches parity on voice interviewing within 12 months, the standalone thesis dies. **Options:** (a) build 2 connectors (Teamio for CEE, Greenhouse for credibility) and demote kp's own pipeline UI to "ATS-optional"; (b) stay full-suite for SMBs who lack an ATS; (c) both, sequenced (a)→(b).

**V6 — Sellability gate: no revenue conversation before the four blockers close.**
Single-tenancy (2 verified tables), open-mode auth, outbox-only delivery, and no deploy story are each individually disqualifying in any security review; SOC 2 cannot even start on this base. Falsifiable milestone: one non-demo workspace, password-gated, sending a real email, on a hosted URL. **Options:** (a) minimal hardening sprint (tenancy allowlist completion + operator password default-on + one ESP integration + a Dockerfile/host) before any pilot; (b) design-partner route with a signed disclaimer (only viable for ČS-style internal pilot).

---

*Sources are linked inline. Repo evidence: `app/_lib/tenancy.ts`, `app/_lib/auth/require-operator.ts`, `app/_lib/auth/devAuth.ts`, `app/_lib/comms-dispatch.ts`, `app/_lib/salary-band.ts`, `app/_lib/compliance-regimes.ts`, `.env.example`, `package.json`, `.github/workflows/ci.yml`.*
