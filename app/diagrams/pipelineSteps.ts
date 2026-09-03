// Per-step implementation detail for the to-be pipeline funnel. Each entry maps
// a funnel node id (the alias in 15-automated-pipeline-tobe.puml) to how that
// step is actually wired today: UI module → function/call → data tables, drawn
// as a left-to-right component diagram. Dashed nodes mark honest remaining gaps.
//
// PROSE LIVES IN THE CATALOGS (/perfect wave 21b). What a reader is told about a
// step — its title and its summary — is copy, so it is `diagrams.steps.<id>.title`
// / `.summary` in messages/{en,cs,de,fr}.json, keyed by the same alias used here.
// What stays in this module is everything that is NOT copy and must read the same
// in every language: the status, the repo-relative `files[]` citations and the
// `puml` body, whose boxes are code identifiers (`runJdBuild`, `POST /api/jds/save`)
// that a translation would turn into a wrong claim about the code. The two halves
// are held in bijection by pipelineSteps.test.ts.

export type StepStatus = "live" | "gate" | "gap";

export type StepDetail = {
  status: StepStatus;
  files: string[];
  puml: string;
};

export const STEP_DETAILS: Record<string, StepDetail> = {
  jd: {
    status: "live",
    files: ["app/features/library/jds/*", "app/_lib/jd-build-run.ts", "app/api/jds/save/route.ts", "pipeline/jobfit/devcase/devcase_cli.py"],
    puml: `[Library · JdBuilder] <<auto>> as ui
[runJdBuild\\ndevcase_cli need->design] as fn
[POST /api/jds/save\\nsaveJd + ingestJobAd] as api
database "jds · jobs\\njob_ingests" as db
ui --> fn : need text
fn --> api : markdown
api --> db : INSERT`,
  },
  ingest: {
    status: "live",
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
    status: "live",
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
    status: "live",
    files: ["app/features/tools/analyze/*", "app/api/analyze/route.ts", "app/_lib/analyze-run.ts", "pipeline/jobfit/pipeline.py"],
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
    status: "live",
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
    status: "live",
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
    status: "live",
    files: ["app/features/insights/matrix/*", "app/features/insights/matrix/focus/*", "app/api/match/route.ts", "pipeline/jobfit/matching.py"],
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
    status: "live",
    files: ["app/features/hiring/pipeline/PipelineCandidateDrawer.tsx", "app/_lib/automation-run.ts", "pipeline/jobfit/automation.py"],
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
    status: "gate",
    files: ["app/features/hiring/decisions/*", "app/api/pipeline/[id]/route.ts", "app/_lib/db.ts (actOnPipelineEntry)"],
    puml: `[DecisionsTab\\nAiReviewCard] <<gate>> as ui
[POST /api/pipeline/[id]] as api
[actOnPipelineEntry] as fn
database "pipeline_entries\\npipeline_events" as db
ui --> api : accept / reject
api --> fn
fn --> db : UPDATE stage`,
  },
  engage: {
    status: "live",
    files: ["app/features/hiring/pipeline/PipelineCandidateDrawer.tsx", "app/_lib/automation-run.ts", "app/_lib/comms-dispatch.ts", "app/_lib/comms.ts"],
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
    status: "live",
    files: [
      "app/features/hiring/pipeline/PipelineCandidateDrawer.tsx",
      "app/api/interview/*",
      "app/_lib/interview-run.ts",
      "app/_lib/voice/*",
      "app/_components/voice/VoiceInterview.tsx",
      "app/features/hiring/schedule/*",
      "app/api/schedule/*",
      "app/_lib/schedule-store.ts",
    ],
    puml: `[CandidateDrawer\\n"Voice screen"] <<auto>> as ui
[POST /api/interview/create\\nbuildGroundedInterview · Task 4] <<auto>> as create
database "interview_sessions" as iv
[Candidate portal\\n/interview/[token]] <<auto>> as portal
[/api/interview/connect\\nvoice adapter] as conn
cloud "OpenAI / ElevenLabs" as prov
[/api/interview/complete\\nrunInterviewScorecard · Task 5] <<auto>> as done
database "pipeline_entries\\n(scorecard_review)" as pe
[POST /api/schedule/invite\\ncreateScheduleInvite + dispatch] <<auto>> as inv
[Candidate picks a slot\\n/schedule/[token] · confirm] <<auto>> as slot
database "schedule_invites" as si
ui --> create
create --> iv : INSERT
create --> portal : token link
portal --> conn
conn --> prov : WebRTC
portal --> done : transcript
done --> iv
done --> pe : setApproval
ui --> inv : propose times
inv --> si : INSERT
inv --> slot : token link
slot --> si : confirmed slot`,
  },
  offer: {
    status: "gate",
    files: ["app/features/hiring/pipeline/PipelineCandidateDrawer.tsx", "app/_lib/automation-run.ts", "app/_lib/offers-store.ts", "app/_lib/comms-dispatch.ts"],
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
    status: "live",
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
    status: "live",
    files: ["app/_lib/offer-finalize.ts", "app/_lib/ats-egress.ts", "app/api/ats/deliveries/route.ts"],
    puml: `[Entry -> Hired] <<auto>> as h
[dispatchAtsEvent\\ncandidate.hired] as fn
[ATS / HRIS webhook] as send
database "ats_delivery\\npipeline_events" as db
h --> fn
fn --> send
send --> db : hire handoff`,
  },
  cron: {
    status: "live",
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
