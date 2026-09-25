"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { KitSurface, PageHead, type Figure, type PartState } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { JourneyKitLanes } from "./JourneyKitLanes";
import { JourneyKitPane } from "./JourneyKitPane";
import { JourneyKitRoles } from "./JourneyKitRoles";
import { JourneyKitShared } from "./JourneyKitShared";
import { JourneyKitToolbar } from "./JourneyKitToolbar";
import { KIT_STEPS } from "./journeyKitSteps";
import { useJourneyKit } from "./useJourneyKit";
import { useJourneyKitKeys } from "./useJourneyKitKeys";
import "./journeyKit.css";

const INTERVIEW = KIT_STEPS.indexOf("interview");

/*
 * The Journeys board rebuilt as the kit's lane board (kit-unification Gate 3; the style-kit-r2
 * winner's "Journey board rebuilt as a matrix"). Top to bottom: the role's page head, Roles (every
 * role's reach on the same steps; press one), the filters, the role's shared job-definition band,
 * and the lanes (a StageRail head, one Lane per candidate). A lane opens the reading pane.
 * Rendered by JourneyOverlay behind useKitFlag(); with the flag off the Broadsheet renders unchanged.
 */
function JourneyKitBoard({ initialRole, onRetry }: { initialRole?: string | null; onRetry: () => void }) {
  const k = useJourneyKit(initialRole);
  const t = useTranslations("journey");
  const tEnums = useTranslations("enums");
  const { date } = useDateFormat();
  const root = useRef<HTMLDivElement>(null);
  useJourneyKitKeys(root, { step: k.step, open: k.openCursor, close: k.close, paneOpen: k.pane != null });

  const role = k.roles.find((r) => r.jobId === k.jobId) ?? null;
  const total = k.roles.reduce((sum, r) => sum + r.n, 0);
  // A workspace with no journeys has no role to ask for: the board is ready and empty.
  const noRoles = !k.cohort.loading && !k.cohortError && k.roles.length === 0;
  const waiting = k.board.board === null || (k.jobId !== null && k.cluster === null);
  const status: PartState = k.cohortError || k.boardError ? "error" : noRoles ? "ready" : k.cohort.loading || waiting ? "loading" : "ready";
  const held = k.lanes.filter((l) => l.status === "needs").length;
  const interviewed = k.rail[INTERVIEW]?.reached ?? 0;
  const of = k.rail[INTERVIEW]?.of ?? 0;
  const figures: Figure[] = [
    { label: t("kit.figJourneys"), value: k.lanes.length, of: total || undefined },
    { label: t("kit.figInterview"), value: interviewed, of, draw: of ? interviewed / of : 0 },
    { label: t("kit.figHeld"), value: held, tone: held > 0 ? "needs" : "default", tip: t("kit.figHeldTip") },
  ];
  const areaKey = role?.roleArea ? (`family.${role.roleArea}` as Parameters<typeof tEnums>[0]) : null;
  const area = areaKey ? (tEnums.has(areaKey) ? tEnums(areaKey) : (role?.roleArea ?? "")) : t("cohort.roleUnassigned");
  const context = k.cluster ? `${area} · ${t("kit.opened", { date: date(k.cluster.openedAt) })}` : undefined;

  return (
    <KitSurface pane={k.pane ? <JourneyKitPane k={k} /> : null} onStep={k.step} onClose={k.close}>
      <div ref={root} className="jk" role="region" aria-label={t("title")} aria-busy={status === "loading"} data-testid="journey-kit">
        <PageHead
          title={role?.title ?? k.cluster?.title ?? t("title")}
          context={context}
          figures={figures}
          state={k.cohortError ? "error" : status === "ready" ? "ready" : "loading"}
          errorText={k.cohortError ?? undefined}
          onRetry={onRetry}
        />
        <JourneyKitRoles k={k} onRetry={onRetry} />
        <JourneyKitToolbar k={k} />
        <JourneyKitShared k={k} />
        <JourneyKitLanes k={k} status={status} onRetry={k.boardError ? k.board.reload : onRetry} />
      </div>
    </KitSurface>
  );
}

/** A retry re-mounts the board, so both reads (the cohort and the role) run again. */
export default function JourneyKitView({ initialRole }: { initialRole?: string | null }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="jk-frame">
      <JourneyKitBoard key={attempt} initialRole={initialRole} onRetry={() => setAttempt((n) => n + 1)} />
    </div>
  );
}
