"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/app/_components/kit";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { buildTabSwitchUrl } from "@/app/features/shell/tabs";
import { simulateInbound, type ChannelJob } from "../../useChannelsData";
import { useCopyState } from "../../useCopyState";
import { SetupResult } from "./SetupBits";

/**
 * The careers page: every OPEN role's public apply link (useChannelData reads openOnly, so no row
 * hands out a dead link), each with its copy action answering Copied / Copy failed on the row that
 * asked (and to a screen reader). "Receive a test
 * application" is the real /api/sim/inbound on the first open role: its answer is announced, a
 * refusal resolved from its code. All roles / Publish a role go to the Jobs tab.
 */
export function SetupCareers({ jobs, onArrived }: { jobs: ChannelJob[] | null; onArrived: () => void }) {
  const t = useTranslations("channels");
  const ts = useTranslations("channelsNight.setup.careers");
  const errMsg = useErrorMessage();
  const router = useRouter();
  const search = useSearchParams();
  const { state: copyState, copy } = useCopyState();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sim, setSim] = useState<{ busy: boolean; note: { ok: boolean; text: string } | null }>({ busy: false, note: null });
  const said = (id: string) => (copiedId === id ? copyState : "idle");
  const base = publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "");
  const first = jobs?.[0] ?? null;

  const simulate = async () => {
    setSim({ busy: true, note: null });
    const r = await simulateInbound(first?.id);
    if (r.ok) {
      onArrived();
      setSim({ busy: false, note: { ok: true, text: t("sim.filed", { label: r.label, score: r.score, role: r.jobTitle }) } });
    } else {
      const text = r.reason === "noJob" ? t("sim.noJob") : errMsg(r, r.status ? t("sim.failedStatus", { status: r.status }) : t("sim.failed"));
      setSim({ busy: false, note: { ok: false, text } });
    }
  };

  return (
    <div className="cns-body">
      <div className="cns-row cns-row--split">
        <p className="cns-help">{ts("help")}</p>
        <Button
          label={jobs && jobs.length === 0 ? t("careers.publishRole") : t("careers.viewAllRoles")}
          variant="ghost"
          size="sm"
          icon="right"
          onClick={() => router.push(buildTabSwitchUrl("jobs", search.toString()))}
        />
      </div>
      <span className="sr-only" role="status">
        {copyState === "copied" ? t("copied") : copyState === "failed" ? t("copyFailed") : ""}
      </span>
      {jobs === null ? (
        <LoadingGap className="cns-hold" />
      ) : jobs.length === 0 ? (
        <p className="cns-intro">{t("careers.empty")}</p>
      ) : (
        // Every open role, in a region that scrolls after about eight (focusable, so the keyboard
        // scrolls it too); nothing is cut and no row folds its link away on a narrow sheet.
        <div className="cns-roles" role="region" tabIndex={0} aria-label={t("stats.publishedRoles")}>
          <ul>
            {jobs.map((j) => {
              const url = `${base}/apply/${j.id}`;
              const st = said(j.id);
              return (
                <li key={j.id} className="cns-role">
                  <span className="cns-role__name">{j.title}</span>
                  <a className="cns-role__url" href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                  <Button
                    label={st === "copied" ? t("copied") : st === "failed" ? t("copyFailed") : t("copyLink")}
                    aria-label={ts("copyAria", { role: j.title })}
                    icon={st === "copied" ? "check" : st === "failed" ? "x" : "copy"}
                    size="sm"
                    onClick={() => {
                      setCopiedId(j.id);
                      copy(url);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="cns-row">
        <Button label={t("sim.run")} loadingLabel={t("sim.running")} loading={sim.busy} disabled={!first} variant="primary" icon="plus" onClick={simulate} />
        {first ? <p className="cns-help">{ts("testHint", { role: first.title })}</p> : null}
      </div>
      {sim.note ? <SetupResult ok={sim.note.ok}>{sim.note.text}</SetupResult> : null}
    </div>
  );
}
