import { initials } from "@/app/_lib/initials";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { styleFor } from "../DecisionsTypes";

// ---- Primitives -----------------------------------------------------------

export const PILL_TONE: Record<string, string> = {
  neutral: "bg-stone-100 text-steel",
  moss: "bg-moss/15 text-moss",
  coral: "bg-coral/10 text-coral",
  amber: "bg-amber-100 text-amber-700",
  info: "bg-blue-50 text-blue-700",
};

export function Pill({
  children,
  tone = "neutral",
  className = "",
  title,
}: {
  children: React.ReactNode;
  tone?: keyof typeof PILL_TONE;
  className?: string;
  title?: string;
}) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-semibold ${PILL_TONE[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function Avatar({ label, archetype, size = "md" }: { label: string; archetype?: string | null; size?: "sm" | "md" }) {
  const enumLabel = useEnumLabel();
  const s = styleFor(archetype ?? null);
  const dim = size === "sm" ? "h-6 w-6 text-sm" : "h-8 w-8 text-base";
  return (
    <span className={`grid ${dim} shrink-0 place-items-center rounded-full font-semibold text-white ${s.bg}`} title={enumLabel("archetype", archetype ?? "bau")}>
      {initials(label, "?")}
    </span>
  );
}

export function ArchetypeTag({ archetype }: { archetype?: string | null }) {
  const enumLabel = useEnumLabel();
  const s = styleFor(archetype ?? null);
  return (
    <Pill>
      <span className={`h-2 w-2 rounded-full ${s.bg}`} aria-hidden /> {enumLabel("archetype", archetype ?? "bau")}
    </Pill>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold uppercase tracking-wide text-steel">{children}</h3>;
}
