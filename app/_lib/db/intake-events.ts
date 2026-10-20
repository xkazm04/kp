// The history of a role-intake conversation — the ONE new write in Journey Analytics.
//
// WHY THIS TABLE EXISTS AT ALL. The rest of the board is a PROJECTION over five
// append-only logs that already exist (`pipeline_events`, `decision_records`,
// `interview_events`, `dev_session_events`, `consent_events`). Phase A of the lifecycle
// — the conversation that DEFINES a role — has none: `role_intakes.transcript_json` is a
// JSON array rewritten WHOLE on every exchange (`updateIntakeDialog`, db/intakes.ts), and
// a rewritten row can only tell you when it was last touched. "When did this team decide
// the band was 120k?" is unanswerable from it. So the rounds get a ledger, and only the
// rounds.
//
// APPEND-ONLY, AND THAT IS STRUCTURAL. There is no UPDATE statement in this file and
// there must never be one: the row is the record that a round happened and what it was
// about, and a ledger whose past can be edited proves nothing. Two consequences worth
// stating because they look like limitations until you see the reason:
//   • a round's topic is classified BEFORE the row is written, never corrected after
//     (see the background runner in late-bound-boot.ts);
//   • the only DELETE is `eraseIntakeEvents` — the erasure door below.
//
// ONE WRITER. `recordIntakeEvent` is the only function that inserts, which is the
// registry's `audit-logging/write-chokepoint`: audit INSERTs sprinkled across routes is
// precisely how a ledger acquires rows nobody can account for. A route calls this; it
// never touches the table. (The boot BACKFILL in db/core.ts is the one documented
// exception, for the same reason `seedBenchmarkTeam` is: it runs inside ensureDb's
// initializer, before the connection is memoized, so calling into anything that reaches
// `ensureDb()` would re-enter the whole initializer.)
//
// TWO CLOCKS, NEVER COLLAPSED. `occurred_at` is the turn's OWN `at` — when the exchange
// happened — and `recorded_at` is when kp wrote the row. For a live round they are
// milliseconds apart; for a round recovered from a transcript written weeks ago they are
// weeks apart, and a report over "what happened in August" must stay reproducible
// whichever one it is. Registry: `audit-logging/two-clock-records`.
//
// Tenancy: `intake_events` is workspace-scoped with NO by-id exemption, exactly like the
// `role_intakes` rows it describes — the dialog is operator-internal, has no public
// token, and holds a requestor's own words. Every statement below binds workspace_id and
// intake-events-tenancy.test.ts fails on one that does not.

import { ensureDb, safeRowParse } from "./core";
import { isJourneyTopicCode, type JourneyFactValue, type JourneyTopicCode } from "../journey/types";

/**
 * The kinds this ledger writes. Prefixed `intake_` per the journey contract's rule that
 * kinds introduced by that module carry the prefix while kinds lifted from an existing
 * log keep their original spelling. Each has its catalog key in `journey.events.*` and
 * its entry in render-keys.ts.
 */
export const INTAKE_EVENT_KINDS = ["intake_round", "intake_brief_changed", "intake_promoted"] as const;
export type IntakeEventKind = (typeof INTAKE_EVENT_KINDS)[number];

const KINDS = new Set<string>(INTAKE_EVENT_KINDS);
export function isIntakeEventKind(v: unknown): v is IntakeEventKind {
  return typeof v === "string" && KINDS.has(v);
}

/**
 * One row, in the journey contract's own shape so the projector (P3) can lift it without
 * a second normalization: an absent optional field is OMITTED rather than null, and
 * `actor` is the single deliberate `string | null` because a null there is the FACT "kp
 * does not know who did this". See the absent-value convention in journey/types.ts.
 */
export type IntakeEventRow = {
  /** The table's own AUTOINCREMENT id — the stable half of the projected event id. */
  id: number;
  intakeId: string;
  workspaceId: string;
  /** Monotonic per `intake_id`, derived inside the insert. 1-based. */
  seq: number;
  kind: string;
  /** Omitted when the classifier placed nothing — a legitimate row, not a failure. */
  topicCode?: JourneyTopicCode;
  facts: Record<string, JourneyFactValue>;
  /** The turn's own `at`. */
  occurredAt: string;
  /** When kp wrote this row. */
  recordedAt: string;
  actor: string | null;
};

type IntakeEventDbRow = {
  id: number;
  intake_id: string;
  workspace_id: string;
  seq: number;
  kind: string;
  topic_code: string | null;
  facts_json: string | null;
  occurred_at: string;
  recorded_at: string;
  actor: string | null;
};

/** Bound so one malformed caller cannot grow the ledger without limit. Facts are a
 *  handful of short named values by contract (types.ts: never pre-composed prose), so
 *  this is a guard rail, not a working size. */
const MAX_FACTS_CHARS = 4_000;

/** How much of a round's text rides on its history row. The ledger is NOT a second
 *  transcript — the transcript is still the transcript — it carries enough for the board
 *  to show what was asked and what came back.
 *
 *  Exported so the route and the late-bound runner bound the same way from one number.
 *  db/core.ts's boot backfill cannot import it (core.ts is on every route's static graph
 *  and this module imports core.ts back), so it restates the literal with this constant
 *  named in the comment beside it — the one place the value is deliberately copied. */
export const INTAKE_ROUND_FACT_CHARS = 600;

function factsColumn(facts: Record<string, JourneyFactValue> | undefined): string | null {
  if (!facts) return null;
  const keys = Object.keys(facts);
  if (keys.length === 0) return null;
  try {
    const json = JSON.stringify(facts);
    return json.length > MAX_FACTS_CHARS ? null : json;
  } catch {
    /* best-effort: a facts object that will not serialize (a cycle, a BigInt) must not
       cost the round its history row — the kind and the two clocks are the record, and
       the row renders through its kind with no arguments. */
    return null;
  }
}

function fromRow(row: IntakeEventDbRow): IntakeEventRow {
  const facts = safeRowParse<Record<string, JourneyFactValue>>(row.facts_json, "intakeEvent.facts", String(row.id));
  return {
    id: row.id,
    intakeId: row.intake_id,
    workspaceId: row.workspace_id,
    seq: row.seq,
    kind: row.kind,
    // A code the vocabulary no longer contains is DROPPED rather than carried: the
    // renderer would resolve `journey.topics.<gone>` to nothing and the row would paint
    // blank, where falling back to the kind paints an honest sentence.
    ...(isJourneyTopicCode(row.topic_code) ? { topicCode: row.topic_code } : {}),
    facts: facts && typeof facts === "object" && !Array.isArray(facts) ? facts : {},
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    actor: row.actor,
  };
}

export type RecordIntakeEventInput = {
  intakeId: string;
  /** REQUIRED, never defaulted to the deployment's workspace: a defaulted tenant is the
   *  exact shape route-tenancy-coverage.test.ts exists to catch, and an audit row filed
   *  under the wrong team is worse than no audit row. */
  workspaceId: string;
  kind: IntakeEventKind;
  /** The turn's own `at`. The caller reads it off the transcript element; it is NOT
   *  defaulted to now, because "we do not know when this happened" and "it happened at
   *  the moment we wrote it down" are different claims. */
  occurredAt: string;
  /** Already classified (intake-topics.ts) — this table has no UPDATE path to add one
   *  later. `null` / omitted writes NULL, which is a legitimate row. */
  topicCode?: JourneyTopicCode | null;
  facts?: Record<string, JourneyFactValue>;
  /** `null` = kp genuinely does not know who did this. Omitting it means the same. */
  actor?: string | null;
};

/**
 * Append one row. THE ONLY WRITER.
 *
 * `seq` is derived from `MAX(seq) + 1` INSIDE the statement, so the read and the write
 * are one operation under one write lock rather than a read→compute→write straddling the
 * event loop. Wrapped in `.immediate()` on top of that: the repo's rule is that a
 * read→compute→write either locks at BEGIN or re-asserts in its WHERE, and taking the
 * write lock up front is the cheaper of the two here (there is no row to re-assert on —
 * the row does not exist yet). No `await` appears anywhere in this function; the
 * classification that produced `topicCode` happened before the call, off the request
 * path (late-bound-boot.ts).
 *
 * Best-effort by design at its ONE call site (the dialog route): the ledger is history,
 * never the requestor's reply. A caller that must know whether the row landed reads back
 * through `listIntakeEvents`.
 */
export function recordIntakeEvent(input: RecordIntakeEventInput): void {
  const d = ensureDb();
  const topic = isJourneyTopicCode(input.topicCode) ? input.topicCode : null;
  const run = d.transaction((): void => {
    d.prepare(
      `INSERT INTO intake_events (intake_id, workspace_id, seq, kind, topic_code, facts_json, occurred_at, recorded_at, actor)
       SELECT ?, ?, COALESCE((SELECT MAX(e.seq) FROM intake_events e WHERE e.intake_id = ? AND e.workspace_id = ?), 0) + 1,
              ?, ?, ?, ?, ?, ?`
    ).run(
      input.intakeId,
      input.workspaceId,
      input.intakeId,
      input.workspaceId,
      input.kind,
      topic,
      factsColumn(input.facts),
      input.occurredAt,
      new Date().toISOString(),
      input.actor ?? null
    );
  });
  run.immediate();
}

/** One intake's history, oldest first. `seq` rather than `occurred_at` is the order: two
 *  turns of the same exchange carry the SAME `at` (the route stamps one `now` for both),
 *  so a timestamp sort would shuffle question and answer. */
export function listIntakeEvents(intakeId: string, workspaceId: string): IntakeEventRow[] {
  const rows = ensureDb()
    .prepare(
      `SELECT * FROM intake_events WHERE intake_id = ? AND workspace_id = ? ORDER BY seq ASC`
    )
    .all(intakeId, workspaceId) as IntakeEventDbRow[];
  return rows.map(fromRow);
}

/** How many rows this intake has. Cheaper than listing when a caller only needs to know
 *  whether the history exists at all. */
export function countIntakeEvents(intakeId: string, workspaceId: string): number {
  const row = ensureDb()
    .prepare(`SELECT COUNT(*) AS n FROM intake_events WHERE intake_id = ? AND workspace_id = ?`)
    .get(intakeId, workspaceId) as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * THE ERASURE DOOR — and the only DELETE this table has.
 *
 * WHICH erasure. kp's candidate erasure is ENTRY-keyed (`scrubEntryLinkedPii`,
 * db/pipeline.ts) and cannot reach here: an intake round is written before any candidate
 * exists and is keyed to an intake, not to a pipeline entry. `role_intakes` itself is
 * listed in ERASURE_EXEMPT for exactly that reason ("operator text about a ROLE"), and
 * these rows are a projection of the same text, so they inherit the same classification.
 *
 * That is NOT the same as saying nobody can ask for them back. The text is a hiring
 * requestor's own words — a named employee under their employer's controller
 * relationship — so the door exists now rather than after somebody asks: deleting an
 * intake's history is one call, it is by `intake_id` bound to the tenant, and it leaves
 * nothing behind. Returns the number of rows removed so a caller can report honestly
 * rather than claim a deletion it did not perform.
 */
export function eraseIntakeEvents(intakeId: string, workspaceId: string): number {
  const res = ensureDb()
    .prepare(`DELETE FROM intake_events WHERE intake_id = ? AND workspace_id = ?`)
    .run(intakeId, workspaceId);
  return res.changes;
}
