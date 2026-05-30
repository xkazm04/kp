import type { JobRequirement } from "./JobsTypes";

export function ReqChip({ req }: { req: JobRequirement }) {
  const learnable = req.hardness === "learnable";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${
        learnable ? "border-amber-200 bg-amber-50 text-amber-800" : "border-stone-300 bg-white text-ink"
      }`}
      title={`${req.kind} · ${req.hardness}${req.termId ? ` · ${req.termId}` : ""}`}
    >
      {req.skill}
      <span className="text-[10px] uppercase opacity-70">{learnable ? "learnable" : "prereq"}</span>
    </span>
  );
}

export function Chip({ label, value, tone = "neutral" }: { label: string; value: string | number; tone?: "neutral" | "green" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${
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
      className="focus-ring h-10 rounded-md border border-stone-200 bg-white px-2 text-sm capitalize text-ink"
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
    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-steel">
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-sm text-ink ${className}`}>{children}</td>;
}

export function SkelBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-stone-100 motion-reduce:animate-none ${className}`} />;
}
