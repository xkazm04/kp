"use client";

// The preview pane's small vocabulary — one place for the tile, the fact row,
// the status line and the number/date formatters, so the ~25 view renderers
// (PreviewHiring / PreviewLibraryTools / PreviewInsightsSettings /
// PreviewEntities) compose the same few shapes and read as one surface.
import type { ReactNode } from "react";
import { useLocale } from "next-intl";
import type { LucideIcon } from "lucide-react";
import type { BadgeTone } from "@/app/_components/Badge";
import { CHIP_QUIET, STAT_LABEL } from "@/app/_components/ui/recipes";

/** Locale-aware formatters — numbers, money, dates, and "3 d ago". */
export function useFmt() {
  const locale = useLocale();
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  const usd = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 2 : 0 }).format(n);
  const pct = (ratio: number) => `${Math.round(ratio * 100)} %`;
  const date = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(d);
  };
  const dateTime = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
  };
  const rel = (iso: string | null) => {
    if (!iso) return "—";
    const ms = Date.parse(iso) - Date.now();
    if (!Number.isFinite(ms)) return iso;
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    const abs = Math.abs(ms);
    if (abs < 3_600_000) return rtf.format(Math.round(ms / 60_000), "minute");
    if (abs < 86_400_000) return rtf.format(Math.round(ms / 3_600_000), "hour");
    if (abs < 30 * 86_400_000) return rtf.format(Math.round(ms / 86_400_000), "day");
    return rtf.format(Math.round(ms / (30 * 86_400_000)), "month");
  };
  return { num, usd, pct, date, dateTime, rel };
}

/** A row of 2–3 compact stat tiles — the pane's headline numbers. */
export function Tiles({ children }: { children: ReactNode }) {
  // Auto-fit: two tiles get half each, three get thirds — no fixed column count.
  return <div className="grid auto-cols-fr grid-flow-col gap-2">{children}</div>;
}

export function Tile({ label, value, tone = "ink" }: { label: string; value: ReactNode; tone?: "ink" | "coral" | "moss" | "steel" }) {
  const color = tone === "coral" ? "text-coral" : tone === "moss" ? "text-moss" : tone === "steel" ? "text-steel" : "text-ink";
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-2 dark:-rotate-[0.4deg]">
      {/* Number first — it is what the eye is here for — then the sentence-case
          label on ONE line (truncated, full text in the tooltip). */}
      <span className={`font-serif text-h2 leading-none nums ${color}`}>{value}</span>
      <span className="truncate text-sm leading-tight text-steel" title={label}>
        {label}
      </span>
    </div>
  );
}

/** A labelled fact on one line — label left, value right. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="shrink-0 text-steel">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-ink">{children}</span>
    </div>
  );
}

export function Rows({ children }: { children: ReactNode }) {
  return <div className="space-y-1.5">{children}</div>;
}

/** Section eyebrow inside the pane ("By stage", "Top role families"). */
export function Sub({ children }: { children: ReactNode }) {
  return <p className={`${STAT_LABEL} pt-1`}>{children}</p>;
}

/** A status line: icon + text, toned by the state (connected / configured / missing). */
export function Status({ icon: Icon, tone, label, detail }: { icon?: LucideIcon; tone: BadgeTone; label: string; detail?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="flex min-w-0 items-center gap-1.5 text-ink">
        {Icon ? <Icon size={14} className="shrink-0 text-steel" aria-hidden /> : null}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {detail ? <span className="max-w-[9rem] truncate text-steel">{detail}</span> : null}
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden />
      </span>
    </div>
  );
}

/** Status dot per tone — filled for live states, hollow-looking (stone) for "not set up". */
const DOT: Record<BadgeTone, string> = {
  positive: "bg-moss",
  info: "bg-blue-700",
  caution: "bg-amber-700",
  critical: "bg-red-700",
  neutral: "border border-stone-300 bg-transparent",
};

/** Chip list ("Java · senior · Prague") from nullable strings — skips empties. */
export function Chips({ items }: { items: (string | null | undefined)[] }) {
  const shown = items.filter((s): s is string => !!s && s.trim().length > 0);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((s) => (
        <span key={s} className={CHIP_QUIET}>
          {s}
        </span>
      ))}
    </div>
  );
}

/** A ranked mini list with a proportional bar behind each count. */
export function RankList({ items, peak }: { items: { name: string; count: number }[]; peak?: number }) {
  const max = Math.max(1, peak ?? Math.max(...items.map((i) => i.count), 1));
  return (
    <ul className="space-y-1">
      {items.map((it) => (
        <li key={it.name} className="relative flex items-center justify-between gap-2 overflow-hidden rounded-md px-2 py-1 text-sm">
          <span aria-hidden className="absolute inset-y-0 left-0 bg-coral/10" style={{ width: `${Math.round((it.count / max) * 100)}%` }} />
          <span className="relative min-w-0 truncate text-ink">{it.name}</span>
          <span className="relative shrink-0 nums text-steel">{it.count}</span>
        </li>
      ))}
    </ul>
  );
}
