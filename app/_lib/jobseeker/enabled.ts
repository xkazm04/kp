// Is the job-seeker module (/me, /api/jobseeker/**, the `jobseeker_scan` clock job)
// part of THIS install? The one place that question is answered.
//
// kp is AGPL open source, and the seeker module is a personal tool: the operator runs it
// for themselves, against their own CV. A recruiting team self-hosting kp must not get a
// seeker surface, its routes or its scan clock by default. So the module is OFF unless
// the install says `KP_JOBSEEKER=1` — exactly "1"; unset, "0", "true" or anything else
// is off. A flag that turns a surface ON must not be guessable into existence.
//
// Every door reads it here and nowhere else:
//   - proxy.ts          /me/** and /api/jobseeker/** answer what an unknown route answers
//   - app/me/layout.tsx notFound() for every /me page (defence in depth under the proxy)
//   - instrumentation-node.ts + /api/automation/schedule: the scan clock job is neither
//                       run nor offered (schedulerJobOffered)
//   - app/page.tsx      seeds the first-run wizard, whose intent fork hides "looking for
//                       a job" (and its hand-off to /me) when the module is off
//
// Pure and dependency-free (no node:*, no next/*), because proxy.ts imports it. The env
// is a parameter so the tests can drive both states without mutating process.env.

type Env = Readonly<Record<string, string | undefined>>;

/** The install's switch. Default OFF. */
export function jobseekerEnabled(env: Env = process.env): boolean {
  return env.KP_JOBSEEKER === "1";
}

/** Every URL the module owns: the /me pages and the /api/jobseeker routes — whole
 *  segments only, so `/media`, `/members` and `/api/me/*` are never caught. */
export function isJobseekerPath(pathname: string): boolean {
  return (
    pathname === "/me" ||
    pathname.startsWith("/me/") ||
    pathname === "/api/jobseeker" ||
    pathname.startsWith("/api/jobseeker/")
  );
}

/** The scheduler jobs that belong to the module. */
const JOBSEEKER_SCHEDULER_JOBS: ReadonlySet<string> = new Set(["jobseeker_scan"]);

/** Whether a registered scheduler job is part of this install: every job is, except the
 *  seeker's scan while the module is off. The clock skips it (no row, no run) and the
 *  schedule panel does not list it. */
export function schedulerJobOffered(name: string, env: Env = process.env): boolean {
  return !JOBSEEKER_SCHEDULER_JOBS.has(name) || jobseekerEnabled(env);
}

/** A path under no route at all. The proxy REWRITES a hidden module path here, so the
 *  answer is whatever an unknown URL gets — the same not-found page and status, by
 *  construction rather than by imitation. A `_`-prefixed folder is private in the App
 *  Router (never routable), so nothing can ever be mounted at this address. */
export const UNKNOWN_ROUTE_PATH = "/_kp/unknown-route";
