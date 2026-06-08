// Shared "get this off the screen" toolkit for the export/share surfaces (ranked
// matches, the fit matrix, candidate reports, interview prep, calendar invites).
// The pure serializers (toCsv, buildIcs) are testable in isolation; the two
// browser helpers (downloadFile, copyText) reference DOM globals only at call
// time, so this module still imports cleanly under `node --test`.

/** RFC 4180-ish CSV: fields containing a comma, double-quote, or newline are
 *  wrapped in double-quotes with embedded quotes doubled. A trailing CRLF is
 *  omitted; rows are joined with CRLF (the line ending spreadsheet apps expect). */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined): string => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

// ICS text escaping (RFC 5545 §3.3.11): backslash, semicolon, comma escaped; a
// newline becomes a literal \n. Applied to SUMMARY / DESCRIPTION / LOCATION.
function icsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// A UTC timestamp in iCalendar basic format: YYYYMMDDTHHMMSSZ. Takes an ISO
// string (or anything Date parses) — deterministic, never reads the clock.
function icsStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`buildIcs: unparseable date "${iso}"`);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export type IcsEvent = {
  uid: string;
  /** ISO start datetime. */
  start: string;
  durationMin: number;
  title: string;
  description?: string;
  location?: string;
  /** ISO creation stamp (DTSTAMP). Pass new Date().toISOString() from the caller
   *  so this stays pure/testable; defaults to `start` when omitted. */
  stamp?: string;
};

/** Build a single-event VCALENDAR (METHOD:PUBLISH) the candidate can import into
 *  any calendar. DTEND is start + durationMin. Lines are CRLF-joined per the spec. */
export function buildIcs(event: IcsEvent): string {
  const startMs = new Date(event.start).getTime();
  if (Number.isNaN(startMs)) throw new Error(`buildIcs: unparseable start "${event.start}"`);
  const end = new Date(startMs + Math.max(0, event.durationMin) * 60_000).toISOString();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//kp//interview//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${icsStamp(event.stamp ?? event.start)}`,
    `DTSTART:${icsStamp(event.start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsText(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${icsText(event.description)}`] : []),
    ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

/** Trigger a client-side file download of `content`. Browser-only (uses Blob +
 *  object URL + a transient anchor); a no-op outside the browser. */
export function downloadFile(filename: string, content: string, mime = "text/plain"): void {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return;
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Copy text to the clipboard, resolving to whether it succeeded. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
