import { writeFile } from "node:fs/promises";
import path from "node:path";
import { runDevcaseCli } from "./devcase-run-cli";

export type SessionChatResult = {
  reply: string;
  source: string;
};

export type BaselineSolveResult = {
  baseline: Record<string, unknown>; // {solutions: [{files, note}], promptVersion}
  source: string;
};

/** One in-session assistant/stakeholder reply (LLM-era controls #2/#5). The
 *  transcript + message flow through the platform so the candidate's prompts are
 *  captured evidence; the reply persona lives in devcase/chat.py. */
export async function runSessionChat(
  channel: "assistant" | "stakeholder",
  kase: Record<string, unknown>,
  role: Record<string, unknown>,
  transcript: { channel: string; role: string; text: string }[],
  message: string,
  currentFile?: { path: string; contents: string } | null,
  lang?: string | null,
  signal?: AbortSignal
): Promise<SessionChatResult> {
  const payload = await runDevcaseCli<{ result: { reply?: { reply?: string } }; source: string }>(
    async (workdir) => {
      const write = async (name: string, data: unknown) => {
        const fp = path.join(workdir, name);
        await writeFile(fp, JSON.stringify(data), "utf-8");
        return fp;
      };
      const args = [
        "session-chat",
        "--case-json",
        await write("case.json", kase),
        "--role-json",
        await write("role.json", role),
        "--channel",
        channel,
        "--message",
        message,
        "--lang",
        lang || "en",
      ];
      if (transcript.length > 0) args.push("--chat-json", await write("chat.json", transcript));
      if (currentFile) args.push("--current-file-json", await write("current.json", currentFile));
      return args;
    },
    signal,
  );
  return { reply: String(payload.result.reply?.reply ?? ""), source: payload.source };
}

/** One-shot naive-LLM baseline solve (LLM-era controls #6) — run at freeze time
 *  beside the seed, persisted per case as the comparison target for every
 *  submission's "what did the human add beyond the bare model?". */
export async function runBaselineSolve(
  kase: Record<string, unknown>,
  role: Record<string, unknown>,
  seed: Record<string, unknown> | null
): Promise<BaselineSolveResult> {
  const payload = await runDevcaseCli<{ result: { baseline: Record<string, unknown> }; source: string }>(
    async (workdir) => {
      const write = async (name: string, data: unknown) => {
        const fp = path.join(workdir, name);
        await writeFile(fp, JSON.stringify(data), "utf-8");
        return fp;
      };
      const args = ["baseline-solve", "--case-json", await write("case.json", kase), "--role-json", await write("role.json", role)];
      if (seed) args.push("--seed-json", await write("seed.json", seed));
      return args;
    },
  );
  return { baseline: payload.result.baseline, source: payload.source };
}
