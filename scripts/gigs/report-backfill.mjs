#!/usr/bin/env node
/**
 * report-backfill - ask kp to write (or rewrite) the HTML report of every gig in the given
 * statuses, paced (docs/features/gigs/README.md "The report"). For the gigs that were already
 * past research when the report shipped: the stage triggers only fire on the NEXT move, so a
 * drafted gig would otherwise have no report until it is sent.
 *
 * Every call is kp's HTTP API (KP_BASE_URL / --kp, default http://localhost:3000):
 *   GET  /api/gigs?status=<list>&limit=200   the candidates (only gigs WITH a research brief)
 *   POST /api/gigs/<id>/report               one forced `gig_report` task each (202 {taskId})
 *
 * IT SPENDS MONEY: each POST is one pinned model call (Claude Sonnet 5.5 at high effort,
 * about $0.20 on the 2026-09-30 fixture), unless the install is keyless (then kp writes the
 * report itself for free). --dry-run lists what it would ask for and asks for nothing.
 *
 * PACED: the report door allows 20 POSTs per 10 minutes per IP, so the default pace is one
 * every 35 s; a 429 waits out its Retry-After (or a minute) and retries that gig once. By
 * default a gig whose report is already `ready` is skipped (--all rewrites those too).
 *
 * --proposal: the same pass for the CLIENT PROPOSAL of freelance gigs (the proposal track,
 * docs/features/gigs/README.md "Two tracks"): POST /api/gigs/<id>/proposal instead of /report,
 * freelance gigs only, a gig whose proposal is already `ready` skipped (unless --all), the same
 * pacing and 429 handling (that door allows 20 per 10 minutes too). Its default statuses are
 * qualified,drafted,in_review: a qualified gig's proposal becomes its draft; a drafted one
 * (an older persona draft) gets the file and the record only.
 *
 * kp auth: open dev mode needs no cookie; a passworded deploy needs KP_SESSION_COOKIE.
 * Exit codes: 0 every request accepted; 1 a request failed; 2 usage.
 * Node builtins only.
 */

import { pathToFileURL } from "node:url";

export const DEFAULT_KP = "http://localhost:3000";
export const DEFAULT_STATUSES = ["drafted", "in_review"];
export const DEFAULT_PROPOSAL_STATUSES = ["qualified", "drafted", "in_review"];
export const SESSION_COOKIE_ENV = "KP_SESSION_COOKIE";

export const HELP = `usage: node scripts/gigs/report-backfill.mjs [options]

Ask kp to write the HTML report of every researched gig in the given statuses, paced.
Each request is one model call (about $0.20) unless the install is keyless.

  --status <a,b>   gig statuses (default ${DEFAULT_STATUSES.join(",")})
  --kp <url>       kp base URL (default ${DEFAULT_KP}, or KP_BASE_URL)
  --pace-s <n>     seconds between requests (default 35; the door allows 20 per 10 min)
  --max <n>        at most this many gigs (default 50)
  --all            also rewrite reports that are already ready
  --min-days-left <n>  only gigs whose deadline is more than n days away (a gig with no
                   stated deadline is kept - nothing says it is closing; --dated-only drops it)
  --dated-only     with --min-days-left, drop gigs that state no deadline
  --arena <a,b>    only gigs in these arenas (freelance, oss_bounty, security, competition)
  --proposal       write the CLIENT PROPOSAL of freelance gigs instead of the report
                   (default statuses ${DEFAULT_PROPOSAL_STATUSES.join(",")})
  --dry-run        list the gigs, request nothing
  --help, -h       this text`;

/** Parse argv. Throws on an unknown flag or a bad value. */
export function parseArgs(argv) {
  const out = { statuses: [...DEFAULT_STATUSES], kp: null, paceS: 35, max: 50, all: false, dryRun: false, help: false, minDaysLeft: null, datedOnly: false, arenas: null, proposal: false };
  let statusGiven = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    const need = () => {
      if (typeof v !== "string" || v.startsWith("--")) throw new Error(`${a} needs a value`);
      i++;
      return v;
    };
    if (a === "--all") out.all = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--dated-only") out.datedOnly = true;
    else if (a === "--proposal") out.proposal = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--kp") out.kp = need();
    else if (a === "--arena") out.arenas = need().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--status") {
      out.statuses = need().split(",").map((s) => s.trim()).filter(Boolean);
      statusGiven = true;
    }
    else if (a === "--pace-s" || a === "--max" || a === "--min-days-left") {
      const n = Number(need());
      if (!Number.isFinite(n) || n < 0) throw new Error(`${a} needs a non-negative number`);
      if (a === "--pace-s") out.paceS = n;
      else if (a === "--min-days-left") out.minDaysLeft = n;
      else out.max = Math.trunc(n);
    } else throw new Error(`unknown flag ${a}`);
  }
  if (out.statuses.length === 0 || !out.statuses.every((s) => /^[a-z_]+$/.test(s))) throw new Error("--status needs gig statuses like drafted,in_review");
  if (out.proposal && !statusGiven) out.statuses = [...DEFAULT_PROPOSAL_STATUSES];
  return out;
}

/** Days from `now` to a gig's deadline; null when it states none (or an unreadable one). */
export function daysLeft(deadlineAt, now) {
  const at = typeof deadlineAt === "string" ? Date.parse(deadlineAt) : NaN;
  return Number.isFinite(at) ? (at - now.getTime()) / 86_400_000 : null;
}

/** The gigs to ask for: researched, not already reported unless `all`, with more than
 *  `minDaysLeft` days to their deadline when that is set (a gig stating no deadline is kept
 *  unless `datedOnly`), at most `max`. With `proposal`: freelance gigs only (the proposal
 *  track), and it is the PROPOSAL that must not be ready yet. Pure. */
export function pickGigs(gigs, { all = false, max = 50, minDaysLeft = null, datedOnly = false, arenas = null, proposal = false, now = new Date() } = {}) {
  const out = [];
  for (const g of Array.isArray(gigs) ? gigs : []) {
    if (!g || typeof g.id !== "string" || !g.brief) continue;
    if (proposal && g.arena !== "freelance") continue;
    const record = proposal ? g.proposal : g.report;
    if (!all && record && record.status === "ready") continue;
    if (arenas && !arenas.includes(g.arena)) continue;
    const days = daysLeft(g.deadlineAt, now);
    if (minDaysLeft !== null && (days === null ? datedOnly : days <= minDaysLeft)) continue;
    out.push({ id: g.id, title: typeof g.title === "string" ? g.title : g.id, status: g.status, stage: proposal ? (g.proposal?.status ?? null) : (g.report?.stage ?? null), daysLeft: days });
    if (out.length >= max) break;
  }
  return out;
}

/** The door one gig is asked through: the report's, or with `proposal` the client proposal's. Pure. */
export function requestPath(gigId, proposal = false) {
  return `/api/gigs/${encodeURIComponent(gigId)}/${proposal ? "proposal" : "report"}`;
}

/** Seconds a 429 asks us to wait (Retry-After), else a minute. Pure. */
export function retryAfterS(header) {
  const n = Number(header);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 600) : 60;
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(String(e.message ?? e));
    console.error(HELP);
    return 2;
  }
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  const base = (args.kp ?? process.env.KP_BASE_URL ?? DEFAULT_KP).replace(/\/+$/, "");
  const headers = { "content-type": "application/json" };
  if (process.env[SESSION_COOKIE_ENV]) headers.cookie = process.env[SESSION_COOKIE_ENV];
  const list = await fetch(`${base}/api/gigs?status=${encodeURIComponent(args.statuses.join(","))}&limit=200`, { headers });
  if (!list.ok) {
    console.error(`GET /api/gigs answered ${list.status}`);
    return 1;
  }
  const gigs = pickGigs((await list.json()).gigs, args);
  const noun = args.proposal ? "propose for" : "report";
  console.log(`${gigs.length} gig(s) to ${noun}${args.dryRun ? " (dry run)" : ""}`);
  let failed = 0;
  for (const [i, g] of gigs.entries()) {
    const left = g.daysLeft === null ? "no deadline" : `${g.daysLeft.toFixed(1)}d left`;
    const line = `${String(i + 1).padStart(3)}  ${g.id}  ${g.status}  ${left}  ${g.stage ?? (args.proposal ? "no proposal" : "no report")}  ${g.title.slice(0, 60)}`;
    if (args.dryRun) {
      console.log(line);
      continue;
    }
    let res = await fetch(`${base}${requestPath(g.id, args.proposal)}`, { method: "POST", headers });
    if (res.status === 429) {
      const wait = retryAfterS(res.headers.get("retry-after"));
      console.log(`${line}  429, waiting ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      res = await fetch(`${base}${requestPath(g.id, args.proposal)}`, { method: "POST", headers });
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 202) console.log(`${line}  task ${body.taskId}`);
    else {
      failed += 1;
      console.log(`${line}  FAILED ${res.status} ${body.code ?? ""}`);
    }
    if (i < gigs.length - 1 && args.paceS > 0) await new Promise((r) => setTimeout(r, args.paceS * 1000));
  }
  return failed > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    }
  );
}
