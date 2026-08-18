"use client";

// Preview renderers — INSIGHTS (Analytics, Matrix, Activity, About) and SETTINGS
// (Organization, Branding, Billing, Models, Integrations, Workspaces, Hiring).
import { Building2, CalendarDays, Cable, KeyRound, Plug, Webhook } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PalettePreview } from "@/app/_lib/palette-preview/types";
import { Badge, type BadgeTone } from "@/app/_components/Badge";
import { Meter } from "@/app/_components/Meter";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import { Chips, Row, Rows, Status, Sub, Tile, Tiles, useFmt } from "./previewBits";

type V<K extends PalettePreview["view"]> = Extract<PalettePreview, { view: K }>;

// ── Insights ──

export function PreviewAnalytics({ p }: { p: V<"analytics"> }) {
  const t = useTranslations("palettePreview.analytics");
  const { num } = useFmt();
  return (
    <>
      <Tiles>
        <Tile label={t("total")} value={num(p.total)} />
        <Tile label={t("reachedInterview")} value={num(p.reachedInterview)} />
        <Tile label={t("hired")} value={num(p.hired)} tone="moss" />
      </Tiles>
      {p.conversionPct != null ? (
        <div className="space-y-1">
          <Row label={t("conversion")}>{p.conversionPct} %</Row>
          <Meter value={p.conversionPct} tone={p.conversionPct >= 10 ? "strong" : p.conversionPct >= 4 ? "mid" : "weak"} aria-label={t("conversion")} />
        </div>
      ) : null}
    </>
  );
}

export function PreviewMatrix({ p }: { p: V<"matrix"> }) {
  const t = useTranslations("palettePreview.matrix");
  const { num } = useFmt();
  return (
    <Tiles>
      <Tile label={t("candidates")} value={num(p.candidates)} />
      <Tile label={t("openPositions")} value={num(p.openPositions)} />
      <Tile label={t("placements")} value={num(p.placements)} tone="moss" />
    </Tiles>
  );
}

export function PreviewActivity({ p }: { p: V<"activity"> }) {
  const t = useTranslations("palettePreview.activity");
  const { num, usd } = useFmt();
  return (
    <>
      <Tiles>
        <Tile label={t("calls")} value={num(p.calls30d)} />
        <Tile label={t("cost")} value={usd(p.costUsd30d)} />
        <Tile label={t("providers")} value={num(p.providers)} />
      </Tiles>
      <Rows>
        <Row label={t("running")}>{num(p.running)}</Row>
        <Row label={t("queued")}>{num(p.queued)}</Row>
      </Rows>
    </>
  );
}

export function PreviewAbout() {
  const t = useTranslations("palettePreview.about");
  return <p className="text-sm leading-relaxed text-steel">{t("blurb")}</p>;
}

// ── Settings ──

export function PreviewOrganization({ p }: { p: V<"organization"> }) {
  const t = useTranslations("palettePreview.organization");
  const { num } = useFmt();
  return (
    <>
      <div className="flex items-center gap-3">
        {p.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- customer logo URL, not a bundled asset
          <img src={p.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-stone-200 bg-white object-contain" />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-coral/10 font-serif text-h3 text-coral dark:-rotate-2" aria-hidden>
            {p.name.trim().charAt(0).toUpperCase() || "?"}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-serif text-h3 leading-tight text-ink">{p.name}</p>
          <p className="truncate text-sm text-steel">{p.domain ?? t("noDomain")}</p>
        </div>
      </div>
      <Tiles>
        <Tile label={t("members")} value={num(p.members)} />
        <Tile label={t("pendingInvites")} value={num(p.pendingInvites)} tone={p.pendingInvites > 0 ? "coral" : "steel"} />
        <Tile label={t("workspaces")} value={num(p.workspaces)} />
      </Tiles>
    </>
  );
}

export function PreviewBranding({ p }: { p: V<"branding"> }) {
  const t = useTranslations("palettePreview.branding");
  return (
    <>
      <div className="flex items-center gap-3">
        {/* The customer's chosen accent — data, not a design literal. */}
        <span className="h-10 w-10 shrink-0 rounded-lg border border-stone-200 bg-coral" style={p.accentColor ? { backgroundColor: p.accentColor } : undefined} aria-hidden />
        {p.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- customer logo URL, not a bundled asset
          <img src={p.logoUrl} alt="" className="h-10 max-w-[7rem] rounded-md border border-stone-200 bg-white object-contain px-1" />
        ) : null}
        <p className="min-w-0 truncate font-serif text-h3 leading-tight text-ink">{p.displayName ?? "KandiDate"}</p>
      </div>
      <Rows>
        <Row label={t("displayName")}>{p.displayName ? t("custom") : t("productDefault")}</Row>
        <Row label={t("accent")}>{p.accentColor ?? t("productDefault")}</Row>
        <Row label={t("logo")}>{p.logoUrl ? t("custom") : t("productDefault")}</Row>
      </Rows>
    </>
  );
}

const STATUS_TONE: Record<string, BadgeTone> = { active: "positive", trialing: "info", past_due: "caution", unpaid: "critical", canceled: "neutral" };

export function PreviewBilling({ p }: { p: V<"billing"> }) {
  const t = useTranslations("palettePreview.billing");
  const { date, num } = useFmt();
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="font-serif text-h3 leading-tight text-ink">{p.plan}</p>
        {p.status && p.status !== "none" ? <Badge tone={STATUS_TONE[p.status] ?? "neutral"} label={p.status} /> : null}
      </div>
      <Rows>
        <Row label={t("renews")}>{p.periodEnd ? date(p.periodEnd) : p.configured ? t("noPeriod") : t("unbilled")}</Row>
      </Rows>
      <div className="space-y-1.5">
        {p.meters.map((m) => {
          const ratio = m.limit && m.limit > 0 ? m.used / m.limit : 0;
          return (
            <div key={m.meter}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-steel">{t(`meters.${m.meter}` as Parameters<typeof t>[0])}</span>
                <span className="nums text-ink">
                  {num(m.used)}
                  <span className="text-steel"> / {m.limit == null ? t("unlimited") : num(m.limit)}</span>
                </span>
              </div>
              {m.limit != null ? <Meter value={ratio * 100} tone={ratio >= 0.9 ? "weak" : ratio >= 0.6 ? "mid" : "strong"} aria-label={m.meter} /> : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function PreviewModels({ p }: { p: V<"models"> }) {
  const t = useTranslations("palettePreview.models");
  const { num, usd } = useFmt();
  return (
    <>
      <Tiles>
        <Tile label={t("routed")} value={`${num(p.routed)} / ${num(p.useCases)}`} />
        <Tile label={t("cost")} value={usd(p.costUsd30d)} />
      </Tiles>
      <Sub>{t("providers")}</Sub>
      {p.providers.length ? <Chips items={p.providers} /> : <p className="flex items-center gap-1.5 text-sm text-steel"><KeyRound size={14} aria-hidden /> {t("noKeys")}</p>}
    </>
  );
}

const INTEGRATION_ICON = { calendar: CalendarDays, relay: Cable, atsWebhook: Webhook, atsConnections: Plug } as const;

export function PreviewIntegrations({ p }: { p: V<"integrations"> }) {
  const t = useTranslations("palettePreview.integrations");
  const anyOn = p.items.some((i) => i.state !== "missing");
  return (
    <div className="space-y-2">
      {!anyOn ? <p className="text-sm text-steel">{t("empty")}</p> : null}
      {p.items.map((it) => (
        <Status
          key={it.id}
          icon={INTEGRATION_ICON[it.id]}
          tone={it.state === "connected" ? "positive" : it.state === "configured" ? "info" : "neutral"}
          label={t(it.id)}
          detail={it.id === "atsWebhook" && it.detail ? t("events", { count: Number(it.detail) }) : it.detail}
        />
      ))}
    </div>
  );
}

export function PreviewWorkspace({ p }: { p: V<"workspace"> }) {
  const t = useTranslations("palettePreview.workspace");
  const { num } = useFmt();
  return (
    <>
      <div className="flex items-center gap-2">
        <Building2 size={16} className="shrink-0 text-steel" aria-hidden />
        <p className="truncate font-serif text-h3 leading-tight text-ink">{p.current}</p>
      </div>
      <Tiles>
        <Tile label={t("count")} value={num(p.count)} />
        <Tile label={t("members")} value={num(p.members)} />
      </Tiles>
      <span className={CHIP_QUIET}>{p.multi ? t("multiOn") : t("multiOff")}</span>
    </>
  );
}

export function PreviewHiringSettings({ p }: { p: V<"hiring"> }) {
  const t = useTranslations("palettePreview.hiring");
  const { num } = useFmt();
  return (
    <>
      <Tiles>
        <Tile label={t("stages")} value={num(p.stages.length)} />
        <Tile label={t("active")} value={num(p.active)} />
      </Tiles>
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {p.stages.map((s, i) => (
          <li key={`${s}-${i}`} className="flex items-center gap-1">
            <span className={CHIP_QUIET}>{s}</span>
            {i < p.stages.length - 1 ? <span className="text-stone-300" aria-hidden>›</span> : null}
          </li>
        ))}
      </ol>
      {p.regime ? (
        <Rows>
          <Row label={t("regime")}>{p.regime}</Row>
        </Rows>
      ) : null}
    </>
  );
}
