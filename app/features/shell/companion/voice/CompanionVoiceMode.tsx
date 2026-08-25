"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import type { ChatBlockLabels } from "@/app/_components/chat/chatBlockTypes";
import { railIconBtn } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { AttentionCounts } from "@/app/features/shell/useAttention";
import { CompanionSettingsMenu } from "../CompanionSettingsMenu";
import type { CompanionVoiceVariant } from "../companionPrefs";
import type { CompanionSpeech } from "../useCompanionSpeech";
import type { CompanionThreadState } from "../useCompanionThread";
import type { CompanionPrefsState } from "../useCompanionPrefs";
import { CompanionVoiceHud } from "./CompanionVoiceHud";
import { CompanionVoiceStage } from "./CompanionVoiceStage";
import { CompanionVoiceTicker } from "./CompanionVoiceTicker";
import { VoiceInputBar } from "./VoiceInputBar";
import { useVoiceHistory } from "./useVoiceHistory";
import type { VoiceVariantProps } from "./voiceTypes";

/*
 * VOICE MODE (round V2) — the top/bottom pair.
 *
 * The dock puts a conversation in a column beside the work. This puts it around
 * the work: her last answer pinned to the top edge, a slim bar pinned to the
 * bottom, and the whole middle of the display left alone. It is the shape you
 * want when the conversation is something you LISTEN to while working, and the
 * shape that makes "what did she say three answers ago" a countable step rather
 * than a scroll through a column you can no longer see.
 *
 * PRESENTATION ONLY. Same provider, same open/close, same `useCompanionThread`,
 * same routes, same proposals. The host receives the thread and the speech seam
 * from `CompanionDock` rather than making its own, which is what lets an
 * operator flip modes mid-conversation without dropping a turn — and what makes
 * auto-speak one behaviour rather than one per shape.
 *
 * GEOMETRY. Both halves are fixed and both sit on `--z-sim-drawer`, the dock's
 * own layer: above the sidebar, below the Modal, because a dialog the operator
 * opened is always the more recent intent. The bottom bar clears the live
 * control bar the same way every other floating surface does
 * (`--sim-bar-h`). Nothing traps focus and nothing is inert — the page behind is
 * the entire reason this mode exists.
 *
 * KEYBOARD. The top window is one focus stop (`tabIndex=0`, a labelled region);
 * Left and Right walk her answers from there. Bound to the region rather than
 * the document on purpose: a global arrow handler would steal the keys from the
 * page this mode is deliberately leaving usable.
 *
 * THE DIRECTION SWITCHER IS SCAFFOLD. Three directions ride behind it for this
 * round only (`prefs.variant`, persisted so a reload does not lose the
 * comparison). When one wins, this rail, the two losing files and the `variant`
 * field all go; the winner keeps every prop it already has, because all three
 * render against one contract (voiceTypes.ts).
 */

const VARIANTS: Record<CompanionVoiceVariant, (props: VoiceVariantProps) => React.ReactNode> = {
  ticker: CompanionVoiceTicker,
  stage: CompanionVoiceStage,
  hud: CompanionVoiceHud,
};

export function CompanionVoiceMode({
  thread,
  speech,
  attention,
  prefs,
  onClose,
}: {
  thread: CompanionThreadState;
  speech: CompanionSpeech;
  attention: AttentionCounts | null;
  prefs: CompanionPrefsState;
  onClose: () => void;
}) {
  const t = useTranslations("companion");
  const resolveError = useErrorMessage();
  const history = useVoiceHistory(thread.turns);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const proposalById = useMemo(
    () => new Map(thread.proposals.map((proposal) => [proposal.id, proposal])),
    [thread.proposals]
  );
  const blockLabels = useMemo<ChatBlockLabels>(
    () => ({ table: t("blocks.table"), chart: t("blocks.chart"), emptyCell: t("blocks.emptyCell") }),
    [t]
  );
  const error = thread.error ? resolveError({ code: thread.error }, t("chat.errorGeneric")) : null;

  const Variant = VARIANTS[prefs.variant];

  // The window's own controls. They ride into the variant as a slot so each
  // direction can put them where its metaphor puts them — the settings gear is
  // the SAME component the dock header mounts, so there is one companion
  // settings panel and not one per shape.
  const chrome = (
    <div className="flex shrink-0 items-center gap-0.5">
      <CompanionSettingsMenu prefs={prefs} open={settingsOpen} onOpenChange={setSettingsOpen} side="bottom" align="end" />
      <button type="button" onClick={onClose} aria-label={t("voiceMode.close")} title={t("voiceMode.close")} className={railIconBtn(false)}>
        <X size={18} aria-hidden />
      </button>
    </div>
  );

  return (
    <>
      <section
        aria-label={t("voiceMode.label")}
        tabIndex={0}
        onKeyDown={history.onKeyDown}
        className="focus-ring animate-slide-in motion-reduce:animate-none fixed inset-x-3 top-3 z-[var(--z-sim-drawer)] rounded-xl"
      >
        <VariantRail value={prefs.variant} onChange={prefs.setVariant} />
        <Variant
          history={history}
          speech={speech}
          busy={thread.busy}
          error={error}
          proposalById={proposalById}
          onResolveProposal={thread.resolveProposal}
          blockLabels={blockLabels}
          attention={attention}
          chrome={chrome}
        />
      </section>

      <div className="fixed inset-x-3 bottom-[calc(var(--sim-bar-h)_+_8px)] z-[var(--z-sim-drawer)]">
        <VoiceInputBar
          onSend={thread.send}
          // `ready` matters as much as `busy` here: the bar is on screen before
          // the thread has booted, and a message sent into no thread resolves
          // false and silently restores itself, which reads as the app ignoring
          // you. Disabled until there is somewhere to send it.
          busy={thread.busy || !thread.ready}
          className="mx-auto w-full max-w-[44rem]"
        />
      </div>
    </>
  );
}

/**
 * PROTOTYPE SCAFFOLD — delete with the round.
 *
 * A right-aligned pill above the window, not a band across it, so it costs the
 * calm direction as little height as a switcher can. It is deliberately not
 * styled to belong: this rail is the one thing on screen that is not part of any
 * of the three designs being judged.
 */
function VariantRail({
  value,
  onChange,
}: {
  value: CompanionVoiceVariant;
  onChange: (next: CompanionVoiceVariant) => void;
}) {
  const t = useTranslations("companion");
  const options: ReadonlyArray<{ value: CompanionVoiceVariant; label: string }> = [
    { value: "ticker", label: t("voiceMode.variantTicker") },
    { value: "stage", label: t("voiceMode.variantStage") },
    { value: "hud", label: t("voiceMode.variantHud") },
  ];
  return (
    <div className="mb-1.5 flex items-center justify-end gap-2">
      <span className="text-meta uppercase text-steel">{t("voiceMode.variant")}</span>
      <SegmentedControl
        label={t("voiceMode.variant")}
        options={options}
        value={value}
        onChange={onChange}
        className="flex items-center gap-1 rounded-md bg-paper/90 p-0.5 backdrop-blur"
      />
    </div>
  );
}
