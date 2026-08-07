// Icon + section metadata for the two-level sidebar (SectionRailNav). Kept apart
// from the tabs.ts catalog (which stays a JSX-free, server-safe module) so the
// lucide component references live only in the client nav layer.
import {
  BarChart3,
  Briefcase,
  Building2,
  CalendarClock,
  Code2,
  CreditCard,
  Cpu,
  FileSearch,
  FileText,
  Info,
  LayoutDashboard,
  Library,
  Mic,
  Palette,
  Radio,
  Rocket,
  Scale,
  Settings,
  SlidersHorizontal,
  Table,
  Target,
  TrendingUp,
  UserCircle,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { NavGroup } from "@/app/features/tabs";
import type { WorkspaceTabId } from "@/app/features/tabs";

// The first NAV_GROUP has no `key` (it's the operational hiring flow); give it a
// stable section id + English fallback label so the rail can render it like any
// other group without touching the tabs.ts catalog.
export const HIRING_SECTION = "hiring";
export const HIRING_FALLBACK_LABEL = "Hiring";
// Rendered last on the rail, pinned to the bottom (the systedo "system" slot).
export const PINNED_SECTION = "settings";

/** A group's stable section id: its catalog `key`, or "hiring" for the keyless
 *  operational group. Drives the icon, the rail label (nav.groups.<section>) and
 *  the pinned-to-bottom test — no parallel section list to keep in sync. */
export function sectionOf(group: NavGroup): string {
  return group.key ?? HIRING_SECTION;
}

/** First-level rail glyphs — one per section, distinct from the tab icons. */
export const SECTION_ICON: Record<string, LucideIcon> = {
  hiring: Workflow,
  library: Library,
  tools: Wrench,
  devExtension: Code2,
  insights: BarChart3,
  settings: Settings,
};

/** Second-level (panel) glyphs — one per tab. A tab without an entry falls back
 *  to a neutral dot in the renderer, so this never has to be exhaustive. */
export const TAB_ICON: Partial<Record<WorkspaceTabId, LucideIcon>> = {
  pipeline: LayoutDashboard,
  channels: Radio,
  decisions: Scale,
  schedule: CalendarClock,
  onboarding: Rocket,
  jobs: Briefcase,
  library: FileText,
  profile: UserCircle,
  match: Target,
  analyze: FileSearch,
  interview: Mic,
  dev: Code2,
  analytics: TrendingUp,
  matrix: Table,
  about: Info,
  organization: Building2,
  branding: Palette,
  billing: CreditCard,
  models: Cpu,
  workspace: SlidersHorizontal,
};
