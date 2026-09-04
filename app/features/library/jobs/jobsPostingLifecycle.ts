// The posting modal's lifecycle state machine, extracted from
// jobsPostingModalLogic so it can be pinned without a React runner.
//
// Three inputs: the status the server decorated the job with, and the two
// in-session flips (`closed` after a successful /close, `published` after a
// successful /publish — which doubles as Reopen). The footer spends the answer:
// a DRAFT's apply pages 404 and a CLOSED role's serve 410, so handing out those
// links from a wrong verdict ships a campaign pointing at nothing.

export type PostingStatus = "draft" | "published" | "closed" | null;

export function derivePostingLifecycle(
  serverStatus: string | null | undefined,
  closed: boolean,
  published: boolean
): { status: PostingStatus; isDraft: boolean; isClosed: boolean } {
  // Order matters and is deliberate: `published` is checked FIRST because a
  // re-publish is the reopen path — a role that was closed in this session and
  // then reopened is live, and reading `closed` first would keep the links inert
  // on a live role unless every caller remembered to clear the flag by hand.
  const status: PostingStatus = published
    ? "published"
    : closed
      ? "closed"
      : serverStatus === "draft" || serverStatus === "published" || serverStatus === "closed"
        ? serverStatus
        : null;
  return { status, isDraft: status === "draft", isClosed: status === "closed" };
}
