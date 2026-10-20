"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Note, Segmented } from "@/app/_components/kit";
import { ConditionMark } from "@/app/_components/kit/scene";
import type { Endpoint, ReceiverSection } from "./setupModel";

const CLIENTS = {
  email: [{ value: "gmail", label: "Gmail" }, { value: "outlook", label: "Outlook" }],
  ads: [{ value: "linkedin", label: "LinkedIn" }, { value: "meta", label: "Meta" }],
} as const;
const STEPS = {
  gmail: ["email.gmail1", "email.gmail2", "email.gmail3", "email.gmail4"],
  outlook: ["email.outlook1", "email.outlook2", "email.outlook3", "email.outlook4"],
  linkedin: ["ads.linkedin1", "ads.linkedin2", "ads.linkedin3", "ads.linkedin4"],
  meta: ["ads.meta1", "ads.meta2", "ads.meta3", "ads.meta4"],
} as const;
type Client = keyof typeof STEPS;

/**
 * How to point a source at this receiver: per client (Gmail / Outlook forwarding for email intake;
 * LinkedIn / Meta lead-gen through Zapier or Make for ad forms), the numbered steps with the
 * receiver's endpoint in them (masked unless the card has revealed it), whether anything has
 * arrived yet, and the ads' direct-POST footnote. Email with no inbound domain says why in full:
 * no mailbox exists, the real receiver is the HTTP endpoint, and how to wire forwarding.
 */
export function SetupGuideSteps({ section, role, endpoint, revealed, live }: {
  section: ReceiverSection;
  role: string;
  endpoint: Endpoint;
  revealed: boolean;
  live: boolean;
}) {
  const t = useTranslations("channels");
  const [client, setClient] = useState<Client>(section === "email" ? "gmail" : "linkedin");
  const b = (c: ReactNode) => <b>{c}</b>;
  const code = (c: ReactNode) => <code className="k-code">{c}</code>;
  const shown = (v: string, m: string) => <code className="k-code">{revealed ? v : m}</code>;

  if (!endpoint.wired) {
    return (
      <Note tone="caution">
        <b>{t("email.notWiredTitle")}</b> {t.rich("email.notWiredBody", { role, b })} {shown(endpoint.http, endpoint.httpMasked)} {t("email.notWiredHowTo")}{" "}
        {t.rich("email.notWiredHowToSetup", { code })}
      </Note>
    );
  }

  const node = shown(endpoint.value, endpoint.masked);
  return (
    <div className="cns-guide">
      <div className="cns-row cns-row--split">
        <p className="cns-help">
          {t.rich(section === "email" ? "email.lead" : "ads.lead", { role, b })} {node}
        </p>
        <ConditionMark condition={live ? "live" : "wait"} label={live ? t("guide.live") : t(section === "email" ? "email.waiting" : "ads.waiting")} />
      </div>
      <Segmented label={t("guide.setupFor")} lead={t("guide.setupFor")} items={[...CLIENTS[section]]} value={client} onChange={(v) => setClient(v as Client)} />
      <ol className="cns-steps" key={client}>
        {STEPS[client].map((k) => (
          <li key={k}>
            <span>{t.rich(k, { b, i: (c) => <i>{c}</i>, endpoint: () => node })}</span>
          </li>
        ))}
      </ol>
      {section === "ads" ? <p className="cns-help">{t.rich("ads.footnote", { code })}</p> : null}
    </div>
  );
}
