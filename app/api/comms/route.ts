import { NextRequest, NextResponse } from "next/server";
import { listOutboxFiltered } from "@/app/_lib/db/devcase";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { coerceOutboxStatus } from "@/app/_lib/comms-status";
import { isRelayConfigured } from "@/app/_lib/comms-relay";
import { deriveCommsView, pageCommsFeed } from "@/app/_lib/comms-view";
import { safeJsonError } from "@/app/_lib/api-response";


// W6-2 (SIM1) — the recruiter comms read. Every candidate-facing message (8
// kinds) lands in dev_outbox with ref = pipeline entry id, but the only UI was
// the Dev tab's display-only table: "what did this candidate actually receive?"
// and "did anything fail to send?" needed server logs. This serves the Comms
// Center on Channels and the drawer's Messages section.
// ?entry=<id> scopes to one candidate; ?status=failed is the dead-letter view.
/** The widest slice of the ledger one read may derive over — and the store's own
 *  ceiling (`listOutboxFiltered` clamps its limit to 500). Supersession is computed
 *  across the WHOLE slice, so it has to be wider than a page. */
const DERIVE_WINDOW = 500;
/** Rows returned when the caller names no `?limit=`. */
const DEFAULT_PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  try {
    const entry = request.nextUrl.searchParams.get("entry")?.trim() || undefined;
    const statusRaw = request.nextUrl.searchParams.get("status")?.trim();
    const status = statusRaw ? coerceOutboxStatus(statusRaw) : undefined;
    // Paging (comms-view.pageCommsFeed): a cursor, not an offset — the ledger is
    // append-only and newest-first, so an offset re-shows or skips rows as messages
    // arrive between two reads.
    const limitRaw = Number(request.nextUrl.searchParams.get("limit"));
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), DERIVE_WINDOW) : DEFAULT_PAGE_SIZE;
    const cursor = request.nextUrl.searchParams.get("cursor")?.trim() || null;
    // The derived delivery view (comms-view.ts) is computed over the UNFILTERED
    // window so a ?status=failed read still sees the sibling that recovered a
    // dead-letter, and a `bounced` receipt still supersedes its sent row. Resend
    // and async bounce reporting are append-only by design (the original row stays
    // as audit); `recovered`/`bounced`/`deliverable` are the derived bits the Comms
    // Center needs. Bounce receipt rows are folded onto their sent row in there.
    const ws = await currentWorkspace();
    const base = listOutboxFiltered({ ref: entry, limit: DERIVE_WINDOW }, ws);
    // TRUNCATED means "there are older rows this read did not see". It is handed to
    // the derivation because `orphaned` is an ACCUSATION — "the relay reported a
    // bounce for something we never sent" — and a send that merely scrolled out of
    // the window is not that. The fixed 200-row window used to make every bounce on
    // an older message look like an integration fault.
    const truncated = base.length >= DERIVE_WINDOW;
    const view = deriveCommsView(base, { windowTruncated: truncated });
    const filtered = status ? view.filter((m) => m.status === status) : view;
    const { messages, hasMore, nextCursor, cursorExpired } = pageCommsFeed(filtered, { limit, cursor });

    // Resolve each distinct ref to the candidate it names, so the center can
    // group/label rows without N client round-trips. Refs that aren't pipeline
    // entries (e.g. dev-case submission ids) resolve to null and render raw.
    const entries: Record<string, { label: string; jobTitle: string | null }> = {};
    for (const m of messages) {
      if (!m.ref || entries[m.ref] !== undefined) continue;
      const e = getPipelineEntry(m.ref, ws);
      if (e) entries[m.ref] = { label: e.candidateLabel, jobTitle: e.jobTitle };
    }
    // relayConfigured = is a real delivery relay wired? When false, every message
    // is recorded `queued` in the local outbox and NOTHING reaches candidates — the
    // Comms Center must warn loudly rather than show benign queued badges.
    return NextResponse.json({
      messages,
      entries,
      relayConfigured: isRelayConfigured(),
      // The page contract. `truncated` is about the LEDGER (older rows exist beyond
      // the derivation window and no cursor reaches them); `hasMore`/`nextCursor` are
      // about this read (more rows inside it). They are separate facts and a client
      // that conflates them either stops early or pages forever.
      hasMore,
      nextCursor,
      cursorExpired,
      truncated,
      limit,
    });
  } catch (error) {
    return safeJsonError(error, "api:comms", "OUTREACH_FAILED");
  }
}
