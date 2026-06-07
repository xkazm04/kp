// Per-step implementation detail for the to-be pipeline funnel. Each entry maps
// a funnel node id (the alias in 15-automated-pipeline-tobe.puml) to how that
// step is actually wired today: UI module → function/call → data tables, drawn
// as a left-to-right component diagram. Dashed nodes mark honest remaining gaps.

export type StepStatus = "live" | "gate" | "gap";

export type StepDetail = {
  title: string;
  status: StepStatus;
  summary: string;
  files: string[];
  puml: string;
};

export const STEP_DETAILS: Record<string, StepDetail> = {
  jd: {
    title: "JD authoring",
    status: "live",
    summary:
      "A recruiter's free-text need (optionally a GitHub repo) becomes a publishable Markdown JD via the devcase need→design chain, then is persisted — and ingested into the matchable corpus.",
    files: ["app/features/sub_library/*", "app/_lib/jd-build-run.ts", "app/api/jds/save/route.ts", "pipeline/jobfit/devcase/devcase_cli.py"],
    puml: `[Library · JdBuilder] <<auto>> as ui
[runJdBuild\\ndevcase_cli need->design] as fn
[POST /api/jds/save\\nsaveJd + ingestJobAd] as api
database "jds · jobs\\njob_ingests" as db
ui --> fn : need text
fn --> api : markdown
api --> db : INSERT`,
  },
  ingest: {
    title: "JD → structured Job",
    status: "live",
    summary:
      "Direction #1: an authored or pasted ad is parsed into a structured Job (must/nice, taxonomy-resolved skills, entry profile) and written to the matchable corpus, content-hash deduped so unchanged ads are free.",
    files: ["pipeline/jobfit/jobs_cli.py", "app/_lib/job-ingest.ts", "app/api/jobs/ingest/route.ts"],
    puml: `[JD text / ad] as src
[POST /api/jobs/ingest\\njob-ingest.ts] <<auto>> as api
[jobs_cli\\nnormalize_job · ingest_raw_ad] as cli
[insertJob\\n(content-hash dedup)] as ins
database "jobs · job_ingests" as db
src --> api
api --> cli : spawn
cli --> ins
ins --> db : INSERT`,
  },
  dist: {
    title: "Candidate fan-out",
    status: "live",
    summary:
      "On JD save the candidate pool is ranked against the new job and seeded as Accepted pipeline entries; the policy pass's Accepted branch (Direction #1) auto-advances matched candidates into Screened (first-wave evaluation). External job-board posting is still manual.",
    files: ["app/api/jds/save/route.ts", "app/_lib/devcase-run.ts", "pipeline/jobfit/recruiter_cli.py", "pipeline/jobfit/automation.py (evaluate_entry)"],
    puml: `[POST /api/jds/save] <<auto>> as api
[runSourceForRole\\nrecruiter_cli --job-json] as fn
[createPipelineEntry\\nstage = Accepted] as ce
[evaluate_entry\\nAccepted -> Screened] <<auto>> as ev
database "pipeline_entries" as db
[Post to job boards / ATS\\n(still manual)] <<gap>> as boards
api --> fn : rank pool
fn --> ce
ce --> db : INSERT
ev --> db : auto-advance
api ..> boards`,
  },
  apply: {
    title: "Candidate apply / CV upload",
    status: "live",
    summary:
      "A CV (PDF/DOCX/TXT/MD) uploaded in the Analyze tab is bridged to the Python analysis CLI as a subprocess and the result is saved. The guided Profile form persists a structured V2 profile.",
    files: ["app/features/sub_analyze/*", "app/api/analyze/route.ts", "app/_lib/analyze-run.ts", "pipeline/jobfit/pipeline.py"],
    puml: `actor "Candidate" as c
[Analyze / Profile tab] <<auto>> as ui
[POST /api/analyze] as api
[pipeline.jobfit.cli\\nanalyze_cv] as cli
database "analyses · profiles" as db
c --> ui : upload CV
ui --> api
api --> cli : spawn
cli --> db : saveAnalysis`,
  },
  extract: {
    title: "Extract text + LLM fields",
    status: "live",
    summary:
      "Deterministic text extraction (with Czech mojibake + letter-spacing repair) feeds an LLM that returns structured skills/traits/evidence. Note: the runtime extractor still calls Gemini (off-spec vs the Claude-CLI-only rule) and the LLM-only fields have no deterministic fallback yet.",
    files: ["pipeline/jobfit/extractors.py", "pipeline/jobfit/gemini.py", "pipeline/jobfit/pipeline.py"],
    puml: `[analyze_cv] as cli
[extractors.extract_text\\nclean · repair CZ] <<auto>> as ext
cloud "Gemini\\nLLM fields (off-spec)" as gem
database "analyses" as db
cli --> ext : PDF/DOCX/TXT
ext --> gem : text
gem --> db : structured profile`,
  },
  v2: {
    title: "Archetype route → V2 profile",
    status: "live",
    summary:
      "Direction #2: the CV path now infers archetype signals and runs detect_archetype, mapping the extracted CV into a CandidateProfileV2 with provenance/potential. The candidates route and match-candidate.ts read the real archetype instead of hard-coding BAU.",
    files: ["pipeline/jobfit/pipeline.py (_v2_profile_from_payload)", "pipeline/jobfit/archetype.py", "app/api/jobs/[id]/candidates/route.ts", "app/_lib/match-candidate.ts"],
    puml: `[Extracted CV payload] as cv
[_v2_profile_from_payload\\ndetect_archetype] <<auto>> as fn
[CandidateProfileV2\\nprovenance · potential] as prof
database "analyses · profiles" as db
cv --> fn
fn --> prof : BAU / student / switcher
prof --> db`,
  },
  match: {
    title: "Match — KO · score · reason",
    status: "live",
    summary:
      "A normalized candidate is filtered by hard knock-out gates, then scored against the job corpus with archetype-aware weights over the taxonomy hierarchy. Surfaced in the Match tab and the Matrix grid.",
    files: ["app/features/sub_match/*", "app/features/sub_matrix/*", "app/api/match/route.ts", "pipeline/jobfit/matching.py"],
    puml: `[Match / Matrix tab] <<auto>> as ui
[POST /api/match\\n/api/matrix] as api
[matching.ko_filter\\nscore_job] as fn
database "jobs · profiles" as db
ui --> api
api --> fn : spawn
db --> fn : corpus
fn --> ui : ranked + bands`,
  },
  screen: {
    title: "AI screening",
    status: "live",
    summary:
      "Fairness-gated screening (Task 1) runs the Claude CLI with a deterministic fallback. Available one-by-one at both pre-interview stages: at Accepted it triages a fresh applicant into Screened; at Screened it advances toward Interview. Confident matches advance; early-career and low-confidence are held for the Decisions queue — never auto-rejected.",
    files: ["app/features/sub_pipeline/CandidateDrawer.tsx", "app/_lib/automation-run.ts", "pipeline/jobfit/automation.py"],
    puml: `[CandidateDrawer\\n"Screen with AI"] <<auto>> as ui
[runAutomationTask\\nscreen] as fn
[automation_cli screen\\nClaude CLI + fallback] as cli
database "pipeline_entries\\npipeline_events · gemini_cache" as db
ui --> fn : startTask
fn --> cli : spawn
cli --> fn : route + confidence
fn --> db : advance / hold`,
  },
  decide: {
    title: "Decisions queue",
    status: "gate",
    summary:
      "The deliberate human-in-the-loop gate: held candidates, rejections, and approvals are a recruiter's call. The AI recommendation rides along as context; the action is a click.",
    files: ["app/features/sub_decisions/*", "app/api/pipeline/[id]/route.ts", "app/_lib/db.ts (actOnPipelineEntry)"],
    puml: `[DecisionsTab\\nAiReviewCard] <<gate>> as ui
[POST /api/pipeline/[id]] as api
[actOnPipelineEntry] as fn
database "pipeline_entries\\npipeline_events" as db
ui --> api : accept / reject
api --> fn
fn --> db : UPDATE stage`,
  },
  engage: {
    title: "Outreach + interview invite",
    status: "live",
    summary:
      "Direction #3: outreach and rejection messages are drafted (Claude CLI + fallback) and actually dispatched through the comms channel (queued by default, sent when COMMS_WEBHOOK_URL is set). The recipient is still the candidate label — an email/ATS field is the enrichment hook.",
    files: ["app/features/sub_pipeline/CandidateDrawer.tsx", "app/_lib/automation-run.ts", "app/_lib/comms-dispatch.ts", "app/_lib/comms.ts"],
    puml: `[CandidateDrawer\\n"Draft outreach"] <<auto>> as ui
[runAutomationTask\\noutreach] as fn
[dispatchOutreach\\ncomms-dispatch.ts] as disp
[sendComm] as send
database "dev_outbox\\npipeline_events" as db
[email / ATS recipient\\n(label only today)] <<gap>> as rcpt
ui --> fn
fn --> disp
disp --> send
send --> db : queued -> sent
send ..> rcpt`,
  },
  interview: {
    title: "Interview — AI voice screen → scorecard",
    status: "live",
    summary:
      "The recruiter creates a grounded voice screen (questions from Task 4 prep); the candidate takes it in-browser (OpenAI Realtime or ElevenLabs). On hang-up the transcript synthesizes a scorecard (Task 5) and sets scorecard_review for the Interview→Offer gate. Slot scheduling is still hardcoded.",
    files: ["app/features/sub_pipeline/CandidateDrawer.tsx", "app/api/interview/*", "app/_lib/interview-run.ts", "app/_lib/voice/*", "app/_components/voice/VoiceInterview.tsx"],
    puml: `[CandidateDrawer\\n"Voice screen"] <<auto>> as ui
[POST /api/interview/create\\nbuildGroundedInterview · Task 4] <<auto>> as create
database "interview_sessions" as iv
[Candidate portal\\n/interview/[token]] <<auto>> as portal
[/api/interview/connect\\nvoice adapter] as conn
cloud "OpenAI / ElevenLabs" as prov
[/api/interview/complete\\nrunInterviewScorecard · Task 5] <<auto>> as done
database "pipeline_entries\\n(scorecard_review)" as pe
[interview slot\\nhardcoded Tue 14:00] <<gap>> as slot
ui --> create
create --> iv : INSERT
create --> portal : token link
portal --> conn
conn --> prov : WebRTC
portal --> done : transcript
done --> iv
done --> pe : setApproval
create ..> slot`,
  },
  offer: {
    title: "Offer decision",
    status: "gate",
    summary:
      "The offer figure is deterministic (role band × fit) and the letter auto-drafts. A human approves it (the gate), which EXTENDS the offer and dispatches it to the candidate.",
    files: ["app/features/sub_pipeline/CandidateDrawer.tsx", "app/_lib/automation-run.ts", "app/_lib/offers-store.ts", "app/_lib/comms-dispatch.ts"],
    puml: `[CandidateDrawer\\n"Draft offer"] <<auto>> as ui
[runAutomationTask\\noffer] as fn
[setApproval\\noffer_review] as ap
[AiReviewCard approve\\n(human)] <<gate>> as human
[createOffer (extended)\\n+ dispatchOffer] as ext
database "pipeline_entries\\noffers · dev_outbox" as db
ui --> fn
fn --> ap
ap --> human
human --> ext
ext --> db`,
  },
  close: {
    title: "Deliver offer · capture accept/decline",
    status: "live",
    summary:
      "Direction #4: the candidate opens a tokenized offer page and accepts or declines. Accept transitions the entry to Hired; decline closes it. No more bare human click at the terminal.",
    files: ["app/offer/[token]/page.tsx", "app/api/offer/[token]/route.ts", "app/_lib/offers-store.ts"],
    puml: `actor "Candidate" as c
[Offer portal\\n/offer/[token]] <<auto>> as portal
[POST /api/offer/[token]] as api
[markOfferResponded\\nmarkEntryStatus] as fn
database "offers\\npipeline_entries" as db
c --> portal : accept / decline
portal --> api
api --> fn
fn --> db : accept -> Hired`,
  },
  hire: {
    title: "Onboarding handoff",
    status: "live",
    summary:
      "Direction #4 terminal: reaching Hired fires an onboarding handoff comm, so the automated middle of the funnel finally has an automated end.",
    files: ["app/_lib/comms-dispatch.ts (dispatchOnboarding)", "app/_lib/db.ts", "app/_lib/comms.ts"],
    puml: `[Entry -> Hired] <<auto>> as h
[dispatchOnboarding\\ncomms-dispatch.ts] as fn
[sendComm] as send
database "dev_outbox\\npipeline_events" as db
h --> fn
fn --> send
send --> db : onboarding handoff`,
  },
  cron: {
    title: "Scheduler / cron",
    status: "live",
    summary:
      "Direction #5: a durable clock. An instrumentation heartbeat ticks the scheduler, which atomically claims a due run and executes the policy pass (aging nudges, time-based advances). Default OFF — opt in via the Pipeline-tab toggle or AUTOMATION_SCHEDULER_AUTOSTART=1.",
    files: ["instrumentation.ts", "app/_lib/scheduler.ts", "app/_lib/scheduler-store.ts", "app/_lib/automation-pass.ts", "app/api/automation/schedule/route.ts"],
    puml: `[instrumentation.ts\\n60s heartbeat] <<auto>> as hb
[tickScheduler\\nclaimDueRun (atomic)] as tick
[runAutomationPass\\nevaluate_entry] as pass
database "scheduler · scheduler_runs\\npipeline_entries" as db
[SchedulerControl\\nPipeline tab (default off)] <<gate>> as ui
ui --> tick : enable / interval
hb --> tick : due?
tick --> pass
pass --> db : advance / hold / nudge`,
  },
};
