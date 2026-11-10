"use client";

// /one — the shell the layout mounts in (docs/design/one-interface.md).
//
// It owns the shared core and hands it to the layout (layout/SheetsLayout.tsx — round 5:
// the one layout) as LayoutProps: the attention read and the greeting it composes, the
// session (conductor + validation door + reducer), the panel and consent renderers, the
// words. Its root is the FINISH root (`data-one-root` + `data-finish`, the hooks in
// finish.css) and the motion flavor's provider (motion.ts), so the header follows the
// finish too.
//
// Round 5 — the motion orchestration root (docs/design/one-interface.md "Motion
// orchestration"): ONE <MotionConfig> (reducedMotion "user" — reduced motion is honoured
// here, once, for every motion element below — and the flavor's base move as the default
// transition), then ONE <LayoutGroup> around the header and the layout, so the header's
// sliding pill, the sheet stack and the tables' row moves measure and animate together.
// Views are keyed by their identity (kind + params, panels/seen.ts), so a view the next
// answer shows again stays mounted.
//
// Round 5: two FRAMES (OneFrame, panels/PanelShell.tsx).
//   page  `/one` — owns the viewport (`h-dvh` from lg), its header carries the brand and
//         the Console link (+ Ctrl/⌘ K, composition-region "fixed chrome").
//   tab   `/?tab=one` (OneTab.tsx) — fills the workspace's tab panel (`h-full min-h-0`);
//         the workspace IS the console, so no brand, no Console link and no Ctrl/⌘ K of
//         its own (the workspace's palette owns that key), and every Console link in the
//         panels switches tabs in place (ConsoleAnchor).
import { useCallback, useEffect, type ReactNode } from "react";
import { LayoutGroup, MotionConfig } from "framer-motion";
import { useRouter } from "next/navigation";
import { KitSurface } from "@/app/_components/kit";
import { mkBody, mkHand } from "@/app/landing/site/chrome/fonts";
import { ConsentCard } from "./consent/ConsentCard";
import { greeting as composeGreeting } from "./engine/greeting";
import { parseAttention } from "./panels/NeedsPanel";
import { consoleHref, OneFrameContext, type OneFrame } from "./panels/PanelShell";
import { useRead } from "./panels/read";
import { PANEL_VIEWS, PanelChrome } from "./panels/registry";
import { OneHeader } from "./OneHeader";
import { useLettersWaiting, usePipeline } from "./tools/reads";
import type { PanelInstance, PanelKind, ProposalInstance, Selected, ToolKind } from "./types";
import { useOneSession } from "./useOneSession";
import { ONE_FLAVOR, ONE_MOTION_CONFIG, OneMotion } from "./motion";
import { viewKey } from "./panels/seen";
import { SheetsLayout } from "./layout/SheetsLayout";
import type { GreetingState, LayoutProps, PanelOpts } from "./layoutProps";
import { useOneWords } from "./words";
import type { AttentionCounts } from "@/app/_lib/attention";
import "./finish.css";

const CONSOLE_HREF = consoleHref("pipeline");

/** The panel kind each per-candidate tool is drawn by (`interview` = the calendar scoped
 *  to one candidate). */
const TOOL_PANEL: Record<ToolKind, PanelKind> = { profile: "profile", letter: "letter", interview: "calendar" };

/** KitSurface's three wrappers (kit, stage, sheet) are plain blocks; the frame needs the
 *  viewport height to flow through them so the body can fill what the header leaves. */
const KIT_FILL =
  "min-h-0 flex-1 [&>.k-kit]:h-full [&>.k-kit>.k-stage]:h-full [&>.k-kit>.k-stage]:grid-rows-[minmax(0,1fr)] [&>.k-kit>.k-stage>.k-sheet]:min-h-0 [&>.k-kit>.k-stage>.k-sheet]:flex [&>.k-kit>.k-stage>.k-sheet]:h-full [&>.k-kit>.k-stage>.k-sheet]:flex-col";

/** The root's size per frame: the page owns the viewport from lg (below it the page scrolls);
 *  the tab fills the panel it is given (OneTab gives it a definite height from lg). */
const ROOT_SIZE: Record<OneFrame, string> = {
  page: "min-h-dvh lg:h-dvh lg:overflow-hidden",
  tab: "lg:h-full lg:min-h-0 lg:overflow-hidden",
};

export function OneShell({ frame }: { frame: OneFrame }) {
  const router = useRouter();
  const words = useOneWords();
  const attentionRead = useRead("/api/attention", parseAttention, 0);
  // A partial read is not a full one: the greeting composes only from a complete set.
  const attention: AttentionCounts | null =
    attentionRead.state === "ready" &&
    (["decisions", "pipeline", "channels", "schedule", "jobs", "companion"] as const).every((k) => typeof attentionRead.data[k] === "number")
      ? (attentionRead.data as AttentionCounts)
      : null;
  const greeting: GreetingState = attentionRead.state === "loading" ? { state: "loading" } : composeGreeting(attention);
  // The shared pipeline read: "open <name>" binds to one of its active entries.
  const pipelineRead = usePipeline(0);
  const entries = pipelineRead.state === "ready" ? pipelineRead.data.entries : null;
  const session = useOneSession(attention, entries);
  // The header's Letters figure: the one new door (drafted outreach waiting for approval).
  const lettersRead = useLettersWaiting(session.epoch);
  const lettersWaiting = lettersRead.state === "ready" ? lettersRead.data.letters.length : null;

  // Ctrl/⌘ K → the Console, on the page only: the workspace's own palette is not mounted on
  // /one, and inside the workspace that key is the palette's.
  useEffect(() => {
    if (frame !== "page") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        router.push(CONSOLE_HREF);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, frame]);

  const { epoch, focusId, focus, close, pin, unpin, propose, show, dismissProposal, bumpEpoch, select, selected } = session;
  const selectedEntryId = selected?.entryId ?? null;
  const renderPanel = useCallback(
    (panel: PanelInstance, opts?: PanelOpts): ReactNode => {
      const View = PANEL_VIEWS[panel.kind];
      return (
        <View
          // The view's identity, not the session's panel id (new on every answer): the same
          // view in the same place stays mounted across answers.
          key={viewKey(panel, opts?.look ?? "list")}
          panel={panel}
          epoch={epoch}
          look={opts?.look}
          className={opts?.className}
          onExpand={opts?.onExpand}
          group={opts?.group}
          selectedEntryId={selectedEntryId}
          onSelectEntry={select}
          onPropose={propose}
          onShow={show}
          chrome={
            <PanelChrome
              panel={panel}
              focused={focusId === panel.id}
              onPin={() => pin(panel.id)}
              onUnpin={() => unpin(panel.id)}
              onFocus={() => focus(panel.id)}
              onClose={() => close(panel.id)}
            />
          }
        />
      );
    },
    [epoch, focusId, focus, close, pin, unpin, propose, show, select, selectedEntryId]
  );
  // A tool is a panel bound to one candidate, drawn by the host outside the session's
  // region (no pin / close chrome: the layout closes it by clearing the selection).
  const renderTool = useCallback(
    (tool: ToolKind, entry: Selected, opts?: { look?: "pane" | "insight"; className?: string }): ReactNode => {
      const kind: PanelKind = TOOL_PANEL[tool];
      const View = PANEL_VIEWS[kind];
      const panel: PanelInstance = { id: `tool-${tool}-${entry.entryId}`, kind, params: { entryId: entry.entryId, label: entry.label }, pinned: false };
      return (
        <View
          key={panel.id}
          panel={panel}
          epoch={epoch}
          look={opts?.look ?? "pane"}
          className={opts?.className}
          selectedEntryId={selectedEntryId}
          onSelectEntry={select}
          onPropose={propose}
          onShow={show}
        />
      );
    },
    [epoch, propose, show, select, selectedEntryId]
  );
  const renderConsent = useCallback(
    (proposal: ProposalInstance, opts?: { className?: string }): ReactNode => (
      <ConsentCard
        key={proposal.id}
        proposal={proposal}
        className={opts?.className}
        epoch={epoch}
        onDataChanged={bumpEpoch}
        onDismiss={() => dismissProposal(proposal.id)}
        onPropose={propose}
      />
    ),
    [epoch, bumpEpoch, dismissProposal, propose]
  );

  const props: LayoutProps = {
    session,
    submit: session.submit,
    greeting,
    attention,
    current: session.current,
    position: session.position,
    stepBack: session.stepBack,
    stepForward: session.stepForward,
    renderPanel,
    renderConsent,
    words,
    selected,
    select,
    renderTool,
  };
  const partial = attentionRead.state === "ready" ? attentionRead.data : null;
  return (
    <OneFrameContext.Provider value={frame}>
    <OneMotion.Provider value={ONE_FLAVOR}>
    <MotionConfig {...ONE_MOTION_CONFIG}>
    <LayoutGroup id="one">
    <div
      className={`${mkBody.variable} ${mkHand.variable} flex flex-col bg-paper text-ink ${ROOT_SIZE[frame]}`}
      data-one-root
      data-one-frame={frame}
      data-finish="dense"
    >
      <div className={KIT_FILL}>
        <KitSurface density="calm">
          <OneHeader
            counts={partial}
            letters={lettersWaiting}
            activeChip={session.current?.asked.chip ?? null}
            onAsk={(chip) => session.submit({ chip })}
            frame={frame}
            consoleHref={CONSOLE_HREF}
          />
          <div className="min-h-0 flex-1 overflow-y-auto" data-role="one-body">
            <SheetsLayout {...props} />
          </div>
        </KitSurface>
      </div>
    </div>
    </LayoutGroup>
    </MotionConfig>
    </OneMotion.Provider>
    </OneFrameContext.Provider>
  );
}
