"use client";

import { SegmentedControl } from "@/app/_components/SegmentedControl";

/*
 * PROTOTYPE SCAFFOLD — throwaway.
 *
 * One switcher shared by every chapter still choosing a direction, so the three
 * options read identically from chapter to chapter and a reader comparing them
 * is comparing the scenes rather than three slightly different toolbars.
 *
 * Every chapter deletes its own use of this when its direction is picked; the
 * file goes when the last one does.
 */

export type VariantOption<T extends string> = { value: T; label: string; blurb: string };

export function VariantSwitcher<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<VariantOption<T>>;
  value: T;
  onChange: (v: T) => void;
}) {
  const active = options.find((o) => o.value === value);
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
      <SegmentedControl
        label={label}
        options={options.map((o) => ({ value: o.value, label: o.label }))}
        value={value}
        onChange={onChange}
      />
      <p className="text-meta text-steel">{active?.blurb}</p>
    </div>
  );
}
