// "Send work sample" in the candidate drawer (CX S43) — the PURE half: what one answer
// of POST /api/pipeline/[id]/work-sample means for the person who clicked.
//
// The server sends through the homework column's own function (sendWorkSample in
// app/_lib/stage-hooks-homework.ts), so every state below is one that function can
// reach. The line never claims more than happened: `queued` is "not sent — copy the
// link", never a green "sent"; a refusal says nothing went out and names the next step.
// Kept import-free so the Node unit runner loads it directly.

export type WorkSampleDelivery = "sent" | "queued" | "failed";

/** The route's 200 body — one STATE per non-fault outcome. */
export type WorkSampleResponse =
  | { state: "invited"; url: string; delivery: WorkSampleDelivery }
  | { state: "already_invited"; url: string }
  | { state: "no_case"; jobId: string | null }
  | { state: "agent" }
  | { state: "refused"; reason: string; jobId: string | null };

/** The catalog key under `pipeline.candidate.footer.workSample.outcome`. */
export type WorkSampleLine =
  | "sent"
  | "queued"
  | "failed"
  | "alreadyInvited"
  | "noCase"
  | "agent"
  | "unaddressable"
  | "suppressed"
  | "intakeStopped"
  | "notSent";

export type WorkSampleView = {
  line: WorkSampleLine;
  tone: "ok" | "amber" | "critical";
  /** The candidate's relative apply link to show with copy, when one exists. */
  url: string | null;
  /** A next step under Assignments, filtered to this role (`?tab=assignments&job=`). */
  assignmentsHref: string | null;
  /** The label for that next step. */
  assignmentsAction: "create" | "reopen" | null;
};

/** The Assignments tab narrowed to one role — the address assignmentsDeepLink.ts reads. */
export function assignmentsForJobHref(jobId: string | null): string {
  return jobId ? `/?tab=assignments&job=${encodeURIComponent(jobId)}` : "/?tab=assignments";
}

const none = { url: null, assignmentsHref: null, assignmentsAction: null } as const;

export function workSampleView(res: WorkSampleResponse): WorkSampleView {
  switch (res.state) {
    case "invited":
      // The outbox's claim, verbatim: only a relayed send is "sent".
      if (res.delivery === "sent") return { ...none, line: "sent", tone: "ok", url: res.url };
      if (res.delivery === "queued") return { ...none, line: "queued", tone: "amber", url: res.url };
      return { ...none, line: "failed", tone: "critical", url: res.url };
    case "already_invited":
      return { ...none, line: "alreadyInvited", tone: "ok", url: res.url };
    case "no_case":
      return { ...none, line: "noCase", tone: "amber", assignmentsHref: assignmentsForJobHref(res.jobId), assignmentsAction: "create" };
    case "agent":
      return { ...none, line: "agent", tone: "amber" };
    case "refused":
      if (res.reason === "unaddressable") return { ...none, line: "unaddressable", tone: "amber" };
      if (res.reason === "suppressed") return { ...none, line: "suppressed", tone: "critical" };
      if (res.reason === "intake_stopped") {
        return { ...none, line: "intakeStopped", tone: "amber", assignmentsHref: assignmentsForJobHref(res.jobId), assignmentsAction: "reopen" };
      }
      return { ...none, line: "notSent", tone: "critical" };
  }
}
