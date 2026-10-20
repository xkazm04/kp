"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Note, formatCount } from "@/app/_components/kit";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { buildUrl } from "@/app/features/shell/tabs";
import { simulateInbound, type ChannelJob } from "../useChannelsData";
import type { Headline, NightFigure } from "./channelsNightPlumbing";
import { useNeedWords } from "./ChannelsNightNeeds";

/**
 * Level 0's head: the eyebrow, the HEADLINE (the worst thing that needs a person, from
 * rankNeeds; "flowing" only when everything was read, nothing does, every channel is set up and the
 * relay has proven it delivers, else a calm "nothing needs you" that says what is not proven), its one sentence, the
 * three figures (a dash always carries its reason in words, never a hover), "N waiting in the
 * pipeline" as a link to the board, and "Receive a test application" (the real
 * /api/sim/inbound, its outcome announced; a refusal resolved from its code).
 * `data-sim="channel-inbound"` is the guided walk's "match" spotlight (simWalkSteps.ts).
 */
export function ChannelsNightHead({ headline, figures, jobs, loadFailed, onReload, onArrived }: {
  headline: Headline;
  figures: readonly NightFigure[];
  jobs: ChannelJob[] | null;
  loadFailed: boolean;
  onReload: () => void;
  onArrived: () => void;
}) {
  const t = useTranslations("channelsNight.plumbing");
  const tc = useTranslations("channels");
  const tr = useTranslations("resilience");
  const errMsg = useErrorMessage();
  const locale = useLocale();
  const needWords = useNeedWords();
  const router = useRouter();
  const search = useSearchParams();
  const [sim, setSim] = useState<{ busy: boolean; note: { ok: boolean; text: string } | null }>({ busy: false, note: null });
  const waiting = figures.find((f) => f.key === "waiting")?.value ?? null;

  const simulate = async () => {
    setSim({ busy: true, note: null });
    const r = await simulateInbound(jobs?.[0]?.id);
    if (r.ok) {
      onReload();
      onArrived();
      setSim({ busy: false, note: { ok: true, text: tc("sim.filed", { label: r.label, score: r.score, role: r.jobTitle }) } });
    } else {
      const text = r.reason === "noJob" ? tc("sim.noJob") : errMsg(r, r.status ? tc("sim.failedStatus", { status: r.status }) : tc("sim.failed"));
      setSim({ busy: false, note: { ok: false, text } });
    }
  };

  let title: ReactNode;
  let sub: string;
  if (headline.kind === "need") {
    const w = needWords(headline.need, (c) => <span className="cn-pill">{c}</span>);
    title = w.title;
    sub = w.detail;
  } else if (headline.kind === "quiet") {
    title = t("headline.quiet");
    sub = t("headline.quietSub", { relay: headline.relayProven ? "proven" : "unproven", off: headline.off });
  } else {
    title = t(`headline.${headline.kind}`);
    sub = headline.kind === "ok" ? t("headline.okSub") : headline.kind === "okPartial" ? t("headline.okPartialSub") : "";
  }

  return (
    <div className="cn-head" data-sim="channel-inbound">
      <div className="cn-head__lead">
        <p className="cn-eyebrow">{t("eyebrow")}</p>
        <h2 className="cn-headline" data-tone={headline.kind === "need" ? headline.need.tone : headline.kind} tabIndex={-1} data-level-heading="">
          {title}
        </h2>
        {loadFailed ? (
          <p className="cn-head__sub" role="alert" data-tone="bad">
            {tr("errorTitle")} <Button label={tr("retry")} size="sm" onClick={onReload} />
          </p>
        ) : sub ? (
          <p className="cn-head__sub">{sub}</p>
        ) : null}
      </div>
      <div className="cn-head__side">
        <dl className="cn-figs">
          {figures.map((f) => (
            <div key={f.key} className="cn-fig" data-key={f.key} data-needs={f.needs ? "1" : undefined}>
              <dt>{t(`figures.${f.key}`)}</dt>
              <dd>{f.value === null ? "—" : formatCount(f.value, locale)}</dd>
              <dd className="cn-fig__note">
                {f.reason
                  ? t(`figures.${f.reason}`)
                  : f.key === "waiting"
                    ? t("figures.waitingNote")
                    : f.key === "messages"
                      ? `${f.sent ? t("figures.sent", { count: f.sent }) : t("figures.noneSent")}${f.olderExist ? ` · ${t("figures.newestPage")}` : ""}`
                      : t("figures.deadNote")}
              </dd>
            </div>
          ))}
        </dl>
        <div className="cn-head__acts">
          {waiting !== null ? (
            <Button label={tc("waiting", { count: waiting })} variant="link" icon="right" onClick={() => router.push(buildUrl({ tab: "pipeline" }, search.toString()))} />
          ) : null}
          <Button
            label={tc("sim.run")}
            loadingLabel={tc("sim.running")}
            loading={sim.busy}
            disabled={jobs === null}
            variant="primary"
            icon="plus"
            onClick={simulate}
            data-sim-click="simulate-inbound"
          />
        </div>
        <p className="cn-head__status" role="status">
          {sim.note?.ok ? sim.note.text : ""}
        </p>
      </div>
      {sim.note && !sim.note.ok ? <Note tone="caution">{sim.note.text}</Note> : null}
    </div>
  );
}
