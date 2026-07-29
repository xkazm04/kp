#!/usr/bin/env node

/**
 * Tight-crop a logo PNG: trim the uniform background, re-pad with a small uniform
 * margin (default 8% of trimmed-max-dimension), and resize back to a square.
 *
 * Reads the background color from the top-left pixel so the re-pad matches the
 * generated artwork (cream/parchment/etc), and writes back to the same path or a
 * caller-provided --output.
 *
 *   node tight-crop.mjs --input path/in.png [--output path/out.png] [--size 512]
 *                       [--margin 0.08] [--threshold 12]
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i++; }
      else { args[key] = true; }
    }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.input) {
  console.error('Usage: tight-crop.mjs --input PATH [--output PATH] [--size 512] [--margin 0.08] [--threshold 12]');
  process.exit(1);
}

const inputPath  = resolve(args.input);
const outputPath = resolve(args.output || args.input);
const size       = parseInt(args.size || '512', 10);
const margin     = parseFloat(args.margin || '0.08');
const threshold  = parseInt(args.threshold || '12', 10);

// Resolve sharp from any of the project's node_modules.
const candidates = [
  resolve(process.cwd(), 'node_modules/sharp'),
  resolve(inputPath, '../../../node_modules/sharp'),
  resolve(inputPath, '../../../../node_modules/sharp'),
];
let sharp;
for (const c of candidates) {
  try { sharp = createRequire(c + '/').apply(null, [c]); break; } catch {}
}
if (!sharp) {
  try { sharp = (await import('sharp')).default; } catch {}
}
if (!sharp) {
  // Last-ditch: try resolving relative to input file's package tree
  const cwdReq = createRequire(import.meta.url);
  try { sharp = cwdReq('sharp'); } catch (e) {
    console.error(JSON.stringify({ error: 'sharp not found', tried: candidates, hint: 'run from a repo that has next installed' }));
    process.exit(1);
  }
}

const buf = readFileSync(inputPath);

// Sample background by averaging an 8x8 patch from each corner and picking the
// mode (most common patch color, bucketed). Robust against decorative frames
// that happen to touch a single corner.
const meta = await sharp(buf).metadata();
const PATCH = 8;
const corners = [
  { left: 0, top: 0 },
  { left: meta.width - PATCH, top: 0 },
  { left: 0, top: meta.height - PATCH },
  { left: meta.width - PATCH, top: meta.height - PATCH },
];

async function avgPatch(left, top) {
  const { data, info } = await sharp(buf)
    .extract({ left, top, width: PATCH, height: PATCH })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let r=0,g=0,b=0,a=0,n=0;
  for (let i = 0; i < data.length; i += ch) {
    r += data[i]; g += data[i+1]; b += data[i+2];
    a += ch === 4 ? data[i+3] : 255;
    n++;
  }
  return { r: Math.round(r/n), g: Math.round(g/n), b: Math.round(b/n), a: Math.round(a/n) };
}

const patches = await Promise.all(corners.map(c => avgPatch(c.left, c.top)));

// Bucket each patch color to nearest 16 and find the mode.
const key = (p) => `${p.r >> 4}_${p.g >> 4}_${p.b >> 4}`;
const counts = new Map();
for (const p of patches) {
  const k = key(p);
  counts.set(k, (counts.get(k) || 0) + 1);
}
let bestKey = null, bestCount = 0;
for (const [k, v] of counts) if (v > bestCount) { bestKey = k; bestCount = v; }
// Average the patches that fell into the winning bucket.
const winners = patches.filter(p => key(p) === bestKey);
const bg = winners.reduce((acc, p) => ({ r: acc.r+p.r, g: acc.g+p.g, b: acc.b+p.b, a: acc.a+p.a }), {r:0,g:0,b:0,a:0});
const bgR = Math.round(bg.r / winners.length);
const bgG = Math.round(bg.g / winners.length);
const bgB = Math.round(bg.b / winners.length);
const bgA = Math.round(bg.a / winners.length);
const bgHex = `#${[bgR,bgG,bgB].map(v => v.toString(16).padStart(2,'0')).join('')}`;

// Adaptive trim: start with caller-provided threshold (default 12 = conservative
// for flat vector-style designs). If the trim refuses to engage (ratio > 0.85),
// the background is probably a textured/photographic frame — escalate threshold
// to slice through the decorative border too. Cap at 120 to avoid eating actual
// dark content.
async function attemptTrim(t) {
  const out = await sharp(buf)
    .trim({ background: { r: bgR, g: bgG, b: bgB, alpha: bgA / 255 }, threshold: t })
    .toBuffer({ resolveWithObject: true });
  return { ...out, threshold: t };
}

let trimmedBuf = await attemptTrim(threshold);
let trimRatio = (trimmedBuf.info.width * trimmedBuf.info.height) / (meta.width * meta.height);

const escalations = [50, 100];
for (const t of escalations) {
  if (trimRatio <= 0.85) break;
  const next = await attemptTrim(t);
  const nextRatio = (next.info.width * next.info.height) / (meta.width * meta.height);
  // Sanity: never accept a trim that nukes more than 75% of the artwork — that'd
  // mean we ate the logo too.
  if (nextRatio < 0.08) break;
  if (nextRatio < trimRatio) { trimmedBuf = next; trimRatio = nextRatio; }
}

const tw = trimmedBuf.info.width;
const th = trimmedBuf.info.height;

// Pad to a square with margin, then resize.
const maxSide = Math.max(tw, th);
const pad = Math.round(maxSide * margin);
const target = maxSide + 2 * pad;

const padTop    = Math.floor((target - th) / 2);
const padBottom = target - th - padTop;
const padLeft   = Math.floor((target - tw) / 2);
const padRight  = target - tw - padLeft;

await sharp(trimmedBuf.data)
  .extend({
    top: padTop, bottom: padBottom, left: padLeft, right: padRight,
    background: { r: bgR, g: bgG, b: bgB, alpha: bgA / 255 },
  })
  .resize(size, size, { fit: 'fill' })
  .png()
  .toFile(outputPath);

console.log(JSON.stringify({
  success: true,
  input: inputPath,
  output: outputPath,
  original: { w: meta.width, h: meta.height },
  trimmed:  { w: tw, h: th, ratio: Number(trimRatio.toFixed(3)), threshold: trimmedBuf.threshold },
  background: bgHex,
  finalSize: size,
}, null, 2));
