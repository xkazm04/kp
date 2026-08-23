// Binary resolution ladder shared by the local adapters: explicit env override ->
// the shared per-user sidecar home (one install serves every app on the machine)
// -> PATH. "installed" is derived from the real artifact, never a settings flag.
import { accessSync, constants } from "node:fs";
import path from "node:path";
import type { TtsHost } from "../types.ts";

/** The per-user home every app on this machine shares for local voice engines.
 *  The same layout the Personas desktop app installs into, so one download
 *  serves both apps: <home>/bin/<engine>.exe, <home>/kokoro/, <home>/piper/. */
export function sidecarHome(host: TtsHost): string {
  return host.env("VOICE_SIDECAR_HOME") || path.join(host.homeDir(), ".personas", "companion-tts");
}

export function isReadableFile(p: string): boolean {
  try {
    accessSync(p, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveBinary(host: TtsHost, opts: { envVar: string; name: string }): string | null {
  const override = host.env(opts.envVar);
  if (override) return isReadableFile(override) ? override : null;
  const exe = process.platform === "win32" ? `${opts.name}.exe` : opts.name;
  const shared = path.join(sidecarHome(host), "bin", exe);
  if (isReadableFile(shared)) return shared;
  const pathVar = host.env("PATH") || host.env("Path") || "";
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, exe);
    if (isReadableFile(candidate)) return candidate;
  }
  return null;
}
