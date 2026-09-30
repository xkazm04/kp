// Gigs — the whole lifecycle, end to end, HERMETIC (docs/features/gigs/README.md "Testing the
// process end to end", tier 1):
//
//   scan (the REAL freelancer_api adapter against a local fixture API) -> expiry + quarantine
//   + the not-digital decline (a physical listing never reaches research) -> research (the
//   pinned web-researching brief, gig-brief-v4) -> the report. Then the TWO TRACKS
//   (docs/features/gigs/README.md "Two tracks"):
//
//   BUILD (an open-source bounty, forwarded by hand - test 2c): plans (the lineup follows the
//   brief's difficulty: three seats on a very hard gig, one of them GPT through the Codex CLI;
//   one Sonnet seat on a moderate one) -> ACCEPT one in the UI -> dispatch = pairing
//   (workspace by type, project at the gig's folder, the plan as a milestone, the gig persona
//   hired and AUTO-APPROVED) -> the run -> sync (the draft lands, PLAN-STATUS mirrored to the
//   milestone, shown on the Pairing tab) -> review (approve with the whole checklist) ->
//   SUBMISSION, SIMULATED ("Mark sent": kp never submits anything) -> outcome (accepted, a
//   lesson queued) -> cleanup (the persona retired; the niche sweep).
//
//   PROPOSAL (the scanned FREELANCE listing - tests P1-P3): plans with the client-facing prompt
//   variant -> accept -> the pinned model writes the CLIENT PROPOSAL (a file with no internal
//   figures, served sandboxed) and the gig reaches `drafted` with kp's own attempt - WITHOUT
//   pairing, a persona or a dispatch (a dispatch is refused GIG_PROPOSAL_TRACK) -> review with
//   the proposal checklist -> "Mark sent".
//
//   Side paths: withdraw for a brief challenge (and the next brief call is handed it), a
//   dispatch with no accepted plan (409), a plan seat that fails while the other two land.
//
// Every HUMAN GATE is answered by the test: plan acceptance (a click in the Plans tab), the
// Personas approval (the mock's gig persona policy approves on arrival, as the real one does),
// the review (the checklist ticked, the disclosure included), and the send ("Mark sent" is the
// operator saying he sent it; nothing leaves kp).
//
// WHAT IS REAL AND WHAT IS FAKE. Real: the kp server (its own `next dev`, its own throwaway DB,
// its own port, its own `.next-empty` dist dir), every route, the task runner, the Python
// pipeline (gig_brief_cli.py / gig_plan_cli.py and the LLM registry), the freelancer adapter,
// politeFetch, the honeypot scan, qualification, pairing, the sync. Fake, and each asserted on:
//   - the Claude CLI and the Codex CLI: e2e/fixtures/fake-claude/ (fake-claude.mjs and
//     fake-codex.mjs behind their shims) first on the SERVER's PATH, logging every call (argv +
//     the untrusted payload it read) to one file this spec reads;
//   - Personas: e2e/fixtures/mock-gig-bridge.ts (PERSONAS_BRIDGE_URL/KEY), logging every call;
//     its `runAgent` hook is the agent: it writes the deliverable the contract asks for and
//     PLAN-STATUS.json into the gig folder;
//   - Freelancer.com: a loopback fixture API the adapter is pointed at through the documented
//     test seam KP_GIGS_FREELANCER_API_BASE (app/_lib/gigs/adapters/freelancer.ts, loopback only).
// No network, no key, no spend. KP_OFFLINE is NOT set: it would seal the Claude CLI too, and the
// point is to drive the model-backed path (with a fake model).
//
// HOW TO RUN. The spec boots its OWN server, because the fake CLI, the mock bridge and the
// fixture API must be in the server's environment before it starts (their ports are only known
// here). It therefore needs KP_E2E_BASE_URL (which also switches playwright.config.ts's managed
// webServer off) naming a free loopback port, and it skips without it:
//
//   npm run test:e2e:gigs
//   (= cross-env KP_E2E_BASE_URL=http://localhost:3117 playwright test e2e/gig-lifecycle.spec.ts)
//
// Not in KEYLESS_SPECS: the release job runs a production build it starts itself, with none of
// this env, and this spec needs to own its server. Python + requirements.txt must be installed
// (every brief and plan spawns `python -m pipeline.jobfit…`), as for `npm run build`.
//
// The operator's dev server (:3000, data/kp.sqlite) is never touched: another port, another DB
// file under the OS temp dir, another dist dir.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { seedDevAuth } from "./dev-auth";
import { startMockGigBridge, type MockGigBridge } from "./fixtures/mock-gig-bridge";

test.describe.configure({ mode: "serial" });

const REPO_ROOT = process.cwd();
const BASE = process.env.KP_E2E_BASE_URL ?? "";
const BASE_URL = (() => {
  try {
    return BASE ? new URL(BASE) : null;
  } catch {
    return null;
  }
})();
const OWN_SERVER_OK = !!BASE_URL && ["localhost", "127.0.0.1"].includes(BASE_URL.hostname) && !!BASE_URL.port;

test.skip(!OWN_SERVER_OK, "Run through `npm run test:e2e:gigs`: this spec boots its own server at KP_E2E_BASE_URL (a free loopback port).");

// ─── The fixture world ──────────────────────────────────────────────────────────────────

/** The proposal track's checklist (app/_lib/gigs/checklists.ts GIG_CHECKLISTS.freelance). */
const FREELANCE_CHECKLIST = ["brief_answered", "scope_honest", "no_overclaim", "asks_included", "proposal_attached", "no_off_platform", "disclosure"];
/** The build track's checklist for the bounty fixture (GIG_CHECKLISTS.oss_bounty). */
const BUILD_CHECKLIST = ["claim_rules_followed", "tests_pass", "scoped_change", "contributing_followed", "pr_description", "disclosure"];
/** The AI-use disclosure kp's own proposal message ends with (contract.ts GIG_DISCLOSURE_SENTENCE). */
const KP_DISCLOSURE = "This work was prepared with the assistance of an AI agent and reviewed by me before sending.";
const DISCLOSURE = "I used AI tools to draft this work and I reviewed every part of it myself before sending.";
const ACCEPT_NOTE = "Keep the PoC harmless";
const RUN_COST_USD = 0.42;
const MAIN_TITLE = "Build a landing page for a bakery";
/** The BUILD-track fixture: an open-source bounty forwarded by hand (a freelance gig is never
 *  built). "bakery" makes the fake brief rate it very hard (three plan seats), "landing" files
 *  it as web development (the `web` gig type, the "Gigs · Web" Personas workspace). */
const BUILD_TITLE = "Build a landing page for a bakery chain";
const HONEYPOT_TITLE = "Quick data entry job";
const LATE_TITLE = "Fix a typo on a static site";
const PHYSICAL_TITLE = "Bulk Retail Gift Cards";

/** The Freelancer projects/active answer (the shape freelancer.ts reads), dated at request time. */
function freelancerProjects(nowS: number) {
  return [
    {
      id: 900001,
      title: MAIN_TITLE,
      seo_url: "websites/bakery-landing-page",
      description:
        "We need a one-page landing page for our bakery: a hero with our name, opening hours, three product photos and a contact form. Plain HTML and CSS is fine. Please deliver the files and tell us how you checked them.",
      type: "fixed",
      bidperiod: 14,
      time_submitted: nowS - 86_400,
      budget: { minimum: 250, maximum: 400 },
      currency: { code: "USD", sign: "$" },
      jobs: [{ name: "Website Design" }, { name: "HTML" }],
    },
    {
      id: 900002,
      title: HONEYPOT_TITLE,
      seo_url: "data-entry/quick-data-entry-job",
      description: "Copy 200 rows from a PDF into a spreadsheet. Contact me on Telegram, paid in USDT.",
      type: "fixed",
      bidperiod: 7,
      time_submitted: nowS - 3_600,
      budget: { minimum: 30, maximum: 50 },
      currency: { code: "USD", sign: "$" },
      jobs: [{ name: "Data Entry" }],
    },
    {
      // The listing the operator named when he asked for physical work to stay off the desk
      // (2026-09-30): its tags AND its text name physical goods, so qualification declines it.
      id: 900004,
      title: PHYSICAL_TITLE,
      seo_url: "supplier-sourcing/bulk-retail-gift-cards",
      description:
        "I'm sourcing a dependable supplier who can deliver physical retail gift cards in mid-size batches. I need between 50 and 100 cards each for three stores, brand-new and fully activated.",
      type: "fixed",
      bidperiod: 20,
      time_submitted: nowS - 7_200,
      budget: { minimum: 200, maximum: 500 },
      currency: { code: "USD", sign: "$" },
      jobs: [{ name: "Data Entry" }, { name: "Excel" }, { name: "Supplier Sourcing" }, { name: "Logistics" }, { name: "eBay" }],
    },
    {
      id: 900003,
      title: LATE_TITLE,
      seo_url: "websites/fix-a-typo",
      description: "One word on our About page is misspelled. Fix it and send the corrected HTML file.",
      type: "fixed",
      bidperiod: 2,
      time_submitted: nowS - 10 * 86_400,
      budget: { minimum: 10, maximum: 20 },
      currency: { code: "USD", sign: "$" },
      jobs: [{ name: "HTML" }],
    },
  ];
}

const WARMUP_TITLE = "Warm-up listing for the task runner";

/** The first list call's answer: one listing whose only job is the warm-up scan (see test 1). */
function warmupProjects(nowS: number) {
  return [
    {
      id: 900000,
      title: WARMUP_TITLE,
      seo_url: "websites/warm-up-listing",
      description: "A small website task used to start the task runner before the lifecycle begins.",
      type: "fixed",
      bidperiod: 30,
      time_submitted: nowS - 60,
      budget: { minimum: 100, maximum: 150 },
      currency: { code: "USD", sign: "$" },
      jobs: [{ name: "Website Design" }],
    },
  ];
}

type FixtureApi = { url: string; hits: string[]; close(): Promise<void> };

async function startFreelancerFixture(): Promise<FixtureApi> {
  const hits: string[] = [];
  let listCalls = 0;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    hits.push(url.pathname);
    if (url.pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nAllow: /\n");
      return;
    }
    if (url.pathname === "/api/projects/0.1/projects/active/") {
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const nowS = Math.floor(Date.now() / 1000);
      if (offset === 0) listCalls += 1;
      const projects = offset !== 0 ? [] : listCalls === 1 ? warmupProjects(nowS) : freelancerProjects(nowS);
      const payload = JSON.stringify({ status: "success", result: { projects } });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(payload);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "error" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/** A registry checkout with only the knowledge index the `web` gig type asks for, so the
 *  persona's `requirements.knowledge[]` is deterministic (no dependency on ../ai-registry). */
function writeFixtureRegistry(dir: string): void {
  const bundle = path.join(dir, "knowledge", "software-engineering");
  mkdirSync(bundle, { recursive: true });
  const subjects = Object.fromEntries(
    ["error-handling", "data-access", "rate-limiting"].map((s) => [s, { file: `knowledge/software-engineering/backend/${s}/${s}.md` }])
  );
  writeFileSync(path.join(bundle, "index.json"), JSON.stringify({ subjects }, null, 1), "utf8");
}

type FakeCall = {
  /** "codex" for the fake Codex CLI; absent for the fake Claude CLI. */
  cli?: string;
  sandbox?: string | null;
  schemaRequired?: string[] | null;
  argv: string[];
  useCase: string;
  model: string | null;
  effort: string | null;
  allowedTools: string | null;
  maxTurns: number | null;
  jsonSchema: boolean;
  seat?: string;
  /** Which plan prompt ran: "proposal" (gig-plan-v2-proposal) or "build" (gig-plan-v1). */
  planVariant?: string;
  answered: string;
  payload: Record<string, unknown> | null;
};

// ─── The agent (the mock bridge's runAgent hook) ────────────────────────────────────────

type PlanStep = { goalId: string; title: string; doneWhen: string };

/** "Runs" the gig persona: writes what the deliverable contract asks for into the gig folder
 *  (contract.ts: files under deliverable/, the handoff object in kp-deliverable.json at the
 *  root) and PLAN-STATUS.json (goal 1 done, goal 2 in progress at 50, goal 3 open). The run's
 *  output carries no fenced block, so the sync lands the FILE (sync.ts resolveGigDeliverable). */
function runAgent(input: Record<string, unknown>): { output: string; costUsd: number } {
  const workdir = typeof input.workdir === "string" ? input.workdir : null;
  if (!workdir || !existsSync(workdir)) return { output: "No workdir was given, so nothing was written.", costUsd: 0 };
  const plan = input.plan as { steps?: PlanStep[] } | undefined;
  const steps = plan?.steps ?? [];
  mkdirSync(path.join(workdir, "deliverable"), { recursive: true });
  writeFileSync(
    path.join(workdir, "deliverable", "index.html"),
    "<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\"><title>The Bakery</title></head>\n<body>\n<h1>The Bakery</h1>\n<p>Open Monday to Saturday, 7:00 to 18:00.</p>\n</body>\n</html>\n",
    "utf8"
  );
  const deliverable = {
    version: 1,
    summary:
      "Delivered a one-page landing page for the bakery.\n- The page is plain HTML in deliverable/index.html.\n- It was checked against every point of the brief.\n- **Check first:** the opening hours are placeholders.",
    draftText: `Hello,\n\nThe landing page is ready: one HTML file with your name, your opening hours and a contact section. I checked it against each point of your brief.\n\n${DISCLOSURE}\n\nBest regards`,
    artifacts: [{ kind: "file", ref: "deliverable/index.html", title: "Landing page" }],
    evidence: [{ kind: "test", command: "npx html-validate deliverable/index.html", result: "0 errors", passed: true }],
    disclosure: DISCLOSURE,
    confidence: 0.8,
    questions: [],
  };
  writeFileSync(path.join(workdir, "kp-deliverable.json"), JSON.stringify(deliverable, null, 2), "utf8");
  const statuses = [
    { status: "done", progress: 100, note: "Requirements listed in NOTES.md." },
    { status: "in-progress", progress: 50, note: "Page drafted; the form is next." },
    { status: "open", progress: 0 },
  ];
  writeFileSync(
    path.join(workdir, "PLAN-STATUS.json"),
    JSON.stringify({ goals: steps.slice(0, statuses.length).map((s, i) => ({ goalId: s.goalId, ...statuses[i] })) }, null, 2),
    "utf8"
  );
  return { output: "Work finished. The deliverable object is in kp-deliverable.json at the gig folder root.", costUsd: RUN_COST_USD };
}

// ─── The server this spec owns ──────────────────────────────────────────────────────────

let tmp = "";
let gigsRoot = "";
let fakeLog = "";
let serverLog = "";
let server: ChildProcess | null = null;
let mock: MockGigBridge;
let fixture: FixtureApi;
let startedAt = 0;

/** The env var key the platform uses for PATH (Windows: usually `Path`), so the override
 *  replaces it instead of adding a second, ambiguous key. */
function pathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
}

function serverEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Nothing the operator's shell or .env.local carries may steer this server: an EMPTY value
  // blocks .env.local's (Next's env loader keeps what the process already has), and a deleted
  // one is simply off.
  for (const k of ["KP_OFFLINE", "KP_OPERATOR_PASSWORD", "KP_E2E_BASE_URL", "NODE_ENV", "__NEXT_PROCESSED_ENV"]) delete env[k];
  for (const k of [
    "GEMINI_API_KEY",
    "OPENAI_API_KEY",
    "QWEN_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_AGENT_ID",
    "ELEVENLABS_VOICE_ID",
    "GITHUB_TOKEN",
    "KAGGLE_API_TOKEN",
    "KAGGLE_USERNAME",
    "KAGGLE_KEY",
    "LIGHTTRACK_URL",
    "LIGHTTRACK_PROJECT",
    "KP_AUTOMATION_TOKEN",
    "KP_MULTI_WORKSPACE",
    "KP_APP_MASTER_REPO_ROOTS",
    "KP_JOBSEEKER",
  ]) {
    env[k] = "";
  }
  const fakeBin = path.join(REPO_ROOT, "e2e", "fixtures", "fake-claude", process.platform === "win32" ? "bin-win" : "bin-posix");
  const pk = pathKey(env);
  env[pk] = `${fakeBin}${path.delimiter}${env[pk] ?? ""}`;
  return {
    ...env,
    KP_EMPTY: "1",
    KP_DB_PATH: path.join(tmp, "kp-gig-e2e.sqlite"),
    KP_GIGS_ROOT: gigsRoot,
    AI_REGISTRY_DIR: path.join(tmp, "registry"),
    PERSONAS_BRIDGE_URL: mock.url,
    PERSONAS_BRIDGE_KEY: mock.apiKey,
    KP_GIGS_FREELANCER_API_BASE: fixture.url,
    FAKE_CLAUDE_LOG: fakeLog,
    NEXT_PUBLIC_KP_AGENT_HIRING: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

async function answers(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return r.status > 0;
  } catch {
    return false;
  }
}

async function bootServer(): Promise<void> {
  const origin = BASE_URL!.origin;
  if (await answers(`${origin}/api/health`)) {
    throw new Error(`${origin} already answers. This spec boots its own server with the fake CLI and the mock bridge in its env; pick a free port in KP_E2E_BASE_URL.`);
  }
  const nextBin = path.join(REPO_ROOT, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", "--port", BASE_URL!.port], {
    cwd: REPO_ROOT,
    env: serverEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  server = child;
  const sink = (chunk: Buffer) => appendFileSync(serverLog, chunk);
  child.stdout?.on("data", sink);
  child.stderr?.on("data", sink);
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const r = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(60_000) });
      if (r.ok) return;
    } catch {
      // still compiling or not listening yet
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  const tail = existsSync(serverLog) ? readFileSync(serverLog, "utf8").slice(-3_000) : "(no output)";
  throw new Error(`the kp server did not come up at ${origin} (exit ${child.exitCode}). Is .next-empty/dev/lock held by another KP_EMPTY dev server?\n${tail}`);
}

function stopServer(): void {
  const child = server;
  server = null;
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(300_000);
  startedAt = Date.now();
  tmp = mkdtempSync(path.join(os.tmpdir(), "kp-gig-e2e-"));
  gigsRoot = path.join(tmp, "gigs");
  mkdirSync(gigsRoot, { recursive: true });
  fakeLog = path.join(tmp, "fake-claude.jsonl");
  serverLog = path.join(tmp, "server.log");
  writeFixtureRegistry(path.join(tmp, "registry"));
  fixture = await startFreelancerFixture();
  mock = await startMockGigBridge({ runAgent: (input) => runAgent(input), allowedRoots: [gigsRoot] });
  await bootServer();
});

test.afterAll(async () => {
  stopServer();
  await mock?.close();
  await fixture?.close();
  console.log(`[gig-lifecycle] ${((Date.now() - startedAt) / 1000).toFixed(1)} s including the server boot; artefacts in ${tmp}`);
  if (tmp && !process.env.KP_GIG_E2E_KEEP) {
    // Windows releases the killed server's hold on the DB file a moment after taskkill.
    for (let i = 0; i < 20 && existsSync(tmp); i++) {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────────────────────

function fakeCalls(): FakeCall[] {
  if (!existsSync(fakeLog)) return [];
  return readFileSync(fakeLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as FakeCall);
}

async function okJson<T>(res: Awaited<ReturnType<APIRequestContext["get"]>>, what: string): Promise<T> {
  const body = await res.text();
  expect(res.ok(), `${what} answered ${res.status()}: ${body.slice(0, 500)}`).toBe(true);
  return JSON.parse(body) as T;
}

type TaskRow = { id: string; status: string; result: Record<string, unknown> | null; error: string | null };

async function waitTask(request: APIRequestContext, id: string, timeoutMs = 120_000): Promise<TaskRow> {
  const task = await waitTaskEnd(request, id, timeoutMs);
  expect(task.status, `task ${id}: ${task.error ?? ""}`).toBe("succeeded");
  return task;
}

/** The task's terminal row, whatever its status. */
async function waitTaskEnd(request: APIRequestContext, id: string, timeoutMs = 120_000): Promise<TaskRow> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const { task } = await okJson<{ task: TaskRow }>(await request.get(`/api/tasks/${encodeURIComponent(id)}`), `GET /api/tasks/${id}`);
    if (["succeeded", "failed", "canceled", "interrupted"].includes(task.status)) return task;
    if (Date.now() > until) throw new Error(`task ${id} still ${task.status} after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

type GigRow = {
  id: string;
  externalKey: string;
  title: string;
  status: string;
  suspectReasons: string[];
  workdir: string | null;
  specialistId: string | null;
  withdrawReason: { challenge: string; index: number } | null;
  brief: {
    source: string;
    promptVersion: string;
    fallbackReason: string | null;
    challenges: string[];
    category: string;
    title: string;
    difficulty?: string;
    workKind?: string | null;
    missingArtifacts?: string[];
    outreachMessage?: string | null;
  } | null;
  qualification?: { score: number; declineReason?: string | null; declinedBy?: string | null; declineEvidence?: string[] } | null;
  proposal?: ProposalRecord | null;
};
type Attempt = {
  id: string;
  status: string;
  specialistId?: string;
  executionId?: string | null;
  costUsd: number | null;
  deliverable: { summary: string; draftText: string; disclosure: string; artifacts?: { kind: string; ref: string; title: string }[] } | null;
  fallbackReason: string | null;
};
type ProposalRecord = { path: string; status: string; source: string; model: string | null; costUsd: number | null; planId: string | null; message: string; questions: string[]; artifacts: string[] };
type PlanRow = {
  id: string;
  seat: string;
  model: string;
  effort: string | null;
  status: string;
  plan: { summary: string; steps: { title: string; doneWhen: string }[] } | null;
  fallbackReason: string | null;
  costUsd: number | null;
  note: string | null;
  acceptedAt: string | null;
  progress: { milestoneId: string | null; goals: { stepIndex: number; goalId: string | null; status: string; progress: number; note: string | null }[] } | null;
};

async function listGigs(request: APIRequestContext): Promise<GigRow[]> {
  return (await okJson<{ gigs: GigRow[] }>(await request.get("/api/gigs?limit=200"), "GET /api/gigs")).gigs;
}

async function getGig(request: APIRequestContext, id: string): Promise<{ gig: GigRow; attempts: Attempt[] }> {
  return okJson(await request.get(`/api/gigs/${id}`), `GET /api/gigs/${id}`);
}

async function getPlans(request: APIRequestContext, id: string): Promise<PlanRow[]> {
  return (await okJson<{ plans: PlanRow[] }>(await request.get(`/api/gigs/${id}/plans`), `GET /api/gigs/${id}/plans`)).plans;
}

async function sync(request: APIRequestContext): Promise<void> {
  await okJson(await request.post("/api/gigs/sync", { data: {} }), "POST /api/gigs/sync");
}

/** Forward a brief by hand (the operator's door), research it now, and answer the gig. */
async function forwardAndResearch(request: APIRequestContext, title: string, bodyText: string, arena = "freelance"): Promise<GigRow> {
  const created = await okJson<{ gig: GigRow }>(
    await request.post("/api/gigs", {
      data: {
        arena,
        url: `https://example.org/gigs/${encodeURIComponent(title.toLowerCase().replace(/\W+/g, "-"))}`,
        title,
        bodyText,
        reward: { amount: 120, currency: "USD" },
        deadlineAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      },
    }),
    "POST /api/gigs"
  );
  const researched = await okJson<{ gig: GigRow }>(await request.post(`/api/gigs/${created.gig.id}/research`, { timeout: 120_000 }), "POST research");
  expect(researched.gig.brief?.source).toBe("llm");
  return researched.gig;
}

/** The Gigs tab, the gig opened from the whole file (the front page's table). */
async function openProof(page: Page, title: string): Promise<void> {
  await seedDevAuth(page);
  await page.goto("/?tab=gigs");
  const row = page.locator("table.file").getByRole("button", { name: title, exact: true });
  await expect(row).toBeVisible({ timeout: 120_000 });
  await row.click();
  await expect(page.getByRole("group", { name: "Proof sections" })).toBeVisible({ timeout: 30_000 });
}

async function openSection(page: Page, name: RegExp): Promise<void> {
  const tab = page.getByRole("group", { name: "Proof sections" }).getByRole("button", { name });
  await expect(tab).toBeEnabled({ timeout: 30_000 });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-pressed", "true");
}

// ─── The lifecycle ──────────────────────────────────────────────────────────────────────

let mainGig: GigRow;
let buildGig: GigRow;
let acceptedPlan: PlanRow;
let attemptId = "";
let personaId = "";

test("1. scan: the real adapter against the fixture API files, quarantines and expires", async ({ request }) => {
  const created = await okJson<{ source: { id: string; enabled: boolean } }>(
    await request.post("/api/gigs/sources", { data: { adapter: "freelancer_api" } }),
    "POST /api/gigs/sources"
  );
  expect(created.source.enabled, "a tier-B source starts disabled until its terms are acknowledged").toBe(false);
  const { catalog } = await okJson<{ catalog: { adapter: string; termsHash?: string | null }[] }>(await request.get("/api/gigs/sources"), "GET /api/gigs/sources");
  const termsHash = catalog.find((c) => c.adapter === "freelancer_api")?.termsHash;
  expect(termsHash, "the catalog states the terms summary's hash").toBeTruthy();
  await okJson(await request.patch(`/api/gigs/sources/${created.source.id}`, { data: { action: "acknowledge", termsHash } }), "acknowledge");

  // FIRST SCAN AFTER BOOT - a regression guard for a task-runner defect this spec found.
  // The late-bound gig runners are registered from instrumentation-node.ts, a separate server
  // bundle with its OWN copy of app/_lib/tasks.ts. When the scan runner enqueued its research
  // pass, that copy ran its one-time recovery sweep and marked every `running` row
  // `interrupted` - the calling scan included, so the first scan after a boot lost its
  // research task. tasks.ts now marks recovery once per PROCESS (globalThis), so this first
  // scan must succeed. The fixture API answers it with one throwaway listing so the
  // lifecycle's own scan below stays the one that counts.
  const warm = await okJson<{ taskId: string }>(await request.post("/api/gigs/scan", { data: {} }), "first scan after boot");
  const warmTask = await waitTaskEnd(request, warm.taskId);
  expect(warmTask.status, "the first scan after a boot is not swept by a second task-module copy").toBe("succeeded");
  await expect
    .poll(async () => (await listGigs(request)).find((g) => g.title === WARMUP_TITLE)?.brief?.source ?? null, { timeout: 60_000 })
    .toBe("llm");

  const scan = await okJson<{ taskId: string }>(await request.post("/api/gigs/scan", { data: {} }), "POST /api/gigs/scan");
  const done = await waitTask(request, scan.taskId);
  const summary = done.result as { created: number; suspect: number; research: { taskId: string | null; gigs: number } | null };
  expect(summary.created).toBe(4);
  expect(summary.suspect).toBe(1);
  expect(fixture.hits, "the adapter read the fixture API, not freelancer.com").toContain("/api/projects/0.1/projects/active/");
  expect(summary.research?.taskId, "the scan hands the gigs it created to a research pass").toBeTruthy();
  const research = await waitTask(request, summary.research!.taskId!);
  expect((research.result as { llm: number }).llm, "a declined physical listing never reaches research").toBe(2);

  const gigs = await listGigs(request);
  mainGig = gigs.find((g) => g.externalKey === "fl:900001")!;
  const honeypot = gigs.find((g) => g.externalKey === "fl:900002")!;
  const late = gigs.find((g) => g.externalKey === "fl:900003")!;
  expect(mainGig.status).toBe("qualified");
  expect(honeypot.status, "the Telegram + USDT line quarantines the listing").toBe("suspect");
  expect(honeypot.suspectReasons).toContain("off_platform_payment");
  expect(late.status, "a passed deadline scores 0: never qualified").toBe("new");
  const physical = gigs.find((g) => g.externalKey === "fl:900004")!;
  expect(physical.status, "physical work never reaches the desk").toBe("declined");
  expect(physical.qualification?.declineReason).toBe("not_digital_work");
  expect(physical.qualification?.declinedBy).toBe("rule");
  expect(physical.qualification?.declineEvidence).toEqual(expect.arrayContaining(["Supplier Sourcing", "physical goods", "sourcing a supplier"]));
  expect(physical.brief, "no brief: research never spent a call on it").toBeNull();
  expect(
    fakeCalls().some((c) => (c.payload?.untrusted_listing as { title?: string } | undefined)?.title === PHYSICAL_TITLE),
    "a physical listing never reaches a model"
  ).toBe(false);

  // The expiry sweep runs at the START of every scan, so the second scan expires what the
  // first one filed past its deadline.
  const again = await okJson<{ taskId: string }>(await request.post("/api/gigs/scan", { data: {} }), "second scan");
  const second = (await waitTask(request, again.taskId)).result as { expired: number; created: number };
  expect(second.expired).toBe(1);
  expect(second.created).toBe(0);
  expect((await getGig(request, late.id)).gig.status).toBe("expired");
});

test("2. research: the brief came from the pinned web-researching model call", async ({ request }) => {
  const { gig } = await getGig(request, mainGig.id);
  expect(gig.brief?.source).toBe("llm");
  expect(gig.brief?.promptVersion).toBe("gig-brief-v4");
  expect(gig.brief?.difficulty, "the fake rates the bakery build very hard: the three-seat lineup").toBe("very_hard");
  expect(gig.brief?.workKind).toBe("digital");
  expect(gig.brief?.missingArtifacts).toEqual(["The brand assets (logo and colours)", "The acceptance criteria for the finished work"]);
  expect(gig.brief?.outreachMessage, "a freelance gig gets a first message to the client").toMatch(/^Hello,/);
  expect(gig.brief?.challenges.length).toBe(3);
  expect(gig.brief?.category).toBe("Web development · Landing page");

  const calls = fakeCalls().filter((c) => c.useCase === "brief");
  const mine = calls.find((c) => (c.payload?.untrusted_listing as { title?: string } | undefined)?.title === MAIN_TITLE);
  expect(mine, "the fake CLI answered the main gig's brief").toBeTruthy();
  expect(mine!.model).toBe("claude-sonnet-5-5");
  expect(mine!.allowedTools).toBe("WebSearch,WebFetch");
  expect(mine!.jsonSchema).toBe(true);
  expect(mine!.maxTurns).toBe(16);
  expect(mine!.argv).toContain("--disallowedTools");
  expect(
    calls.some((c) => (c.payload?.untrusted_listing as { title?: string } | undefined)?.title === HONEYPOT_TITLE),
    "a quarantined listing never reaches a model"
  ).toBe(false);
  const honeypot = (await listGigs(request)).find((g) => g.externalKey === "fl:900002")!;
  expect(honeypot.brief?.source).toBe("deterministic");
  expect(honeypot.brief?.fallbackReason).toBe("gig_suspect");
});

test("2b. report: the gig's report file is written by the pinned model, sanitized, and served sandboxed", async ({ request }) => {
  // The research moved the gig, and the report's stage trigger enqueued a gig_report task.
  let res = await request.get(`/api/gigs/${mainGig.id}/report`);
  for (let i = 0; i < 60 && res.status() === 404; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    res = await request.get(`/api/gigs/${mainGig.id}/report`);
  }
  expect(res.status(), "the report file exists after research").toBe(200);
  expect(res.headers()["content-security-policy"]).toMatch(/^sandbox; default-src 'none'/);
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  const html = await res.text();
  expect(html).toContain("<mark>take it</mark>");
  expect(html, "the model's <script> never reaches the file").not.toContain("<script");
  const { gig } = await getGig(request, mainGig.id);
  const report = (gig as { report?: { source: string; model: string | null; path: string } | null }).report;
  expect(report?.source).toBe("llm");
  expect(report?.model).toBe("claude-sonnet-5-5");
  expect(path.relative(path.join(gigsRoot, "_reports"), report!.path).startsWith(".."), "the file is under <KP_GIGS_ROOT>/_reports").toBe(false);
  const call = fakeCalls().find((c) => c.useCase === "report");
  expect(call?.model).toBe("claude-sonnet-5-5");
  expect(call?.effort).toBe("high");
});

test("2c. build track: an open-source bounty is forwarded and researched (the gig the build path below works)", async ({ request }) => {
  buildGig = await forwardAndResearch(
    request,
    BUILD_TITLE,
    "Add a one-page landing page for our bakery chain to the repository: a hero, opening hours and a contact section. Plain HTML and CSS.",
    "oss_bounty"
  );
  expect(buildGig.status).toBe("qualified");
  expect(buildGig.brief?.difficulty, "the three-seat lineup").toBe("very_hard");
  expect(buildGig.brief?.outreachMessage ?? null, "a bounty gets no client message").toBeNull();
});

test("3. plans: a very hard gig gets three seats, each on its own engine, model and effort, all ready", async ({ request }) => {
  const posted = await okJson<{ taskId: string }>(await request.post(`/api/gigs/${buildGig.id}/plans`, { data: {} }), "POST plans");
  const task = await waitTask(request, posted.taskId);
  expect((task.result as { ready: number }).ready).toBe(3);
  const rows = await getPlans(request, buildGig.id);
  expect(rows.map((r) => `${r.seat}:${r.status}`).sort()).toEqual(["fable:ready", "gpt:ready", "opus:ready"]);
  const bySeat = Object.fromEntries(rows.map((r) => [r.seat, r]));
  expect(bySeat.fable.plan?.summary).toMatch(/^Fable plan/);
  expect(bySeat.opus.plan?.summary).toMatch(/^Opus plan/);
  expect(bySeat.gpt.plan?.summary).toMatch(/^GPT plan/);
  expect([bySeat.opus.model, bySeat.opus.effort, bySeat.gpt.model, bySeat.gpt.effort]).toEqual(["claude-opus-5-5", "xhigh", "gpt-6-astra", "max"]);
  expect([bySeat.fable.costUsd, bySeat.opus.costUsd, bySeat.gpt.costUsd], "the Codex seat reports tokens, not dollars: null").toEqual([0.02, 0.05, null]);

  const plans = fakeCalls().filter((c) => c.useCase === "plan");
  expect(plans.every((c) => c.planVariant === "build"), "a bounty is planned with the build prompt (gig-plan-v1)").toBe(true);
  const argvOf = (model: string) => plans.find((c) => c.model === model)!.argv;
  expect(argvOf("claude-opus-5-5")).toEqual(expect.arrayContaining(["--effort", "xhigh"]));
  expect(argvOf("claude-fable-5"), "the Fable seat runs at the CLI's default effort: no flag").not.toContain("--effort");
  expect(argvOf("claude-opus-5-5"), "a plan seat has no web door").not.toContain("--allowedTools");
  const gpt = plans.find((c) => c.cli === "codex")!;
  expect(gpt, "the GPT seat ran through the Codex CLI").toBeTruthy();
  expect([gpt.model, gpt.effort, gpt.sandbox]).toEqual(["gpt-6-astra", "max", "read-only"]);
  expect(gpt.argv).toEqual(expect.arrayContaining(["exec", "--ephemeral", "--skip-git-repo-check", "--output-schema"]));
  expect(gpt.schemaRequired, "the plan's shape travels as the output schema").toEqual(["summary", "steps", "decisions", "risks", "effortHours", "questions"]);
  expect((gpt.payload?.untrusted_gig as { title?: string } | undefined)?.title).toBe(BUILD_TITLE);
});

test("4. UI: the Plans tab shows three columns, and one is ACCEPTED with a note (human gate 1)", async ({ page, request }) => {
  await openProof(page, BUILD_TITLE);
  // The plans sit in the gig's report (the Summary section) or, in the older proof layout,
  // behind their own section button: open that button only when it is the one that exists.
  const plansSection = page.getByRole("group", { name: "Proof sections" }).getByRole("button", { name: /\bPlans\b/ });
  const opusRegion = page.getByRole("region", { name: "Opus 5.5 · xhigh: Ready" });
  await expect(opusRegion.or(plansSection).first()).toBeVisible({ timeout: 30_000 });
  if (!(await opusRegion.isVisible())) await openSection(page, /\bPlans\b/);
  for (const label of ["Fable 5: Ready", "Opus 5.5 · xhigh: Ready", "GPT 6 Astra · max: Ready"]) {
    await expect(page.getByRole("region", { name: label })).toBeVisible();
  }
  const opus = page.getByRole("region", { name: "Opus 5.5 · xhigh: Ready" });
  await expect(opus.getByText(/^Opus plan for /)).toBeVisible();
  await opus.getByRole("textbox", { name: "Note for the agent (optional)" }).fill(ACCEPT_NOTE);
  const accepted = page.waitForResponse((r) => /\/api\/gigs\/[^/]+\/plans\/[^/]+\/accept$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
  await opus.getByRole("button", { name: "Accept this plan" }).click();
  expect((await accepted).status()).toBe(200);
  // Once accepted, the Summary's plan block is one line (the seat, the note) over its steps.
  const acceptedPlanLine = page.getByRole("group", { name: "Accepted plan" });
  await expect(acceptedPlanLine.getByText("Accepted: Opus 5.5 · xhigh")).toBeVisible();
  await expect(acceptedPlanLine).toContainText(ACCEPT_NOTE);
  await expect(page.getByRole("button", { name: "Accept this plan" }), "one plan per gig: no accept is left").toHaveCount(0);

  acceptedPlan = (await getPlans(request, buildGig.id)).find((r) => r.acceptedAt)!;
  expect(acceptedPlan.seat).toBe("opus");
  expect(acceptedPlan.note).toBe(ACCEPT_NOTE);
});

test("5. dispatch = pairing: workspace by type, project at the gig folder, the plan as a milestone, the persona auto-approved (human gate 2)", async ({ request }) => {
  const res = await request.post(`/api/gigs/${buildGig.id}/dispatch`, { data: {} });
  expect(res.status(), await res.text()).toBe(202);
  const body = (await res.json()) as { pairing: string; specialistId: string };
  expect(body.pairing).toBe("pending");

  const ws = mock.workspaces.find((w) => w.name === "Gigs · Web");
  expect(ws, "the persona and the project are filed in the gig TYPE's workspace").toBeTruthy();
  const project = mock.projects.find((x) => x.workspaceId === ws!.id)!;
  expect(path.relative(path.join(gigsRoot, "web"), project.rootPath).startsWith(".."), `project root ${project.rootPath} under <KP_GIGS_ROOT>/web`).toBe(false);
  expect(existsSync(path.join(project.rootPath, "DELIVERABLE-CONTRACT.md")), "the gig folder is scaffolded").toBe(true);

  const steps = acceptedPlan.plan!.steps;
  const milestone = mock.milestones.find((m) => m.projectId === project.id)!;
  expect(milestone, "the accepted plan became the project's milestone").toBeTruthy();
  const goals = milestone.goalIds.map((id) => mock.goals.find((g) => g.id === id)!);
  expect(goals.map((g) => g.title)).toEqual(steps.map((s, i) => `${i + 1}. ${s.title}`));
  expect(goals.map((g) => g.description)).toEqual(steps.map((s) => `Done when: ${s.doneWhen}`));

  const hire = mock.requests.find((r) => (r.body.fit as { kind?: string } | undefined)?.kind === "kp.gig-persona.v1")!;
  expect(hire, "the gig persona was requested").toBeTruthy();
  const spec = hire.body.spec as Record<string, unknown>;
  expect(spec.modelProfile).toEqual({ model: "claude-opus-5-5", effort: "high" });
  expect(spec.maxBudgetUsd ?? null, "gig personas run uncapped").toBeNull();
  expect("systemPromptDraft" in spec, "kp sends requirements, never a prompt").toBe(false);
  const requirements = spec.requirements as { knowledge?: { bundle: string; subject: string }[]; plan?: { summary: string; operatorNote?: string | null } };
  expect(requirements.knowledge?.map((k) => k.subject)).toEqual(["error-handling", "data-access", "rate-limiting"]);
  expect(requirements.plan?.summary).toBe(acceptedPlan.plan!.summary);
  const fit = hire.body.fit as { kind: string; gigId: string; gigType: string };
  expect(fit).toMatchObject({ kind: "kp.gig-persona.v1", gigId: buildGig.id, gigType: "web" });
  expect(hire.body.placement).toEqual({ workspaceId: ws!.id, projectId: project.id });
  expect((hire.body.kp as { jobId: string }).jobId).toBe(`gig-persona:${buildGig.id}`);
  expect(hire.autoApproved, "the mock's gig persona policy approved it on arrival").toBe(true);
  personaId = hire.personaId!;

  const plan = (await getPlans(request, buildGig.id)).find((r) => r.acceptedAt)!;
  expect(plan.progress?.milestoneId).toBe(milestone.id);
  expect(plan.progress?.goals.map((g) => g.goalId)).toEqual(milestone.goalIds);
  expect(plan.progress?.goals.every((g) => g.status === "open" && g.progress === 0)).toBe(true);
});

test("6. run + sync: the persona runs in the gig folder, the draft lands, PLAN-STATUS is mirrored", async ({ request }) => {
  // Each pass: poll the hire (approved -> active), run the paired gig once active, read its
  // run (running -> completed), land the deliverable, mirror PLAN-STATUS.
  let gig: GigRow | null = null;
  for (let pass = 0; pass < 8; pass++) {
    await sync(request);
    gig = (await getGig(request, buildGig.id)).gig;
    if (gig.status === "drafted") break;
  }
  expect(gig?.status).toBe("drafted");

  expect(mock.executions).toHaveLength(1);
  const run = mock.executions[0];
  expect(run.personaId).toBe(personaId);
  const input = run.input as { kind: string; _projectId: string; workdir: string; budgetUsd: number | null; plan: { steps: PlanStep[]; note: string | null; statusFile: string } };
  const project = mock.projects.find((x) => x.id === input._projectId)!;
  expect(input.kind).toBe("kp.gig.v1");
  expect(input.workdir).toBe(project.rootPath);
  expect(input.budgetUsd).toBeNull();
  expect(input.plan.note).toBe(ACCEPT_NOTE);
  expect(input.plan.statusFile).toBe("PLAN-STATUS.json");
  const milestone = mock.milestones.find((m) => m.projectId === project.id)!;
  expect(input.plan.steps.map((s) => s.goalId), "each plan step carries its Personas goal id").toEqual(milestone.goalIds);

  const { attempts } = await getGig(request, buildGig.id);
  const attempt = attempts[attempts.length - 1];
  attemptId = attempt.id;
  expect(attempt.status).toBe("drafted");
  expect(attempt.costUsd).toBe(RUN_COST_USD);
  expect(attempt.deliverable?.disclosure).toBe(DISCLOSURE);

  // Goals 1 and 2 moved and were patched; goal 3 reported `open` (unchanged) and was not.
  const [g1, g2] = milestone.goalIds;
  expect(mock.goalPatches.map((x) => x.goalId).sort()).toEqual([g1, g2].sort());
  expect(mock.goalPatches.find((x) => x.goalId === g1)?.body).toEqual({ status: "done", progress: 100 });
  expect(mock.goalPatches.find((x) => x.goalId === g2)?.body).toEqual({ status: "in-progress", progress: 50 });
  const progress = (await getPlans(request, buildGig.id)).find((r) => r.acceptedAt)!.progress!;
  expect(progress.goals.slice(0, 3).map((g) => [g.status, g.progress])).toEqual([
    ["done", 100],
    ["in-progress", 50],
    ["open", 0],
  ]);
});

test("7. UI: the Pairing tab shows the milestone progress", async ({ page }) => {
  await openProof(page, BUILD_TITLE);
  await openSection(page, /\bPairing\b/);
  await expect(page.getByRole("img", { name: "Milestone 30% done" })).toBeVisible();
  const steps = acceptedPlan.plan!.steps;
  await expect(page.getByRole("img", { name: `${steps[0].title}: 100% done` })).toBeVisible();
  await expect(page.getByRole("img", { name: `${steps[1].title}: 50% done` })).toBeVisible();
});

test("8-9. review: approve with the whole checklist (human gate 3), then the SIMULATED submission", async ({ request }) => {
  const all = Object.fromEntries(BUILD_CHECKLIST.map((k) => [k, true]));
  const approved = await okJson<{ gig: GigRow }>(
    await request.post(`/api/gigs/attempts/${attemptId}`, { data: { action: "approve", review: { checklist: all, note: "Checked against the brief.", reviewMs: 90_000 } } }),
    "approve"
  );
  expect(approved.gig.status).toBe("in_review");

  // The send gate: a review that does not tick the AI-use disclosure is refused.
  const refused = await request.post(`/api/gigs/attempts/${attemptId}`, { data: { action: "mark_sent", review: { checklist: { ...all, disclosure: false } } } });
  expect(refused.status()).toBe(422);
  expect(((await refused.json()) as { code: string }).code).toBe("GIG_DISCLOSURE_REQUIRED");

  // "Mark sent" is the operator saying he sent it himself: kp submits nothing anywhere.
  const callsBefore = mock.calls.length;
  const sent = await okJson<{ gig: GigRow; attempt: Attempt }>(await request.post(`/api/gigs/attempts/${attemptId}`, { data: { action: "mark_sent" } }), "mark_sent");
  expect(sent.gig.status).toBe("sent");
  expect(sent.attempt.status).toBe("sent");
  expect(mock.calls.length, "sending touches no outside system").toBe(callsBefore);
});

test("10. outcome: accepted with an amount, a lesson queued", async ({ request }) => {
  const res = await request.post(`/api/gigs/${buildGig.id}/outcome`, { data: { verdict: "accepted", amount: 250, currency: "USD", feedbackText: "Clean work." } });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { gig: GigRow; outcome: { id: string }; lessons: unknown[] };
  expect(body.gig.status).toBe("accepted");
  expect(body.lessons.length).toBeGreaterThan(0);
  const { lessons } = await okJson<{ lessons: { outcomeId: string; verdict: string; bullets: string[] }[] }>(await request.get("/api/gigs/lessons?pending=1"), "GET lessons");
  const mine = lessons.filter((l) => l.outcomeId === body.outcome.id);
  expect(mine.length).toBeGreaterThan(0);
  expect(mine.every((l) => l.verdict === "accepted" && l.bullets.length > 0)).toBe(true);
});

test("11. cleanup: the next sync retires the gig persona in Personas and in kp", async ({ request }) => {
  await sync(request);
  expect(mock.retireCalls).toContain(personaId);
  const { specialists } = await okJson<{ specialists: { gigId: string | null; hire: { status: string; personaId: string | null } | null }[] }>(
    await request.get("/api/gigs/specialists"),
    "GET specialists"
  );
  const persona = specialists.find((s) => s.gigId === buildGig.id);
  expect(persona?.hire?.status).toBe("retired");
  expect(persona?.hire?.personaId).toBe(personaId);
});

test("11b. cleanup: a niche specialist with no open work is retired by the sweep", async ({ request }) => {
  const hired = await request.post("/api/gigs/specialists", { data: { arena: "freelance", niche: "web development" } });
  expect(hired.ok(), await hired.text()).toBe(true);
  const niche = mock.requests.filter((r) => (r.body.fit as { kind?: string } | undefined)?.kind !== "kp.gig-persona.v1");
  expect(niche.length, "the niche hire reached Personas and waits for a human (no policy for it)").toBe(1);
  await sync(request);
  const { specialists } = await okJson<{ specialists: { gigId: string | null; hire: { status: string } | null }[] }>(await request.get("/api/gigs/specialists"), "GET specialists");
  const nicheRow = specialists.find((s) => s.gigId === null);
  expect(nicheRow?.hire?.status, "no persona yet: retired in kp only").toBe("retired");
});

// ─── The proposal track (the scanned freelance listing) ────────────────────────────────

let proposalAttemptId = "";

test("P1. proposal track: the freelance gig's plans use the CLIENT-facing prompt variant", async ({ request }) => {
  const posted = await okJson<{ taskId: string }>(await request.post(`/api/gigs/${mainGig.id}/plans`, { data: {} }), "POST plans (freelance)");
  expect((await waitTask(request, posted.taskId)).result).toMatchObject({ ready: 3, failed: 0 });
  const mine = fakeCalls().filter((c) => c.useCase === "plan" && (c.payload?.untrusted_gig as { title?: string } | undefined)?.title === MAIN_TITLE);
  expect(mine.length).toBe(3);
  expect(mine.every((c) => c.planVariant === "proposal"), "gig-plan-v2-proposal").toBe(true);
  const claudeSeat = mine.find((c) => c.cli !== "codex")!;
  const brief = claudeSeat.payload?.untrusted_brief as { missingArtifacts?: string[]; outreachMessage?: string | null; language?: string | null };
  expect(brief.missingArtifacts).toEqual(["The brand assets (logo and colours)", "The acceptance criteria for the finished work"]);
  expect(brief.outreachMessage).toMatch(/^Hello,/);
  expect(brief.language).toBe("en");
});

test("P2. proposal track: accept -> the pinned model writes the client proposal and the gig is DRAFTED without pairing or a dispatch", async ({ request }) => {
  const plans = await getPlans(request, mainGig.id);
  const opusPlan = plans.find((r) => r.seat === "opus")!;
  const hiresBefore = mock.requests.length;
  const runsBefore = mock.executions.length;
  await okJson(await request.post(`/api/gigs/${mainGig.id}/plans/${opusPlan.id}/accept`, { data: { note: "Keep it small" } }), "accept (freelance)");
  let gig: GigRow | null = null;
  let attempts: Attempt[] = [];
  for (let i = 0; i < 120; i++) {
    ({ gig, attempts } = await getGig(request, mainGig.id));
    if (gig.status === "drafted" && gig.proposal?.status === "ready") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  expect(gig?.status, "qualified -> dispatched -> drafted by kp itself").toBe("drafted");
  const proposal = gig!.proposal!;
  expect([proposal.status, proposal.source, proposal.model, proposal.costUsd, proposal.planId]).toEqual(["ready", "llm", "claude-sonnet-5-5", 0.04, opusPlan.id]);
  expect(proposal.message.endsWith(KP_DISCLOSURE), "the bid message ends with the AI-use disclosure").toBe(true);
  expect(proposal.artifacts).toEqual(["The brand assets (logo and colours)", "The acceptance criteria for the finished work"]);
  expect(path.relative(path.join(gigsRoot, "_proposals"), proposal.path).startsWith(".."), "the file is under <KP_GIGS_ROOT>/_proposals").toBe(false);

  const attempt = attempts[attempts.length - 1];
  proposalAttemptId = attempt.id;
  expect([attempt.specialistId, attempt.status, attempt.executionId ?? null, attempt.costUsd]).toEqual(["kp:proposal", "drafted", null, 0.04]);
  expect(attempt.deliverable?.draftText).toBe(proposal.message);
  expect(attempt.deliverable?.artifacts).toEqual([{ kind: "file", ref: proposal.path, title: "Client proposal" }]);
  expect(mock.requests.length, "no persona was hired").toBe(hiresBefore);
  expect(mock.executions.length, "nothing ran in Personas").toBe(runsBefore);

  const call = fakeCalls().find((c) => c.useCase === "proposal");
  expect([call?.model, call?.effort]).toEqual(["claude-sonnet-5-5", "high"]);
  expect((call?.payload?.untrusted_plan as { steps?: unknown[] } | null)?.steps?.length, "the accepted plan rides the fence").toBeGreaterThan(0);

  const refused = await request.post(`/api/gigs/${mainGig.id}/dispatch`, { data: {} });
  expect(refused.status()).toBe(409);
  expect(((await refused.json()) as { code: string }).code).toBe("GIG_PROPOSAL_TRACK");
});

test("P2b. the proposal file is served sandboxed, carries no internal figures, and downloads as an attachment", async ({ request }) => {
  const res = await request.get(`/api/gigs/${mainGig.id}/proposal`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-security-policy"]).toMatch(/^sandbox; default-src 'none'/);
  const html = await res.text();
  expect(html, "the model's <script> is text, never markup").not.toContain("<script");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("What you receive");
  for (const internal of [/\bkp\b/i, /claude/i, /\$0\.04/, new RegExp(mainGig.id)]) expect(html).not.toMatch(internal);
  const dl = await request.get(`/api/gigs/${mainGig.id}/proposal?download=1`);
  expect(dl.headers()["content-disposition"]).toMatch(/^attachment; filename="build-a-landing-page-for-a-bakery-proposal\.html"$/);
  // The report now reports the proposal, not a draft.
  let report = "";
  for (let i = 0; i < 60 && !report.includes("The client proposal"); i++) {
    report = await (await request.get(`/api/gigs/${mainGig.id}/report`)).text();
    if (!report.includes("The client proposal")) await new Promise((r) => setTimeout(r, 1000));
  }
  expect(report, "the drafted report on the proposal track").toContain("The client proposal");
  expect(report).not.toContain("The evidence");
});

test("P3. proposal track: approve with the proposal checklist, then the SIMULATED send", async ({ request }) => {
  const all = Object.fromEntries(FREELANCE_CHECKLIST.map((k) => [k, true]));
  const approved = await okJson<{ gig: GigRow }>(
    await request.post(`/api/gigs/attempts/${proposalAttemptId}`, { data: { action: "approve", review: { checklist: all, note: "Asks and file checked.", reviewMs: 60_000 } } }),
    "approve (proposal)"
  );
  expect(approved.gig.status).toBe("in_review");
  const sent = await okJson<{ gig: GigRow; attempt: Attempt }>(await request.post(`/api/gigs/attempts/${proposalAttemptId}`, { data: { action: "mark_sent" } }), "mark_sent (proposal)");
  expect([sent.gig.status, sent.attempt.status]).toEqual(["sent", "sent"]);
});

// ─── Side paths ─────────────────────────────────────────────────────────────────────────

test("side: a dispatch with no accepted plan is refused 409 GIG_PLAN_NOT_ACCEPTED (a freelance gig: GIG_PROPOSAL_TRACK)", async ({ request }) => {
  const bid = await forwardAndResearch(request, "Validate ISO-8601 dates in Python for a client", "Write a Python function that validates ISO-8601 dates, with pytest tests.");
  const proposalOnly = await request.post(`/api/gigs/${bid.id}/dispatch`, { data: {} });
  expect(proposalOnly.status()).toBe(409);
  expect(((await proposalOnly.json()) as { code: string }).code).toBe("GIG_PROPOSAL_TRACK");
  const gig = await forwardAndResearch(request, "Validate ISO-8601 dates in Python", "Write a Python function that validates ISO-8601 dates, with pytest tests.", "oss_bounty");
  expect(gig.status).toBe("qualified");
  const requestsBefore = mock.requests.length;
  const res = await request.post(`/api/gigs/${gig.id}/dispatch`, { data: {} });
  expect(res.status()).toBe(409);
  expect(((await res.json()) as { code: string }).code).toBe("GIG_PLAN_NOT_ACCEPTED");
  expect(mock.requests.length, "nothing reached Personas").toBe(requestsBefore);
});

test("side: one plan seat fails and the other two still land", async ({ request }) => {
  const gig = await forwardAndResearch(request, "Write a CSV cleaner script [fable-fails]", "Write a small Python script that trims whitespace in every cell of a CSV file.");
  const posted = await okJson<{ taskId: string }>(await request.post(`/api/gigs/${gig.id}/plans`, { data: {} }), "POST plans");
  const task = await waitTask(request, posted.taskId);
  expect(task.result).toMatchObject({ ready: 2, failed: 1 });
  const rows = await getPlans(request, gig.id);
  const bySeat = Object.fromEntries(rows.map((r) => [r.seat, r]));
  expect(bySeat.fable.status).toBe("failed");
  expect(bySeat.fable.fallbackReason).toMatch(/^llm_error:/);
  expect(bySeat.opus.status).toBe("ready");
  expect(bySeat.gpt.status).toBe("ready");
});

test("side: a moderate gig gets ONE plan seat, Sonnet 5.5 at high effort", async ({ request }) => {
  const gig = await forwardAndResearch(request, "Rename the CSV columns", "Rename three columns in one CSV file and send it back.");
  expect(gig.brief?.difficulty).toBe("moderate");
  const before = fakeCalls().filter((c) => c.useCase === "plan").length;
  const posted = await okJson<{ taskId: string }>(await request.post(`/api/gigs/${gig.id}/plans`, { data: {} }), "POST plans");
  const task = await waitTask(request, posted.taskId);
  expect(task.result).toMatchObject({ ready: 1, failed: 0 });
  const rows = await getPlans(request, gig.id);
  expect(rows.map((r) => `${r.seat}:${r.model}:${r.effort}:${r.status}`)).toEqual(["sonnet:claude-sonnet-5-5:high:ready"]);
  const calls = fakeCalls().filter((c) => c.useCase === "plan").slice(before);
  expect(calls.map((c) => c.model)).toEqual(["claude-sonnet-5-5"]);
  expect(calls[0].argv).toEqual(expect.arrayContaining(["--effort", "high"]));
});

test("side: withdraw for a brief challenge in one click, and the next brief is handed the reason", async ({ page, request }) => {
  const title = "Set up a contact form on a small site";
  const gig = await forwardAndResearch(request, title, "Add a working contact form to our five-page site and send us the changed files.");
  const reason = gig.brief!.challenges[1];

  await openProof(page, title);
  await openSection(page, /\bBrief\b/);
  const row = page.getByRole("region", { name: "Expected challenges" }).getByRole("listitem").filter({ hasText: reason });
  const withdrew = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/gigs/${gig.id}` && r.request().method() === "PATCH");
  await row.getByRole("button", { name: "Withdraw for this" }).click();
  expect((await withdrew).status()).toBe(200);

  const stored = (await getGig(request, gig.id)).gig;
  expect(stored.status).toBe("withdrawn");
  expect(stored.withdrawReason?.challenge).toBe(reason);
  expect(stored.withdrawReason?.index).toBe(1);

  const next = await forwardAndResearch(request, "Add a newsletter signup to a site", "Add a newsletter signup box to the footer of our site.");
  const call = fakeCalls()
    .filter((c) => c.useCase === "brief")
    .find((c) => (c.payload?.untrusted_listing as { title?: string } | undefined)?.title === "Add a newsletter signup to a site");
  expect(call?.payload?.untrusted_past_withdraw_reasons, "the operator's reason travels to the next brief call").toEqual([reason]);
  expect(next.brief?.challenges, "a shared obstacle is written in exactly the reason's words").toContain(reason);
});

test("the mock bridge saw no unauthenticated call and no unknown route", () => {
  expect(mock.unauthorizedCalls).toBe(0);
  expect(mock.unknownPaths).toEqual([]);
  expect(readdirSync(gigsRoot)).toContain("web");
});
