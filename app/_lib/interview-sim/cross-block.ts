// The CROSS-BLOCK COVER MEASUREMENT (spark interview-uat-tranche, WP-2) — a number a
// future rule decision needs, NOT an invariant: it never fails a conversation.
//
// WHY IT EXISTS. The director accepts a `mark_topic_covered` quote when it matches ANY
// persisted candidate turn of the session. An earlier fix required the quote to come
// from a turn recorded while the SAME block was active; live re-runs showed the
// interviewer routinely asks block X's question BEFORE it calls begin_topic(X), so the
// answer is recorded under the previous block (or under none), the stricter rule refused
// true evidence (coverage 6/6 → 2/6), and it was withdrawn (docs/features/interviews/
// README.md, "Known gaps"). Nothing in the record said how often each case happens. This
// does:
//
//   same_block    the quoted answer was recorded while block X was active;
//   late_begin    it was recorded under another block (or none), but the interviewer
//                 question that prompted it WAS about X's topic — X's question asked before
//                 begin_topic(X): a begins_blocks-class lapse, and the evidence is sound;
//   cross_topic   it was an answer to a DIFFERENT topic, taken as evidence for X — the case
//                 a stricter rule would target;
//   unclassified  cross-block, and nobody judged which (keyless, or the judge's fact did
//                 not verify).
//
// The block a turn was recorded under is the director's own tag on its `turn` event
// (director-loop.ts: "tagged with the block active before this exchange"); the quote is
// matched with the SAME matcher and options the director used to accept it.

import { matchQuoteToTurn } from "../quote-match";
import { EVIDENCE_QUOTE_MATCH } from "../voice/director";
import type { SimConversationDump } from "./engine";
import type { JudgedFact } from "./detectors";
import { readRecord } from "./record";

export const CROSS_BLOCK_CLASSES = ["same_block", "late_begin", "cross_topic", "unclassified"] as const;
export type CrossBlockClass = (typeof CROSS_BLOCK_CLASSES)[number];

export type CrossBlockRecord = {
  /** The block the cover was accepted for (X). */
  blockId: string;
  /** The tool turn that covered it. */
  coverSeq: number;
  quote: string;
  /** The candidate turn the quote matched (null when the join failed). */
  candidateSeq: number | null;
  /** The block active when that candidate turn was recorded (null = none was). */
  recordedUnder: string | null;
  /** The last interviewer turn before that candidate turn — the question that prompted it. */
  promptSeq: number | null;
  /** The judge fact that classifies a cross-block cover (null for same_block). */
  factId: string | null;
  class: CrossBlockClass;
};

/** The judge fact id for one cross-block cover. */
export function crossBlockFactId(blockId: string, candidateSeq: number | null, coverSeq: number): string {
  return `crossblock.${blockId}.${candidateSeq ?? `cover${coverSeq}`}`;
}

/** Every accepted cover of one conversation, classified. `facts` (verified judge facts)
 *  turn a cross-block cover into late_begin (true) or cross_topic (false). */
export function measureCrossBlock(dump: SimConversationDump, facts?: ReadonlyMap<string, JudgedFact> | null): CrossBlockRecord[] {
  const rec = readRecord(dump);
  const out: CrossBlockRecord[] = [];
  let candidateSoFar = 0;
  for (const e of rec.events) {
    if (e.kind === "turn" && e.payload?.role === "candidate") {
      candidateSoFar += 1;
      continue;
    }
    if (e.kind !== "topic_covered" || !e.blockId) continue;
    const quote = typeof e.payload?.quote === "string" ? e.payload.quote : "";
    const before = rec.candidateEvents.slice(0, candidateSoFar);
    const texts = before.map((c) => (typeof c.event.payload?.text === "string" ? c.event.payload.text : ""));
    const idx = matchQuoteToTurn(quote, texts, EVIDENCE_QUOTE_MATCH);
    const tool = rec.tools.find((t) => t.events.includes(e));
    const coverSeq = tool?.seq ?? -1;
    if (idx < 0) {
      out.push({ blockId: e.blockId, coverSeq, quote, candidateSeq: null, recordedUnder: null, promptSeq: null, factId: null, class: "unclassified" });
      continue;
    }
    const matched = before[idx];
    const candidateSeq = matched.turn?.seq ?? null;
    const recordedUnder = matched.event.blockId ?? null;
    const prompt = candidateSeq === null ? null : ([...rec.spoken].reverse().find((t) => t.seq < candidateSeq) ?? null);
    if (recordedUnder === e.blockId) {
      out.push({ blockId: e.blockId, coverSeq, quote, candidateSeq, recordedUnder, promptSeq: prompt?.seq ?? null, factId: null, class: "same_block" });
      continue;
    }
    const factId = crossBlockFactId(e.blockId, candidateSeq, coverSeq);
    const f = facts?.get(factId);
    const cls: CrossBlockClass = f?.value === true ? "late_begin" : f?.value === false ? "cross_topic" : "unclassified";
    out.push({ blockId: e.blockId, coverSeq, quote, candidateSeq, recordedUnder, promptSeq: prompt?.seq ?? null, factId, class: cls });
  }
  return out;
}

export type CrossBlockCounts = Record<CrossBlockClass, number>;

export function countCrossBlock(records: readonly CrossBlockRecord[]): CrossBlockCounts {
  const counts: CrossBlockCounts = { same_block: 0, late_begin: 0, cross_topic: 0, unclassified: 0 };
  for (const r of records) counts[r.class] += 1;
  return counts;
}
