export type CoverageItem = {
  slug: string;
  title: string;
  /** Rail section; defaults to the v1 group when omitted. */
  group?: string;
  /** One-line subtitle shown under the title. */
  lead: string;
  /** Markdown body — includes a `puml` component diagram rendered in-app. */
  body: string;
};

export const GROUP_V1 = "CV analysis (v1)";
export const GROUP_V2 = "Matching platform & automation (v2)";

// Each capability is described with a short lead, a focused component diagram
// (rendered by our own PlantUML renderer — the tinted box marks the part doing
// the heavy lifting), and a couple of grounding notes.
const coverageItems: CoverageItem[] = [
  {
    slug: "company-salary-context",
    title: "Company salary context",
    lead: "Free-text company notes reshape the pay assumptions and the application strategy.",
    body: `\`\`\`puml
@startuml
title Company notes steer pay + strategy
actor "Recruiter" as rec
[Company notes] as notes
package "Salary engine" {
  [Context detector\\nenterprise · startup\\nscaleup · public] <<focus>> as det
  [Range adjuster\\ncap 1.20x] as adj
}
[Application strategy\\n& negotiation] as strat
rec --> notes
notes --> det
det --> adj : signal
adj --> strat
@enduml
\`\`\`

- Detects enterprise, startup, scaleup, consultancy, and public-sector signals.
- The detected context adjusts salary ranges and negotiation guidance, capped at \`1.20×\`.`,
  },
  {
    slug: "cv-text-extraction",
    title: "CV text extraction",
    lead: "Uploaded profiles become normalized text before any scoring happens.",
    body: `\`\`\`puml
@startuml
title Upload → normalized text
[Upload\\nPDF · DOCX · TXT · MD] as up
package "Extractor" {
  [pypdf parse] as parse
  [Cleanup\\nspacing · encoding] <<focus>> as clean
}
[Normalized text] as txt
up --> parse
parse --> clean
clean --> txt
txt --> [Scoring]
@enduml
\`\`\`

- PDF, DOCX, TXT, and MD uploads are all supported.
- The local extractor uses \`pypdf\` parsing plus cleanup helpers for spacing and encoding artifacts.`,
  },
  {
    slug: "czech-diacritics",
    title: "Czech diacritics",
    lead: "The extraction path preserves and repairs Czech text wherever it can.",
    body: `\`\`\`puml
@startuml
title Repairing Czech text
[Extracted text\\n(may be mangled)] as raw
package "Repair path" {
  [Local cleanup\\nmojibake · letter-spacing] as local
  [Gemini extraction\\npreserve diacritics] <<focus>> as gem
}
[Clean Czech text\\nháčky · čárky] as out
raw --> local
local --> gem
gem --> out
@enduml
\`\`\`

- The local parser repairs common mojibake and PDF letter-spacing artifacts.
- Gemini extraction is prompted to keep Czech diacritics and reconstruct letter-spaced words.`,
  },
  {
    slug: "end-to-end-api",
    title: "End-to-end API",
    lead: "A Next.js route bridges browser uploads to the Python analysis CLI.",
    body: `\`\`\`puml
@startuml
left to right direction
title One process bridges JS ↔ Python
actor "Browser" as br
[/api/analyze/\\n(Next.js route)] <<focus>> as api
package "Python subprocess" {
  [analysis CLI] as cli
}
[Zod validation] as zod
[Typed result] as res
br --> api : upload
api --> cli : spawn
cli --> zod : JSON
zod --> res
@enduml
\`\`\`

- \`app/api/analyze/route.ts\` spawns the Python CLI as a subprocess and validates its JSON with Zod.
- Running analysis under the Next.js process avoids standing up a second long-lived server.`,
  },
  {
    slug: "github-evidence",
    title: "GitHub evidence",
    lead: "An optional GitHub profile is analyzed separately to corroborate the CV.",
    body: `\`\`\`puml
@startuml
title Verifying claims against real code
actor "Candidate" as c
[/api/github-analysis/] <<focus>> as api
cloud "GitHub REST" as gh
cloud "Gemini\\ndeep-dive" as gem
[Verified claims\\nvs CV] as out
c --> api : profile URL
api --> gh : metadata
api --> gem : READMEs · commits · tree
gem --> out
@enduml
\`\`\`

- The web app fires a separate, non-blocking request for public GitHub metadata.
- A Gemini deep-dive checks CV claims against READMEs, recent commits, and the repo file tree.`,
  },
  {
    slug: "job-description-input",
    title: "Job description input",
    lead: "Attaching a role file or pasted text makes the result role-specific.",
    body: `\`\`\`puml
@startuml
title Role in → job-fit out
[Role file / pasted text] as jd
package "Job-fit" {
  [Matcher\\nskills · seniority] <<focus>> as m
  [Salary positioning] as sal
}
[Result\\nfit score · gaps\\ntalking points] as out
jd --> m
m --> sal
m --> out
sal --> out
@enduml
\`\`\`

- Adds a fit score, matching and missing skills, seniority alignment, and salary positioning.
- Role-specific talking points and proof gaps surface in the Job-fit tab.`,
  },
  {
    slug: "linkedin-pdf-export",
    title: "LinkedIn PDF export",
    lead: "LinkedIn exports are handled as ordinary profile PDFs — no special mode.",
    body: `\`\`\`puml
@startuml
title One path for every profile
[LinkedIn PDF export] as li
[Profile PDF path\\n(same as CV)] <<focus>> as path
[Extraction] as ex
li --> path
path --> ex
note bottom of path
Reuses the CV pipeline —
no LinkedIn-specific input.
end note
@enduml
\`\`\`

- The app needs no separate LinkedIn input mode.
- Profile extraction reuses the exact same pipeline as uploaded CVs.`,
  },
  {
    slug: "python-solution",
    title: "Python solution",
    lead: "The analysis engine is a standalone Python package, callable from the web app.",
    body: `\`\`\`puml
@startuml
left to right direction
title Engine independent of Next.js
package "Next.js app" {
  [API route] as api
}
package "Python package\\npipeline/jobfit" {
  [cli.py] <<focus>> as cli
  [parse · score\\nsalary · gemini] as core
}
[Same JSON shape\\nthe UI consumes] as out
api --> cli : subprocess
cli --> core
core --> out
@enduml
\`\`\`

- The CLI lives at \`pipeline/jobfit/cli.py\` and returns the JSON shape the UI consumes.
- Parsing, scoring, salary logic, and Gemini calls stay testable outside Next.js.`,
  },
  {
    slug: "role-fit-scoring",
    title: "Role-fit scoring",
    lead: "With a job supplied, the candidate is compared against that specific role.",
    body: `\`\`\`puml
@startuml
title Profile strength vs match quality
[Candidate profile] as cand
[Target role] as role
package "Comparison" {
  [Match quality] <<focus>> as mq
  [Risk flags\\nmissing skills] as risk
}
cand --> mq
role --> mq
mq --> risk
@enduml
\`\`\`

- The job-fit result separates general profile strength from match quality for one vacancy.
- Missing skills and recruiter risk flags pinpoint what to prove or improve.`,
  },
  {
    slug: "salary-heuristic-data",
    title: "Salary heuristic data",
    lead: "Salary estimates start from local Czech technology benchmark bands.",
    body: `\`\`\`puml
@startuml
title Local bands, optional market blend
database "salary_benchmarks.json\\nrole × seniority" <<focus>> as db
cloud "Gemini\\n(+ grounding)" as gem
[Salary range] as out
db --> gem : anchor bands
gem --> out
@enduml
\`\`\`

- \`data/salary_benchmarks.json\` carries role × seniority anchor bands fed into the Gemini prompt.
- Gemini grounding can blend market context into the local range when enabled.`,
  },
  {
    slug: "structured-scoring",
    title: "Structured scoring",
    lead: "Seniority is scored from explicit, auditable profile factors.",
    body: `\`\`\`puml
@startuml
title Factors → score → evidence
[Profile factors\\nexp · skills · seniority\\nedu · traits] as f
[Scorer\\n0–100] <<focus>> as s
[Extraction tab\\nbreakdown · evidence] as ui
f --> s
s --> ui
@enduml
\`\`\`

- The 0–100 score combines experience, skills, role seniority, education, and professional traits.
- The Extraction tab shows the breakdown and evidence trace, so the score is auditable.`,
  },
  {
    slug: "skill-taxonomy",
    title: "Skill taxonomy graph",
    group: GROUP_V2,
    lead: "A single source of truth for matching: aliases collapse synonyms, a hierarchy relates broad ↔ specific skills.",
    body: `\`\`\`puml
@startuml
title Aliases + hierarchy + provenance
[Raw skill terms\\nfrom JD & CV] as raw
package "Skill taxonomy" {
  [Alias resolver\\nReact.js = React] <<auto>> as alias
  [Hierarchy\\nSwiftUI ⊂ Swift] <<auto>> as hier
}
[Canonical skills\\n+ provenance] as out
raw --> alias
alias --> hier
hier --> out
@enduml
\`\`\`

- \`taxonomy.py\` resolves aliases deterministically before any LLM call, so "React.js" and "ReactJS" score as one skill.
- Hierarchical edges let a specific skill (SwiftUI) partially satisfy a broader requirement (Swift), with provenance kept per claim.`,
  },
  {
    slug: "archetype-routing",
    title: "Archetype routing",
    group: GROUP_V2,
    lead: "Every candidate is routed as experienced, early-career, or career-switcher — the lever that keeps scoring fair.",
    body: `\`\`\`puml
@startuml
title One router, three fair paths
[Candidate signals\\nenrolment · years · intent] as sig
[Archetype router\\nconfidence-scored] <<auto>> as router
[BAU\\nexperienced] as bau
[Student /\\nearly-career] <<gate>> as student
[Career switcher] <<gate>> as switch
sig --> router
router --> bau
router --> student
router --> switch
@enduml
\`\`\`

- \`archetype.detect_archetype\` scores the route with reasons, so seniority isn't assumed from years alone.
- Early-career and career-switcher routes carry human-in-the-loop gates (coral) — they are never silently advanced or rejected.`,
  },
  {
    slug: "matching-engine",
    title: "Matching engine",
    group: GROUP_V2,
    lead: "A candidate is ranked against the job corpus by hard knock-out gates, then archetype-aware scoring.",
    body: `\`\`\`puml
@startuml
left to right direction
title KO gates → weighted score → ranked
[Candidate\\n(V2 profile)] as cand
package "Matching engine" {
  [KO filter\\nlocation · lang · auth\\n· entry-eligible] <<auto>> as ko
  [Multi-factor scorer\\narchetype weights] <<auto>> as score
}
[Ranked matches\\n+ salary bands] as out
cand --> ko
ko --> score
score --> out
@enduml
\`\`\`

- \`matching.ko_filter\` removes hard mismatches first; \`score_job\` then weights skills, seniority, and potential by archetype.
- Surfaced in the Match tab and the Matrix (candidate × job grid) via \`/api/match\` and \`/api/matrix\`.`,
  },
  {
    slug: "match-reasoning",
    title: "Match reasoning",
    group: GROUP_V2,
    lead: "Each pairing gets a plain-language verdict — the Claude CLI when available, a deterministic explanation otherwise.",
    body: `\`\`\`puml
@startuml
title Never blocks: LLM with a fallback
[Match result\\nscore · gaps] as m
[Reasoning generator] <<auto>> as gen
cloud "Claude CLI" as cli
[Deterministic\\nfallback] as fb
[Verdict · strengths\\ngaps · probes\\n(cached 168h)] as out
m --> gen
gen --> cli
gen ..> fb : if CLI absent
cli --> out
fb --> out
@enduml
\`\`\`

- \`match_reasoning.generate\` calls the local Claude CLI and always has \`deterministic_reasoning\` to fall back to, so analysis never stalls.
- Results are cached for 168h in \`gemini_cache\`, keyed per candidate × job.`,
  },
  {
    slug: "ai-screening",
    title: "AI screening & policy",
    group: GROUP_V2,
    lead: "Strong experienced matches auto-advance; everything else is held for a human. Fairness gates run before any LLM call.",
    body: `\`\`\`puml
@startuml
title Auto-advance BAU, hold the rest
[Screened entry] as e
[Fairness gate\\n(pre-LLM)] <<gate>> as gate
[Screening recommendation\\nLLM + fallback] <<auto>> as screen
[Auto-advance\\nBAU · conf ≥ 80] <<auto>> as adv
[Hold → Decisions\\nearly-career · low-conf] <<gate>> as hold
e --> gate
gate --> screen
screen --> adv
screen --> hold
@enduml
\`\`\`

- \`screen_candidate\` (Task 1) forces a hold for early-career and low-confidence cases; only confident BAU advances automatically.
- \`evaluate_entry\` (Task 7) runs the same rules as a batch policy pass — and never auto-rejects.`,
  },
  {
    slug: "decisions-queue",
    title: "Decisions & human gates",
    group: GROUP_V2,
    lead: "Held candidates, offers, and every rejection are human calls — never silently automated.",
    body: `\`\`\`puml
@startuml
title Where a human stays in the loop
[Held entries\\n+ approvals] as q
package "Decisions queue" {
  [Recruiter review] <<gate>> as rev
}
[Advance] <<auto>> as adv
[Reject\\n(human only)] <<gate>> as rej
[Offer decision] <<gate>> as offer
q --> rev
rev --> adv
rev --> rej
rev --> offer
@enduml
\`\`\`

- The Decisions tab collects everything automation deliberately would not decide: early-career advances, low-confidence calls, rejections, offers.
- Each carries the AI recommendation as context, but the action is a human click.`,
  },
  {
    slug: "recruiter-outputs",
    title: "Recruiter comms & interview support",
    group: GROUP_V2,
    lead: "Outreach, rejection, and offer letters plus interview prep and scorecards are drafted automatically — with fallbacks.",
    body: `\`\`\`puml
@startuml
title Drafted by AI, sent by a human
[Pipeline entry] as e
package "Generated artifacts" {
  [Outreach / rejection /\\noffer draft] <<auto>> as msg
  [Interview prep pack] <<auto>> as prep
  [Scorecard synthesis] <<auto>> as score
}
[Recruiter\\nreviews · sends] <<gate>> as rec
e --> msg
e --> prep
e --> score
msg --> rec
prep --> rec
score --> rec
@enduml
\`\`\`

- Tasks 2–5 and 8 generate role- and candidate-grounded text (CV-aware prep, notes-driven scorecards), each with a deterministic fallback.
- Drafts are reviewed by a recruiter before anything reaches a candidate — delivery on the mainline is a known next step.`,
  },
  {
    slug: "dev-cases",
    title: "Dev-case extension",
    group: GROUP_V2,
    lead: "A scenario track for LLM-era developer hiring: generate a case, distribute it, and evaluate submissions.",
    body: `\`\`\`puml
@startuml
left to right direction
title Need → case → distribute → evaluate
[Hiring need] as need
package "Dev case lifecycle" {
  [Generate case\\n+ artifacts] <<auto>> as gen
  [Distribute] <<auto>> as dist
  [Evaluate\\nsubmissions] <<auto>> as eval
}
[Ranked candidates] as out
need --> gen
gen --> dist
dist --> eval
eval --> out
@enduml
\`\`\`

- Assumes near-100% LLM-generated code: the case probes judgement, debugging, and review rather than from-scratch authoring.
- Lives under \`pipeline/jobfit/devcase\` with its own lifecycle, inbound, and evaluation model (Dev cases tab).`,
  },
];

// v1 acceptance items first, then the v2 platform — each group sorted by title.
const GROUP_ORDER = [GROUP_V1, GROUP_V2];

export type CoverageGroup = { label: string; items: CoverageItem[] };

export const coverageGroups: CoverageGroup[] = GROUP_ORDER.map((label) => ({
  label,
  items: coverageItems
    .filter((item) => (item.group ?? GROUP_V1) === label)
    .sort((a, b) => a.title.localeCompare(b.title)),
})).filter((group) => group.items.length > 0);

export const allCoverageItems: CoverageItem[] = coverageGroups.flatMap((group) => group.items);
