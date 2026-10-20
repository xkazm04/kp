/*
 * The condition vocabulary of a scene (pure; pinned by conditions.test.ts): the state of a thing that
 * can be set up and can fail (a channel, a relay, a feed, a service). Lifted from the Night Post.
 *
 *   live     working, WITH evidence (a sent row, a heartbeat), never "configured" alone
 *   wait     set up, nothing has happened yet
 *   reach    working in part (some of it answers)
 *   fail     failing now
 *   off      not set up
 *   unknown  not read: never a guess
 *
 * Meaning is carried by the kit Mark's SHAPE (marks.ts), colour second, words always beside it.
 */
import type { MarkKind } from "../types.ts";

export const CONDITIONS = ["live", "wait", "reach", "fail", "off", "unknown"] as const;
export type Condition = (typeof CONDITIONS)[number];

/** The mark each condition wears: dot lit, ring waiting, triangle caution, cross failing, dashed
 *  ring not set up / not read (the two differ in words, never in a guessed shape). */
export const CONDITION_MARK: Record<Condition, MarkKind> = {
  live: "ok",
  wait: "wait",
  reach: "caution",
  fail: "fail",
  off: "unknown",
  unknown: "unknown",
};

/** How bad a thing that needs a person is: `bad` breaks something now, `warn` degrades, `info` waits. */
export type NeedTone = "bad" | "warn" | "info";
export const NEED_TONE_CONDITION: Record<NeedTone, Condition> = { bad: "fail", warn: "reach", info: "wait" };
