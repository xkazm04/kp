"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { KitSurface, Section } from "@/app/_components/kit";
import type { Crumb } from "@/app/_components/kit/scene";
import { Defer } from "@/app/_components/ui/Defer";
import { IntegrationsCalendarPanel } from "@/app/features/settings/integrations/IntegrationsCalendarPanel";
import { ChannelsNightFrame, KEYS_LEVEL } from "../ChannelsNightFrame";
import type { DeckEntry, DeckFocus } from "../channelsNightNav";
import { SetupStatus } from "../setup/SetupBits";
import { ConnectorCard, type CardNote } from "./ConnectorCard";
import { DECK_GROUPS, deckCards, deckSummary, type DeckCard, type DeckGroup } from "./connectorsDeckModel";
import type { ConnectorsDeckState } from "./useConnectorsDeck";
import "../setup/setup.css";

// The setup panels the retired Integrations tab held, re-homed here as they are
// (app/features/settings/integrations/). The calendar panel is eager: it is the landing of the
// Google OAuth callback (`?calendar=<code>` survives the redirect from ?tab=integrations) and
// reads that outcome on its first render. The rest are their own chunks, mounted an idle beat later.
const IntegrationsAtsPanel = dynamic(
  () => import("@/app/features/settings/integrations/IntegrationsAtsPanel").then((m) => ({ default: m.IntegrationsAtsPanel })),
  { loading: () => <div className="cns-hold" aria-hidden /> },
);
const IntegrationsWebhookPanel = dynamic(
  () => import("@/app/features/settings/integrations/IntegrationsWebhookPanel").then((m) => ({ default: m.IntegrationsWebhookPanel })),
  { loading: () => <div className="cns-hold" aria-hidden /> },
);
const IntegrationsPersonasPanel = dynamic(
  () => import("@/app/features/settings/integrations/IntegrationsPersonasPanel").then((m) => ({ default: m.IntegrationsPersonasPanel })),
  { loading: () => <div className="cns-hold" aria-hidden /> },
);

/**
 * Level 1, the connectors deck (night/README.md "The connectors deck"): every connector the
 * catalog knows (GET /api/connect, read in the shell), grouped as delivery / ATS / calendar, each
 * a card with its ONE health word and one door, and under each group the panel that sets it up.
 * Opened from the plumbing's door, a need (`focus` scrolls to its group) or `?sec=connectors[:part]`.
 * Probe runs only from a press (`deck.probe`); smtp's door is the sender level, where its Send test
 * lives, and is never probed from here.
 */
export function ChannelsNightConnectorsLevel({ entry, deck, crumbs, onBack, onOpenSender }: {
  entry: DeckEntry;
  deck: ConnectorsDeckState;
  crumbs: readonly Crumb[];
  onBack: () => void;
  onOpenSender: (el: HTMLElement) => void;
}) {
  const t = useTranslations("channelsNight.connectors");
  const groups = useMemo(() => (deck.connectors ? deckCards(deck.connectors) : null), [deck.connectors]);
  const summary = deckSummary(deck.connectors);
  const [notes, setNotes] = useState<Partial<Record<string, CardNote>>>({});
  const sections = useRef<Partial<Record<DeckFocus, HTMLElement | null>>>({});

  // A need or a deep link opened the deck on one part: bring that group into view once.
  const focus = entry.focus;
  useEffect(() => {
    if (focus) sections.current[focus]?.scrollIntoView({ block: "start" });
  }, [focus]);

  const press = async (card: DeckCard) => {
    const out = await deck.probe(card.id);
    const text =
      out.kind === "row"
        ? t(out.row.health === "connected" ? "probe.ok" : out.row.health === "failing" ? "probe.failed" : "probe.notRun")
        : out.kind === "failed"
          ? t(out.status === 429 ? "probe.throttled" : "probe.noAnswer")
          : null;
    if (text) setNotes((n) => ({ ...n, [card.id]: { ok: out.kind === "row" && out.row.health === "connected", text } }));
  };

  const status = summary === null
    ? { condition: "unknown" as const, title: t(deck.settled ? "summary.notRead" : "summary.reading") }
    : summary.sealed
      ? { condition: "unknown" as const, title: t("summary.sealed") }
      : { condition: summary.failing ? ("fail" as const) : summary.connected ? ("live" as const) : ("off" as const), title: t("summary.count", { connected: summary.connected, total: summary.total }) };

  const panels: Record<DeckGroup, ReactNode> = {
    delivery: null,
    ats: (
      <Defer strategy="idle">
        <IntegrationsAtsPanel />
        <IntegrationsWebhookPanel />
      </Defer>
    ),
    calendar: <IntegrationsCalendarPanel />,
  };

  return (
    <ChannelsNightFrame ground="studio" kicker={t("kicker")} title={t("title")} lead={t("lead")} crumbs={crumbs} onBack={onBack} keys={KEYS_LEVEL}>
      <KitSurface>
        <SetupStatus
          condition={status.condition}
          title={status.title}
          fact={summary && summary.failing ? t("summary.failing", { count: summary.failing }) : t("summary.fact")}
        />
        {DECK_GROUPS.map((group) => (
          <div key={group} ref={(el) => { sections.current[group] = el; }}>
            <Section title={t(`group.${group}.title`)} state={t(`group.${group}.blurb`)} id={`connectors-${group}`}>
              {groups ? (
                <ul className="cns-cards">
                  {groups[group].map((card) => (
                    <ConnectorCard
                      key={card.id}
                      card={card}
                      busy={deck.busy === card.id}
                      note={notes[card.id] ?? null}
                      onProbe={press}
                      onSender={onOpenSender}
                    />
                  ))}
                </ul>
              ) : null}
              {panels[group]}
            </Section>
          </div>
        ))}
        <Defer strategy="idle">
          <IntegrationsPersonasPanel />
        </Defer>
      </KitSurface>
    </ChannelsNightFrame>
  );
}
