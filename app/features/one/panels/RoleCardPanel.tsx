"use client";

// roleCard — GET /api/jobs?q=<role>&limit=1: the first role matching the user's own
// words, with the facts the Roles desk carries (company, location, seniority, lifecycle,
// hired / target). `matching` is the route's unbounded count over the same predicate, so
// "more roles match" is stated, never hidden. Params: role (required).
import { useLocale, useTranslations } from "next-intl";
import { ABSENT, formatCount } from "@/app/_components/kit";
import { PanelFrame } from "./PanelFrame";
import { isCount, useRead } from "./read";
import type { PanelProps } from "./types";

type Role = {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  seniority: string | null;
  status: "open" | "draft" | "closed";
  hired: number | null;
  target: number | null;
};
type RoleRead = { role: Role | null; matching: number | null };

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function parseRole(body: unknown): RoleRead | null {
  if (body == null || typeof body !== "object") return null;
  const b = body as { jobs?: unknown; matching?: unknown };
  if (!Array.isArray(b.jobs)) return null;
  const j = b.jobs[0] as Record<string, unknown> | undefined;
  if (!j || typeof j.id !== "string" || typeof j.title !== "string") return { role: null, matching: isCount(b.matching) ? b.matching : null };
  return {
    role: {
      id: j.id,
      title: j.title,
      company: s(j.company),
      location: s(j.location),
      seniority: s(j.seniority),
      // NULL status = a seeded / live corpus role (core.ts JobRecord.status).
      status: j.status === "draft" ? "draft" : j.status === "closed" ? "closed" : "open",
      hired: isCount(j.hired) ? j.hired : null,
      target: isCount(j.targetHires) ? j.targetHires : null,
    },
    matching: isCount(b.matching) ? b.matching : null,
  };
}

export function RoleCardPanel(props: PanelProps) {
  const t = useTranslations("one.core.panels");
  const locale = useLocale();
  const role = props.panel.params.role?.trim() || null;
  const read = useRead(role ? `/api/jobs?q=${encodeURIComponent(role)}&limit=1` : null, parseRole, props.epoch);
  const data = read.state === "ready" ? read.data : null;
  const r = data?.role ?? null;
  const more = data && r && data.matching !== null && data.matching > 1 ? data.matching - 1 : 0;
  const n = (v: number | null) => (v === null ? null : formatCount(v, locale));
  const facts: { key: string; label: string; value: string | null }[] = r
    ? [
        { key: "company", label: t("roleCard.company"), value: r.company },
        { key: "location", label: t("roleCard.location"), value: r.location },
        { key: "seniority", label: t("roleCard.seniority"), value: r.seniority },
        { key: "status", label: t("roleCard.status"), value: t(`roleCard.statuses.${r.status}`) },
        { key: "hired", label: t("roleCard.hired"), value: n(r.hired) },
        { key: "target", label: t("roleCard.target"), value: n(r.target) },
      ]
    : [];
  const absent = (
    <span data-tip={t("notReturned")} tabIndex={0}>
      {ABSENT}
    </span>
  );
  return (
    <PanelFrame
      props={props}
      data={{
        title: r?.title ?? t("roleCard.title"),
        state: more > 0 ? t("roleCard.more", { count: more }) : undefined,
        console: r ? { tab: "pipeline", params: { role: r.id }, label: t("roleCard.pipeline") } : undefined,
        read: role ? read : { state: "ready", data: null, retry: () => undefined },
        cols: [
          { key: "label", label: t("cols.field"), track: "10rem" },
          { key: "value", label: t("cols.value"), track: "minmax(0,1fr)" },
        ],
        actsTrack: "0",
        rows: facts.map((f) => ({
          key: f.key,
          cells: { label: <span className="text-steel">{f.label}</span>, value: <span className="font-semibold">{f.value ?? absent}</span> },
          line: f.label,
          trail: f.value ?? absent,
        })),
        empty: !role ? t("roleCard.needRole") : data && !r ? t("roleCard.notFound", { role }) : undefined,
      }}
    />
  );
}
