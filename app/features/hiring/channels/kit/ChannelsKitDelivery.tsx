"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, KeyValueGrid, Mark, Section, SettingRow } from "@/app/_components/kit";
import { useCommsCapability } from "@/app/features/shell/useDeliveryCapability";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { readEdgeConfig, type EdgeState } from "../ChannelsEdgeCard";
import { firstSentence, type ChannelsSelection } from "./channelsKitModel";

/**
 * The Communications section's first block: where outbound mail goes (the relay) and who
 * answers while this install is off (the edge), as two setting rows on the measure plus the
 * edge's drain facts. The rows READ state (relay: the shared capability cache; edge: GET
 * /api/edge through the card's own reader); "Configure" opens the existing editor in the
 * reading pane, so every save / test / drain / pair action is the product's, not a copy.
 */
export function ChannelsKitDelivery({ sel, setSel }: { sel: ChannelsSelection | null; setSel: (s: ChannelsSelection | null) => void }) {
  const t = useTranslations("channels");
  const tk = useTranslations("channels.kit");
  const fmt = useDateFormat();
  const { relayConfigured } = useCommsCapability();
  const [edge, setEdge] = useState<EdgeState | null | "failed">(null);
  useEffect(() => {
    let alive = true;
    readEdgeConfig().then((next) => {
      if (alive) setEdge(next ?? "failed");
    });
    return () => {
      alive = false;
    };
  }, [sel?.kind]); // re-read after the edge editor closes

  const e = edge && edge !== "failed" ? edge : null;
  const paired = Boolean(e?.url && e.hasSecret);
  const edgeStatus = !e ? tk("notRead") : e.offline ? t("edge.statusOffline") : e.url && !e.hasSecret ? t("edge.statusSecretMissing") : paired ? t("edge.statusPaired") : t("edge.statusOff");
  const relayStatus = relayConfigured === null ? tk("notRead") : relayConfigured ? t("relay.statusOn") : t("relay.statusOff");
  const open = (kind: "relay" | "edge") => setSel(sel?.kind === kind ? null : { kind, key: kind });
  const neverPaired = e && !e.url;

  return (
    <Section
      title={tk("delivery")}
      state={`${relayStatus} · ${edgeStatus}`}
      stateMark={<Mark kind={relayConfigured ? "ok" : "caution"} />}
      tone={relayConfigured === false ? "caution" : "default"}
    >
      <SettingRow
        mark={<Mark kind={relayConfigured ? "ok" : relayConfigured === null ? "unknown" : "caution"} tip={relayStatus} />}
        name={t("relay.title")}
        sub={relayStatus}
        consequence={firstSentence(t("relay.intro"))}
        state={sel?.kind === "relay" ? ["changed"] : []}
        control={<Button label={tk("configure")} size="sm" aria-pressed={sel?.kind === "relay"} onClick={() => open("relay")} />}
      />
      <SettingRow
        mark={<Mark kind={paired ? "ok" : e?.offline ? "wait" : e ? "caution" : "unknown"} tip={edgeStatus} />}
        name={t("edge.title")}
        sub={edgeStatus}
        consequence={firstSentence(t("edge.intro"))}
        state={sel?.kind === "edge" ? ["changed"] : []}
        control={<Button label={tk("configure")} size="sm" aria-pressed={sel?.kind === "edge"} onClick={() => open("edge")} />}
      />
      <div style={{ padding: "4px 0 0 calc(var(--m-mark) + var(--m-gap))" }}>
        <KeyValueGrid
          cols={5}
          items={[
            { label: tk("lastDrain"), value: e?.lastDrainAt ? fmt.dateTime(e.lastDrainAt) : null, absent: t("edge.neverDrained") },
            { label: tk("lastHeartbeat"), value: e?.lastHeartbeatAt ? fmt.dateTime(e.lastHeartbeatAt) : null, absent: tk("neverPaired") },
            { label: tk("edgePending"), value: e?.pending ?? null, absent: t("edge.pendingUnknown") },
            { label: tk("edgeCursor"), value: e?.url ? e.cursor : null, absent: tk("neverPaired") },
            { label: tk("signingSecret"), value: e?.hasSecret ? t("edge.secretSet") : null, absent: neverPaired ? tk("neverPaired") : tk("notSet") },
          ]}
        />
      </div>
    </Section>
  );
}
