import { callerOrgCapabilities, can } from "@/app/_lib/auth/current-user";
import { isOperator } from "@/app/_lib/auth/require-operator";
import { notFound } from "next/navigation";
import { ControlRoom } from "./ControlRoom";
import { FeedbackSection } from "./FeedbackSection";

// The control room polls live server state client-side and renders under the
// per-request locale layout, so it is inherently dynamic — there is no useful
// static shell to prerender. Block it under Cache Components (its behavior
// before the flag). `instant` is route segment config, so it must live on this
// Server Component wrapper; the interactive UI stays in the "use client"
// ControlRoom child.
export const instant = false;

export default async function ControlPage() {
  // The feedback list is colleagues' free-text WITH their reply addresses, so the
  // section is gated here as well as on GET /api/feedback (/perfect wave 17,
  // api-workspace). The route is the real wall; this is what stops a recruiter
  // being shown a panel that can only ever 403 at them. Same capability on both
  // sides — `members:manage`, the bar that already gates the member and invite
  // lists — so the UI and the API cannot disagree about who may read this.
  // Director gate (2026-09-03): a demo cookie is a valid session and the room is not in
  // the nav - answer the same 404 an unknown route does rather than reveal it.
  if (!(await isOperator())) notFound();
  const canReadFeedback = await can("members:manage");
  // AUTHORITY, read once server-side (/perfect wave 21, internal-explorers) and mirrored
  // by the routes, exactly as the feedback section above already does it. The room used
  // to render every control to every seat and let the API decide - which, before this
  // wave, it never did. The two questions are different:
  //   - the KILL SWITCH and the promote FLOOR are deployment policy (one global
  //     dev_control key each), so they are org-level: `org:manage`, resolved org-wide.
  //   - approving an Art. 22 gate, reconciling this team's lifecycles and recording an
  //     outcome are recruiter operations on the caller's own workspace: `pipeline:write`.
  // A seat that holds neither still gets the room's READ half - the lifecycle list, the
  // audit trail and the calibration table - which is what an oversight surface is for.
  const [canGovern, canOperate] = await Promise.all([
    callerOrgCapabilities().then((caps) => caps.has("org:manage")),
    can("pipeline:write"),
  ]);
  return (
    <>
      <ControlRoom canGovern={canGovern} canOperate={canOperate} />
      {/* Recruiter feedback (read-only) — composed BESIDE the room from the page,
          in the room's own container idiom, so the oversized ControlRoom.tsx
          (mid-decomposition) doesn't grow another section. */}
      {canReadFeedback ? (
        <div className="bg-paper pb-10">
          <div className="mx-auto max-w-4xl px-6">
            <FeedbackSection />
          </div>
        </div>
      ) : null}
    </>
  );
}
