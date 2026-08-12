// Icon + section metadata for the two-level sidebar (SectionRailNav). Kept apart
// from the tabs.ts catalog (which stays a JSX-free, server-safe module) so the
// lucide component references live only in the client nav layer.
import {
  Activity,
  BarChart3,
  Bot,
  Briefcase,
  Building2,
  CalendarClock,
  Code2,
  CreditCard,
  Cpu,
  FileSearch,
  FileText,
  GitBranch,
  Info,
  LayoutDashboard,
  Library,
  Mic,
  Palette,
  Plug,
  Radio,
  Rocket,
  Scale,
  Settings,
  SlidersHorizontal,
  Table,
  TrendingUp,
  UserCircle,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceTabId } from "@/app/features/shell/tabs";

// Section identity (HIRING_SECTION / sectionOf) lives in tabs.ts beside the
// catalog — this module adds only the glyph tables, so importing it is the one
// thing that pulls lucide into a chunk.

/** First-level rail glyphs — one per section, distinct from the tab icons. */
export const SECTION_ICON: Record<string, LucideIcon> = {
  hiring: Workflow,
  library: Library,
  tools: Wrench,
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
  agents: Bot,
  jobs: Briefcase,
  library: FileText,
  archetypes: UserCircle,
  analyze: FileSearch,
  interview: Mic,
  assignments: Code2,
  analytics: TrendingUp,
  activity: Activity,
  matrix: Table,
  about: Info,
  organization: Building2,
  branding: Palette,
  billing: CreditCard,
  models: Cpu,
  integrations: Plug,
  workspace: SlidersHorizontal,
  hiring: GitBranch,
};
