// Section wrapper (title + count + card chrome) shared by the In-progress and
// Done groups, split out of TasksTab.tsx so it stays under the 200-line file cap.
export function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-baseline justify-between">
        <h3 className="font-serif text-h2 text-ink">{title}</h3>
        <span className="text-meta uppercase text-steel">{count}</span>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}
