#!/usr/bin/env node
/**
 * Decoupe les planches de asset/ en frames normalisees dans build/frames/.
 *
 * asset/ est strictement en lecture seule. build/ est un produit de compilation,
 * regenerable et ignore par git : charger des planches de 10 Mo a l'execution
 * serait impossible, cette transformation est donc une necessite technique et
 * non une duplication d'assets.
 *
 *   node tools/slice.mjs                 toutes les animations
 *   node tools/slice.mjs --only idle     une seule
 *   node tools/slice.mjs --no-skin       sans retouche de carnation
 */

import { readdir, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { alphaBounds, footAnchorX, median } from "./lib/raster.mjs";
import { createSkinTinter } from "./lib/skin.mjs";
import {
  ROOT,
  ASSET_DIR,
  BUILD_DIR,
  FRAMES_DIR,
  MANIFEST_PATH,
  GENERATED_TS_PATH,
} from "./lib/paths.mjs";

const args = process.argv.slice(2);
const onlyIndex = args.indexOf("--only");
const only = onlyIndex !== -1 ? args[onlyIndex + 1] : null;
const skipSkin = args.includes("--no-skin");

const config = JSON.parse(await readFile(path.join(ROOT, "tools/sheets.config.json"), "utf8"));
const [COLS, ROWS] = config.grid;
const TARGET_HEIGHT = config.frameHeight;

/** Retrouve l'unique PNG d'un dossier d'animation. */
async function findSheet(dir) {
  const full = path.join(ASSET_DIR, dir);
  if (!existsSync(full)) throw new Error(`dossier introuvable : asset/${dir}`);
  const entries = await readdir(full, { withFileTypes: true });
  const png = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith(".png"));
  if (!png) throw new Error(`aucun PNG dans asset/${dir}`);
  return path.join(full, png.name);
}

/**
 * Mesure chaque case de la grille : boite englobante et point d'ancrage.
 * Les cases vides sont ecartees automatiquement, en plus des exclusions
 * declarees dans la configuration.
 */
function measureFrames(data, sheetWidth, sheetHeight, excluded) {
  const cellWidth = Math.floor(sheetWidth / COLS);
  const cellHeight = Math.floor(sheetHeight / ROWS);
  const measurements = [];

  for (let index = 0; index < COLS * ROWS; index++) {
    if (excluded.has(index)) continue;

    const region = {
      left: (index % COLS) * cellWidth,
      top: Math.floor(index / COLS) * cellHeight,
      width: cellWidth,
      height: cellHeight,
    };

    const bounds = alphaBounds(data, sheetWidth, region);
    if (!bounds || bounds.width < 8 || bounds.height < 8) continue;

    measurements.push({
      index,
      bounds,
      anchorX: footAnchorX(data, sheetWidth, bounds),
    });
  }

  return measurements;
}

/**
 * Geometrie commune a toutes les frames d'une animation.
 *
 * Toutes les frames sont posees sur un canevas de taille unique, ancrees sur le
 * bas de leur boite englobante et sur leurs pieds. C'est cet ancrage qui
 * supprime le tremblement des planches generees par IA, ou le personnage se
 * balade d'une case a l'autre.
 */
function computeLayout(measurements, scaleAdjust) {
  const scale = (TARGET_HEIGHT / median(measurements.map((m) => m.bounds.height))) * scaleAdjust;

  let leftExtent = 0;
  let rightExtent = 0;
  let topExtent = 0;

  for (const { bounds, anchorX } of measurements) {
    leftExtent = Math.max(leftExtent, (anchorX - bounds.left) * scale);
    rightExtent = Math.max(rightExtent, (bounds.left + bounds.width - anchorX) * scale);
    topExtent = Math.max(topExtent, bounds.height * scale);
  }

  const padding = 2;
  return {
    scale,
    frameWidth: Math.ceil(leftExtent + rightExtent) + padding * 2,
    frameHeight: Math.ceil(topExtent) + padding * 2,
    anchorX: Math.ceil(leftExtent) + padding,
    anchorY: Math.ceil(topExtent) + padding,
  };
}

async function processAnimation(id, spec, tinter) {
  const sheetPath = await findSheet(spec.dir);
  const { data, info } = await sharp(sheetPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const excluded = new Set(spec.exclude ?? []);
  const measurements = measureFrames(data, info.width, info.height, excluded);
  if (measurements.length === 0) throw new Error(`aucune frame exploitable pour ${id}`);

  const layout = computeLayout(measurements, spec.scale ?? 1);
  const outDir = path.join(FRAMES_DIR, id);
  await mkdir(outDir, { recursive: true });

  const frames = [];

  for (let i = 0; i < measurements.length; i++) {
    const { bounds, anchorX } = measurements[i];

    const scaledWidth = Math.max(1, Math.round(bounds.width * layout.scale));
    const scaledHeight = Math.max(1, Math.round(bounds.height * layout.scale));

    let sprite = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .extract(bounds)
      .resize(scaledWidth, scaledHeight, { kernel: "lanczos3", fit: "fill" })
      .raw()
      .toBuffer();

    if (tinter) sprite = tinter(sprite, scaledWidth, scaledHeight);

    const left = Math.round(layout.anchorX - (anchorX - bounds.left) * layout.scale);
    const top = layout.anchorY - scaledHeight;

    const name = String(i).padStart(3, "0") + ".webp";
    await sharp({
      create: {
        width: layout.frameWidth,
        height: layout.frameHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: sprite,
          raw: { width: scaledWidth, height: scaledHeight, channels: 4 },
          left: Math.max(0, left),
          top: Math.max(0, top),
        },
      ])
      .webp({ quality: 92, alphaQuality: 100, effort: 4 })
      .toFile(path.join(outDir, name));

    frames.push(`/frames/${id}/${name}`);
  }

  return {
    id,
    dir: spec.dir,
    fps: spec.fps,
    loop: spec.loop,
    frameWidth: layout.frameWidth,
    frameHeight: layout.frameHeight,
    anchorX: layout.anchorX,
    anchorY: layout.anchorY,
    frames,
    droppedFrames: COLS * ROWS - measurements.length,
  };
}

/** Signale les dossiers de asset/ absents de la configuration. */
async function reportUnmappedFolders(mapped) {
  const found = [];
  async function walk(dir, prefix) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      const children = await readdir(full, { withFileTypes: true });
      if (children.some((c) => c.isFile() && c.name.toLowerCase().endsWith(".png"))) found.push(rel);
      await walk(full, rel);
    }
  }
  await walk(ASSET_DIR, "");

  const missing = found.filter((dir) => !mapped.has(dir));
  if (missing.length > 0) {
    console.warn(`\nDossiers presents dans asset/ mais absents de sheets.config.json :`);
    for (const dir of missing) console.warn(`  - ${dir}`);
  }
}

const entries = Object.entries(config.animations).filter(([id]) => !only || id === only);
if (entries.length === 0) throw new Error(`animation inconnue : ${only}`);

const tinter = skipSkin ? null : await createSkinTinter();
if (!tinter) console.log("Carnation : desactivee");

if (!only && existsSync(FRAMES_DIR)) await rm(FRAMES_DIR, { recursive: true });
await mkdir(FRAMES_DIR, { recursive: true });

const started = Date.now();
const animations = {};

for (const [id, spec] of entries) {
  const result = await processAnimation(id, spec, tinter);
  animations[id] = result;
  const dropped = result.droppedFrames > 0 ? `, ${result.droppedFrames} ecartees` : "";
  console.log(
    `${id.padEnd(13)} ${String(result.frames.length).padStart(2)} frames  ` +
      `${result.frameWidth}x${result.frameHeight}${dropped}`,
  );
}

// En mode --only on fusionne avec le manifeste existant pour ne pas perdre le
// reste du travail deja genere.
let merged = animations;
if (only && existsSync(MANIFEST_PATH)) {
  const previous = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  merged = { ...previous.animations, ...animations };
}

await mkdir(BUILD_DIR, { recursive: true });
await writeFile(
  MANIFEST_PATH,
  JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString(),
      frameHeight: TARGET_HEIGHT,
      skinTint: !skipSkin,
      animations: merged,
    },
    null,
    2,
  ),
);

// Le type est genere avec les frames : le compilateur refuse ainsi toute
// reference a une animation qui n'existe pas sur le disque.
const ids = Object.keys(merged).sort();
await mkdir(path.dirname(GENERATED_TS_PATH), { recursive: true });
await writeFile(
  GENERATED_TS_PATH,
  `// Genere par tools/slice.mjs. Ne pas editer a la main.\n\n` +
    `export const ANIMATION_IDS = [\n` +
    ids.map((id) => `  "${id}",`).join("\n") +
    `\n] as const;\n\n` +
    `export type AnimationId = (typeof ANIMATION_IDS)[number];\n`,
);

await reportUnmappedFolders(new Set(Object.values(config.animations).map((a) => a.dir)));

console.log(`\n${Object.keys(merged).length} animations, ${((Date.now() - started) / 1000).toFixed(1)}s`);
