"use client";

// The two tokenized candidate links — the voice first-round screen and
// self-scheduling — and revoking every live one. The shared POST/url/copy plumbing
// is useTokenLink; only the endpoint and the panel around it differ.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { stageHasRole, type StageDef } from "@/app/_lib/pipeline-stages";
import { useTokenLink } from "../../PipelineTokenLink";

export function useCandidateLinks({
  entry,
  axis,
}: {
  entry: { id: string; stage: string; status: string };
  axis: readonly StageDef[];
}) {
  const t = useTranslations("pipeline.drawer");
  const [voiceProvider, setVoiceProvider] = useState<"openai" | "elevenlabs">("openai");
  const voice = useTokenLink("/api/interview/create");
  const sched = useTokenLink("/api/schedule/invite");
  const [revokeNote, setRevokeNote] = useState<string | null>(null);

  // W6-4 — pull every live link for this candidate without minting a replacement.
  const revokeLinks = async () => {
    setRevokeNote(null);
    try {
      const r = await fetch("/api/interview/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id }),
      });
      const p = (await r.json().catch(() => null)) as { revoked?: number } | null;
      if (!r.ok) throw new Error();
      setRevokeNote(t("linksRevoked", { count: p?.revoked ?? 0 }));
    } catch {
      setRevokeNote(t("revokeFailed"));
    }
  };

  // Both panels share one gate: an active candidate on a screening or interview
  // column. By ROLE on this workspace's axis — the gate used to be the literal names
  // "Screened" / "Interview", so a renamed column or a second interview round
  // ("Onsite") silently lost both links.
  const showLinks =
    entry.status === "active" &&
    (stageHasRole(entry.stage, "screening", axis) || stageHasRole(entry.stage, "interview", axis));

  return { voiceProvider, setVoiceProvider, voice, sched, revokeNote, revokeLinks, showLinks };
}
