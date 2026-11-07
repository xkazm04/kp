"use client";

// /one — the shell every layout direction mounts in (docs/design/one-interface.md).
//
// It owns the shared core and hands it to the selected variant as VariantProps: the
// attention read and the greeting it composes, the session (conductor + validation door
// + reducer), the panel and consent renderers, the words. It also owns the two pieces of
// fixed chrome no variant may move (composition-region "fixed chrome"): the Console link
// (+ Ctrl/⌘ K) and the dev-visible layout switcher.
import { useCallback, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { KitSurface } from "@/app/_components/kit";
import { ConsentCard } from "./consent/ConsentCard";
import { greeting as composeGreeting } from "./engine/greeting";
import { parseAttention } from "./panels/NeedsPanel";
import { consoleHref } from "./panels/PanelShell";
import { useRead } from "./panels/read";
import { PANEL_VIEWS, PanelChrome } from "./panels/registry";
import type { PanelLook } from "./panels/types";
import { OneHeader } from "./OneHeader";
import type { PanelInstance, ProposalInstance, VariantId } from "./types";
import { useOneSession } from "./useOneSession";
import { HEADER_SIZE, VARIANTS } from "./variants";
import type { GreetingState, VariantProps } from "./variantProps";
import { useOneWords } from "./words";
import type { AttentionCounts } from "@/app/_lib/attention";

const CONSOLE_HREF = consoleHref("pipeline");

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
  const session = useOneSession(attention);

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

  const { epoch, focusId, focus, close, pin, unpin, propose, show, dismissProposal, bumpEpoch } = session;
  const renderPanel = useCallback(
    (panel: PanelInstance, opts?: { look?: PanelLook; className?: string; onExpand?: () => void }): ReactNode => {
      const View = PANEL_VIEWS[panel.kind];
      return (
        <View
          key={panel.id}
          panel={panel}
          epoch={epoch}
          look={opts?.look}
          className={opts?.className}
          onExpand={opts?.onExpand}
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
    [epoch, focusId, focus, close, pin, unpin, propose, show]
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
  };
  const partial = attentionRead.state === "ready" ? attentionRead.data : null;
  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink lg:h-dvh lg:overflow-hidden" data-one-variant={variant}>
      <div className={KIT_FILL}>
        <KitSurface density="calm">
          <OneHeader
            size={HEADER_SIZE[variant]}
            counts={partial}
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
  );
}
