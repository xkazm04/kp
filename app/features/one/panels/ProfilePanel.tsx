"use client";

// profile — ONE candidate's profile (round 4): the analysis the timeline links to the entry
// (else the seeded one keyed by their own id), read through tools/reads.ts `useProfile`.
// Params: entryId, label (the name the user saw). Looks: `pane` = the half-screen CV | score
// tool (tools/ProfileTool.tsx), `insight` = a compact card; table / list draw the pane.
// No analysis on record is a stated sentence, never a blank tool.
import { useTranslations } from "next-intl";
import { ProfileCard, ProfilePane } from "../tools/ProfileTool";
import { useProfile, usePipeline } from "../tools/reads";
import { PanelFrame } from "./PanelFrame";
import type { Read } from "./read";
import type { PanelProps } from "./types";

export function ProfilePanel(props: PanelProps) {
  const t = useTranslations("one.core.panels.profile");
  const { entryId = "", label = "" } = props.panel.params;
  const pipeline = usePipeline(props.epoch);
  const candidateId = pipeline.state === "ready" ? (pipeline.data.entries.find((e) => e.id === entryId)?.candidateId ?? null) : null;
  // Wait for the pipeline read before choosing the seeded fallback, so a candidate whose
  // timeline holds no analysis is not called "none" a beat before their id arrives.
  const profile = useProfile(entryId && pipeline.state !== "loading" ? entryId : null, candidateId, props.epoch);
  const loading = Boolean(entryId) && (pipeline.state === "loading" || profile.state === "loading");
  const read: Read<unknown> & { retry: () => void } = loading
    ? { state: "loading", retry: () => undefined }
    : profile.state === "error"
      ? profile.read
      : { state: "ready", data: null, retry: () => undefined };
  const ready = profile.state === "ready" ? profile : null;
  return (
    <PanelFrame
      props={{ ...props, look: props.look === "insight" ? "insight" : "pane" }}
      data={{
        title: label ? t("titleFor", { label }) : t("title"),
        console: entryId ? { tab: "pipeline", params: { q: label } } : undefined,
        read,
        cols: [],
        rows: [],
        empty: !entryId ? t("pick") : t("none", { label }),
        body: ready
          ? {
              pane: <ProfilePane profile={ready} />,
              insight: <ProfileCard profile={ready} />,
            }
          : undefined,
      }}
    />
  );
}
