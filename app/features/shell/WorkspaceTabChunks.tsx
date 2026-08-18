"use client";

// Code-split tab registry + the tab-panel switch, split out of Workspace.tsx so the
// shell orchestrator stays under the 200-line file cap. Lazy-loads each tab so the
// initial bundle only carries the shell + the active tab's chunk; the rest are
// fetched on demand when navigated to. A shared skeleton fills the swap. (Named
// exports → map to a default for next/dynamic.) See docs/design/loading-choreography.md.
//
// The import specifiers themselves live ONCE, in ./tabChunks — the same loaders back
// the hover/idle prefetch (so a click no longer starts the download it then waits on).
// Going through the shared map is what makes the two provably request the same chunk.
import dynamic from "next/dynamic";
import { ErrorBoundary } from "@/app/_components/ErrorBoundary";
import { TAB_CHUNKS } from "./tabChunks";
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
const AboutTab = dynamic(() => TAB_CHUNKS.about().then((m) => ({ default: m.AboutTab })), { loading });
const AnalyzeWorkspace = dynamic(() => TAB_CHUNKS.analyze().then((m) => ({ default: m.AnalyzeWorkspace })), { loading });
const DecisionsTab = dynamic(() => TAB_CHUNKS.decisions().then((m) => ({ default: m.DecisionsTab })), { loading });
const ScheduleTab = dynamic(() => TAB_CHUNKS.schedule().then((m) => ({ default: m.ScheduleTab })), { loading });
const JobsTab = dynamic(() => TAB_CHUNKS.jobs().then((m) => ({ default: m.JobsTab })), { loading });
const JdsTab = dynamic(() => TAB_CHUNKS.library().then((m) => ({ default: m.JdsTab })), { loading });
const MatrixTab = dynamic(() => TAB_CHUNKS.matrix().then((m) => ({ default: m.MatrixTab })), { loading });
const AnalyticsTab = dynamic(() => TAB_CHUNKS.analytics().then((m) => ({ default: m.AnalyticsTab })), { loading });
const ActivityTab = dynamic(() => TAB_CHUNKS.activity().then((m) => ({ default: m.ActivityTab })), { loading });
const PipelineTab = dynamic(() => TAB_CHUNKS.pipeline().then((m) => ({ default: m.PipelineTab })), { loading });
const AgentsWorkforceTab = dynamic(() => TAB_CHUNKS.agents().then((m) => ({ default: m.AgentsWorkforceTab })), { loading });
const ChannelsTab = dynamic(() => TAB_CHUNKS.channels().then((m) => ({ default: m.ChannelsTab })), { loading });
const DevTab = dynamic(() => TAB_CHUNKS.assignments().then((m) => ({ default: m.DevTab })), { loading });
const ProfileTab = dynamic(() => TAB_CHUNKS.archetypes().then((m) => ({ default: m.ProfileTab })), { loading });
const InterviewSimTab = dynamic(() => TAB_CHUNKS.interview().then((m) => ({ default: m.InterviewSimTab })), { loading });
const TasksTab = dynamic(() => TAB_CHUNKS.tasks().then((m) => ({ default: m.TasksTab })), { loading });
const BillingTab = dynamic(() => TAB_CHUNKS.billing().then((m) => ({ default: m.BillingTab })), { loading });
const ModelsTab = dynamic(() => TAB_CHUNKS.models().then((m) => ({ default: m.ModelsTab })), { loading });
const WorkspaceTab = dynamic(() => TAB_CHUNKS.workspace().then((m) => ({ default: m.WorkspaceTab })), { loading });
const OrganizationTab = dynamic(() => TAB_CHUNKS.organization().then((m) => ({ default: m.OrganizationTab })), { loading });
const IntegrationsTab = dynamic(() => TAB_CHUNKS.integrations().then((m) => ({ default: m.IntegrationsTab })), { loading });
const BrandingTab = dynamic(() => TAB_CHUNKS.branding().then((m) => ({ default: m.BrandingTab })), { loading });
const HiringTab = dynamic(() => TAB_CHUNKS.hiring().then((m) => ({ default: m.HiringTab })), { loading });

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
        {navActive === "agents" ? <AgentsWorkforceTab /> : null}
        {navActive === "archetypes" ? <ProfileTab /> : null}
        {navActive === "interview" ? <InterviewSimTab /> : null}
        {navActive === "analyze" ? (
          <AnalyzeWorkspace initialMode={active === "history" ? "history" : "new"} />
        ) : null}
        {navActive === "jobs" ? <JobsTab /> : null}
        {navActive === "library" ? <JdsTab /> : null}
        {navActive === "matrix" ? <MatrixTab /> : null}
        {navActive === "analytics" ? <AnalyticsTab /> : null}
        {navActive === "activity" ? <ActivityTab /> : null}
        {navActive === "assignments" ? <DevTab /> : null}
        {navActive === "about" ? <AboutTab /> : null}
        {navActive === "tasks" ? <TasksTab /> : null}
        {navActive === "billing" ? <BillingTab /> : null}
        {navActive === "models" ? <ModelsTab /> : null}
        {navActive === "workspace" ? <WorkspaceTab /> : null}
        {navActive === "organization" ? <OrganizationTab /> : null}
        {navActive === "branding" ? <BrandingTab /> : null}
        {navActive === "integrations" ? <IntegrationsTab /> : null}
        {navActive === "hiring" ? <HiringTab /> : null}
      </div>
    </ErrorBoundary>
  );
}
