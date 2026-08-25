import {
  appendTurnWithProposals,
  createThread,
  listProposals,
  listThreads,
  renameThread,
} from "./db/companion";
import { runCompanionDigest } from "./companion-run";
import { deriveThreadTitle } from "./companion-turn";
import { coerceProposalPayload } from "./companion-proposal-view";
import { isLocale, DEFAULT_LOCALE } from "@/i18n/locales";
import type { TaskCtx } from "./tasks";

// The `companion_digest` background task (docs/features/companion/README.md, WP3).
//
// A digest is the companion speaking FIRST — the one thing the WP1/WP2 contract
// deliberately did not do, made safe by the fact that it still only lands as a
// message in a conversation the operator can ignore, plus proposals they resolve.
// It never moves an entry, never writes to a candidate, never publishes anything.
//
// It is a background task rather than a route because it is one metered model
// call plus three store reads: exactly the shape the runner exists for (the row
// is the source of truth, so leaving the page loses nothing), and it inherits the
// runner's dedupe — one digest per tenant per day, so a second accept of the same
// proposal coalesces onto the run already in flight instead of paying twice.

/** Open proposals, projected to what a prompt can use: an id short enough to
 *  quote and the summary reference the operator sees. The PARAMS are deliberately
 *  omitted — a proposal's parameters are already in the transcript that produced
 *  it, and re-serializing them here would put a candidate's name into a second
 *  prompt for no added grounding. */
function openProposalDigestView(workspaceId: string): { id: string; summary: string }[] {
  return listProposals(workspaceId, "open")
    .slice(0, 10)
    .map((proposal) => {
      const payload = coerceProposalPayload(proposal.payload);
      return { id: proposal.id, summary: payload ? `${payload.actionId}: ${payload.summary.key}` : proposal.kind };
    });
}

export async function runCompanionDigestTask(ctx: TaskCtx): Promise<unknown> {
  const workspaceId = ctx.workspaceId;
  const locale = isLocale(ctx.params.lang) ? ctx.params.lang : DEFAULT_LOCALE;
  ctx.progress(0, 3, "Reading the studio");

  // Where the digest LANDS is decided before it is written, so a model call is
  // never spent on a message with nowhere to go. The newest conversation is the
  // one the dock opens on; with none at all, a thread is minted here and named
  // from the digest's own first line — titles stay DERIVED, which is the store's
  // contract, rather than becoming the first typed title in the product.
  const existing = listThreads(workspaceId);
  const thread = existing[0] ?? createThread("", workspaceId);
  const openProposals = openProposalDigestView(workspaceId);

  ctx.progress(1, 3, "Writing the digest");
  const result = await runCompanionDigest(
    { workspaceId, threadId: thread.id, locale, openProposals },
    ctx.signal
  );

  ctx.progress(2, 3, "Filing it");
  const written = appendTurnWithProposals(
    {
      threadId: thread.id,
      role: "assistant",
      content: result.reply,
      meta: {
        source: result.source,
        digest: true,
        ...(result.blocks.length > 0 ? { blocks: result.blocks } : {}),
        // A digest is the one turn nobody asked for, which makes it the one most
        // likely to be listened to rather than read. It carries the same spoken
        // channel as every other reply.
        ...(result.voiceReply ? { voiceReply: result.voiceReply } : {}),
        ...(result.blockErrors > 0 ? { blockErrors: result.blockErrors } : {}),
        ...(result.actionErrors > 0 ? { actionErrors: result.actionErrors } : {}),
        // What it was LOOKING AT. The digest resolves nothing — marking the
        // proposals it was shown is the honest record of what it may be
        // referring to, and it is what lets a later reader tell a digest that
        // ignored the queue from one that summarized it.
        ...(openProposals.length > 0 ? { proposalsSeen: openProposals.map((p) => p.id) } : {}),
        recallUsed: result.recallUsed,
        episodePaths: result.episodePaths,
        indexSkipped: result.indexSkipped,
        ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
      },
      proposals: result.actions.map((action) => ({
        kind: action.actionId,
        payload: { actionId: action.actionId, params: action.params, summary: action.summary },
      })),
    },
    workspaceId
  );
  if (!written) throw new Error("The digest's conversation disappeared while it was being written.");
  if (!thread.title.trim()) renameThread(thread.id, deriveThreadTitle(result.reply), workspaceId);

  ctx.progress(3, 3, "Done");
  return {
    threadId: thread.id,
    turnId: written.turn.id,
    proposals: written.proposals.length,
    proposalsSeen: openProposals.length,
    source: result.source,
  };
}
