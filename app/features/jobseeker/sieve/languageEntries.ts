// The seeker's own languages, as the Want step's editor holds them.
//
// Stored as plain strings in `preferences.languages`, in the one shape the CV's
// languageLine already reads: "German (B2)", "Czech (native)", "English". A level is a
// CEFR code, "native", or — carried over from a CV that said so — the CV's own word
// ("fluent"); it is never inferred. Names are trimmed, deduplicated case-insensitively
// (the later duplicate is dropped) and capped, so the list the server receives is the
// list the seeker sees.

import { splitLanguage } from "../cv/cvContent";

export const LANGUAGE_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "native"] as const;
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];
export function isLanguageLevel(v: unknown): v is LanguageLevel {
  return typeof v === "string" && (LANGUAGE_LEVELS as readonly string[]).includes(v);
}

export const MAX_LANGUAGES = 12;
/** languageLine drops a name longer than this, so the editor never stores one. */
export const MAX_LANGUAGE_NAME = 40;

export type LanguageEntry = { name: string; level: string | null };

export function readLanguage(raw: string): LanguageEntry | null {
  const split = splitLanguage(raw);
  return split ? { name: split.name, level: split.level } : null;
}

export function formatLanguage(entry: LanguageEntry): string {
  return entry.level ? `${entry.name} (${entry.level})` : entry.name;
}

/** Any list of stated languages → the stored shape: parsed, trimmed, deduplicated by
 *  name (case-insensitively), capped at MAX_LANGUAGES. */
export function normalizeLanguages(raw: readonly string[]): string[] {
  const out: LanguageEntry[] = [];
  for (const item of raw) {
    const entry = readLanguage(item);
    if (!entry || out.some((e) => e.name.toLowerCase() === entry.name.toLowerCase())) continue;
    out.push(entry);
    if (out.length === MAX_LANGUAGES) break;
  }
  return out.map(formatLanguage);
}

/** Add what was typed ("German", or "German (B2)"). Unchanged when the name is empty,
 *  already listed, too long, or the list is full. */
export function addLanguage(list: readonly string[], typed: string): string[] {
  return normalizeLanguages([...list, typed]);
}

export function setLanguageLevel(list: readonly string[], index: number, level: string | null): string[] {
  const entries = list.map(readLanguage);
  const entry = entries[index];
  if (!entry) return [...list];
  entries[index] = { name: entry.name, level: level || null };
  return normalizeLanguages(entries.filter((e): e is LanguageEntry => !!e).map(formatLanguage));
}

export function removeLanguage(list: readonly string[], index: number): string[] {
  return list.filter((_, i) => i !== index);
}
