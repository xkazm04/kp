"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, ChipRow, Mark, Note, PageHead, SearchField, Segmented, Toolbar, type Figure } from "@/app/_components/kit";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { nextTabIndex } from "@/app/_components/ui/useTablist";
import { buildUrl } from "@/app/features/shell/tabs";
import { CHANNEL_SECTIONS, type ChannelSectionId } from "../channelsSections";
import { commsStatusLabels, type Message } from "../channelsCommsHelpers";
import { simulateInbound, type useChannelData } from "../useChannelsData";
import { deadCount, receiverTotals, receiversFor, sectionMark, verdictCounts, VERDICT_MARK, VERDICT_ORDER, type VerdictFilter } from "./channelsKitModel";

/**
 * The Channels kit view's page head (eyebrow, title, the section's blurb, three figures, the
 * test-application action) and toolbar (sections as a segmented control with a status mark
 * each, the verdict chips, the Role / Channel / Type facets and the ledger search on
 * Communications). "N waiting" is a link to the Pipeline tab, as the old head's was; the section
 * switch takes the arrow keys (useTablist's movement rule) without a kit change; a filed test
 * application is announced through a status line.
 */
export function ChannelsKitHead({ section, setSection, data, messages, olderExist, verdict, setVerdict, q, setQ, facetFilters }: {
  section: ChannelSectionId;
  setSection: (s: ChannelSectionId) => void;
  data: ReturnType<typeof useChannelData>;
  messages: Message[] | null;
  olderExist: boolean;
  verdict: VerdictFilter;
  setVerdict: (v: VerdictFilter) => void;
  q: string;
  setQ: (v: string) => void;
  /** The ledger's column facets (ChannelsKitLedgerFacets), drawn after the verdict chips. */
  facetFilters?: ReactNode;
}) {
  const t = useTranslations("channels");
  const tk = useTranslations("channels.kit");
  const tc = useTranslations("channels.comms");
  const tErr = useTranslations("resilience");
  const errMsg = useErrorMessage();
  const router = useRouter();
  const search = useSearchParams();
  const [sim, setSim] = useState<{ busy: boolean; note: { ok: boolean; text: string } | null }>({ busy: false, note: null });
  const { webhooks, jobs, accepted, loadFailed, reload } = data;
  const active = CHANNEL_SECTIONS.find((s) => s.id === section)!;
  const statusLabels = commsStatusLabels(tc);

  const waiting: Figure = { label: t("stats.waiting"), value: accepted, tip: accepted == null ? undefined : t("waiting", { count: accepted }) };
  let figures: Figure[];
  if (section === "comms") {
    const dead = messages ? deadCount(messages) : null;
    figures = [
      waiting,
      { label: tk("messages"), value: messages ? messages.length : null, tip: messages && olderExist ? tc("olderExist", { count: messages.length }) : undefined },
      { label: tk("deadLetters"), value: dead, tone: dead ? "needs" : "default", tip: dead ? tc("deadLetters", { count: dead }) : undefined },
    ];
  } else if (section === "careers") {
    figures = [waiting, { label: t("stats.publishedRoles"), value: jobs ? jobs.length : null }];
  } else {
    const list = receiversFor(webhooks, active.channel);
    const { received, leads } = receiverTotals(list);
    figures = [
      waiting,
      { label: t("stats.received"), value: received },
      { label: t("stats.leads"), value: leads, of: received || undefined, draw: received ? (leads ?? 0) / received : undefined },
    ];
  }

  const simulate = async () => {
    setSim({ busy: true, note: null });
    const r = await simulateInbound(jobs?.[0]?.id);
    if (r.ok) {
      reload();
      setSim({ busy: false, note: { ok: true, text: t("sim.filed", { label: r.label, score: r.score, role: r.jobTitle }) } });
    } else {
      const text = r.reason === "noJob" ? t("sim.noJob") : errMsg(r, r.status ? t("sim.failedStatus", { status: r.status }) : t("sim.failed"));
      setSim({ busy: false, note: { ok: false, text } });
    }
  };

  // Arrow keys / Home / End move through the sections (the old switcher's useTablist contract).
  // The kit Segmented is a group of pressed buttons with no roving tabindex; that needs a kit change.
  const onSegKey = (e: KeyboardEvent<HTMLElement>) => {
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const at = buttons.indexOf(e.target as HTMLButtonElement);
    const next = at < 0 ? null : nextTabIndex(e.key, at, CHANNEL_SECTIONS.length);
    if (next === null) return;
    e.preventDefault();
    setSection(CHANNEL_SECTIONS[next].id);
    buttons[next]?.focus();
  };

  const counts = messages ? verdictCounts(messages) : null;
  const segments = CHANNEL_SECTIONS.map((s) => {
    const m = sectionMark(s.id, jobs, webhooks, s.channel);
    return {
      value: s.id,
      label: t(`sections.${s.id}.label`),
      mark: m ? <Mark kind={m.mark} tip={t(m.key)} /> : <Mark kind="wait" tip={t("ledger")} />,
    };
  });

  return (
    <>
      {/* data-sim: the guided walk's "match" chapter spotlights the inbound figures here
          (shell/simulation/simWalkSteps.ts); a plain block, so the spotlight has a box. */}
      <div data-sim="channel-inbound">
        <PageHead
          eyebrow={t("eyebrow")}
          title={t("title")}
          context={
            <>
              {sim.note?.ok ? sim.note.text : t(`sections.${section}.blurb`)}
              <span className="sr-only" role="status">{sim.note?.ok ? sim.note.text : ""}</span>
            </>
          }
          figures={figures}
          state={loadFailed ? "error" : "ready"}
          errorText={tErr("errorTitle")}
          onRetry={() => reload()}
          actions={
            <>
              {accepted != null ? (
                <Button
                  label={t("waiting", { count: accepted })}
                  variant="link"
                  icon="right"
                  onClick={() => router.push(buildUrl({ tab: "pipeline" }, search.toString()))}
                />
              ) : null}
              <Button
                label={t("sim.run")}
                loadingLabel={t("sim.running")}
                loading={sim.busy}
                disabled={jobs === null}
                onClick={simulate}
                data-sim-click="simulate-inbound"
              />
            </>
          }
        />
      </div>
      {sim.note && !sim.note.ok ? <Note tone="caution">{sim.note.text}</Note> : null}
      <Toolbar
        segmented={
          <div className="contents" onKeyDown={onSegKey}>
            <Segmented label={t("tablist")} items={segments} value={section} onChange={(v) => setSection(v as ChannelSectionId)} />
          </div>
        }
        filters={
          section === "comms" && counts ? (
            <>
              <ChipRow
                chips={VERDICT_ORDER.map((v) => ({
                  id: v,
                  label: statusLabels[v],
                  count: counts[v],
                  mark: <Mark kind={VERDICT_MARK[v]} />,
                  pressed: verdict === v,
                  disabled: !counts[v],
                  onPress: () => setVerdict(verdict === v ? null : v),
                }))}
              />
              {facetFilters}
            </>
          ) : undefined
        }
        search={section === "comms" ? <SearchField label={tk("search")} value={q} onChange={setQ} /> : undefined}
      />
    </>
  );
}
