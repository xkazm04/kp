export function upd<T>(arr: T[], i: number, patch: Partial<T>): T[] {
  return arr.map((x, j) => (j === i ? { ...x, ...patch } : x));
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 p-3">
      <p className="text-sm font-semibold uppercase tracking-wide text-steel">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

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
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={errId}
        className={`focus-ring h-9 rounded-md border px-2 text-base ${error ? "border-coral" : "border-stone-200"}`}
      />
      {error ? <span id={errId} className="text-sm text-coral">{error}</span> : null}
    </label>
  );
}

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
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="focus-ring h-9 rounded-md border border-stone-200 bg-white px-2 text-base capitalize"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-base text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-coral" />
      {label}
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
  return (
    <button type="button" onClick={onClick} className="focus-ring rounded-md px-2 text-base text-steel hover:text-red-600" aria-label="Remove">
      ×
    </button>
  );
}
