"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, DataTable, Mark, Section, formatCount, type Column } from "@/app/_components/kit";
import { buildTabSwitchUrl } from "@/app/features/shell/tabs";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import type { ChannelJob } from "../useChannelsData";
import { useCopyState } from "../useCopyState";

/**
 * Careers page on the kit: every OPEN role's public apply link (useChannelData reads
 * openOnly, so no row hands out a dead link), one row each, the copy action on the act
 * track. The variant showed 8 rows and a "showing 8 of N" pager; the windowed table shows
 * all of them 8 rows tall and its pager counts them, so nothing is cut. The copy answers Copied /
 * Copy failed on the row that asked (useCopyState: a blocked clipboard must never look like a copy).
 */
export function ChannelsKitCareers({ jobs }: { jobs: ChannelJob[] | null }) {
  const t = useTranslations("channels");
  const locale = useLocale();
  const router = useRouter();
  const search = useSearchParams();
  const { state: copyState, copy } = useCopyState();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const said = (id: string) => (copiedId === id ? copyState : "idle");
  const base = publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "");
  const toJobs = () => router.push(buildTabSwitchUrl("jobs", search.toString()));

  const columns: Column[] = [
    { id: "mark", label: "", track: "mark" },
    { id: "role", label: t("receivers.role"), track: "name", primary: true },
    { id: "link", label: t("careers.applyLink"), track: "meta", quiet: true },
    { id: "act", label: "", track: "act" },
  ];

  return (
    <Section
      title={t("stats.publishedRoles")}
      count={jobs ? formatCount(jobs.length, locale) : undefined}
      actions={<Button label={jobs && jobs.length === 0 ? t("careers.publishRole") : t("careers.viewAllRoles")} variant="ghost" size="sm" onClick={toJobs} />}
    >
      <span className="sr-only" role="status">
        {copyState === "copied" ? t("copied") : copyState === "failed" ? t("copyFailed") : ""}
      </span>
      <DataTable
        label={t("stats.publishedRoles")}
        rows={jobs ?? []}
        columns={columns}
        visibleRows={8}
        rowKey={(j) => j.id}
        state={jobs === null ? "loading" : "ready"}
        emptyText={t("careers.empty")}
        cells={(j) => {
          const url = `${base}/apply/${j.id}`;
          return [
            <Mark key="m" kind="ok" tip={t("statusLive")} />,
            j.title,
            <a key="l" className="k-code" href={url} target="_blank" rel="noreferrer">
              {url}
            </a>,
            <Button
              key="a"
              label={said(j.id) === "copied" ? t("copied") : said(j.id) === "failed" ? t("copyFailed") : t("copyLink")}
              icon={said(j.id) === "copied" ? "check" : said(j.id) === "failed" ? "x" : "copy"}
              iconOnly
              size="sm"
              variant="ghost"
              onClick={() => {
                setCopiedId(j.id);
                copy(url);
              }}
            />,
          ];
        }}
      />
    </Section>
  );
}
