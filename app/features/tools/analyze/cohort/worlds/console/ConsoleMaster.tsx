"use client";

import { Segmented } from "@/app/_components/kit/Toolbar";
import { KeyHints } from "@/app/_components/kit/scene";
import { COHORT_CAP, type CohortView } from "../../cohortTypes";
import { PATCH_ORDERS, isPatchOrder, labelOf, masterClaim, noiseGroup, type PatchOrder } from "./consoleModel";
import { ConsoleReadout, type Hot } from "./ConsoleReadout";
import type { ConsoleWords } from "./useConsoleWords";

/** The desk's title strip: the role the cohort is read against, the channel count, the patch order. */
export function ConsoleTop({ view, words, order, onOrder }: { view: CohortView; words: ConsoleWords; order: PatchOrder; onOrder: (o: PatchOrder) => void }) {
  return (
    <div className="cx-top">
      <div className="cx-top__titles">
        <p className="cx-eyebrow">
          {words.t("head.eyebrow")} · {words.t("head.channels", { n: view.members.length, cap: COHORT_CAP })}
          {view.blind ? ` · ${words.t("head.blind")}` : ""}
        </p>
      </div>
      <Segmented
        label={words.t("master.patch.label")}
        lead={words.t("master.patch.label")}
        value={order}
        onChange={(v) => isPatchOrder(v) && onOrder(v)}
        items={PATCH_ORDERS.map((o) => ({ value: o, label: words.t(`master.patch.${o}`) }))}
      />
    </div>
  );
}

/**
 * The master section: the overall claim (a lead is named ONLY when it clears; "within the noise"
 * names the channels that share the band and says the order is not a finding; below the floor
 * nothing is compared), its robustness, the run's progress, and the readout.
 */
export function ConsoleMaster({ view, words, hot, covered }: { view: CohortView; words: ConsoleWords; hot: Hot; covered: ReadonlySet<string> }) {
  const claim = masterClaim(view);
  const noise = noiseGroup(view);
  const { progress } = view;
  const running = view.status === "running" || view.status === "queued";
  let headline: string;
  let detail: string;
  if (claim.kind === "lead") {
    headline = words.t("master.overall.lead", { name: labelOf(view, claim.leader) ?? "—" });
    detail = words.t("master.overallDetail.lead");
  } else if (claim.kind === "floor") {
    headline = words.t("master.overall.floor");
    detail = words.t("master.overallDetail.floor");
  } else {
    headline = words.t("master.overall.noise");
    const names = (noise?.ids ?? []).map((id) => labelOf(view, id) ?? "—");
    detail = noise && names.length > 0 ? words.t("master.overallDetail.noise", { names: words.list(names), lo: noise.lo, hi: noise.hi }) : words.t("master.overallDetail.noiseNone");
  }
  const dots = Array.from({ length: progress.total }, (_, i) => (i < progress.done ? "done" : i < progress.done + progress.failed ? "failed" : "wait"));
  return (
    <section className="cx-master" aria-label={words.t("master.title")}>
      <div className="cx-claim" data-claim={claim.kind}>
        <p className="cx-eyebrow">{words.t("master.title")}</p>
        <p className="cx-claim__head">
          <i className="cx-claimlamp cx-claimlamp--big" aria-hidden />
          <span>{headline}</span>
        </p>
        <p className="cx-claim__detail">{detail}</p>
        <dl className="cx-facts">
          <div>
            <dt>{words.t("master.robustness.label")}</dt>
            <dd data-robust={view.claims.overall.robustness}>{words.t(`master.robustness.${view.claims.overall.robustness}`)}</dd>
          </div>
          <div>
            <dt>{words.t("master.progress", { done: progress.done, total: progress.total })}</dt>
            <dd>
              <span className="cx-run" aria-hidden>
                {dots.map((d, i) => (
                  <i key={i} data-run={d} />
                ))}
              </span>
              {words.t("master.progressDetail", { reused: progress.reused, failed: progress.failed })}
            </dd>
          </div>
        </dl>
        {running ? <p className="cx-claim__run">{words.t("master.running")}</p> : null}
      </div>
      <ConsoleReadout view={view} hot={hot} covered={covered} words={words} />
    </section>
  );
}

/** The talkback: the top-N narrative, who it covers and how many it leaves out, and who wrote it. */
export function ConsoleTalkback({ view, words, onHot }: { view: CohortView; words: ConsoleWords; onHot: (on: boolean) => void }) {
  const n = view.narrative;
  return (
    <section
      className="cx-talk"
      aria-label={words.t("talkback.title")}
      onPointerEnter={() => onHot(true)}
      onPointerLeave={() => onHot(false)}
      onFocus={() => onHot(true)}
      onBlur={() => onHot(false)}
    >
      <p className="cx-eyebrow">
        <i className="cx-lamp" data-lamp="talkback" data-on={n ? true : undefined} aria-hidden /> {words.t("talkback.title")}
      </p>
      {n ? (
        <>
          <p className="cx-talk__text" tabIndex={0}>
            {n.text}
          </p>
          <p className="cx-talk__meta">
            {words.t("talkback.covers", { n: n.covers.length, out: n.leavesOut })} · {words.t(n.engine === "keyless" ? "talkback.keyless" : "talkback.model")}
          </p>
        </>
      ) : (
        <p className="cx-talk__meta">{words.t("talkback.none")}</p>
      )}
    </section>
  );
}

const LEGEND = ["meter", "capped", "pending", "lamps", "phase", "talkback", "tape"] as const;

/** The desk's legend: each mark drawn once beside its words (the marks themselves are decorative). */
export function ConsoleLegend({ words }: { words: ConsoleWords }) {
  return (
    <section className="cx-legend" aria-label={words.t("master.legend.label")}>
      <p className="cx-eyebrow">{words.t("master.legend.label")}</p>
      <ul>
        {LEGEND.map((k) => (
          <li key={k} data-key={k}>
            <i className="cx-legend__mark" aria-hidden />
            <span>{words.t(`master.legend.${k}`)}</span>
          </li>
        ))}
      </ul>
      <KeyHints
        label={words.t("keys.label")}
        hints={[
          { id: "move", keys: [words.t("keys.names.arrows")], act: words.t("keys.acts.move") },
          { id: "solo", keys: [words.t("keys.names.enter")], act: words.t("keys.acts.solo") },
        ]}
      />
    </section>
  );
}
