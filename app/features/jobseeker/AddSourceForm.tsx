"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Info, Loader2, Plus } from "lucide-react";
import { IconAction } from "@/app/_components/IconAction";
import { BTN_PRIMARY, FIELD, PANEL } from "@/app/_components/ui/recipes";
import type { JobseekerSource, SourceAdapterName } from "@/app/_lib/jobseeker/types";
import { FailureNotice } from "./FailureNotice";
import { callJson, type ApiFailure } from "./sourcesApi";

// Two ways to add a source the catalog does not list by name: an ATS by company slug
// + vendor (`{adapter: "ats_<vendor>", config: {slug}}`; the route derives the host),
// and a board by host (`{adapter: "board_sitemap_jsonld", host}`; an unknown host is
// tier B by rule, so its first enable asks for the acknowledgement). Tier C hosts are
// refused by the route with JOBSEEKER_SOURCE_REFUSED and rendered from the code.

const ATS_VENDORS: { adapter: SourceAdapterName; label: string }[] = [
  { adapter: "ats_greenhouse", label: "Greenhouse" },
  { adapter: "ats_lever", label: "Lever" },
  { adapter: "ats_recruitee", label: "Recruitee" },
  { adapter: "ats_teamtailor", label: "Teamtailor" },
  { adapter: "ats_personio", label: "Personio" },
  { adapter: "ats_workable", label: "Workable" },
  { adapter: "ats_ashby", label: "Ashby" },
  { adapter: "ats_smartrecruiters", label: "SmartRecruiters" },
];

export function AddSourceForm({ onCreated }: { onCreated(source: JobseekerSource): void }) {
  const t = useTranslations("me.sources.add");
  const tCommon = useTranslations("me.common");
  const [slug, setSlug] = useState("");
  const [vendor, setVendor] = useState<SourceAdapterName>("ats_greenhouse");
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState<"ats" | "board" | null>(null);
  const [error, setError] = useState<{ fail: ApiFailure; form: "ats" | "board" } | null>(null);

  const create = async (form: "ats" | "board", body: Record<string, unknown>) => {
    setBusy(form);
    setError(null);
    const r = await callJson<{ source: JobseekerSource }>("/api/jobseeker/sources", { method: "POST", body: JSON.stringify(body) });
    setBusy(null);
    if (!r.ok) {
      setError({ fail: r.fail, form });
      return;
    }
    onCreated(r.body.source);
    if (form === "ats") setSlug("");
    else setHost("");
  };

  return (
    <section className={`${PANEL} p-4`} aria-labelledby="add-source">
      {/* ONE heading voice per level across the seeker's sources/scans surfaces: the
          serif h3. This was a META_LABEL-styled h2 sitting beside serif h2s of the
          same rank. */}
      <h2 id="add-source" className="font-serif text-h3 text-ink">
        {t("title")}
      </h2>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (slug.trim()) void create("ats", { adapter: vendor, config: { slug: slug.trim() } });
          }}
        >
          <p className="text-sm font-medium text-ink">{t("ats.label")}</p>
          <div className="flex flex-wrap gap-2">
            <select className={`${FIELD} h-9 py-0`} value={vendor} onChange={(e) => setVendor(e.target.value as SourceAdapterName)} aria-label={t("ats.vendor")}>
              {ATS_VENDORS.map((v) => (
                <option key={v.adapter} value={v.adapter}>
                  {v.label}
                </option>
              ))}
            </select>
            <input className={`${FIELD} h-9 min-w-0 flex-1`} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={t("ats.slugPlaceholder")} aria-label={t("ats.slug")} maxLength={80} />
            <button type="submit" className={`${BTN_PRIMARY} h-9 px-3 text-sm`} disabled={busy !== null || !slug.trim()}>
              {busy === "ats" ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <Plus size={14} aria-hidden />} {t("ats.cta")}
            </button>
          </div>
          {/* One failure block, resolved by CODE (FailureNotice), not a bare red line
              the reader cannot act on. */}
          {error?.form === "ats" ? <FailureNotice failure={error.fail} fallback={t("error")} onDismiss={() => setError(null)} /> : null}
        </form>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (host.trim()) void create("board", { adapter: "board_sitemap_jsonld", config: {}, host: host.trim() });
          }}
        >
          <p className="flex items-center gap-1 text-sm font-medium text-ink">
            {t("board.label")}
            {/* The tier-B caveat used to be a line of prose under the field. It now
                rides on the label as a reachable hint (surface-doctrine §1). */}
            <IconAction icon={Info} label={tCommon("explain")} hint={t("board.hint")} side="bottom" size={16} />
          </p>
          <div className="flex flex-wrap gap-2">
            <input className={`${FIELD} h-9 min-w-0 flex-1`} value={host} onChange={(e) => setHost(e.target.value)} placeholder={t("board.hostPlaceholder")} aria-label={t("board.host")} maxLength={120} />
            <button type="submit" className={`${BTN_PRIMARY} h-9 px-3 text-sm`} disabled={busy !== null || !host.trim()}>
              {busy === "board" ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <Plus size={14} aria-hidden />} {t("board.cta")}
            </button>
          </div>
          {error?.form === "board" ? <FailureNotice failure={error.fail} fallback={t("error")} onDismiss={() => setError(null)} /> : null}
        </form>
      </div>
    </section>
  );
}
