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
 * kp auth: open dev mode needs no cookie; a passworded deploy needs KP_SESSION_COOKIE.
 * Exit codes: 0 every request accepted; 1 a request failed; 2 usage.
 * Node builtins only.
 */

import { pathToFileURL } from "node:url";

export const DEFAULT_KP = "http://localhost:3000";
export const DEFAULT_STATUSES = ["drafted", "in_review"];
export const SESSION_COOKIE_ENV = "KP_SESSION_COOKIE";

export const HELP = `usage: node scripts/gigs/report-backfill.mjs [options]

Ask kp to write the HTML report of every researched gig in the given statuses, paced.
Each request is one model call (about $0.20) unless the install is keyless.

  --status <a,b>   gig statuses (default ${DEFAULT_STATUSES.join(",")})
  --kp <url>       kp base URL (default ${DEFAULT_KP}, or KP_BASE_URL)
  --pace-s <n>     seconds between requests (default 35; the door allows 20 per 10 min)
  --max <n>        at most this many gigs (default 50)
  --all            also rewrite reports that are already ready
  --dry-run        list the gigs, request nothing
  --help, -h       this text`;

/** Parse argv. Throws on an unknown flag or a bad value. */
export function parseArgs(argv) {
  const out = { statuses: [...DEFAULT_STATUSES], kp: null, paceS: 35, max: 50, all: false, dryRun: false, help: false };
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
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--kp") out.kp = need();
    else if (a === "--status") out.statuses = need().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--pace-s" || a === "--max") {
      const n = Number(need());
      if (!Number.isFinite(n) || n < 0) throw new Error(`${a} needs a non-negative number`);
      if (a === "--pace-s") out.paceS = n;
      else out.max = Math.trunc(n);
    } else throw new Error(`unknown flag ${a}`);
  }
  if (out.statuses.length === 0 || !out.statuses.every((s) => /^[a-z_]+$/.test(s))) throw new Error("--status needs gig statuses like drafted,in_review");
  return out;
}

/** The gigs to ask for: researched, not already reported unless `all`, at most `max`. Pure. */
export function pickGigs(gigs, { all = false, max = 50 } = {}) {
  const out = [];
  for (const g of Array.isArray(gigs) ? gigs : []) {
    if (!g || typeof g.id !== "string" || !g.brief) continue;
    if (!all && g.report && g.report.status === "ready") continue;
    out.push({ id: g.id, title: typeof g.title === "string" ? g.title : g.id, status: g.status, stage: g.report?.stage ?? null });
    if (out.length >= max) break;
  }
  return out;
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
  console.log(`${gigs.length} gig(s) to report${args.dryRun ? " (dry run)" : ""}`);
  let failed = 0;
  for (const [i, g] of gigs.entries()) {
    const line = `${String(i + 1).padStart(3)}  ${g.id}  ${g.status}  ${g.stage ?? "no report"}  ${g.title.slice(0, 60)}`;
    if (args.dryRun) {
      console.log(line);
      continue;
    }
    let res = await fetch(`${base}/api/gigs/${encodeURIComponent(g.id)}/report`, { method: "POST", headers });
    if (res.status === 429) {
      const wait = retryAfterS(res.headers.get("retry-after"));
      console.log(`${line}  429, waiting ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      res = await fetch(`${base}/api/gigs/${encodeURIComponent(g.id)}/report`, { method: "POST", headers });
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
