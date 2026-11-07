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
import Link from "next/link";
import { useTranslations } from "next-intl";
import { KitSurface } from "@/app/_components/kit";
import { ConsentCard } from "./consent/ConsentCard";
import { greeting as composeGreeting } from "./engine/greeting";
import { parseAttention } from "./panels/NeedsPanel";
import { consoleHref } from "./panels/PanelShell";
import { useRead } from "./panels/read";
import { PANEL_VIEWS, PanelChrome } from "./panels/registry";
import type { PanelLook } from "./panels/types";
import { Switcher } from "./Switcher";
import type { PanelInstance, ProposalInstance, VariantId } from "./types";
import { useOneSession } from "./useOneSession";
import { VARIANTS } from "./variants";
import type { GreetingState, VariantProps } from "./variantProps";
import { useOneWords } from "./words";
import type { AttentionCounts } from "@/app/_lib/attention";

const CONSOLE_HREF = consoleHref("pipeline");

export function OneShell({ variant, showSwitcher }: { variant: VariantId; showSwitcher: boolean }) {
  const t = useTranslations("one.core.meta");
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
    (panel: PanelInstance, opts?: { look?: PanelLook; className?: string }): ReactNode => {
      const View = PANEL_VIEWS[panel.kind];
      return (
        <View
          key={panel.id}
          panel={panel}
          epoch={epoch}
          look={opts?.look}
          className={opts?.className}
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
    renderPanel,
    renderConsent,
    words,
    consoleHref: CONSOLE_HREF,
  };
  return (
    <div className="min-h-screen bg-paper text-ink" data-one-variant={variant}>
      <KitSurface density="calm">
        <nav className="flex items-center justify-between gap-4 px-4 py-3" aria-label={t("region")}>
          <span className="font-serif text-h3 text-ink">{t("region")}</span>
          <div className="flex items-center gap-3">
            {showSwitcher ? <Switcher current={variant} /> : null}
            <Link className="k-btn k-btn--secondary k-btn--sm" href={CONSOLE_HREF} data-tip={t("consoleTip")} data-role="one-console">
              {t("console")}
            </Link>
          </div>
        </nav>
        <Variant {...props} />
      </KitSurface>
    </div>
  );
}
