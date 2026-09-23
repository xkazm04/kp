// W1.1 — the inbound WRITER: mapped ATS applications onto the board, keyed on the
// vendor's own id.
//
// inbound.ts validates a vendor record, field-map.ts maps a vendor payload onto it, and
// links-store.ts holds the (provider, external id, workspace) → entry join. Until this
// module nothing wrote through any of them, so a customer with a connected ATS could not
// get a single application onto the board. This is that writer, and the ONLY one: the
// operator door (POST /api/ats/import) and any future connector sync call it.
//
// The contract, in the order it is applied:
//
//   1. THE CONNECTION DECIDES THE PROVIDER. It must exist and be enabled; its stored
//      field map is applied (the payload can never name another provider — `provider`
//      is not a mappable field). A missing or parked connection refuses the whole call.
//   2. THE JOB IS THE OPERATOR'S CHOICE, and must be visible to the importing team. The
//      vendor's own job id is kept nowhere: an import binds to a real kp opening.
//   3. EACH RECORD STANDS ALONE. A record the map cannot give an external id is
//      `invalid`; the rest of the batch still lands.
//   4. THE EXTERNAL ID IS THE SYNC IDENTITY. A linked record never reaches the filing
//      core again: a live entry answers `unchanged` and only the link's bookkeeping
//      (the vendor's stage word, the sync time) moves — kp owns its funnel, so a vendor
//      stage change is recorded, never applied. An ERASED entry answers `erased` and
//      nothing is written: ats_links outlives the scrub precisely so a re-sync cannot
//      refill the person (db/pipeline.ts, ERASURE_EXEMPT: ats_links).
//   5. A FIRST IMPORT IS FILED BY THE APPLICATION-FILING CORE (application-filing.ts),
//      not by a parallel path: tenant threading, name hygiene, identity before build,
//      consent and the entry id all come from there. Proof "channel" (an authenticated
//      operator import), a profile-less STUB (no Python spawns here), and NO
//      acknowledgement — the vendor already acknowledged this application. A record the
//      core recognises as an existing applicant of the same opening is bound to that
//      entry (`linked`) instead of duplicating them. The core cannot resolve a SCRUBBED
//      row (erasure NULLs its applicant_key and removes it from the identity lookup); the
//      guard below still stops a filing that lands on one before it writes, answering
//      `erased` with no link.
//   6. NEVER THE TERMINAL COLUMN. The vendor stage is mapped against the importing
//      team's own axis; a stage that maps to the terminal role, or to nothing, lands on
//      the entry column. Terminal is outcome-bearing and reachable only through kp's
//      own offer flow.
//
// Every free-text field the board or the link stores is cleaned by sanitizeFreeText
// (the display name inside the filing core, the stage word here).

import { getJob, jobVisibleToWorkspace } from "../db/jobs";
import { getPipelineEntry } from "../db/pipeline";
import type { PipelineEntry } from "../db/core";
import { getPipelineAxis } from "../pipeline-axis-server";
import { stageWithRole } from "../pipeline-stages";
import { fileApplication } from "../application-filing";
import { APPLY_EMAIL_RE } from "../apply-intake";
import { codedReasonDetail } from "../coded-reason";
import { sanitizeFreeText } from "../text-sanitize";
import { Refusal } from "../refusal";
import { getAtsConnection, isAtsProvider } from "./connections-store";
import { applyFieldMap, mapStage } from "./field-map";
import { AtsInboundError, type AtsInboundCandidate } from "./inbound";
import { findAtsLink, upsertAtsLink } from "./links-store";

/** The per-record verdicts, closed. `linked` = a first import the filing core bound to
 *  an applicant already on this opening (no second entry). */
export const ATS_IMPORT_OUTCOMES = ["created", "linked", "unchanged", "erased", "invalid"] as const;
export type AtsImportOutcome = (typeof ATS_IMPORT_OUTCOMES)[number];

export type AtsImportResult = {
  /** The vendor id, or null when the map could not read one (`invalid`). */
  externalId: string | null;
  outcome: AtsImportOutcome;
  /** The kp entry the vendor id is bound to; absent for `invalid` and `erased`. */
  entryId?: string;
};

export type AtsImportReport = {
  results: AtsImportResult[];
  counts: Record<AtsImportOutcome, number>;
};

export type AtsImportInput = {
  provider: string;
  /** The kp opening every record in the batch is filed onto. */
  jobId: string;
  /** The importing team — every entry and link is scoped to it. */
  workspaceId: string;
  records: readonly unknown[];
};

/** Thrown from inside the filing core's `onEntry` seam when it resolved a scrubbed row,
 *  BEFORE the repeat writes anything onto it (onEntry is the first thing a repeat runs). */
class ErasedEntry extends Error {
  constructor() {
    super("ats import resolved an anonymized entry");
    this.name = "ErasedEntry";
  }
}

// Per-(provider, external id, team) serialization within this process. The filing core
// awaits, and two overlapping imports of the same unseen vendor id would otherwise both
// miss the link and both file — the second one's entry then orphaned by upsertAtsLink's
// first-binding-wins rule. One process owns the SQLite file in a self-hosted install;
// a multi-process deployment still gets the filing core's dedupe key as the backstop.
const inFlight = new Map<string, Promise<unknown>>();
async function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prior = inFlight.get(key) ?? Promise.resolve();
  const run = prior.then(work, work);
  const settled = run.then(
    () => undefined,
    () => undefined
  );
  inFlight.set(key, settled);
  try {
    return await run;
  } finally {
    if (inFlight.get(key) === settled) inFlight.delete(key);
  }
}

const cleanStage = (raw: string | null): string | null => (raw ? sanitizeFreeText(raw).trim() || null : null);

const providerLabel = (provider: string): string => provider.charAt(0).toUpperCase() + provider.slice(1);

export async function ingestAtsApplications(input: AtsImportInput): Promise<AtsImportReport> {
  const { provider, jobId, workspaceId } = input;
  if (!isAtsProvider(provider)) {
    throw new Refusal("ATS_CONNECTION_PROVIDER_UNKNOWN", 400, { detail: `unknown provider "${provider}"` });
  }
  const connection = getAtsConnection(provider);
  if (!connection || !connection.enabled) {
    throw new Refusal("ATS_CONNECTION_NOT_FOUND", 404, {
      detail: connection ? `connection "${provider}" is disabled` : `no connection for "${provider}"`,
    });
  }
  const job = jobVisibleToWorkspace(jobId, workspaceId) ? getJob(jobId, workspaceId) : null;
  if (!job) {
    throw new Refusal("ATS_IMPORT_JOB_NOT_FOUND", 404, { detail: `job "${jobId}" is not visible to ${workspaceId}` });
  }

  const axis = getPipelineAxis(workspaceId).stages;
  const liveIds = axis.map((s) => s.id);
  const entryStage = stageWithRole("entry", axis) ?? liveIds[0] ?? "Accepted";
  const terminalStage = stageWithRole("terminal", axis);
  const channel = providerLabel(provider);

  const landingStage = (inbound: AtsInboundCandidate): string => {
    const mapped = mapStage(connection.fieldMap, cleanStage(inbound.externalStage), liveIds);
    return mapped && mapped !== terminalStage ? mapped : entryStage;
  };

  const one = async (inbound: AtsInboundCandidate): Promise<AtsImportResult> => {
    const { externalId } = inbound;
    const lastSeenStage = cleanStage(inbound.externalStage);
    const link = findAtsLink(provider, externalId, workspaceId);
    if (link) {
      const entry = getPipelineEntry(link.entryId, workspaceId);
      // A missing entry is treated like an erased one: the board no longer holds this
      // person, and an import must not be the thing that puts them back.
      if (!entry || entry.anonymizedAt) return { externalId, outcome: "erased" };
      upsertAtsLink({ provider, externalId, entryId: link.entryId, lastSeenStage }, workspaceId);
      return { externalId, outcome: "unchanged", entryId: link.entryId };
    }

    const guardErased = (entry: PipelineEntry) => {
      if (entry.anonymizedAt) throw new ErasedEntry();
    };
    let filed: Awaited<ReturnType<typeof fileApplication>>;
    try {
      filed = await fileApplication({
        job,
        workspaceId,
        // No name from the vendor: parseInboundCandidate falls back to the external id,
        // which is an identifier, not a name — file under the anonymous label instead.
        name: inbound.displayName === externalId ? "" : inbound.displayName,
        email: inbound.contact && APPLY_EMAIL_RE.test(inbound.contact) ? inbound.contact : null,
        locale: null,
        sourceChannel: `ats-${provider}`,
        channelLabel: channel,
        proof: "channel",
        stub: { idPrefix: "ats", reason: codedReasonDetail("atsImported", { channel }) },
        stage: landingStage(inbound),
        sendAck: false,
        onEntry: guardErased,
      });
    } catch (err) {
      if (err instanceof ErasedEntry) return { externalId, outcome: "erased" };
      throw err;
    }
    if (filed.entry.anonymizedAt) return { externalId, outcome: "erased" };
    upsertAtsLink({ provider, externalId, entryId: filed.entry.id, lastSeenStage }, workspaceId);
    return { externalId, outcome: filed.kind === "created" ? "created" : "linked", entryId: filed.entry.id };
  };

  const results: AtsImportResult[] = [];
  // Sequential on purpose: records of one batch can name the same person, and each one
  // must see the link the previous one wrote.
  for (const record of input.records) {
    let inbound: AtsInboundCandidate;
    try {
      inbound = applyFieldMap(connection.fieldMap, provider, record);
    } catch (err) {
      if (!(err instanceof AtsInboundError)) throw err;
      results.push({ externalId: null, outcome: "invalid" });
      continue;
    }
    results.push(await serialized(`${provider}\u0000${inbound.externalId}\u0000${workspaceId}`, () => one(inbound)));
  }

  const counts = Object.fromEntries(ATS_IMPORT_OUTCOMES.map((o) => [o, 0])) as Record<AtsImportOutcome, number>;
  for (const r of results) counts[r.outcome] += 1;
  return { results, counts };
}
