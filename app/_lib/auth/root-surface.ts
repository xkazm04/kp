import { verifySessionEdge } from "./edge-verify";

// Which face of '/' a request gets, decided in proxy.ts before the page renders.
//
// '/' has two audiences: the public landing (SparkHome) and the workspace shell. Served
// by one page, both client trees landed in one entry script group, so a visitor
// downloaded the workspace and an operator the landing (docs/architecture/app-structure.md,
// "First load of '/'"). The proxy now REWRITES an anonymous '/' to LANDING_HOME_PATH, a
// route of its own, so each audience downloads only its own tree. The browser URL stays
// '/', so links, `/#spotlight-<key>`, `?lang=` and hreflang are unchanged.
//
// This is the edge-safe twin of hasEnteredWorkspace() (home-gate-server.ts), which
// app/page.tsx still asks. The two MUST agree; root-surface.test.ts pins it. The proxy
// cannot import session.ts (node:crypto), hence the two literals below, pinned there too.

/** The landing's own route. Internal: the proxy redirects a direct hit back to '/'. */
export const LANDING_HOME_PATH = "/landing/home";

const ENTERED_COOKIE = "kp_entered"; // session.ts ENTERED_COOKIE
const DEMO_WORKSPACE = "demo"; // session.ts DEMO_WORKSPACE

export type RootSurfaceInput = {
  /** The `?sim=auto` guided demo forces the workspace, as app/page.tsx does. */
  sim: string | null;
  passwordSet: boolean;
  sessionCookie: string | undefined;
  enteredCookie: string | undefined;
  secret: string | undefined;
  epoch: number;
  now: number;
};

/** True when '/' must serve the public landing rather than the workspace. */
export async function rootServesLanding(input: RootSurfaceInput): Promise<boolean> {
  if (input.sim === "auto") return false;
  // Open mode: the readable entry marker is the whole gate (no signed session need exist).
  if (!input.passwordSet) return input.enteredCookie !== "1";
  // Password mode: a real signed session, not the anonymous demo workspace.
  const session = await verifySessionEdge(input.sessionCookie, input.secret, input.now, input.epoch);
  return session === null || session.workspace === DEMO_WORKSPACE;
}

export const ROOT_ENTERED_COOKIE = ENTERED_COOKIE;
