"use client";

import { Printer } from "lucide-react";
import { BTN_PRIMARY } from "@/app/_components/ui/recipes";

/** `window.print()` behind a real button — the browser's own print/PDF dialog is
 *  the export; nothing is rendered server-side that the page does not already show. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className={`${BTN_PRIMARY} h-9 px-4`} onClick={() => window.print()}>
      <Printer size={16} aria-hidden /> {label}
    </button>
  );
}
