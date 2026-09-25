// --pair: side-by-side BEFORE | AFTER composites with a label strip and the
// changed-pixel share, so "nothing moved" is a number and not an impression.
//
// Rendered in headless Chromium (canvas getImageData), so it needs no image
// dependency. Shots of different heights (a full-page shot grows with content)
// are compared on the union canvas: rows only one side has count as changed.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './capture.mjs';

const SHOT = /^(.+)-(\d+x\d+)-(light|dark)\.png$/;

function views(dir) {
  return Object.fromEntries(readdirSync(dir).filter((f) => SHOT.test(f)).map((f) => [f, path.join(dir, f)]));
}

function browserOf(dir) {
  try { return JSON.parse(readFileSync(path.join(dir, 'shoot-report.json'), 'utf8')).browser ?? null; } catch { return null; }
}

export async function runPair({ beforeDir, afterDir, outDir, allowBrowserDrift = false, log = console.log }) {
  const before = views(beforeDir);
  const after = views(afterDir);
  const names = Object.keys(before).filter((v) => after[v]).sort();
  const orphans = [...new Set([...Object.keys(before), ...Object.keys(after)].filter((v) => !(before[v] && after[v])))];
  if (!names.length) throw new Error(`no matching <target>-<WxH>-<theme>.png views between ${beforeDir} and ${afterDir}`);
  const [bv, av] = [browserOf(beforeDir), browserOf(afterDir)];
  if (bv && av && bv !== av && !allowBrowserDrift) {
    log(`renderer drift: before shot with ${bv}, after with ${av}; re-shoot one side or pass --allow-browser-drift`);
    return 1;
  }
  mkdirSync(outDir, { recursive: true });
  const browser = await launchBrowser();
  const deltas = {};
  try {
    for (const name of names) {
      const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
      const src = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
      await page.setContent(`<!doctype html><html><body style="margin:0;background:#111;font:600 15px/1 system-ui,sans-serif;color:#eee">
        <div id="strip" style="display:flex;gap:16px;height:44px;align-items:center"></div>
        <div style="display:flex;gap:16px;align-items:flex-start"><img id="b" src="${src(before[name])}"><img id="a" src="${src(after[name])}"></div></body></html>`);
      const delta = await page.evaluate(async ({ label }) => {
        const [bi, ai] = ['b', 'a'].map((id) => document.getElementById(id));
        await Promise.all([bi.decode(), ai.decode()]);
        const w = Math.max(bi.naturalWidth, ai.naturalWidth), h = Math.max(bi.naturalHeight, ai.naturalHeight);
        const read = (img) => {
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const g = c.getContext('2d'); g.fillStyle = '#ff00ff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0);
          return g.getImageData(0, 0, w, h).data;
        };
        const [b, a] = [read(bi), read(ai)];
        let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let i = 0; i < b.length; i += 4) {
          if (b[i] !== a[i] || b[i + 1] !== a[i + 1] || b[i + 2] !== a[i + 2]) {
            n++;
            const p = i / 4, x = p % w, y = (p - x) / w;
            if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
          }
        }
        const pct = (100 * n) / (w * h);
        const strip = document.getElementById('strip');
        const cell = (text, sub) => { const d = document.createElement('div'); d.style.cssText = `width:${bi.naturalWidth}px;padding:0 14px;box-sizing:border-box;white-space:nowrap;overflow:hidden`; d.textContent = text; const s = document.createElement('span'); s.style.cssText = 'font-weight:400;opacity:.75;margin-left:10px'; s.textContent = sub; d.append(s); return d; };
        strip.append(cell('BEFORE', `${label} · ${bi.naturalWidth}x${bi.naturalHeight}`), cell('AFTER', `${ai.naturalWidth}x${ai.naturalHeight} · ${n ? `${n} px changed (${pct.toFixed(2)}%)` : 'pixel-identical'}`));
        return { width: w, height: h, changedPixels: n, changedPct: Number(pct.toFixed(3)), bbox: n ? [x0, y0, x1, y1] : null, compositeWidth: bi.naturalWidth + ai.naturalWidth + 16, compositeHeight: h + 44 };
      }, { label: name.replace(/\.png$/, '') });
      await page.setViewportSize({ width: delta.compositeWidth, height: delta.compositeHeight });
      const file = path.join(outDir, `pair-${name}`);
      await page.screenshot({ path: file, fullPage: true });
      await page.close();
      deltas[name] = { changedPixels: delta.changedPixels, changedPct: delta.changedPct, bbox: delta.bbox, size: [delta.width, delta.height] };
      log(`pair ${path.basename(file)}  ${delta.changedPixels ? `${delta.changedPixels} px changed (${delta.changedPct}%)` : 'pixel-identical (0%)'}`);
    }
  } finally {
    await browser.close();
  }
  writeFileSync(path.join(outDir, 'pair-report.json'), JSON.stringify({ before: beforeDir, after: afterDir, browser: { before: bv, after: av }, orphans, views: deltas }, null, 2));
  if (orphans.length) { log(`views without a counterpart: ${orphans.join(', ')}`); return 1; }
  return 0;
}
