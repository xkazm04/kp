import { DAYS, initialsOf, styleFor, TIMES, type SchedEntry } from "./ScheduleTypes";

// One shared week grid holding every pending interview. Each candidate sits in
// their (picked) slot; selecting a candidate and clicking a cell re-proposes
// that slot for them. A coral ring marks the currently selected candidate.
export function ScheduleCalendar({
  entries,
  picks,
  selectedId,
  onSelect,
  onPickSlot,
}: {
  entries: SchedEntry[];
  picks: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPickSlot: (slot: string) => void;
}) {
  const inSlot = (slot: string) => entries.filter((e) => (picks[e.id] ?? "") === slot);

  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-panel">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-[64px_repeat(5,1fr)] border-b border-stone-200 bg-paper text-center text-meta uppercase text-steel">
          <div className="py-2" />
          {DAYS.map((d) => (
            <div key={d} className="py-2 font-semibold">
              {d}
            </div>
          ))}
        </div>
        {TIMES.map((t) => (
          <div key={t} className="grid grid-cols-[64px_repeat(5,1fr)] border-t border-stone-100">
            <div className="px-2 py-3 text-sm text-steel">{t}</div>
            {DAYS.map((d) => {
              const slot = `${d} ${t}`;
              const here = inSlot(slot);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => onPickSlot(slot)}
                  aria-label={`Slot ${slot}`}
                  className="min-h-14 space-y-1 border-l border-stone-100 p-1.5 text-left align-top transition-colors hover:bg-coral/5"
                >
                  {here.map((e) => {
                    const s = styleFor(e.archetype);
                    const selected = e.id === selectedId;
                    return (
                      <span
                        key={e.id}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onSelect(e.id);
                        }}
                        title={`${e.candidateLabel} · ${e.jobTitle ?? ""}`}
                        className={`flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium text-white ${s.bg} ${
                          selected ? "ring-2 ring-coral ring-offset-1" : ""
                        }`}
                      >
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/25 text-[10px]">
                          {initialsOf(e.candidateLabel)}
                        </span>
                        <span className="truncate">{e.candidateLabel}</span>
                      </span>
                    );
                  })}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
