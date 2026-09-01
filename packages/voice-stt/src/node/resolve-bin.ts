// Binary resolution ladder shared by the local adapters: explicit env override ->
// the shared per-user sidecar home (one install serves every app on the machine)
// -> PATH. "installed" is derived from the real artifact, never a settings flag.
//
// The home is the SAME one @kazm/voice-tts uses, and that is the point: a
// machine has one folder of voice engines, not one per direction and not one
// per app. A product that defaults to an app-private folder reintroduces the
// duplicate multi-hundred-megabyte download the convention exists to remove.
import { accessSync, constants } from "node:fs";
import path from "node:path";
import type { SttHost } from "../types.ts";

export function sidecarHome(host: SttHost): string {
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

/** First readable match for any of `names`, in ladder order. Several names
 *  because whisper.cpp renamed its CLI (`main` -> `whisper-cli`) and both
 *  builds are in the wild; an installed engine under its old name is installed. */
export function resolveBinary(host: SttHost, opts: { envVar: string; names: readonly string[] }): string | null {
  const override = host.env(opts.envVar);
  if (override) return isReadableFile(override) ? override : null;
  const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);
  for (const name of opts.names) {
    const shared = path.join(sidecarHome(host), "bin", exe(name));
    if (isReadableFile(shared)) return shared;
  }
  const pathVar = host.env("PATH") || host.env("Path") || "";
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of opts.names) {
      const candidate = path.join(dir, exe(name));
      if (isReadableFile(candidate)) return candidate;
    }
  }
  return null;
}
