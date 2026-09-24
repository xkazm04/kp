"use client";

// The candidate portal's live half (spark ai-interview-parity).
//
// The agenda rail and the call card used to be two independent children of a server
// page: the rail painted the run-of-show once, at request time, and then never moved
// again — so a candidate eleven minutes into a directed interview was looking at the
// same flat list they saw before they pressed Start, with no way to tell what was
// done from what was coming. The director already knows (every exchange reports
// `activeBlockId` and `coveredBlockIds`); nothing carried it across.
//
// This component is that wire and nothing else. It owns two pieces of state, lifted
// exactly as far as the two children need and no further:
//
//   - the AGENDA the connect returned (the candidate projection: ids, kinds, titles,
//     budgets — never a competency or a question), which replaces the server's
//     run-of-show titles once the call is up;
//   - the director's AGENDA STATE, which the rail reads to tick and highlight.
//
// Before connect, and for any session with nothing grounded to direct, the rail
// renders exactly what it always did. The server still renders the page, the header
// and the disclosure; only this pair moved into the client tree.

import { useState } from "react";
import { AiDisclosure } from "@/app/_components/AiDisclosure";
import { PANEL } from "@/app/_components/ui/recipes";
import { VoiceInterviewClient } from "./VoiceInterviewClient";
import { InterviewSidebar } from "./InterviewSidebar";
import type { CandidateAgendaView, DirectorAgendaState } from "@/app/_lib/voice/director-types";
import type { RegimeId } from "@/app/_lib/compliance-regimes";
import type { VoiceProviderId } from "@/app/_lib/voice/types";

export type InterviewPortalClientProps = {
  token: string;
  candidateLabel?: string;
  jobTitle?: string;
  durationMin: number;
  provider: VoiceProviderId;
  /** The server-rendered run-of-show: what the rail shows until the call connects. */
  runOfShow: string[];
  /** AI-disclosure regime for the workspace that owns this session. */
  regimeId: RegimeId;
  retentionMonths: number;
  /** Whether this workspace offers an audio recording (WP3 owns what it then does). */
  recordingOffered: boolean;
  /** The candidate's durable /status link, for the closing card. */
  statusHref: string | null;
};

export function InterviewPortalClient({
  token,
  candidateLabel,
  jobTitle,
  durationMin,
  provider,
  runOfShow,
  regimeId,
  retentionMonths,
  recordingOffered,
  statusHref,
}: InterviewPortalClientProps) {
  const [agenda, setAgenda] = useState<CandidateAgendaView | null>(null);
  const [agendaState, setAgendaState] = useState<DirectorAgendaState>({ activeBlockId: null, coveredBlockIds: [] });

  return (
    // M1: on mobile the call card comes FIRST (order-1) so the candidate reaches Start
    // without scrolling past the whole agenda; the agenda drops below (order-2).
    // Desktop keeps the agenda on the left.
    <div className="mt-8 grid items-start gap-8 lg:grid-cols-[360px_minmax(0,1fr)]">
      <InterviewSidebar
        items={runOfShow}
        durationMin={durationMin}
        blocks={agenda?.blocks ?? null}
        activeBlockId={agendaState.activeBlockId}
        coveredBlockIds={agendaState.coveredBlockIds}
        className="order-2 lg:order-1 lg:sticky lg:top-10"
      />
      <div className="order-1 lg:order-2">
        {/* M2: the AI/human-review disclosure sits ABOVE the call card so the
            reassurance is visible before the Start decision. */}
        <AiDisclosure className="mb-6" regimeId={regimeId} retentionMonths={retentionMonths} />
        <div className={`${PANEL} p-5 sm:p-6`}>
          <VoiceInterviewClient
            token={token}
            candidateLabel={candidateLabel}
            jobTitle={jobTitle}
            durationMin={durationMin}
            provider={provider}
            lockSettings
            recordingOffered={recordingOffered}
            statusHref={statusHref}
            onAgenda={setAgenda}
            onAgendaState={setAgendaState}
          />
        </div>
      </div>
    </div>
  );
}
