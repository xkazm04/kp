#!/usr/bin/env node

/**
 * Text-to-image via Alibaba DashScope (Wan / Qwen-Image) — the third generator,
 * behind openai-image.mjs (gpt-image-2 on an OpenAI key) and leonardo-gpt-image.mjs
 * (gpt-image-2 on a Leonardo key). Runs on the same $QWEN_API_KEY the motionize
 * skill already uses for vision recognition, so it keeps working when the Leonardo
 * API token pool is drained (that pool renews monthly and *does* run out).
 *
 * DashScope's async contract: POST a task, poll /tasks/<id> until SUCCEEDED, then
 * download the result URL.
 *
 * `prompt_extend` is disabled by default: DashScope otherwise rewrites a terse
 * prompt into a florid one (adding shadows, depth, extra props), which is exactly
 * what a FLAT trace-friendly source must not have.
 *
 * `--negative` is worth spending: this family of models happily adds drop shadows,
 * gradients, cartoon faces and a tinted backdrop unless told not to.
 *
 * Usage:
 *   node qwen-image.mjs generate --prompt "..." --output path.png \
 *     [--size 1024*1024] [--model qwen-image] [--negative "..."] [--seed 42] [--extend]
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

const API_KEY = process.env.QWEN_API_KEY;
const BASE = (process.env.QWEN_IMAGE_BASE_URL || "https://dashscope-intl.aliyuncs.com").replace(/\/+$/, "");
const SUBMIT = `${BASE}/api/v1/services/aigc/text2image/image-synthesis`;
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 60;

function parseArgs(argv) {
  const a = {};
  for (let i = 3; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2), n = argv[i + 1];
      if (n && !n.startsWith("--")) { a[k] = n; i++; } else a[k] = true;
    }
  }
  return a;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (o) => { console.error(JSON.stringify(o, null, 2)); process.exit(1); };

async function generate(args) {
  if (!args.prompt || !args.output) die({ error: "Usage: generate --prompt \"...\" --output path.png" });

  const model = args.model || "qwen-image";
  const body = {
    model,
    input: { prompt: args.prompt, ...(args.negative ? { negative_prompt: args.negative } : {}) },
    parameters: {
      size: args.size || "1024*1024",
      n: 1,
      prompt_extend: Boolean(args.extend),
      watermark: false,
      ...(args.seed ? { seed: Number(args.seed) } : {}),
    },
  };

  const res = await fetch(SUBMIT, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", "X-DashScope-Async": "enable" },
    body: JSON.stringify(body),
  });
  const submitted = await res.json().catch(() => ({}));
  const taskId = submitted?.output?.task_id;
  if (!res.ok || !taskId) die({ error: `DashScope submit HTTP ${res.status}`, body: submitted });
  process.stderr.write(`[${model}] task ${taskId}\n`);

  for (let i = 1; i <= MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const p = await fetch(`${BASE}/api/v1/tasks/${taskId}`, { headers: { Authorization: `Bearer ${API_KEY}` } });
    const j = await p.json().catch(() => ({}));
    const status = j?.output?.task_status;
    process.stderr.write(`[${model}] poll ${i}/${MAX_POLLS} status=${status}\n`);
    if (status === "SUCCEEDED") {
      const url = j.output.results?.[0]?.url;
      if (!url) die({ error: "SUCCEEDED but no image url", body: j });
      const img = await fetch(url);
      if (!img.ok) die({ error: `download HTTP ${img.status}` });
      const buf = Buffer.from(await img.arrayBuffer());
      const abs = resolve(args.output);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, buf);
      console.log(JSON.stringify({ success: true, model, taskId, output: abs, bytes: buf.length, url }, null, 2));
      return;
    }
    if (status === "FAILED" || status === "UNKNOWN") die({ error: "task failed", body: j });
  }
  die({ error: "timed out waiting for task", taskId });
}

const cmd = process.argv[2];
if (!API_KEY) die({ error: "QWEN_API_KEY not set" });
if (cmd !== "generate") die({ error: `unknown command '${cmd ?? ""}' — expected: generate` });
generate(parseArgs(process.argv)).catch((e) => die({ error: String(e?.message || e) }));
