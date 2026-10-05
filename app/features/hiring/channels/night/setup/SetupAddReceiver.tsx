"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Segmented } from "@/app/_components/kit";
import { SearchSelect } from "@/app/_components/table/ColumnFilter";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { buildTabSwitchUrl } from "@/app/features/shell/tabs";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/locales";
import type { ChannelJob } from "../../useChannelsData";
import { SetupField, SetupResult } from "./SetupBits";

/**
 * Add a receiver (POST /api/channels/webhooks, the retired AddReceiverModal's rules), in place: a
 * role (a searchable picker over the OPEN roles; the first is the derived default, so a list that
 * arrives late still preselects) and the candidates' language. While the roles are unread the
 * picker holds its height and says nothing (an unread list is not "publish a role first"); a
 * truly empty one says so, with the way to the JD library. A refusal reads its code. The route
 * answers `{ webhook }`: the new token is handed back so its card opens revealed.
 */
export function SetupAddReceiver({ channel, jobs, onCreated }: {
  channel: "email" | "boards";
  jobs: ChannelJob[] | null;
  onCreated: (token: string) => void;
}) {
  const t = useTranslations("channels");
  const locale = useLocale();
  const errMsg = useErrorMessage();
  const router = useRouter();
  const search = useSearchParams();
  const [jobId, setJobId] = useState("");
  const selected = jobId || jobs?.[0]?.id || "";
  const [lang, setLang] = useState<Locale>(DEFAULT_LOCALE);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = new Intl.DisplayNames([locale], { type: "language" });

  const create = async () => {
    if (creating || !selected) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/channels/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, jobId: selected, lang }),
      });
      const p = (await r.json().catch(() => null)) as { webhook?: ChannelWebhookRecord; code?: string } | null;
      if (!r.ok || !p?.webhook) {
        setError(errMsg(p, t("add.createFailed")));
        return;
      }
      onCreated(p.webhook.token);
    } catch {
      setError(t("add.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  if (jobs === null) return <div className="cns-panel cns-hold" aria-hidden />;
  if (jobs.length === 0) {
    return (
      <div className="cns-panel cns-row">
        <p className="cns-help">{t("add.noJobs")}</p>
        <Button label={t("add.noJobsCta")} variant="link" icon="right" onClick={() => router.push(buildTabSwitchUrl("intake", search.toString()))} />
      </div>
    );
  }
  return (
    <form
      className="cns-panel cns-form"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <SetupField label={t("add.roleLabel")}>
        {({ id }) => <SearchSelect id={id} value={selected} onChange={setJobId} placeholder={t("add.rolePlaceholder")} options={jobs.map((j) => ({ value: j.id, label: j.title }))} />}
      </SetupField>
      <div className="cns-field">
        <span className="cns-field__label" aria-hidden="true">
          {t("add.langLabel")}
        </span>
        <Segmented
          label={t("add.langLabel")}
          value={lang}
          onChange={(v) => setLang(v as Locale)}
          items={LOCALES.map((l) => ({ value: l, label: l.toUpperCase(), tip: names.of(l) }))}
        />
      </div>
      <div className="cns-row">
        <Button type="submit" label={t("add.create")} loadingLabel={t("add.creating")} loading={creating} disabled={!selected} variant="primary" icon="check" />
      </div>
      {error ? <SetupResult ok={false}>{error}</SetupResult> : null}
    </form>
  );
}
