"use client";

// The module-view registry: ONE component per PanelKind. The record type makes a kind
// without a view (or a view for a kind the vocabulary does not have) a compile error —
// the renderer and the vocabulary the conductor composes from are one authority.
import type { ComponentType } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import type { PanelInstance, PanelKind } from "../types";
import { CalendarPanel } from "./CalendarPanel";
import { DecisionsQueuePanel } from "./DecisionsQueuePanel";
import { FunnelPanel } from "./FunnelPanel";
import { JobDraftsPanel } from "./JobDraftsPanel";
import { LetterPanel } from "./LetterPanel";
import { LettersPanel } from "./LettersPanel";
import { NeedsPanel } from "./NeedsPanel";
import { OutboxPanel } from "./OutboxPanel";
import { PipelineSlicePanel } from "./PipelineSlicePanel";
import { ProfilePanel } from "./ProfilePanel";
import { RoleCardPanel } from "./RoleCardPanel";
import { ScheduleAheadPanel } from "./ScheduleAheadPanel";
import type { PanelLook, PanelProps } from "./types";

export const PANEL_VIEWS: Record<PanelKind, ComponentType<PanelProps>> = {
  needs: NeedsPanel,
  pipelineSlice: PipelineSlicePanel,
  scheduleAhead: ScheduleAheadPanel,
  funnel: FunnelPanel,
  jobDrafts: JobDraftsPanel,
  outbox: OutboxPanel,
  decisionsQueue: DecisionsQueuePanel,
  roleCard: RoleCardPanel,
  letters: LettersPanel,
  calendar: CalendarPanel,
  profile: ProfilePanel,
  letter: LetterPanel,
};

/** The host's own controls on every view: pin / unpin, bring forward, close. They are the
 *  user's hand — pressing one supersedes a pending reply (engine/session.ts). */
export function PanelChrome({
  panel,
  focused,
  onPin,
  onUnpin,
  onFocus,
  onClose,
}: {
  panel: PanelInstance;
  focused: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onFocus: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("one.core.panels");
  return (
    <>
      {focused ? null : <Button label={t("focus")} icon="up" iconOnly variant="ghost" size="sm" onClick={onFocus} />}
      <Button
        label={panel.pinned ? t("unpin") : t("pin")}
        variant="ghost"
        size="sm"
        aria-pressed={panel.pinned}
        onClick={panel.pinned ? onUnpin : onPin}
      />
      <Button label={t("close")} icon="x" iconOnly variant="ghost" size="sm" onClick={onClose} />
    </>
  );
}

export type { PanelLook, PanelProps };
