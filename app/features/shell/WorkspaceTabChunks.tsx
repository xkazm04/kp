"use client";

// Code-split tab registry + the tab-panel switch, split out of Workspace.tsx so the
// shell orchestrator stays under the 200-line file cap. Lazy-loads each tab so the
// initial bundle only carries the shell + the active tab's chunk; the rest are
// fetched on demand when navigated to. A shared skeleton fills the swap. (Named
// exports → map to a default for next/dynamic.) See docs/design/loading-choreography.md.
import dynamic from "next/dynamic";
import { ErrorBoundary } from "@/app/_components/ErrorBoundary";
import type { WorkspaceTabId } from "./tabs";

// The gap while a tab's code-split chunk loads (docs/design/loading-choreography.md).
//
// Deliberately EMPTY. The old three-bar skeleton drew a header + card silhouette
// that matched no tab in particular, so a cold navigation showed two unrelated
// loading shapes in a row (this one, then the tab's own) before content — the
// exact flicker the choreography forbids. What replaces it: nothing visible, on
// a 150ms delayed fade (`.reveal-quiet`), so a warm chunk paints no placeholder
// at all and a genuinely slow one gets a calm held frame instead of a fake page.
// The height keeps the footer/sim bar from jumping up into the gap.
function TabChunkGap() {
  return <div className="reveal-quiet min-h-[24rem]" aria-hidden />;
}

const loading = () => <TabChunkGap />;
const AboutTab = dynamic(() => import("../insights/about/AboutTab").then((m) => ({ default: m.AboutTab })), { loading });
const AnalyzeWorkspace = dynamic(() => import("../tools/analyze/AnalyzeWorkspace").then((m) => ({ default: m.AnalyzeWorkspace })), { loading });
const DecisionsTab = dynamic(() => import("../hiring/decisions/DecisionsTab").then((m) => ({ default: m.DecisionsTab })), { loading });
const ScheduleTab = dynamic(() => import("../hiring/schedule/ScheduleTab").then((m) => ({ default: m.ScheduleTab })), { loading });
const OnboardingTab = dynamic(() => import("../hiring/onboarding/OnboardingTab").then((m) => ({ default: m.OnboardingTab })), { loading });
const JobsTab = dynamic(() => import("../library/jobs/JobsTab").then((m) => ({ default: m.JobsTab })), { loading });
const JdsTab = dynamic(() => import("../library/jds/JdsTab").then((m) => ({ default: m.JdsTab })), { loading });
const MatchTab = dynamic(() => import("../tools/match/MatchTab").then((m) => ({ default: m.MatchTab })), { loading });
const MatrixTab = dynamic(() => import("../insights/matrix/MatrixTab").then((m) => ({ default: m.MatrixTab })), { loading });
const AnalyticsTab = dynamic(() => import("../insights/analytics/AnalyticsTab").then((m) => ({ default: m.AnalyticsTab })), { loading });
const PipelineTab = dynamic(() => import("../hiring/pipeline/PipelineTab").then((m) => ({ default: m.PipelineTab })), { loading });
const ChannelsTab = dynamic(() => import("../hiring/channels/ChannelsTab").then((m) => ({ default: m.ChannelsTab })), { loading });
const DevTab = dynamic(() => import("../tools/devcases/DevTab").then((m) => ({ default: m.DevTab })), { loading });
const ProfileTab = dynamic(() => import("../tools/profile/ProfileTab").then((m) => ({ default: m.ProfileTab })), { loading });
const InterviewSimTab = dynamic(() => import("../tools/interview/InterviewSimTab").then((m) => ({ default: m.InterviewSimTab })), { loading });
const TasksTab = dynamic(() => import("./tasks/TasksTab").then((m) => ({ default: m.TasksTab })), { loading });
const BillingTab = dynamic(() => import("../settings/billing/BillingTab").then((m) => ({ default: m.BillingTab })), { loading });
const ModelsTab = dynamic(() => import("../settings/models/ModelsTab").then((m) => ({ default: m.ModelsTab })), { loading });
const WorkspaceTab = dynamic(() => import("../settings/workspace/WorkspaceTab").then((m) => ({ default: m.WorkspaceTab })), { loading });
const OrganizationTab = dynamic(() => import("../settings/organization/OrganizationTab").then((m) => ({ default: m.OrganizationTab })), { loading });
const IntegrationsTab = dynamic(() => import("../settings/integrations/IntegrationsTab").then((m) => ({ default: m.IntegrationsTab })), { loading });
const BrandingTab = dynamic(() => import("../settings/branding/BrandingTab").then((m) => ({ default: m.BrandingTab })), { loading });

// The tab-switch tree + its error boundary, extracted verbatim from Workspace's
// <main> body. `active`/`navActive` keep their Workspace meanings (navActive is the
// history→analyze-collapsed id used for the actual switch; active decides history
// mode inside Analyze).
export function WorkspaceTabPanel({ navActive, active }: { navActive: WorkspaceTabId; active: WorkspaceTabId }) {
  return (
    <ErrorBoundary resetKey={navActive} label="This tab">
      <div key={navActive} className="animate-tab-in">
        {navActive === "pipeline" ? <PipelineTab /> : null}
        {navActive === "channels" ? <ChannelsTab /> : null}
        {navActive === "decisions" ? <DecisionsTab /> : null}
        {navActive === "schedule" ? <ScheduleTab /> : null}
        {navActive === "onboarding" ? <OnboardingTab /> : null}
        {navActive === "profile" ? <ProfileTab /> : null}
        {navActive === "match" ? <MatchTab /> : null}
        {navActive === "interview" ? <InterviewSimTab /> : null}
        {navActive === "analyze" ? (
          <AnalyzeWorkspace initialMode={active === "history" ? "history" : "new"} />
        ) : null}
        {navActive === "jobs" ? <JobsTab /> : null}
        {navActive === "library" ? <JdsTab /> : null}
        {navActive === "matrix" ? <MatrixTab /> : null}
        {navActive === "analytics" ? <AnalyticsTab /> : null}
        {navActive === "dev" ? <DevTab /> : null}
        {navActive === "about" ? <AboutTab /> : null}
        {navActive === "tasks" ? <TasksTab /> : null}
        {navActive === "billing" ? <BillingTab /> : null}
        {navActive === "models" ? <ModelsTab /> : null}
        {navActive === "workspace" ? <WorkspaceTab /> : null}
        {navActive === "organization" ? <OrganizationTab /> : null}
        {navActive === "branding" ? <BrandingTab /> : null}
        {navActive === "integrations" ? <IntegrationsTab /> : null}
      </div>
    </ErrorBoundary>
  );
}
