import { notFound } from "next/navigation";
import { signupEnabled } from "@/app/_lib/workspace-lock";
import { SignupClient } from "./SignupClient";

// Self-serve signup — the /login sibling. GATED: with KP_SIGNUP_ENABLED unset
// (the default) the page 404s as if it didn't exist, matching the register
// API's concealment (see workspace-lock.signupEnabled for why the funnel ships
// dark). Same segment config as /login: the form renders under the per-request
// locale layout, so it can't be statically prerendered under Cache Components —
// and the env gate must be read per request anyway.
export const instant = false;

export default function SignupPage() {
  if (!signupEnabled()) notFound();
  return <SignupClient />;
}
