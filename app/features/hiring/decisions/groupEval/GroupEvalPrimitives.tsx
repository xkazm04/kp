import type { LucideIcon } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import { CHIP_QUIET, META_LABEL, NOTICE } from "@/app/_components/ui/recipes";
import { initials } from "@/app/_lib/initials";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { styleFor } from "@/app/features/shared/decisionsTypes";

// ---- Primitives -----------------------------------------------------------

export const PILL_TONE: Record<string, string> = {
  // The quiet tag IS the shared recipe (CHIP_QUIET) — this local copy of it had
  // drifted from the seam that re-skins every other quiet chip in both themes.
  // CHIP_QUIET switches to inline-block in Spark Dark so its tilt applies to a bare
  // <span>; a Pill is already inline-flex (it carries icons), so the display is put
  // back — the tilt applies to a flex box just as well.
  neutral: `${CHIP_QUIET} dark:inline-flex`,
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

/** The modal's advisory block — pool drift, capped coverage, a governance-mode
 *  mismatch, an unavailable evaluation. Hand-rolled FOUR times (two here, two in
 *  GroupEvalModal) with three different paddings and two icon sizes; one component
 *  now, so a change to the amber advisory lands everywhere at once. Amber's shades
 *  are token-mapped in both themes (globals.css `[data-theme="dark"]`). */
export function Notice({ icon: Icon = AlertTriangle, children }: { icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <div className={`flex items-start gap-2 ${NOTICE()} p-3 text-base`}>
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className={META_LABEL}>{children}</h3>;
}
