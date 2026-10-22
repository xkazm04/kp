import { publicBaseUrl } from "./public-base-url.ts";

// cx T10: say so when candidate links cannot work for a candidate.
//
// publicBaseUrl() resolves the origin that offer, scheduling, interview and apply
// links are built on. On a fresh local install nothing is configured, so that origin
// is the recruiter's own `localhost` (or the neutral `*.example` placeholder when no
// request origin exists) and every link mailed to a candidate points at a machine the
// candidate cannot reach. Nothing fails; the mail simply goes out dead. This module is
// the honest half: a pure verdict plus a log-once wrapper any sender can call.

/** Hosts that only mean something on the machine that runs the app. */
function isLoopbackName(name: string): boolean {
  return (
    name === "localhost" ||
    name === "0.0.0.0" ||
    name === "[::1]" ||
    name === "[::]" ||
    name.endsWith(".localhost") ||
    /^127\.\d+\.\d+\.\d+$/.test(name)
  );
}

/** Pure: why `base` cannot serve a candidate, or null when it looks reachable.
 *  `loopback` = only this machine; `placeholder` = the neutral `.example` default. */
export function linkBaseProblem(base: string | null | undefined): "loopback" | "placeholder" | null {
  let host: string;
  try {
    host = new URL(String(base || "")).hostname.toLowerCase();
  } catch {
    return null; // not an absolute URL: publicBaseUrl never returns one, nothing to judge
  }
  if (isLoopbackName(host)) return "loopback";
  if (host === "example" || host.endsWith(".example")) return "placeholder";
  return null;
}

/** The one warning line for a base, or null. Names both fixes. */
export function linkBaseWarning(base: string | null | undefined): string | null {
  const problem = linkBaseProblem(base);
  if (!problem) return null;
  const what = problem === "loopback" ? "this computer's own address" : "the placeholder address";
  return (
    `[link-base] candidate links point at ${what} (${String(base).replace(/\/+$/, "")}), which a candidate cannot open. ` +
    `Run "npm run up -- --public" for a temporary public address, or set APP_BASE_URL to your public origin.`
  );
}

let warned = false;

/** Test seam: the once-per-process latch. */
export function resetLinkBaseWarnForTests(): void {
  warned = false;
}

/** Log the link-base warning at most once per process. Returns the base it judged so a
 *  sender can call this in place of publicBaseUrl(). */
export function warnLinkBaseOnce(runtimeOrigin?: string | null): string {
  const base = publicBaseUrl(runtimeOrigin);
  if (!warned) {
    const line = linkBaseWarning(base);
    if (line) {
      warned = true;
      console.warn(line);
    }
  }
  return base;
}
