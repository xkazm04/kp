"use client";

export function PrintCredentialButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="focus-ring rounded-md border border-stone-300 px-3 py-1.5 text-sm font-semibold text-ink hover:bg-stone-100 print:hidden"
    >
      {label}
    </button>
  );
}
