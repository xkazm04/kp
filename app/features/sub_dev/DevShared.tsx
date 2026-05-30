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
