#!/usr/bin/env node
/**
 * Exporte un masque de peau 8 bits pour controle visuel.
 *
 *   node tools/skin-mask.mjs --only idle
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { createSkinTinter } from "./lib/skin.mjs";
import { ASSET_DIR, REVIEW_DIR, ROOT } from "./lib/paths.mjs";
import { alphaBounds } from "./lib/raster.mjs";

const args = process.argv.slice(2);
const onlyIndex = args.indexOf("--only");
const only = onlyIndex !== -1 ? args[onlyIndex + 1] : "idle";

const config = JSON.parse(await readFile(path.join(ROOT, "tools/sheets.config.json"), "utf8"));
const spec = config.animations[only];
if (!spec) throw new Error(`animation inconnue : ${only}`);

const dir = path.join(ASSET_DIR, spec.dir);
const entries = await (await import("node:fs/promises")).readdir(dir);
const png = entries.find((n) => n.toLowerCase().endsWith(".png"));
if (!png) throw new Error(`pas de PNG dans asset/${spec.dir}`);

const sheetPath = path.join(dir, png);
const { data, info } = await sharp(sheetPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

const [cols, rows] = config.grid;
const cellW = Math.floor(info.width / cols);
const cellH = Math.floor(info.height / rows);

// Premiere frame non vide pour le preview.
let region = null;
for (let i = 0; i < cols * rows; i++) {
  const candidate = {
    left: (i % cols) * cellW,
    top: Math.floor(i / cols) * cellH,
    width: cellW,
    height: cellH,
  };
  const bounds = alphaBounds(data, info.width, candidate);
  if (bounds) {
    region = bounds;
    break;
  }
}
if (!region) throw new Error("aucune frame exploitable");

const extracted = await sharp(data, {
  raw: { width: info.width, height: info.height, channels: 4 },
})
  .extract(region)
  .raw()
  .toBuffer({ resolveWithObject: true });

const tinter = await createSkinTinter();
if (!tinter) throw new Error("skin.config.json desactive ou absent");

const tinted = tinter(Buffer.from(extracted.data), extracted.info.width, extracted.info.height);

await mkdir(REVIEW_DIR, { recursive: true });
const beforePath = path.join(REVIEW_DIR, `skin-before-${only}.png`);
const afterPath = path.join(REVIEW_DIR, `skin-after-${only}.png`);

await sharp(extracted.data, {
  raw: { width: extracted.info.width, height: extracted.info.height, channels: 4 },
})
  .png()
  .toFile(beforePath);

await sharp(tinted, {
  raw: { width: extracted.info.width, height: extracted.info.height, channels: 4 },
})
  .png()
  .toFile(afterPath);

await writeFile(
  path.join(REVIEW_DIR, `skin-${only}.html`),
  `<!doctype html><meta charset="utf-8"><title>Carnation ${only}</title>` +
    `<style>body{font-family:system-ui;background:#111;color:#eee;margin:24px}` +
    `img{max-height:70vh;background:#333;margin-right:16px}</style>` +
    `<h1>Carnation — ${only}</h1>` +
    `<img src="skin-before-${only}.png" alt="avant">` +
    `<img src="skin-after-${only}.png" alt="apres">`,
);

console.log(`Avant/après écrits dans build/review/skin-*-${only}.png`);
