/*
 * One message's truth (level 3, the letter): pure, pinned by channelsNightMessageModel.test.ts.
 *
 * The delivery timeline is built ONLY from fields the ledger row carries: `createdAt` (a row is
 * recorded AFTER the relay answered, app/_lib/comms.ts), `status`, `failureDetail`, `recovered` +
 * `recoveredAt`, `bounced` + `bouncedAt` + `bounceDetail`, `orphaned`. A step the record holds no
 * time for says so; nothing is derived, guessed or composed (the prototype's attempt ladder and its
 * "≈" times are not ported). `queued` is terminal (docs/features/comms/README.md §2): nothing hands
 * a queued row to a relay later, so its second step is blocked whether or not a relay exists now.
 */
import { commsVerdict, type CommsVerdict } from "@/app/_lib/comms-view.ts";
import type { Condition } from "@/app/_components/kit/scene/conditions.ts";
import type { Message } from "../../channelsCommsHelpers.ts";

export type StepKey =
  | "recorded" | "relayed" | "neverHanded" | "deadLettered" | "needsYou" | "resent" | "bounced" | "needsAddress"
  | "receiptArrived" | "unmatched";

/** done = on the record · pending = waiting on a person · blocked = cannot happen as things are. */
export type StepState = "done" | "pending" | "blocked";
export type StepTone = "ok" | "bad" | "wait" | "info" | "odd";

export type TimelineStep = {
  key: StepKey;
  state: StepState;
  tone: StepTone;
  /** The time on record, or null (the view says why: "not yet" / "cannot happen"). */
  at: string | null;
  /** A detail the RECORD carries (a failure reason, a bounce detail), never composed text. */
  detail: string | null;
  /** Which of the step's own words to use when the record has no detail (relay on / off). */
  variant?: "relayOff" | "relayOn";
};

const step = (key: StepKey, tone: StepTone, at: string | null, detail: string | null = null, state: StepState = "done"): TimelineStep => ({
  key, state, tone, at, detail,
});

/** The honest delivery timeline of one row. `relayConfigured` is the ledger's relay bit. */
export function deliveryTimeline(m: Message, relayConfigured: boolean): TimelineStep[] {
  const v = commsVerdict(m);
  const detail = m.failureDetail?.trim() || null;
  switch (v) {
    case "orphaned":
      return [step("receiptArrived", "info", m.createdAt), step("unmatched", "odd", null, null, "pending")];
    case "queued":
      return [
        step("recorded", "info", m.createdAt),
        { ...step("neverHanded", "bad", null, null, "blocked"), variant: relayConfigured ? "relayOn" : "relayOff" },
      ];
    case "sent":
      return [step("relayed", "ok", m.createdAt)];
    case "failed":
      return [step("deadLettered", "bad", m.createdAt, detail), step("needsYou", "bad", null, null, "pending")];
    case "recovered":
      return [step("deadLettered", "bad", m.createdAt, detail), step("resent", "ok", m.recoveredAt ?? null)];
    case "bounced":
      return [
        step("relayed", "ok", m.createdAt),
        step("bounced", "bad", m.bouncedAt ?? null, m.bounceDetail?.trim() || null),
        step("needsAddress", "bad", null, null, "pending"),
      ];
  }
}

/** The one honest line under a letter's verdict: which words, and how loud. */
export type MessageNote =
  | { key: "queuedNoRelay" | "queuedLater"; tone: "critical" | "caution" }
  | { key: "failed" | "bounced"; tone: "critical" }
  | { key: "orphaned"; tone: "caution" }
  | null;

export function messageNote(v: CommsVerdict, relayConfigured: boolean): MessageNote {
  if (v === "queued") return relayConfigured ? { key: "queuedLater", tone: "caution" } : { key: "queuedNoRelay", tone: "critical" };
  if (v === "failed" || v === "bounced") return { key: v, tone: "critical" };
  if (v === "orphaned") return { key: "orphaned", tone: "caution" };
  return null;
}

/** The letter's drawing: evidence of delivery is live, a letter that needs you is failing, an
 *  unmatched receipt is a partial answer, a queued one waits (the ledger's own mark for it; how
 *  loud "queued" is, is the note's job). */
export function letterCondition(v: CommsVerdict): Condition {
  if (v === "sent" || v === "recovered") return "live";
  if (v === "failed" || v === "bounced") return "fail";
  if (v === "orphaned") return "reach";
  return "wait";
}
