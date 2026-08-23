// App master — the whole hire path, battle-tested WITHOUT the Personas desktop
// app (docs/features/app-master/README.md, phases P2–P4). A mock Personas bridge
// (e2e/fixtures/mock-personas-bridge.ts) stands in for the real management API,
// so this file exercises the seams P2/P3/P4 landed on either side of:
//
//   pair (Settings → Integrations) → an App-master intake started from a REPO
//   → the repo scan lands a RepoDossier → the scripted six-answer dialog
//   → compose an AppMasterSpec → dispatch it to Personas → the approval ladder
//   → reporter v2's backbone rollup + the probation review → the Agents roster
//     renders the deterministic verdict.
//
// This is the harness the Ring-1 live run (against real Personas) is compared
// against: same journey, same assertions, no desktop app.
//
// FULLY DETERMINISTIC — and it FAILS LOUD if it isn't:
//   • `KP_OFFLINE=1` is what makes it keyless. It is not merely "no keys in the
//     env": this box keeps GEMINI/OPENAI keys in .env.local and playwright.config
//     loads that file, so a managed webServer would inherit them. The flag seals
//     the Python side (pipeline/jobfit/llm/offline.py — cloud engines AND the
//     local Claude CLI report unavailable) and the TS side (app/_lib/offline.ts
//     installs a fetch guard that still allows LOOPBACK, which is exactly where
//     the mock bridge lives).
//   • Rather than trusting the flag, the spec ASSERTS the keyless surfaces: every
//     dialog turn must come back `source: "deterministic"`, the dossier chip must
//     read "file-walk, no AI" (source `heuristic`), the conversation must show
//     "AI is offline, so the guided checklist runs instead", and the population
//     fit must disclose that nothing was judged automatable. A silently-keyed run
//     fails on those, not on a flaky diff.
//   • The scan target is THIS checkout, so the dossier's counted facts are
//     checkable: the context count is compared against `context-map.json` read at
//     test time, never a hard-coded number.
//
// REQUIRED ENV (all three belong to the SERVER process, not to Playwright):
//   KP_OFFLINE=1                 forces the keyless/deterministic path
//   KP_APP_MASTER_REPO_ROOTS=…   the PARENT directory of this checkout, so the
//                                fail-closed local-path allow-list admits it
//   KP_SECRET=…                  any value. The pk_ pairing key is stored
//                                ENCRYPTED at rest (bridge-store → ats-secret),
//                                and pairing now refuses out loud without a
//                                master key rather than failing after a human
//                                approved the request — which is a bug this
//                                harness found on its first run.
// playwright.config.ts forwards all three to its managed dev webServer when they
// are set in the environment it is launched from. Against an ALREADY-RUNNING
// server (KP_E2E_BASE_URL) they must be set on THAT process — this spec cannot
// reach in, which is exactly why it asserts the keyless labels instead of
// assuming them.
//
// Managed dev webServer on :3101:
//   KP_OFFLINE=1 KP_APP_MASTER_REPO_ROOTS=/path/to/parent KP_SECRET=e2e \
//     npx playwright test e2e/app-master-hire.spec.ts
//
// Against a running server (the journey spec's invocation plus this file's env):
//   KP_OFFLINE=1 KP_APP_MASTER_REPO_ROOTS=/path/to/parent KP_SECRET=e2e \
//     NEXT_PUBLIC_KP_AGENT_HIRING=1 npm run start -- --port 3101 &
//   KP_E2E_BASE_URL=http://localhost:3101 npx playwright test e2e/app-master-hire.spec.ts
// (`NEXT_PUBLIC_KP_AGENT_HIRING=1` matters only for a PRODUCTION build: the Agents
//  tab is open in dev by default — AGENTS_TAB_IN_NAV, app/features/shell/tabs.ts —
//  and a deep link to it is rejected when the gate is off.)
//
// Python + repo deps must be installed: the repo scan, every intake turn and the
// compose each spawn `python -m pipeline.jobfit…`, the same requirement
// `npm run build` (schemas:gen) already carries.
import { readFileSync } from "fs";
import path from "path";
import { expect, test, type Locator, type Page } from "@playwright/test";
// Relative, not "@/" — the rule e2e/fixtures/github-analysis.ts documents: this
// is a runtime VALUE import and the Playwright runner wires no path alias.
// Validating the dispatched block with the REAL generated schema is the point of
// the exercise: a codegen change that breaks the wire contract fails here.
import { appMasterSpecSchema, type RepoDossier } from "../app/_lib/schemas.generated";
import { seedDevAuth } from "./dev-auth";
import { startMockPersonasBridge, type MockPersonasBridge } from "./fixtures/mock-personas-bridge";

// One journey, minted state shared down the file (scan id, intake id, report
// token) — serial, one worker, a failure skips the dependent remainder.
test.describe.configure({ mode: "serial" });

// Unique per run so the roster (which reads a persistent dev DB) can never
// resolve an earlier run's row, and so two consecutive runs stay independent.
const runId = Date.now().toString(36);
const ROLE_TITLE = `App master for kp ${runId}`;
const PERSONA_NAME = `KP App Master ${runId}`;

// The checkout under scan is this one. `rootPath` must sit inside a
// KP_APP_MASTER_REPO_ROOTS entry (app/_lib/repo-scan-target.ts is fail-closed),
// which is why the header asks for the PARENT directory.
const REPO_ROOT = process.cwd();

/** context-map.json's own context count, read at test time. The dossier's
 *  `size.contexts` is a COUNTED fact the heuristic walker takes off this very
 *  file, so pinning a literal would only prove two constants agree. */
function expectedContextCount(): number {
  const map = JSON.parse(readFileSync(path.join(REPO_ROOT, "context-map.json"), "utf8")) as { contexts?: unknown[] };
  return Array.isArray(map.contexts) ? map.contexts.length : 0;
}

let mock: MockPersonasBridge;
// Shared across the serial steps.
let scanId = "";
let dossier: RepoDossier | null = null;
let intakeId = "";
let hiredAgentId = "";
let reportToken = "";

test.beforeAll(async () => {
  mock = await startMockPersonasBridge();
});

test.afterAll(async () => {
  await mock?.close();
});

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

/** The Library's Intake sub-tab. No deep-link param owns it — it lives behind
 *  the ledger's segmented control — so this is the real click path. */
async function openIntakeTab(page: Page): Promise<void> {
  await page.goto("/?tab=library");
  const intake = page.getByRole("radiogroup", { name: "Library section" }).getByRole("radio", { name: "Intake" });
  await expect(intake).toBeVisible({ timeout: 90_000 });
  // Same dev-hydration retry as the sibling specs: click until the control takes.
  await expect(async () => {
    if ((await intake.getAttribute("aria-checked")) !== "true") await intake.click().catch(() => undefined);
    await expect(intake).toHaveAttribute("aria-checked", "true", { timeout: 2000 });
  }).toPass({ timeout: 60_000 });
}

/** Answer the composer once and wait for the scripted reply to land. The keyless
 *  engine answers in one Python spawn, so a landed exchange is the honest ready
 *  signal — never a fixed sleep. Returns the agent's reply. */
async function answer(page: Page, text: string): Promise<string> {
  const composer = page.getByPlaceholder("Answer in your own words. Vague is fine.");
  await expect(composer).toBeEnabled({ timeout: 90_000 });
  // fill(), not type(): the composer submits on a bare Enter, and one of these
  // answers is deliberately multi-line.
  await composer.fill(text);
  const landed = page.waitForResponse(
    (r) => /\/api\/intake\/[^/]+\/message$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
    { timeout: 180_000 }
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const res = await landed;
  expect(res.ok(), `POST /api/intake/[id]/message responded ${res.status()}`).toBe(true);
  const body = (await res.json()) as { reply: string; source: string };
  // The keyless guard, on every single turn: an exchange served by a model is
  // not the path this harness certifies.
  expect(body.source, "the dialog must run the deterministic script — is KP_OFFLINE=1 set on the server?").toBe(
    "deterministic"
  );
  return body.reply;
}

/** Mint an App-master intake through the API, pre-filled to a known spec. Used
 *  ONLY by the two negative paths: driving a second and third nine-turn dialog
 *  through the UI would spend a minute apiece to re-prove the dialog. */
async function seedIntake(page: Page, populationAnswer: string): Promise<string> {
  const created = await page.request.post("/api/intake", { data: { lang: "en", scanId }, timeout: 120_000 });
  expect(created.ok(), `POST /api/intake responded ${created.status()}`).toBe(true);
  const id = ((await created.json()) as { id: string }).id;

  const attached = await page.request.post(`/api/intake/${id}/dossier`, { data: { scanId, dossier }, timeout: 120_000 });
  expect(attached.ok(), `POST /api/intake/[id]/dossier responded ${attached.status()}`).toBe(true);

  const facet = (key: string, label: string, value: string) => ({
    key,
    label,
    value,
    importance: "core",
    provenance: "stated",
    confidence: 1,
    sourceTurn: null,
  });
  // PATCHed AFTER the dossier so the answers are the last word on the brief.
  const patched = await page.request.patch(`/api/intake/${id}/brief`, {
    data: {
      brief: {
        schemaVersion: 1,
        title: `${ROLE_TITLE} (negative)`,
        facets: [
          facet("objective:gate_pass_rate", "gate pass rate", "gate pass rate — 95% within 60 days"),
          facet("mandate.scopeRung", "Mandate — how far alone", "Rung 2 — open a branch and propose."),
          facet("budget.monthlyUsd", "Monthly budget ceiling", "120 USD per month."),
          facet("mandate.owner", "Review owner", "The engineering lead"),
          facet("tenure.probationDays", "Probation", "30 days."),
          facet("role.population", "Who may hold the role", populationAnswer),
        ],
        successCriteria: ["gate pass rate — 95% within 60 days"],
      },
    },
  });
  expect(patched.ok(), `PATCH /api/intake/[id]/brief responded ${patched.status()}`).toBe(true);

  const composed = await page.request.post(`/api/intake/${id}/compose-app-master`, { timeout: 180_000 });
  expect(composed.ok(), `POST compose-app-master responded ${composed.status()}`).toBe(true);
  return id;
}

test("kp pairs with Personas from Settings → Integrations", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/?tab=integrations");
  await expect(page.getByRole("heading", { name: "Personas bridge" })).toBeVisible({ timeout: 90_000 });

  // Point kp at the mock instead of the real desktop app's loopback default. The
  // start phase persists this BEFORE it registers the request, which is the
  // "point kp at my Personas" write the panel's hint promises.
  const urlField = page.locator("#personas-base-url");
  await expect(urlField).toBeVisible({ timeout: 60_000 });
  await urlField.fill(mock.url);

  // "Connect to Personas" when unpaired, "Re-pair" when a previous run left a key
  // behind — both are the same start phase.
  const connect = page.getByRole("button", { name: /^(Connect to Personas|Re-pair)$/ });
  await expect(async () => {
    if (mock.pairRequests.length === 0) await connect.click().catch(() => undefined);
    expect(mock.pairRequests.length, "the start phase registers a nonce with Personas").toBeGreaterThan(0);
  }).toPass({ timeout: 90_000 });
  // The nonce kp mints is what redeems the key — a short one would be an entropy
  // regression, and the mock refuses it, so reaching here already proves the size.
  expect(mock.pairRequests[0].nonce.length).toBeGreaterThanOrEqual(16);

  // The human-approval beat is REAL here: the mock's first claim answers
  // {status:"pending"}, so the card must show the waiting state rather than
  // completing on the first poll.
  await expect(page.getByText("Approve the request in the Personas app")).toBeVisible({ timeout: 60_000 });

  // …and the second claim hands the pk_ key over.
  await expect(page.getByText("Paired with Personas.")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 60_000 });
  expect(mock.claimAttempts, "the claim is polled until the human approves").toBeGreaterThanOrEqual(2);

  // The stored key is what the server now dials with, proved through the one
  // route that makes a bearer-gated bridge call on the browser's behalf.
  // `source: "personas"` means the live catalog served — `builtin` would mean the
  // call failed and degraded, hiding an auth regression behind a fallback.
  const catalog = await page.request.get("/api/agents/catalog");
  expect(catalog.ok(), `GET /api/agents/catalog responded ${catalog.status()}`).toBe(true);
  const served = (await catalog.json()) as { connectors: { name: string }[]; source: string };
  expect(served.source, "a paired bridge serves the catalog, not the built-in fallback").toBe("personas");
  expect(served.connectors.map((c) => c.name)).toContain("github");
  expect(mock.unauthorizedCalls, "no management call may reach Personas without the pk_ key").toBe(0);
});

// The hire itself, start to dispatch, in ONE browser context. Splitting it would
// mean re-finding the session in the ledger between steps — the session is
// component state, not a deep link — and a title-matched re-open is exactly the
// kind of locator that rots. test.step keeps the report readable instead.
test("App master: repo scan → scripted dialog → composed spec → dispatch", async ({ page }) => {
  test.setTimeout(900_000);
  await openIntakeTab(page);
  // The Triptych's brief leaf is where the App-master card lives (three leaves
  // open by default; a fresh context has no stored fold state).
  const briefLeaf: Locator = page.locator("section").filter({ hasText: "What the scan read" }).last();

  await test.step("the scan is started from THIS checkout and lands a heuristic dossier", async () => {
    await page.getByRole("button", { name: "App master", exact: true }).click();
    await page.getByRole("button", { name: "Local path", exact: true }).click();
    await page.getByPlaceholder("C:\\code\\app").fill(REPO_ROOT);

    const started = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/repo-scan" && r.request().method() === "POST",
      { timeout: 120_000 }
    );
    await page.getByRole("button", { name: "Scan and start" }).click();
    const scanRes = await started;
    // A refusal here is the fail-closed allow-list talking: KP_APP_MASTER_REPO_ROOTS
    // is unset on the SERVER, or does not contain this checkout's parent.
    expect(
      scanRes.ok(),
      `POST /api/repo-scan responded ${scanRes.status()} — is KP_APP_MASTER_REPO_ROOTS set on the server to ${path.dirname(REPO_ROOT)}?`
    ).toBe(true);
    scanId = ((await scanRes.json()) as { scanId: string }).scanId;
    expect(scanId).toBeTruthy();

    // The card's HEADING renders immediately ("the scan is still reading the
    // codebase"), so it is not the ready signal — the SOURCE CHIP is: it exists
    // only once the completed dossier has been posted onto the session by the
    // watcher riding the shared TasksProvider poll. Waiting on the chip is
    // therefore waiting on the whole P2 → P3 hand-off, and it is also
    //
    // KEYLESS GUARD #1 — the deterministic file-walk produced this dossier, not
    // an agent that read the repo in place.
    await expect(briefLeaf).toContainText("file-walk, no AI", { timeout: 300_000 });

    const contexts = expectedContextCount();
    expect(contexts, "context-map.json should carry a context list").toBeGreaterThan(0);
    await expect(briefLeaf).toContainText(`${contexts} contexts`);

    // The declared gates are the other counted fact, and the card shows only the
    // first six — so that row is read off the scan itself.
    const scan = await page.request.get(`/api/repo-scan/${scanId}`);
    expect(scan.ok(), `GET /api/repo-scan/[id] responded ${scan.status()}`).toBe(true);
    // The row is WRAPPED (`{ scan }`) — reading it flat is the exact bug this
    // spec found in the App-master watcher, so read it the way the route serves it.
    const { scan: record } = (await scan.json()) as {
      scan: { status: string; source: string; isLocal: boolean; dossier: RepoDossier | null };
    };
    expect(record.status).toBe("complete");
    expect(record.source, "a keyless scan is the heuristic walk").toBe("heuristic");
    expect(record.isLocal, "the resolved server path is withheld; only this projection of it ships").toBe(true);
    expect(record.dossier).toBeTruthy();
    dossier = record.dossier;
    expect(dossier!.size.contexts, "the dossier's context count is context-map.json's own").toBe(contexts);
    expect(
      dossier!.declaredGates.length,
      `kp declares its verification gates in package.json + CI; got: ${dossier!.declaredGates.join(", ")}`
    ).toBeGreaterThanOrEqual(10);
    // The counted facts a model may never restate (coerce_repo_dossier's
    // REFINABLE_KEYS rule) are stamped as the walker's.
    expect(dossier!.fieldProvenance.size).toBe("heuristic");
    expect(dossier!.fieldProvenance.declaredGates).toBe("heuristic");

    const list = await page.request.get("/api/intake");
    expect(list.ok()).toBe(true);
    const { intakes } = (await list.json()) as { intakes: { id: string; shape: string | null; scanId: string | null }[] };
    const mine = intakes.find((i) => i.shape === "app_master" && i.scanId === scanId);
    expect(mine, "the session is stamped app_master at CREATE, bound to its scan").toBeTruthy();
    intakeId = mine!.id;
  });

  await test.step("the scripted dialog captures the six answers a scan cannot produce", async () => {
    // The opener is the app_master shape's OWN question, asked before a single
    // model call — which is why it is identical keyed and keyless.
    await expect(page.getByText(/Let's define who owns this app/)).toBeVisible({ timeout: 60_000 });

    // 1 · why now (am_context)
    await answer(
      page,
      "The verification gates keep going red between releases and nobody owns them end to end. In three months the on-call engineers should stop babysitting CI."
    );
    // KEYLESS GUARD #2 — the first exchange must disclose the guided-checklist path.
    await expect(
      page.getByText("AI is offline, so the guided checklist runs instead. Your answers are captured all the same.")
    ).toBeVisible({ timeout: 60_000 });

    // 2 · a working title (a brief still needs one to promote)
    await answer(page, ROLE_TITLE);

    // 3 · the value ledger — TWO objectives, one per line. Keyless the scan
    //     proposes none (candidateObjectives is stamped `unknown` on a file
    //     walk), so these keys are slugged from the requestor's own words:
    //     gate_pass_rate and proposal_merge_rate.
    await answer(page, "gate pass rate — 95% within 60 days\nproposal merge rate — 80% within 60 days");

    // 4 · mandate rung 2 — propose only. Rungs 3 and 4 are never grantable.
    await answer(page, "Rung 2 — open a branch and propose a change a human merges.");

    // 5 · all six forbidden classes stand (no allow verb ⇒ nothing is relaxed).
    await answer(page, "All six stand. Nothing there is negotiable for us.");

    // 6 · the monthly ceiling
    await answer(page, "120 USD per month.");

    // 7 · who reviews and answers an escalation
    await answer(page, "Michal, the engineering lead, reviews every proposal.");

    // 8 · probation
    await answer(page, "30 days of probation, then we decide.");

    // 9 · population — the last question; its reply is the READ-BACK rather than
    //     another question, which is how we know the script is exhausted.
    const readback = await answer(page, "An AI agent should hold it.");
    expect(readback, "the script's last turn reads the mandate back").toContain(ROLE_TITLE);

    // The answers landed as `stated` facets under the CLOSED key contract
    // briefToAppMasterSpec reads back (pipeline/jobfit/intake.py::_AM_SLOT_FACET).
    const session = await page.request.get(`/api/intake/${intakeId}`);
    expect(session.ok()).toBe(true);
    const { brief } = (await session.json()) as { brief: { facets: { key: string; provenance: string }[] } };
    const keys = brief.facets.map((f) => f.key);
    for (const key of [
      "objective:gate_pass_rate",
      "objective:proposal_merge_rate",
      "mandate.scopeRung",
      "mandate.forbiddenClasses",
      "budget.monthlyUsd",
      "mandate.owner",
      "tenure.probationDays",
      "role.population",
    ]) {
      expect(keys, `the dialog should have captured ${key}`).toContain(key);
    }
    // The dossier's own facts ride the same brief, but as INFERRED — the card
    // must never launder a machine reading into the requestor's words.
    const codebase = brief.facets.filter((f) => f.key.startsWith("codebase_dossier."));
    expect(codebase.length, "the dossier merges in as codebase_dossier.* facets").toBeGreaterThan(0);
    expect(codebase.every((f) => f.provenance === "inferred")).toBe(true);
  });

  await test.step("composing turns the brief into an AppMasterSpec the card can read", async () => {
    const composed = page.waitForResponse(
      (r) => /\/api\/intake\/[^/]+\/compose-app-master$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
      { timeout: 240_000 }
    );
    await page.getByRole("button", { name: /^(Compose the spec|Re-compose)$/ }).click();
    const res = await composed;
    expect(res.ok(), `POST compose-app-master responded ${res.status()}`).toBe(true);

    // The mandate, the budget and the tenure — the three readings that decide
    // what this role may do and what it may spend.
    await expect(briefLeaf).toContainText("App master spec", { timeout: 60_000 });
    await expect(briefLeaf).toContainText("open a branch and propose");
    await expect(briefLeaf).toContainText("6 classes");
    await expect(briefLeaf).toContainText("$120");
    await expect(briefLeaf).toContainText("30 days");
    await expect(briefLeaf).toContainText("2 outcomes");
    await expect(briefLeaf).toContainText("An AI agent could hold this role");

    // KEYLESS GUARD #3 — the population FIT is a model judgment, and keyless it
    // must stay the disclosed unknown rather than claim automatability.
    await expect(briefLeaf).toContainText("AI is offline, so nothing was judged automatable");

    // The stored spec is the contract, so it is checked against the generated
    // schema here too: a spec that only LOOKS right on a card is what P4's
    // dispatch-time re-validation exists to catch.
    const stored = (await res.json()) as { spec: unknown };
    const parsed = appMasterSpecSchema.safeParse(stored.spec);
    expect(
      parsed.success,
      `the composed spec must satisfy appMasterSpecSchema: ${JSON.stringify(parsed.error?.issues ?? [])}`
    ).toBe(true);
    const spec = parsed.data!;
    expect(spec.role.population).toBe("agent");
    expect(spec.role.title).toBe(ROLE_TITLE);
    expect(spec.mandate.scopeRung).toBe(2);
    expect(spec.mandate.forbiddenClasses).toHaveLength(6);
    expect(spec.budget.monthlyUsd).toBe(120);
    expect(spec.tenure.probationDays).toBe(30);
    expect(spec.objectives.map((o) => o.kpiKey)).toEqual(["gate_pass_rate", "proposal_merge_rate"]);
    // The repo's OWN declared gates are what a proposal must pass — read by the
    // scan, never invented by the composer.
    expect(spec.mandate.approvalGates.length).toBeGreaterThan(0);
    expect(spec.app.repo.rootPath, "the spec is bound to the app it was composed from").toBeTruthy();
  });

  await test.step("dispatch sends the AppMasterSpec beside the flat spec", async () => {
    const dispatched = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/agents/dispatch" && r.request().method() === "POST",
      { timeout: 120_000 }
    );
    await page.getByRole("button", { name: "Dispatch to Personas" }).click();
    const res = await dispatched;
    expect(res.ok(), `POST /api/agents/dispatch responded ${res.status()}`).toBe(true);
    const body = (await res.json()) as { hiredAgentId: string; requestId: string; status: string };
    hiredAgentId = body.hiredAgentId;
    expect(body.status).toBe("pending_approval");

    // The claim the UI makes is exactly what happened: Personas ACCEPTED the
    // request — a human there still has to approve it. Never "hired".
    await expect(
      page.getByText("Personas accepted the request. A human approves it there before the agent starts.")
    ).toBeVisible({ timeout: 60_000 });

    const sent = mock.lastDispatch();
    expect(sent, "Personas should have received a persona request").toBeTruthy();
    expect(sent!.authorization, "the pk_ key rides every management call").toBe(`Bearer ${mock.apiKey}`);
    expect(sent!.requestId).toBe(body.requestId);

    // (1) the additive P4 block, validated against the real generated contract.
    const parsed = appMasterSpecSchema.safeParse(sent!.appMaster);
    expect(
      parsed.success,
      `the dispatched appMaster block must satisfy appMasterSpecSchema: ${JSON.stringify(parsed.error?.issues ?? [])}`
    ).toBe(true);
    expect(parsed.data!.role.title).toBe(ROLE_TITLE);
    expect(parsed.data!.mandate.scopeRung).toBe(2);
    expect(parsed.data!.budget.monthlyUsd).toBe(120);

    // (2) the flat spec is a PROJECTION of appMaster.agent — a Personas build
    //     that never ships the v2 hire handler still receives a complete,
    //     working spec, at the App master's own monthly ceiling.
    expect(sent!.spec.maxBudgetUsd, "the flat budget IS the App master's monthly ceiling").toBe(120);
    expect(sent!.spec.mission, "the projected spec carries a mission").toBeTruthy();
    expect((sent!.spec.successMetrics ?? []).map((m) => (m as { key: string }).key)).toEqual([
      "gate_pass_rate",
      "proposal_merge_rate",
    ]);

    // (3) an App master owns an APPLICATION: there is no job posting, so the
    //     intake is the handle that resolves — and no board card is filed.
    expect(sent!.kp.intakeId, "an App-master hire carries its intake id").toBe(intakeId);
    expect(sent!.kp.jobId, "there is no job posting behind an App-master hire").toBeFalsy();
    reportToken = sent!.reportToken;
    expect(reportToken, "the hire must carry a report capability").toBeTruthy();

    const board = await page.request.get("/api/pipeline");
    expect(board.ok()).toBe(true);
    const { entries } = (await board.json()) as { entries: { candidateId: string }[] };
    expect(
      entries.some((e) => e.candidateId === `agent-${hiredAgentId}`),
      "an App-master hire files no pipeline card — the roster is its home"
    ).toBe(false);
  });
});

test("the approval ladder runs and reporter v2's backbone rollup lands", async ({ page }) => {
  test.setTimeout(240_000);
  // pending_approval → onboarding → active, driven from the mock and read by the
  // PULL fallback (POST /api/agents/[id]/refresh), which applies the same
  // lifecycle mapping the push report path does.
  const refresh = async (): Promise<string> => {
    const r = await page.request.post(`/api/agents/${hiredAgentId}/refresh`, { timeout: 60_000 });
    expect(r.ok(), `POST /api/agents/[id]/refresh responded ${r.status()}`).toBe(true);
    return ((await r.json()) as { agent: { status: string } }).agent.status;
  };

  expect(await refresh(), "still awaiting the human in Personas").toBe("pending_approval");
  mock.setRequestStatus("onboarding", { name: PERSONA_NAME });
  expect(await refresh()).toBe("onboarding");
  mock.setRequestStatus("active", { name: PERSONA_NAME });
  expect(await refresh()).toBe("active");

  // The period rollup, reporter v2. Deliberately incomplete in two NAMED ways:
  // the gate outcomes were never recorded, and the spend was never metered. Both
  // must read as coverage gaps — never as zeroes that score.
  const period = new Date().toISOString().slice(0, 7);
  const rollup = await page.request.post(`/api/agents/report/${reportToken}`, {
    data: {
      kind: "rollup",
      period,
      runs: 12,
      successes: 11,
      failures: 1,
      costUsd: 0,
      tokensIn: 214_000,
      tokensOut: 38_000,
      connectorUses: [{ connector: "github", calls: 37 }],
      proposalsOpened: 8,
      proposalsMerged: 6,
      proposalsReverted: 1,
      forbiddenClassViolations: 0,
      kpiDeltas: [
        { kpiKey: "gate_pass_rate", baseline: 78, current: 94, target: 95, direction: "gte", windowDays: 60, measured: true },
      ],
      // "Unmeasured is not free": no settled figure AND an explicit flag, so the
      // budget rule must be withheld rather than scored as perfect adherence.
      budgetUnmeasured: true,
      ledgerConsistent: true,
      autopilotMode: "suggest",
    },
  });
  expect(rollup.ok(), `POST /api/agents/report/[token] responded ${rollup.status()}`).toBe(true);
  expect((await rollup.json()) as unknown).toMatchObject({ result: "accepted", kind: "rollup" });

  // The day-30 review. `probation_review` carries a REQUIRED decision — the
  // event alone would move the agent nowhere and is not a review.
  const review = await page.request.post(`/api/agents/report/${reportToken}`, {
    data: {
      kind: "lifecycle",
      event: "probation_review",
      decision: "activated",
      personaId: "persona-mock-1",
      personaName: PERSONA_NAME,
      note: `Day-30 review for ${runId}: activated.`,
    },
  });
  expect(review.ok(), `POST probation_review responded ${review.status()}`).toBe(true);

  // …and one with no decision is refused deterministically rather than defaulted.
  const undecided = await page.request.post(`/api/agents/report/${reportToken}`, {
    data: { kind: "lifecycle", event: "probation_review", note: `no decision ${runId}` },
  });
  expect(undecided.status(), "a probation review with no decision is not a review").toBe(400);

  // The server's own arithmetic, before any pixel: `incomplete` BECAUSE two rules
  // could not be read — and the roster is about to say exactly that.
  const roster = await page.request.get("/api/agents");
  expect(roster.ok()).toBe(true);
  const { agents } = (await roster.json()) as {
    agents: {
      id: string;
      status: string;
      personaName: string | null;
      appMaster: { scopeRung: number | null; autopilotMode: string | null; probationDays: number | null } | null;
      backbone: { verdict: string; unmeasured: string[]; score: number | null; coverage: number } | null;
      kpiDeltas: { kpiKey: string }[] | null;
    }[];
  };
  const mine = agents.find((a) => a.id === hiredAgentId);
  expect(mine, "the hire should be on the roster").toBeTruthy();
  expect(mine!.status).toBe("active");
  expect(mine!.personaName).toBe(PERSONA_NAME);
  expect(Object.keys(mine!), "the report token is a capability, never roster data").not.toContain("reportToken");
  expect(mine!.appMaster?.scopeRung).toBe(2);
  expect(mine!.appMaster?.probationDays).toBe(30);
  expect(mine!.appMaster?.autopilotMode, "autopilot is what the agent REPORTED, not what the spec intended").toBe(
    "suggest"
  );
  expect(mine!.backbone?.verdict).toBe("incomplete");
  expect(mine!.backbone?.unmeasured.slice().sort(), "gates were never recorded and spend was never metered").toEqual([
    "budget",
    "gates",
  ]);
  expect(mine!.backbone?.score, "the measurable part still scores").toBeGreaterThan(0);
  expect(mine!.backbone!.coverage, "two of six rules unread ⇒ partial coverage").toBeLessThan(1);
  expect(mine!.kpiDeltas?.map((d) => d.kpiKey)).toEqual(["gate_pass_rate"]);
});

test("the Agents roster renders the verdict, the mandate and the value ledger", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/?tab=agents");
  const nameButton = page.getByRole("button", { name: new RegExp(runId) }).first();
  await expect(nameButton).toBeVisible({ timeout: 180_000 });
  const row = page.locator("tr").filter({ has: page.getByRole("button", { name: new RegExp(runId) }) });

  // Row chips: this is an App master, and Personas is running it on `suggest`.
  await expect(row).toContainText("App master");
  await expect(row).toContainText("Autopilot: suggest");
  await expect(row).toContainText("Mandate: open a branch and propose");
  // An App master hired from an intake has no job posting to navigate to, so the
  // role reads as plain text rather than a link into an empty job.
  expect(await row.getByRole("button", { name: ROLE_TITLE, exact: true }).count()).toBe(0);

  // The expectations column leads with the DETERMINISTIC verdict, and
  // `incomplete` is a DASH — a checkmark there would be the green lie the rubric
  // this scores exists to prevent.
  await expect(row).toContainText("– Not enough was measured");

  await nameButton.click();
  const detail = page.locator("tr").filter({ hasText: "Performance backbone" });
  await expect(detail).toBeVisible({ timeout: 60_000 });

  // Per-rule contributions, exactly as the scorer attributed them — including
  // the two it refused to score, each with its reason. An unmeasured rule shows
  // a dash and "not measured", never a 0, which would read as "scored badly".
  await expect(detail).toContainText("gate outcomes were not recorded for the window");
  await expect(detail).toContainText("spend was not metered for this window — unmeasured is not zero spend");
  await expect(detail).toContainText("not measured");
  await expect(detail).toContainText("6 of 8 proposals merged");
  await expect(detail).toContainText("1 of 1 measured objectives moved toward target");
  // A gate is not a weight: a failed gate fails the verdict outright, so gates
  // are listed apart from the weighted rules.
  await expect(detail).toContainText("no proposal touched a forbidden-change class");

  // The expectations list is the VALUE LEDGER for an App master (source
  // `kpiDeltas`), not the run/spend proxies a task agent gets: the objective with
  // a reading is judged, the one with none reads "no data yet" — a coverage gap,
  // never a miss.
  await expect(detail).toContainText("Outcomes vs readings");
  await expect(detail).toContainText("gate pass rate");
  await expect(detail).toContainText("proposal merge rate");
  await expect(detail).toContainText("no data yet");
});

test("a human-population spec is refused, and an unpaired dispatch fails honestly", async ({ page }) => {
  test.setTimeout(600_000);

  // (1) `human` is a REFUSAL, not a fallback — hiring an agent into a role the
  //     composition judged human-only is exactly the decision this feature
  //     exists to make visible. Refused BEFORE a byte leaves the process.
  const dispatchesBefore = mock.dispatches.length;
  const humanIntake = await seedIntake(page, "A human should hold this role.");
  const refusedHuman = await page.request.post("/api/agents/dispatch", { data: { intakeId: humanIntake } });
  expect(refusedHuman.status()).toBe(400);
  expect((await refusedHuman.json()) as unknown).toMatchObject({ code: "AGENT_DISPATCH_HUMAN_POPULATION" });
  expect(mock.dispatches.length, "a refused hire never reaches Personas").toBe(dispatchesBefore);

  // (2) An unpaired kp — the DEFAULT state of a fresh install — must fail out
  //     loud rather than pretend. Disconnecting last also leaves the bridge clean
  //     for the next run of this file.
  const disconnected = await page.request.delete("/api/agents/bridge");
  expect(disconnected.ok(), `DELETE /api/agents/bridge responded ${disconnected.status()}`).toBe(true);
  expect(((await disconnected.json()) as { bridge: { paired: boolean } }).bridge.paired).toBe(false);

  const agentIntake = await seedIntake(page, "An AI agent should hold it.");
  const refusedUnpaired = await page.request.post("/api/agents/dispatch", { data: { intakeId: agentIntake } });
  expect(refusedUnpaired.status()).toBe(502);
  const failure = (await refusedUnpaired.json()) as { code: string; error: string; hiredAgentId: string };
  expect(failure.code).toBe("AGENT_DISPATCH_BRIDGE_FAILED");
  expect(failure.error, "the reason names the missing pairing").toMatch(/not paired/i);
  expect(mock.dispatches.length, "an unpaired dispatch never reaches Personas either").toBe(dispatchesBefore);

  // The row is marked failed rather than left looking dispatched — the roster
  // shows why — and no phantom Offer-stage card was filed for the attempt.
  const roster = await page.request.get("/api/agents");
  const { agents } = (await roster.json()) as { agents: { id: string; status: string }[] };
  expect(agents.find((a) => a.id === failure.hiredAgentId)?.status).toBe("failed");
  const board = await page.request.get("/api/pipeline");
  const { entries } = (await board.json()) as { entries: { candidateId: string }[] };
  expect(entries.some((e) => e.candidateId === `agent-${failure.hiredAgentId}`)).toBe(false);
});
