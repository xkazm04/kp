// Studio kit — the domain-agnostic three-zone dialog desk (transcript · composer ·
// plane) that the recruiter Intake Studio and the job-seeker CV / fit dialogs share.
//
// WP0 fixed the PUBLIC SURFACE (names + prop types) so the two consumers could be
// built in parallel against it; WP1 replaced the stubs with the components
// extracted from app/features/library/jds/intake/coats/atelier/* without changing
// a prop name declared then — additions are optional props only. The rule from
// the design waves: variants are PROPS (plane, api, i18n namespace, storage key)
// — never coats, never a `variant` switch inside a component.
//
// Nothing in this directory may import from app/features/** — the kit is a
// primitive. It may import app/_components/**, app/_lib/** and packages/**.
//
// What a consumer owes the kit: the catalog keys in `STUDIO_KEYS` under its `ns`
// (useStudioTranslations.ts), a `storageKey` for its zone preference, an
// `autoSpeakStorageKey` for the read-aloud opt-in and a `draftKey` for the unsent
// draft — three keys because two studios on one browser must not share a
// preference.

import type { StudioChoiceSet, StudioReply, StudioTurn } from "@/app/_lib/jobseeker/types";

export type { StudioChoiceSet, StudioReply, StudioTurn };

/** The endpoint adapter a consumer hands the desk: one method, one abortable turn. */
export type StudioApi = {
  send(text: string, signal?: AbortSignal): Promise<StudioReply>;
};

export { StudioOverlay, useStudioOverlayClose, type StudioOverlayProps } from "./StudioOverlay";
export { StudioTranscript, type StudioTranscriptProps } from "./StudioTranscript";
export {
  StudioComposer,
  useStudioComposerDraft,
  useStudioComposerSlot,
  type StudioComposerProps,
  type StudioComposerDraftApi,
} from "./StudioComposer";
export { StudioChoiceCards, type StudioChoiceCardsProps } from "./StudioChoiceCards";
export { StudioVoiceBar, type StudioVoiceBarProps } from "./StudioVoiceBar";
export { StudioDesk, type StudioDeskProps, type StudioZones, type StudioZoneMeta } from "./StudioDesk";
export { StudioZone, STUDIO_EASE, STUDIO_SPRING } from "./StudioZone";
export { choiceMessage, toggleChoice } from "./choiceMessage";
export { readStoredZones, storeZones, toggleZone, zoneKeyGuard } from "./studioZones";
export { useStudioTranslations, STUDIO_KEYS, type StudioTranslator } from "./useStudioTranslations";
