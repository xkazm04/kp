import type { ReactNode } from "react";
import { LoadStatus } from "@/app/_components/LoadStatus";
import type { LoadState } from "@/app/_lib/useLoader";

// Shared shell for the Dev studio's list sections (lifecycle, approved cases,
// postings, outbox). Owns the empty-vs-failed guard — an empty+healthy section
// renders nothing, an empty+failed one surfaces the outage (never an
// indistinguishable blank) — and the section header (icon, title, the `· count`
// chip, and the stale-data pill), so each caller supplies only its list body as
// children. `icon` is passed pre-styled so each section keeps its own glyph + accent.
export function DevSection({
  icon,
  title,
  count,
  state,
  label,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  state: LoadState;
  label: string;
  children: ReactNode;
}) {
  if (count === 0) return <LoadStatus state={state} label={label} />;
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        {icon} {title} <span className="text-coral">· {count}</span>
        <LoadStatus state={state} label={label} variant="pill" />
      </h3>
      {children}
    </section>
  );
}

export function MiniList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-micro font-semibold uppercase tracking-wide text-steel">{title}</p>
      <ul className="mt-0.5 space-y-0.5">
        {items.slice(0, 5).map((it, i) => (
          <li key={i} className="flex gap-1 text-micro text-ink"><span className="text-moss">•</span><span>{it}</span></li>
        ))}
        {items.length === 0 ? <li className="text-micro text-steel">—</li> : null}
      </ul>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-micro font-semibold uppercase tracking-wide text-steel">{label}</span>
      {children}
    </label>
  );
}
