"use client";

// /one — the shell every layout direction mounts in (docs/design/one-interface.md).
//
// It owns the shared core and hands it to the selected variant as VariantProps: the
// attention read and the greeting it composes, the session (conductor + validation door
// + reducer), the panel and consent renderers, the words. It also owns the two pieces of
// fixed chrome no variant may move (composition-region "fixed chrome"): the Console link
// (+ Ctrl/⌘ K) and the dev-visible layout switcher. Round 3: its root is the FINISH root
// (`data-one-root` + `data-finish`, the hooks in finish.css) and the motion flavor's
// provider (motion.ts), so the header follows the finish too.
import { useCallback, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { KitSurface } from "@/app/_components/kit";
import { mkBody, mkHand } from "@/app/landing/site/chrome/fonts";
import { ConsentCard } from "./consent/ConsentCard";
import { greeting as composeGreeting } from "./engine/greeting";
import { parseAttention } from "./panels/NeedsPanel";
import { consoleHref } from "./panels/PanelShell";
import { useRead } from "./panels/read";
import { PANEL_VIEWS, PanelChrome } from "./panels/registry";
import { OneHeader } from "./OneHeader";
import { useLettersWaiting, usePipeline } from "./tools/reads";
import type { PanelInstance, PanelKind, ProposalInstance, Selected, ToolKind, VariantId } from "./types";
import { useOneSession } from "./useOneSession";
import { FLAVOR_OF, OneMotion } from "./motion";
import { VARIANTS } from "./variants";
import type { GreetingState, PanelOpts, VariantProps } from "./variantProps";
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

export function OneShell({ variant, showSwitcher }: { variant: VariantId; showSwitcher: boolean }) {
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

  // Ctrl/⌘ K → the Console. The workspace's own palette is not mounted on /one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        router.push(CONSOLE_HREF);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const { epoch, focusId, focus, close, pin, unpin, propose, show, dismissProposal, bumpEpoch, select, selected } = session;
  const selectedEntryId = selected?.entryId ?? null;
  const renderPanel = useCallback(
    (panel: PanelInstance, opts?: PanelOpts): ReactNode => {
      const View = PANEL_VIEWS[panel.kind];
      return (
        <View
          key={panel.id}
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
        onDataChanged={bumpEpoch}
        onDismiss={() => dismissProposal(proposal.id)}
      />
    ),
    [bumpEpoch, dismissProposal]
  );

  const Variant = VARIANTS[variant];
  const props: VariantProps = {
    variant,
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
    consoleHref: CONSOLE_HREF,
    selected,
    select,
    renderTool,
  };
  const partial = attentionRead.state === "ready" ? attentionRead.data : null;
  return (
    <OneMotion.Provider value={FLAVOR_OF[variant]}>
    <div
      className={`${mkBody.variable} ${mkHand.variable} flex min-h-dvh flex-col bg-paper text-ink lg:h-dvh lg:overflow-hidden`}
      data-one-root
      data-one-variant={variant}
      data-finish="dense"
    >
      <div className={KIT_FILL}>
        <KitSurface density="calm">
          <OneHeader
            counts={partial}
            letters={lettersWaiting}
            activeChip={session.current?.asked.chip ?? null}
            onAsk={(chip) => session.submit({ chip })}
            variant={variant}
            showSwitcher={showSwitcher}
            consoleHref={CONSOLE_HREF}
          />
          <div className="min-h-0 flex-1 overflow-y-auto" data-role="one-body">
            <Variant {...props} />
          </div>
        </KitSurface>
      </div>
    </div>
    </OneMotion.Provider>
  );
}
