/*
 * The feature-spotlight registry.
 *
 * Nine product mockups, one module each, wired to the key their card uses on
 * the landing grid. This was a single 615-line file; the split is what made the
 * i18n migration tractable, because each preview's copy could move into
 * `landing.previews.<key>.*` alongside the component that renders it.
 *
 * Title + closing note come from the catalog (`features.<key>.title` /
 * `previews.<key>.note`); this registry only pairs a key with its icon and
 * animated body.
 */
import { Check, FileSearch, FileSignature, FlaskConical, Gauge, History, Inbox, Mic, ShieldCheck } from "lucide-react";
import type { ComponentType } from "react";
import ScorePreview from "./ScorePreview";
import VoicePreview from "./VoicePreview";
import CasesPreview from "./CasesPreview";
import SchedulePreview from "./SchedulePreview";
import InboxPreview from "./InboxPreview";
import SalaryPreview from "./SalaryPreview";
import RediscoverPreview from "./RediscoverPreview";
import OfferPreview from "./OfferPreview";
import GatesPreview from "./GatesPreview";

// The grid is the app's shop window, so it has to keep pace with the app.
// `cases`, `offer` and `rediscover` were shipped features with no card — and
// `cases` in particular is the one capability no competitor has. Nine keys also
// squares the lg:grid-cols-3 layout.
export type PreviewKey =
  | "score"
  | "voice"
  | "cases"
  | "schedule"
  | "inbox"
  | "salary"
  | "rediscover"
  | "offer"
  | "gates";

export type PreviewDef = {
  icon: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  Body: ComponentType;
};

export const PREVIEWS: Record<PreviewKey, PreviewDef> = {
  score: { icon: FileSearch, Body: ScorePreview },
  voice: { icon: Mic, Body: VoicePreview },
  cases: { icon: FlaskConical, Body: CasesPreview },
  schedule: { icon: Check, Body: SchedulePreview },
  inbox: { icon: Inbox, Body: InboxPreview },
  salary: { icon: Gauge, Body: SalaryPreview },
  rediscover: { icon: History, Body: RediscoverPreview },
  offer: { icon: FileSignature, Body: OfferPreview },
  gates: { icon: ShieldCheck, Body: GatesPreview }
};
