"use client";

import { useTranslations } from "next-intl";
import type { DraftLintFinding } from "@/app/_lib/gigs/draft-lint";
import type { Gig, GigAttempt, GigKpi } from "@/app/_lib/gigs/types";
import { queueKindOf } from "../../logic/line";
import type { AfterWrite, SourceRow, SpecialistRow } from "../../logic/wire";
import { useGigsFormat } from "../../data/useGigsFormat";
import { Suspect, Triage } from "./BeforeDispatch";
import { Desk } from "./Desk";
import { RecordVerdict } from "./RecordVerdict";
import { Agent, OffLine } from "./WithAgent";

// The proof's sign-off (B/3's left column): what state the gig is in, and ONLY the moves
// that state allows, each through the real gigs door. For a draft it is the desk: the
// arena checklist as initials (keys 1-6), the disclosure sentence under its initial, the
// Approve gate that names its reason in its label, Send back with a note, Discard. For an
// approved draft: how to send it yourself, Open the listing, Mark sent (locked until the
// checklist is complete). A quarantined listing has no dispatch control at all - clear it
// (after saying you read it) or decline it. A sent one records the outside verdict. A
// listing nobody worked yet is dispatched or declined; work with an agent says so.
// Nothing here submits anywhere: the operator sends, kp records.
//
// The parts, one per state:
//   Desk.tsx            a drafted or approved draft (its initials, send-back fold and run
//                       facts in DeskParts.tsx)
//   BeforeDispatch.tsx  a quarantined listing (Suspect) and one nobody worked yet (Triage)
//   RecordVerdict.tsx   a sent one: record the outside verdict
//   WithAgent.tsx       in flight, sent back or failed (Agent), and the way off the line (OffLine)
//   useWrite.ts         the one write door every part goes through

export type DeskMemory = { ticks: Record<string, boolean>; seen: string[]; note: string; startedAt: number };
export type DeskStore = Map<string, DeskMemory>;

export function GigsSignoff({
  gig,
  attempt,
  source,
  specialist,
  kpi,
  now,
  findings,
  memory,
  setMemory,
  reviewNoteText,
  onChanged,
  onFlash,
  onDecline,
  onHire,
}: {
  gig: Gig;
  attempt: GigAttempt | null;
  source: SourceRow | null;
  specialist: SpecialistRow | null;
  kpi: GigKpi | null;
  now: Date;
  /** The pre-send lint's findings (the gate reads them). */
  findings: readonly DraftLintFinding[];
  memory: DeskMemory | null;
  setMemory: (update: (m: DeskMemory) => DeskMemory) => void;
  /** The reviewer's note without its header, offered as a revision note; null when none. */
  reviewNoteText: string | null;
  onChanged: AfterWrite;
  /** Say one sentence on the tab's status line, without a re-read. */
  onFlash: (message: string) => void;
  /** Decline through the proof, which lands on the next gig of the list. */
  onDecline: () => void;
  onHire: () => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const kind = queueKindOf(gig, attempt);
  const onDesk = attempt !== null && (attempt.status === "drafted" || attempt.status === "approved");

  const who =
    gig.status === "in_review"
      ? t("front.col.ready")
      : gig.status === "drafted"
        ? t("front.col.proof")
        : gig.status === "suspect"
          ? t("front.col.quar")
          : fmt.status(gig.status);
  const next = t(`signoff.next.${gig.status}`);

  return (
    <aside className="signoff" aria-label={t("signoff.label")}>
      <div className="so-state">
        <span className="caps dim">{t("signoff.title")}</span>
        <span className="who">{who}</span>
        <span className="t-meta">{next}</span>
      </div>
      {onDesk && memory ? (
        <Desk gig={gig} attempt={attempt} source={source} specialist={specialist} findings={findings} memory={memory} setMemory={setMemory} reviewNoteText={reviewNoteText} onChanged={onChanged} />
      ) : kind === "suspect" ? (
        <Suspect gig={gig} onChanged={onChanged} onDecline={onDecline} />
      ) : kind === "record" ? (
        <RecordVerdict gig={gig} attempt={attempt} source={source} specialist={specialist} kpi={kpi} now={now} onChanged={onChanged} onFlash={onFlash} />
      ) : kind === "triage" ? (
        <Triage gig={gig} source={source} specialist={specialist} kpi={kpi} onChanged={onChanged} onDecline={onDecline} onHire={onHire} />
      ) : kind === "running" || kind === "revision" || kind === "failed" ? (
        <Agent gig={gig} attempt={attempt} specialist={specialist} kind={kind} now={now} onChanged={onChanged} />
      ) : (
        <div>
          <p className="t-meta">{t("detail.needsNobody")}</p>
        </div>
      )}
      <OffLine gig={gig} declineOffered={kind === "suspect" || kind === "triage"} onChanged={onChanged} onDecline={onDecline} />
    </aside>
  );
}
