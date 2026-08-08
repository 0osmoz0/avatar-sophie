#!/usr/bin/env node
/**
 * Planches de controle pour la curation.
 *
 * Les planches sources sont generees par IA : elles contiennent des frames
 * parasites et des poses aberrantes qu'aucune heuristique ne detecte de facon
 * fiable. Ces contacts numerotes servent a reperer visuellement les index a
 * placer dans `exclude`, et a verifier que l'ancrage ne fait pas trembler le
 * personnage d'une frame a l'autre.
 *
 *   node tools/contact-sheet.mjs            toutes les animations
 *   node tools/contact-sheet.mjs --only idle
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { BUILD_DIR, MANIFEST_PATH, REVIEW_DIR, ROOT } from "./lib/paths.mjs";

const args = process.argv.slice(2);
const onlyIndex = args.indexOf("--only");
const only = onlyIndex !== -1 ? args[onlyIndex + 1] : null;

if (!existsSync(MANIFEST_PATH)) {
  throw new Error("build/manifest.json absent : lance d'abord `npm run assets`");
}

const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
await mkdir(REVIEW_DIR, { recursive: true });

const COLUMNS = 6;
const LABEL_HEIGHT = 16;
/** Damier gris clair : l'alpha se verifie mal sur un fond uni. */
const CHECKER = { r: 236, g: 236, b: 240, alpha: 1 };

function labelSvg(width, text) {
  return Buffer.from(
    `<svg width="${width}" height="${LABEL_HEIGHT}">` +
      `<text x="4" y="12" font-family="monospace" font-size="12" fill="#444">${text}</text>` +
      `</svg>`,
  );
}

async function buildSheet(animation) {
  const { frameWidth, frameHeight, frames, id, anchorX, anchorY } = animation;
  const cellHeight = frameHeight + LABEL_HEIGHT;
  const rows = Math.ceil(frames.length / COLUMNS);

  const composites = [];

  for (let i = 0; i < frames.length; i++) {
    const column = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);
    const left = column * frameWidth;
    const top = row * cellHeight;

    composites.push({
      input: path.join(BUILD_DIR, frames[i].replace(/^\//, "")),
      left,
      top: top + LABEL_HEIGHT,
    });
    composites.push({ input: labelSvg(frameWidth, String(i)), left, top });
  }

  // Reperes d'ancrage : si le personnage tremble, ses pieds decrochent de la
  // ligne verticale et de la ligne de sol.
  const guides = [];
  for (let column = 0; column < COLUMNS; column++) {
    for (let row = 0; row < rows; row++) {
      const x = column * frameWidth + anchorX;
      const y = row * cellHeight + LABEL_HEIGHT + anchorY;
      guides.push(
        `<line x1="${x}" y1="${row * cellHeight + LABEL_HEIGHT}" x2="${x}" y2="${y}" stroke="#e0483a" stroke-width="1" opacity="0.45"/>`,
        `<line x1="${column * frameWidth}" y1="${y}" x2="${(column + 1) * frameWidth}" y2="${y}" stroke="#e0483a" stroke-width="1" opacity="0.45"/>`,
      );
    }
  }

  const width = COLUMNS * frameWidth;
  const height = rows * cellHeight;

  composites.push({
    input: Buffer.from(`<svg width="${width}" height="${height}">${guides.join("")}</svg>`),
    left: 0,
    top: 0,
  });

  const outPath = path.join(REVIEW_DIR, `${id}.png`);
  await sharp({ create: { width, height, channels: 4, background: CHECKER } })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  return { id, outPath, count: frames.length };
}

const animations = Object.values(manifest.animations).filter((a) => !only || a.id === only);
if (animations.length === 0) throw new Error(`animation inconnue : ${only}`);

const results = [];
for (const animation of animations) {
  results.push(await buildSheet(animation));
  console.log(`${animation.id.padEnd(13)} ${animation.frames.length} frames`);
}

// Un index HTML evite d'ouvrir 34 fichiers a la main.
const html =
  `<!doctype html><meta charset="utf-8"><title>Curation Sophie</title>` +
  `<style>body{font-family:system-ui;background:#fafafa;margin:24px}` +
  `h2{font-size:14px;margin:24px 0 8px;font-family:monospace}img{max-width:100%;border:1px solid #ddd}</style>` +
  results.map((r) => `<h2>${r.id} — ${r.count} frames</h2><img src="${r.id}.png">`).join("");
await writeFile(path.join(REVIEW_DIR, "index.html"), html);

console.log(`\n${results.length} planches dans ${path.relative(ROOT, REVIEW_DIR)}/index.html`);
