import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useTranslations } from "next-intl";
import { Select as UiSelect } from "@/app/_components/Select";

export function upd<T>(arr: T[], i: number, patch: Partial<T>): T[] {
  return arr.map((x, j) => (j === i ? { ...x, ...patch } : x));
}

// One source of truth for field chrome — tweak the focus-ring, radius, or border
// here and every profile-form control (Input/Select/Textarea, and Text/Pick which
// build on them) picks it up. The border *color* is appended per-control so an
// invalid Input can swap stone-200 for coral without a class collision.
const FIELD_CHROME = "focus-ring rounded-md border bg-white text-ink caret-coral placeholder:text-steel";
const FIELD_BORDER = "border-stone-200";

export function Input({
  className = "",
  error = false,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return (
    <input
      {...rest}
      aria-invalid={error || undefined}
      className={`${FIELD_CHROME} h-9 px-2 text-base ${error ? "border-coral" : FIELD_BORDER} ${className}`}
    />
  );
}

// Delegates to the shared dual-theme Select (custom listbox) so the option list
// re-skins in Spark Dark instead of falling back to an OS-rendered popup. The
// value-based onChange + options API replaces the old native `<select>`'s
// event-based onChange + `<option>` children.
export function Select({
  className = "",
  value,
  onChange,
  ariaLabel,
  options,
  disabled,
}: {
  className?: string;
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
  options: { value: string; label: string }[];
}) {
  return <UiSelect value={value} onChange={onChange} ariaLabel={ariaLabel} disabled={disabled} size="sm" className={className} options={options} />;
}

export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={`${FIELD_CHROME} ${FIELD_BORDER} w-full text-base ${className}`} />;
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 p-3">
      <p className="text-sm font-semibold uppercase tracking-wide text-steel">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

// Labeled text field — its uppercase caption + styled input is the standard
// intake field. Routes its control through the shared Input primitive.
export function Text({
  label,
  value,
  onChange,
  placeholder,
  className = "",
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  error?: string;
}) {
  const errId = error ? `${label.replace(/\s+/g, "-").toLowerCase()}-err` : undefined;
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-sm uppercase tracking-wide text-steel">{label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        error={Boolean(error)}
        aria-describedby={errId}
      />
      {error ? <span id={errId} className="text-sm text-coral">{error}</span> : null}
    </label>
  );
}

// Labeled select — routes its control through the shared Select primitive.
export function Pick({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm uppercase tracking-wide text-steel">{label}</span>
      <Select
        value={value}
        onChange={onChange}
        ariaLabel={label}
        className="capitalize"
        options={options.map((o) => ({ value: o.v, label: o.label }))}
      />
    </label>
  );
}

export function Check({
  label,
  checked,
  onChange,
  className = "",
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  return (
    <label className={`flex items-center gap-2 text-base text-ink ${className}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-coral" />
      {label}
    </label>
  );
}

// Generic labeled-field wrapper: a caption above an arbitrary control. Shared so
// forms (e.g. ArchetypeManager) don't each redefine the same label markup.
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-steel">{label}</span>
      {children}
    </label>
  );
}

export function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="focus-ring mt-2 rounded-md border border-dashed border-stone-300 px-2 py-1 text-sm text-steel hover:bg-paper">
      {label}
    </button>
  );
}

export function RemoveBtn({ onClick }: { onClick: () => void }) {
  const t = useTranslations("profile.fields");
  return (
    <button type="button" onClick={onClick} className="focus-ring rounded-md px-2 text-base text-steel hover:text-red-600" aria-label={t("remove")}>
      {"×"}
    </button>
  );
}
