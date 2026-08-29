// Tenure files: the handles of an App master that was hired ONCE and is kept.
//
// PURE (tenures.test.mjs covers it) — no fetch, and no fs beyond reading and
// writing the files themselves, for the same reason scenarios.mjs is pure.
//
// WHY THIS EXISTS. The bench's unit used to be a HIRE: every run minted a new
// persona through `scan → intake → 9 dialog turns → compose → dispatch →
// activate`, which is ~14 calls and most of the wall clock, and it re-tested the
// intake — a closed ring — on every single run. Thirty-one sweeps did that and
// left 100+ personas behind. The unit is now a TENURE: one App master per repo,
// hired once, kept for the whole program, and a run against it starts at the
// night (docs/development/app-master-c1-exam.md §1).
//
//   { "repo": "kp", "hiredAgentId": "agt_…", "personaId": "p_…",
//     "requestId": "…", "hiredAt": "2026-…", "rung": 0, "probationDays": 30 }
//
// A tenure file is a HANDLE, not a record: it names a row in one machine's kp DB
// and one persona in that machine's Personas. That is why `tenures/*.json` is
// gitignored and only the directory is committed — a shared tenure file would
// point every checkout at a hire that exists on exactly one of them.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TENURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "tenures");

/** Statuses under which kp counts a hired agent LIVE — mirrors
 *  `ACTIVE_AGENT_STATUSES` in app/_lib/db/agents.ts. A `retired`, `rejected` or
 *  `failed` row is a finished hire, not a tenure and not an orphan. */
export const LIVE_AGENT_STATUSES = ["dispatched", "pending_approval", "onboarding", "active"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The repo label a tenure is named for: `kp`, `personas`, `systedo-case`. Taken
 * from the scenario's own scan target so the name follows the repo the App
 * master owns, never the scenario that happened to hire it.
 */
export function tenureRepoLabel(scenario) {
  const root = scenario?.repo?.rootPath;
  if (isNonEmptyString(root)) return path.basename(root.trim().replace(/[/\\]+$/, ""));
  const url = scenario?.repo?.url;
  if (isNonEmptyString(url)) {
    const last = url.trim().replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
    return last.replace(/\.git$/i, "") || (scenario?.name ?? "repo");
  }
  return scenario?.name ?? "repo";
}

/**
 * The default tenure name for a scenario: `<repo>-owner` (§4 — `kp-owner`,
 * `personas-owner`, `systedo-owner`). ONE named tenure per repo; a second App
 * master on the same repo is a deliberate experiment that names itself
 * (`kp-owner-b`), never an accident of a retry.
 */
export function tenureNameFor(scenario) {
  return `${tenureRepoLabel(scenario)}-owner`;
}

/** Resolve `kp-owner`, `kp-owner.json` or an explicit path to a file. Mirrors
 *  `resolveScenarioPath` — the two directories behave the same way on purpose. */
export function resolveTenurePath(nameOrPath, dir = TENURE_DIR) {
  const value = String(nameOrPath);
  if (value.includes("/") || value.includes("\\")) return path.resolve(value);
  return path.join(dir, value.endsWith(".json") ? value : `${value}.json`);
}

/**
 * Validate a parsed tenure record. Returns `{ ok, tenure, errors }` — every
 * problem at once, like `validateScenario`.
 *
 * `hiredAgentId` and `personaId` are the two the loop cannot run without: the
 * first is kp's roster handle (refresh, roster read, report), the second is what
 * every `POST /api/kp/test/tick` is scoped by. The rest are the record of what
 * was hired, and a missing one is reported rather than invented.
 */
export function validateTenure(raw, { name = "" } = {}) {
  const errors = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, tenure: null, errors: ["a tenure file must be a JSON object"] };
  }
  if (!isNonEmptyString(raw.hiredAgentId)) errors.push("hiredAgentId is required — it is kp's roster handle for this tenure");
  if (!isNonEmptyString(raw.personaId)) errors.push("personaId is required — every test tick is scoped by it");
  if (!isNonEmptyString(raw.repo)) errors.push("repo is required — one named tenure per repo");
  for (const key of ["requestId", "hiredAt"]) {
    if (raw[key] !== undefined && raw[key] !== null && !isNonEmptyString(raw[key])) {
      errors.push(`${key} must be a non-empty string when present`);
    }
  }
  if (raw.rung !== undefined && raw.rung !== null && (!Number.isInteger(raw.rung) || raw.rung < 0 || raw.rung > 2)) {
    errors.push("rung must be 0, 1 or 2 — rungs 3+ are never grantable");
  }
  if (
    raw.probationDays !== undefined &&
    raw.probationDays !== null &&
    (!Number.isInteger(raw.probationDays) || raw.probationDays <= 0)
  ) {
    errors.push("probationDays must be a positive integer when present");
  }
  if (errors.length > 0) return { ok: false, tenure: null, errors };
  return {
    ok: true,
    errors: [],
    tenure: {
      name: isNonEmptyString(raw.name) ? raw.name.trim() : name,
      repo: raw.repo.trim(),
      hiredAgentId: raw.hiredAgentId.trim(),
      personaId: raw.personaId.trim(),
      requestId: isNonEmptyString(raw.requestId) ? raw.requestId.trim() : null,
      hiredAt: isNonEmptyString(raw.hiredAt) ? raw.hiredAt.trim() : null,
      rung: Number.isInteger(raw.rung) ? raw.rung : null,
      probationDays: Number.isInteger(raw.probationDays) ? raw.probationDays : null,
      ...(isNonEmptyString(raw.scenario) ? { scenario: raw.scenario.trim() } : {}),
      ...(isNonEmptyString(raw.personaName) ? { personaName: raw.personaName.trim() } : {}),
    },
  };
}

/** Read + validate one tenure file. Throws with every error listed. */
export function loadTenureFile(file) {
  const name = path.basename(file).replace(/\.json$/i, "");
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`tenure ${name}: not readable JSON — ${error.message}`);
  }
  const { ok, tenure, errors } = validateTenure(raw, { name });
  if (!ok) throw new Error(`tenure ${name} is invalid:\n  - ${errors.join("\n  - ")}`);
  tenure.file = file;
  return tenure;
}

/** Write a tenure file, creating `tenures/` if this is the first one. */
export function writeTenureFile(file, tenure) {
  const { ok, errors } = validateTenure(tenure, { name: path.basename(file, ".json") });
  if (!ok) throw new Error(`refusing to write ${file}: ${errors.join("; ")}`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(tenure, null, 2)}\n`, "utf8");
  return file;
}

/** `4d 6h` / `6h 12m` / `12m` / `44s` — an orphan's age, at the resolution a
 *  human reads it at. `null` in, `–` out: an agent row with no createdAt has an
 *  age nobody measured, which is not an age of zero. */
export function humanAge(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "–";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m - h * 60).padStart(2, "0")}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${String(h - d * 24).padStart(2, "0")}h`;
}

/**
 * THE FLEET AUDIT (c1-exam §4). Compare kp's roster against the tenure files on
 * disk: every LIVE hired agent that no tenure file names is an **orphan**, with
 * its age.
 *
 * This is the guard that turns "100+ agents" into a red preflight the next time
 * it starts happening. It is deliberately generous about what counts as
 * "named": a tenure file's `hiredAgentId` OR its `personaId` claims a row,
 * because a re-dispatch can leave the two out of step and an audit that cried
 * orphan over that would be ignored within a week.
 *
 * Only live rows are audited (`LIVE_AGENT_STATUSES`). A `retired`, `rejected`
 * or `failed` row is a hire that ended — it is the evidence a teardown worked,
 * not an agent still costing anything.
 */
export function fleetAudit(agents, tenures, { now = Date.now(), liveStatuses = LIVE_AGENT_STATUSES } = {}) {
  const claimed = new Set();
  for (const tenure of tenures ?? []) {
    if (isNonEmptyString(tenure?.hiredAgentId)) claimed.add(tenure.hiredAgentId.trim());
    if (isNonEmptyString(tenure?.personaId)) claimed.add(tenure.personaId.trim());
  }
  const rows = Array.isArray(agents) ? agents.filter((a) => a && typeof a === "object") : [];
  const live = rows.filter((a) => liveStatuses.includes(a.status));
  const orphans = [];
  for (const agent of live) {
    if (claimed.has(agent.id) || (agent.personaId && claimed.has(agent.personaId))) continue;
    const created = Date.parse(agent.createdAt ?? "");
    const ageMs = Number.isFinite(created) ? Math.max(0, now - created) : null;
    orphans.push({
      id: agent.id ?? null,
      personaId: agent.personaId ?? null,
      personaName: agent.personaName ?? null,
      status: agent.status ?? null,
      createdAt: agent.createdAt ?? null,
      ageMs,
      age: humanAge(ageMs),
    });
  }
  // Oldest first: the age is the finding, and the oldest orphan is the one that
  // has been costing the longest.
  orphans.sort((a, b) => (b.ageMs ?? -1) - (a.ageMs ?? -1));
  return { rostered: rows.length, live: live.length, tenures: (tenures ?? []).length, orphans };
}

/** The one line a red fleet audit says, on stderr, in the record and in the
 *  PhaseError under `--strict`. Written once so all three agree. */
export function orphanReport(audit) {
  const list = audit.orphans
    .map((o) => `${o.id}${o.personaId ? ` / ${o.personaId}` : ""} (${o.status}, ${o.age} old)`)
    .join("; ");
  return `fleet audit: ${audit.orphans.length} of ${audit.live} live hired agent(s) are named by no tenure file — ${list}`;
}

/** Every tenure file in the directory, name-sorted. A missing directory is an
 *  empty list, never a throw: a checkout that has never hired has no tenures. */
export function listTenureFiles(dir = TENURE_DIR) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Load every tenure file, keeping the unreadable ones as PROBLEMS rather than
 * throwing. A corrupt tenure file must not stop a preflight from reporting the
 * fleet — it is itself a finding, and the audit's answer would otherwise flip
 * from "these agents are orphans" to nothing at all.
 */
export function readAllTenures(dir = TENURE_DIR) {
  const tenures = [];
  const problems = [];
  for (const file of listTenureFiles(dir)) {
    try {
      tenures.push(loadTenureFile(file));
    } catch (error) {
      problems.push({ file, error: String(error?.message || error) });
    }
  }
  return { tenures, problems };
}
