"use client";

// The Score anatomy structure of the nested dimension layer (spark analyze-v2-cohort round 2).
// Every candidate's rating drawn as how it was BUILT — a base, each part that earned or lost
// points, ending at the rating — on one shared 0-100 scale, so twenty rows compare at a glance;
// beside them a focus sheet takes one candidate apart part by part, with evidence, and
// decomposes their gap to the first in order. One component for all seven floors: fit (model
// judgement) draws its rating plainly and says there is no point breakdown.
import { useRef } from "react";
import { useTranslations } from "next-intl";
import type { DimensionLayerProps } from "../../cohortTypes";
import { DimensionClaim } from "../../dimensions/DimensionClaim";
import { DimensionTips } from "../../dimensions/DimensionTips";
import { Remainder, makeStops } from "../../dimensions/dimensionParts";
import { absentGroups, pendingOn } from "../../dimensions/dimensionModel";
import { fieldOrder, rivalOf } from "./anatomyModel";
import { AnatomyField } from "./AnatomyField";
import { AnatomyLegend } from "./AnatomyLegend";
import { AnatomySheet } from "./AnatomySheet";
import { useAnatomyKeys } from "./useAnatomyKeys";
import { usePhrase } from "./usePhrase";
import "../../dimensions/dimensions.css";
import "./anatomy.css";

export function AnatomyLayer({ view, dimension, focusMemberId, onFocusMember, onOpenReport }: DimensionLayerProps) {
  const t = useTranslations("analyzeCohort");
  const root = useRef<HTMLDivElement>(null);
  const phrase = usePhrase();
  const onKeyDown = useAnatomyKeys(root, focusMemberId, onFocusMember);

  const order = fieldOrder(view, dimension);
  const pending = pendingOn(view, dimension);
  const groups = absentGroups(view, dimension);
  const claim = view.claims.byDimension[dimension];
  // The guide marks where the first in order sits; a LEADER only where the claim clears.
  const first = order[0];
  const guide =
    dimension !== "salary" && claim.separation !== "belowFloor" && first && first.cells[dimension].rating != null
      ? { at: first.cells[dimension].rating as number, kind: claim.separation === "clears" && claim.leader === first.memberId ? ("leader" as const) : ("first" as const) }
      : null;
  const focused = focusMemberId ? (view.members.find((m) => m.memberId === focusMemberId) ?? null) : null;
  const sheetMember = focused ?? first ?? null;
  const place = sheetMember ? order.findIndex((m) => m.memberId === sheetMember.memberId) : -1;
  const rival = rivalOf(view, dimension, sheetMember?.memberId ?? null);
  const stops = makeStops();
  const model = dimension === "fit";

  return (
    <div
      ref={root}
      className="cd-dim k-kit an-layer"
      data-cohort-layer="anatomy"
      data-dimension={dimension}
      data-members={view.members.length}
      role="region"
      aria-label={t("layerAnatomy.region", { dimension: t(`dims.${dimension}`) })}
      onKeyDown={onKeyDown}
    >
      <DimensionClaim view={view} dimension={dimension} />
      <AnatomyLegend dimension={dimension} order={order} guide={guide} model={model} />
      <div className="an-split">
        <div className="an-split__field">
          <AnatomyField
            view={view}
            dimension={dimension}
            order={order}
            pending={pending}
            focusId={focusMemberId}
            guide={guide}
            stops={stops}
            phrase={phrase}
            onFocusMember={onFocusMember}
            onOpenReport={onOpenReport}
          />
          <Remainder pending={[]} groups={groups} focusId={focusMemberId} onFocusMember={onFocusMember} stops={stops} />
        </div>
        <AnatomySheet
          view={view}
          dimension={dimension}
          member={sheetMember}
          focused={focused != null}
          place={place >= 0 ? place + 1 : null}
          rated={order.length}
          rival={rival}
          phrase={phrase}
          onOpenReport={onOpenReport}
        />
      </div>
      <DimensionTips root={root} />
    </div>
  );
}
