import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { JobRequirement, SkippedCandidate } from "./JobsTypes";

// Amber disclosure listing candidates the ranker couldn't score (malformed
// profile). Shared by RecruiterCandidates and RediscoverPanel so both surfaces
// explain a skipped candidate identically: recruiter_cli produces this array
// once, and neither view may silently drop it. Renders nothing when empty.
export function SkippedCandidatesNote({ skipped }: { skipped: SkippedCandidate[] }) {
  const t = useTranslations("jobs.shared");
  if (!skipped.length) return null;
  return (
    <details className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-sm text-amber-800">
      <summary className="cursor-pointer font-semibold">
        {t("skippedSummary", { count: skipped.length })}
      </summary>
      <ul className="mt-1 space-y-0.5">
        {skipped.map((s) => (
          <li key={s.id}>
            <span className="font-medium">{s.label}</span>{` — ${s.reason}`}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ReqChip({ req }: { req: JobRequirement }) {
  const t = useTranslations("jobs.shared");
  const learnable = req.hardness === "learnable";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-sm ${
        learnable ? "border-amber-200 bg-amber-50 text-amber-800" : "border-stone-300 bg-white text-ink"
      }`}
      title={`${req.kind} · ${req.hardness}${req.termId ? ` · ${req.termId}` : ""}`}
    >
      {req.skill}
      <span className="text-sm uppercase opacity-70">{learnable ? t("reqLearnable") : t("reqPrereq")}</span>
    </span>
  );
}

export function Chip({ label, value, tone = "neutral" }: { label: string; value: string | number; tone?: "neutral" | "green" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${
        tone === "green" ? "border-green-200 bg-green-50 text-green-800" : "border-stone-200 bg-paper text-ink"
      }`}
    >
      <span className="uppercase tracking-wide text-steel">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

export function Select({
  value,
  onChange,
  all,
  label,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  all: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="focus-ring h-10 rounded-md border border-stone-200 bg-white px-2 text-base capitalize text-ink"
    >
      <option value="">{all}</option>
      {children}
    </select>
  );
}

export function Meta({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-steel">{k}</dt>
      <dd className="capitalize text-ink">{v}</dd>
    </>
  );
}

export function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide text-steel">
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-base text-ink ${className}`}>{children}</td>;
}

export function SkelBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-stone-100 motion-reduce:animate-none ${className}`} />;
}

// Shared empty-state primitive: one icon + copy treatment for every empty
// surface in the jobs tab and posting modal. `compact` is for tight surfaces
// (e.g. a candidate column that already has its own header); the default is the
// full dashed card used for whole panels.
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="mt-2 flex flex-col items-center gap-1.5 py-3 text-center">
        <Icon className="h-5 w-5 text-stone-400" aria-hidden />
        <p className="text-sm text-steel">{title}</p>
        {body ? <p className="text-sm text-steel">{body}</p> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-12 text-center">
      <Icon className="h-8 w-8 text-steel" aria-hidden />
      <div>
        <p className="text-base font-semibold text-ink">{title}</p>
        {body ? <p className="mt-1 text-base text-steel">{body}</p> : null}
      </div>
      {action ?? null}
    </div>
  );
}
