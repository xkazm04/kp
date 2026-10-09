"use client";

import { useMemo, type CSSProperties, type KeyboardEvent } from "react";
import { Button } from "@/app/_components/kit/Button";
import { KeyHints, LevelFrame, LevelTrail, ScenePress, type Crumb, type LevelTone } from "@/app/_components/kit/scene";
import type { CohortDimension, CohortView } from "../../cohortTypes";
import { DimensionPage } from "../../dimensions/DimensionPage";
import { BUS_ORDER, SEGMENTS, busClaim, litSegments, patchOrder, type PatchOrder } from "./consoleModel";
import { busClaimWords } from "./ConsoleHeads";
import type { ConsoleWords } from "./useConsoleWords";

const TONE: Record<string, LevelTone> = { lead: "moss", noise: "amber", floor: "stone", unranked: "steel" };

/**
 * Level 1, one bus SOLOED: the kit's level frame (the trail back to the desk, the dimension as the
 * heading, the claim as the kicker), the desk's SOLO keys as the way sideways (the soloed one lit,
 * the rest muted), the soloed bus itself kept as a strip of meters across every channel (the
 * channel the descent started from is picked; picking another refocuses the page), and the shared
 * DimensionPage below it.
 */
export function ConsoleSoloLevel({ view, words, dimension, focus, order, crumbs, onBack, onGo, onFocusMember, onOpenReport }: {
  view: CohortView;
  words: ConsoleWords;
  dimension: CohortDimension;
  focus: string | null;
  order: PatchOrder;
  crumbs: readonly Crumb[];
  onBack: () => void;
  onGo: (dim: CohortDimension, dir: 1 | -1) => void;
  onFocusMember: (id: string | null) => void;
  onOpenReport: (slug: string) => void;
}) {
  const t = words.t;
  const claim = busClaimWords(view, dimension, words);
  const rated = t("bus.rated", { rated: view.claims.byDimension[dimension]?.rated ?? 0, total: view.members.length });
  const strips = useMemo(() => patchOrder(view.members, order), [view.members, order]);
  const at = (BUS_ORDER as readonly CohortDimension[]).indexOf(dimension);
  const focused = strips.find((m) => m.memberId === focus) ?? null;

  const onBusKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const keys = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-chan]")];
    const i = keys.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    keys[(i + (e.key === "ArrowRight" ? 1 : keys.length - 1)) % keys.length].focus();
  };

  return (
    <div className="cx-solo-level" data-claim={busClaim(view, dimension).kind}>
      <LevelFrame
        tone={TONE[claim.kind] ?? "steel"}
        kicker={t("solo.kicker", { claim: t(`solo.claim.${claim.kind}`), rated })}
        title={words.dim(dimension)}
        lead={claim.kind === "lead" ? claim.long : view.claims.byDimension[dimension]?.note}
        trail={<LevelTrail crumbs={crumbs} onBack={onBack} backLabel={t("back")} label={t("crumbsLabel")} />}
        foot={
          <span className="cx-solo-step">
            <Button label={t("solo.prev")} icon="left" data-level-key="step-prev" onClick={() => onGo(BUS_ORDER[(at + BUS_ORDER.length - 1) % BUS_ORDER.length], -1)} />
            <Button label={t("solo.next")} data-level-key="step-next" onClick={() => onGo(BUS_ORDER[(at + 1) % BUS_ORDER.length], 1)} />
          </span>
        }
        keys={
          <KeyHints
            label={t("keys.label")}
            hints={[
              { id: "bus", keys: [t("keys.names.brackets")], act: t("keys.acts.bus") },
              { id: "back", keys: [t("keys.names.esc")], act: t("keys.acts.back") },
            ]}
          />
        }
      >
        <div className="cx-buskeys">
          {BUS_ORDER.map((b, i) => (
            <ScenePress
              key={b}
              className="cx-buskey"
              data-on={b === dimension || undefined}
              data-level-key={`bus-${b}`}
              aria-pressed={b === dimension}
              aria-label={b === dimension ? words.dim(b) : t("solo.muted", { dim: words.dim(b) })}
              onClick={() => b !== dimension && onGo(b, i > at ? 1 : -1)}
            >
              <i className="cx-buskey__lamp" aria-hidden />
              {words.dim(b)}
            </ScenePress>
          ))}
        </div>
        <div className="cx-solobus" role="group" aria-label={t("solo.busLabel", { dim: words.dim(dimension) })} style={{ "--cx-n": strips.length } as CSSProperties} onKeyDown={onBusKeys}>
          {strips.map((m, i) => {
            const c = m.cells[dimension];
            const lit = litSegments(c.tier === "absent" ? null : c.rating);
            const on = m.memberId === focus;
            return (
              <ScenePress
                key={m.memberId}
                className="cx-chan-mini"
                data-chan=""
                data-on={on || undefined}
                data-state={lit == null ? "absent" : "rated"}
                data-tier={c.tier}
                data-bus={dimension}
                tabIndex={on || (focus == null && i === 0) ? 0 : -1}
                aria-pressed={on}
                aria-label={words.cellName(m, c)}
                onClick={() => onFocusMember(on ? null : m.memberId)}
              >
                <span className="cx-meter cx-meter--mini" aria-hidden>
                  {Array.from({ length: SEGMENTS }, (_, k) => (
                    <i key={k} className="cx-seg" data-lit={lit != null && k < lit ? true : undefined} />
                  ))}
                </span>
                <span className="cx-chan-mini__n k-nums" aria-hidden>
                  {m.neutralIndex + 1}
                </span>
              </ScenePress>
            );
          })}
        </div>
        <p className="cx-solobus__focus" aria-live="polite">
          {focused ? words.cellName(focused, focused.cells[dimension]) : t("solo.busLabel", { dim: words.dim(dimension) })}
        </p>
        <DimensionPage view={view} dimension={dimension} focusMemberId={focus} onFocusMember={onFocusMember} onOpenReport={onOpenReport} />
      </LevelFrame>
    </div>
  );
}
