import { can } from "@/app/_lib/auth/current-user";
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
  const canReadFeedback = await can("members:manage");
  return (
    <>
      <ControlRoom />
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
