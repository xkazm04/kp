"use client";

import { useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { LevelTransition, layerModeAt, type Crumb } from "@/app/_components/kit/scene";
import { commsReceiptLabels } from "../channelsCommsHelpers";
import { useChannelData } from "../useChannelsData";
import { useCommsFeed } from "../useCommsFeed";
import { ledgerName } from "./ledger/channelsNightLedgerModel";
import { ChannelsNightLedgerLevel } from "./ChannelsNightLedgerLevel";
import { ChannelsNightMessageLevel } from "./ChannelsNightMessageLevel";
import { ChannelsNightPlumbingView } from "./ChannelsNightPlumbingView";
import { ChannelsNightSetupLevel } from "./ChannelsNightSetupLevel";
import { NODE_NAME } from "./channelsNightCopy";
import { LEDGER_ALL, layerKey, stepChannel, topOf, type NightEntry, type NightStack } from "./channelsNightNav";
import { countVerdicts, plumbingModel, type PlumbingInput } from "./channelsNightPlumbing";
import { useChannelsNightDelivery } from "./useChannelsNightDelivery";
import { useChannelsNightKeys } from "./useChannelsNightKeys";
import { useChannelsNightNav } from "./useChannelsNightNav";
import "./channelsNight.css";
import "./channelsNightScene.css";

/**
 * Hiring > Channels, "The Night Post": the plumbing as a district you walk into. This shell owns
 * the data (ONE useChannelData, ONE useCommsFeed, the relay + edge reads), the level stack and its
 * transitions (useChannelsNightNav), the keys (useChannelsNightKeys) and the announcement of
 * where you are. Each level renders inside a kit LevelTransition; covered levels stay mounted so what was typed
 * survives the descent. night/README.md is the architecture and the contract for the level owners.
 */
export function ChannelsNightShell() {
  const t = useTranslations();
  const tc = useTranslations("channels.comms");
  const rootRef = useRef<HTMLDivElement>(null);
  const data = useChannelData();
  const feed = useCommsFeed();
  const nav = useChannelsNightNav(rootRef);
  const depth = nav.stack.length - 1;
  const top = topOf(nav.stack);
  // Every return to the plumbing re-reads the relay and the edge (the edge editor saves silently).
  const [reread, setReread] = useState(0);
  const [seenDepth, setSeenDepth] = useState(depth);
  if (depth !== seenDepth) {
    setSeenDepth(depth);
    if (depth === 0) setReread((n) => n + 1);
  }
  const delivery = useChannelsNightDelivery(reread);
  const receipt = useMemo(() => commsReceiptLabels(tc), [tc]);

  const { webhooks, jobs, accepted, loadFailed, webhooksTruncated } = data;
  const { messages, hasMore, truncated } = feed.feed;
  const dataSettled = (webhooks !== null && jobs !== null && accepted !== null) || loadFailed;
  const input: PlumbingInput = useMemo(
    () => ({
      jobs, receivers: webhooks, receiversTruncated: webhooksTruncated, waiting: accepted, messages, olderExist: hasMore || truncated,
      relay: delivery.relay, edge: delivery.edge, settled: dataSettled && (messages !== null || feed.error) && delivery.settled,
    }),
    [jobs, webhooks, webhooksTruncated, accepted, messages, hasMore, truncated, delivery.relay, delivery.edge, delivery.settled, dataSettled, feed.error],
  );
  const model = useMemo(() => plumbingModel(input), [input]);

  useChannelsNightKeys(rootRef, {
    level: top.level,
    onBack: nav.pop,
    onStepChannel: top.level === 1 ? (d) => nav.replaceTop({ level: 1, channel: stepChannel(top.channel, d), focus: null }) : undefined,
  });

  const labelOf = (e: NightEntry): string => {
    if (e.level === 0) return t("channelsNight.shell.root");
    if (e.level === 1) return t(NODE_NAME[e.channel]);
    if (e.level === 2) return t("channels.ledger");
    const m = messages?.find((x) => x.id === e.id);
    return m ? ledgerName(m, feed.feed.refs, receipt) : t("channelsNight.shell.message");
  };
  const crumbsFor = (stack: NightStack, d: number): Crumb[] =>
    stack.slice(0, d + 1).map((e, i) => ({ label: labelOf(e), onSelect: i < d ? () => nav.popTo(i) : undefined }));

  const render = (entry: NightEntry, d: number, stack: NightStack): ReactElement => {
    const crumbs = crumbsFor(stack, d);
    if (entry.level === 0) {
      return (
        <ChannelsNightPlumbingView
          input={input}
          model={model}
          jobs={jobs}
          loadFailed={loadFailed}
          onReload={() => {
            data.reload();
            feed.load();
          }}
          onOpen={(node, el) => nav.push(node === "book" ? LEDGER_ALL : { level: 1, channel: node, focus: null }, el)}
          onNeed={(item, el) => nav.push(item.target, el)}
        />
      );
    }
    if (entry.level === 1) {
      return (
        <ChannelsNightSetupLevel
          channel={entry.channel}
          focus={entry.focus}
          plates={model.plates}
          counts={messages ? countVerdicts(messages) : null}
          data={data}
          crumbs={crumbs}
          onBack={nav.pop}
          onStep={(dx) => nav.replaceTop({ level: 1, channel: stepChannel(entry.channel, dx), focus: null })}
          onGo={(channel) => nav.replaceTop({ level: 1, channel, focus: null })}
          onOpenLedger={(from, el, scope) => nav.push({ level: 2, verdict: scope?.verdict ?? null, role: scope?.role ?? null, from }, el)}
        />
      );
    }
    if (entry.level === 2) {
      return (
        <ChannelsNightLedgerLevel
          entry={entry}
          feed={feed}
          data={data}
          crumbs={crumbs}
          onBack={nav.pop}
          onOpenMessage={(id, list, el) => nav.push({ level: 3, id, list }, el)}
          onOpenChannel={(channel, el) => nav.push({ level: 1, channel, focus: null }, el)}
        />
      );
    }
    return (
      <ChannelsNightMessageLevel
        entry={entry}
        feed={feed}
        crumbs={crumbs}
        onBack={nav.pop}
        onStep={(id) => nav.replaceTop({ ...entry, id })}
        onOpenChannel={(channel, el) => nav.push({ level: 1, channel, focus: null }, el)}
      />
    );
  };

  const layers = nav.stack.map((entry, d) => (
    <LevelTransition
      key={layerKey(entry, d)}
      depth={d}
      mode={layerModeAt(d, depth, nav.kind)}
      opener={d === depth ? nav.openers[d] ?? null : null}
      onSettled={d === depth ? nav.settle : undefined}
    >
      {render(entry, d, nav.stack)}
    </LevelTransition>
  ));
  const tr = nav.transition;
  if (tr?.kind === "close") {
    // The closing level keeps its key, so React keeps its instance while the circle closes.
    layers.push(
      <LevelTransition key={layerKey(tr.ghost, tr.ghostDepth)} depth={tr.ghostDepth} mode="leaving" opener={tr.opener} onSettled={nav.settle}>
        {render(tr.ghost, tr.ghostDepth, tr.from)}
      </LevelTransition>,
    );
  }

  return (
    // data-sim="channels": the guided walk's handle on the whole surface. aria-busy only until
    // every source settled once; a failed load is not loading, the head's alert says it.
    <div ref={rootRef} className="k-kit cn-night" data-density="compact" data-sim="channels" data-level={top.level} aria-busy={!input.settled || undefined}>
      <p className="sr-only" role="status">
        {crumbsFor(nav.stack, depth).map((c) => c.label).join(" › ")}
      </p>
      {layers}
    </div>
  );
}
