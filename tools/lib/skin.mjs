/**
 * Retouche de carnation.
 *
 * La palette du personnage rend un filtre global impossible : le pantalon
 * camel, les chaussures creme et la peau claire se chevauchent fortement en
 * espace colorimetrique. La selection procede donc en trois temps, du plus
 * grossier au plus fin :
 *
 *   1. classement par plus proche centroide en OKLab, ou la peau est mise en
 *      concurrence avec le pantalon, les chaussures, les cheveux et la veste,
 *      plutot que testee contre un seuil absolu qui les confondrait ;
 *   2. nettoyage morphologique et suppression des petites composantes, qui
 *      elimine les pixels arraches aux contours ;
 *   3. adoucissement du bord, pour qu'aucun lisere ne trahisse la retouche.
 *
 * La couleur est ensuite decalee de facon relative en OKLCh, jamais remplacee :
 * l'ombrage, le rougissement des joues et les details de peinture sont
 * preserves, la ou un aplat les ecraserait.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { ROOT } from "./paths.mjs";
import { centroidFromHexList, oklabDistance, oklabToOklch, oklchToOklab, oklabToRgb, rgbToOklab } from "./oklab.mjs";
import { dilate, erode, feather, keepLargeComponents } from "./mask.mjs";

const CONFIG_PATH = path.join(ROOT, "tools/skin.config.json");
const ALPHA_THRESHOLD = 24;

/**
 * @returns {null | ((rgba: Buffer, width: number, height: number) => Buffer)}
 *   `null` quand la retouche est desactivee, ce qui laisse les frames intactes.
 */
export async function createSkinTinter() {
  if (!existsSync(CONFIG_PATH)) return null;

  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  if (!config.enabled) return null;

  const skinCentroid = centroidFromHexList(config.targets.skin);
  const competitors = Object.entries(config.competitors).map(([name, hexList]) => ({
    name,
    centroid: centroidFromHexList(hexList),
  }));

  const { maxDistance, minComponentAreaRatio, featherRadius, shift } = config;
  const hueShift = (shift.hueDegrees * Math.PI) / 180;

  return function tint(rgba, width, height) {
    const pixelCount = width * height;
    const candidate = new Uint8Array(pixelCount);
    const labs = new Float32Array(pixelCount * 3);

    for (let i = 0; i < pixelCount; i++) {
      const o = i * 4;
      if (rgba[o + 3] < ALPHA_THRESHOLD) continue;

      const lab = rgbToOklab(rgba[o], rgba[o + 1], rgba[o + 2]);
      labs[i * 3] = lab[0];
      labs[i * 3 + 1] = lab[1];
      labs[i * 3 + 2] = lab[2];

      const skinDistance = oklabDistance(lab, skinCentroid);
      if (skinDistance > maxDistance) continue;

      // Un pixel n'est peau que s'il est plus proche du centroide peau que de
      // tous ses concurrents. C'est ce qui tranche le cas des teintes
      // limitrophes entre la main et le pantalon.
      let isSkin = true;
      for (const competitor of competitors) {
        if (oklabDistance(lab, competitor.centroid) <= skinDistance) {
          isSkin = false;
          break;
        }
      }

      candidate[i] = isSkin ? 1 : 0;
    }

    const cleaned = keepLargeComponents(
      dilate(erode(candidate, width, height), width, height),
      width,
      height,
      Math.max(16, Math.round(pixelCount * minComponentAreaRatio)),
    );
    const weights = feather(cleaned, width, height, featherRadius);

    const out = Buffer.from(rgba);

    for (let i = 0; i < pixelCount; i++) {
      const weight = weights[i];
      if (weight < 0.01) continue;

      const [L, C, h] = oklabToOklch(labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]);
      const shifted = oklchToOklab(
        L * (1 + shift.lightness),
        C * (1 + shift.chroma),
        h + hueShift,
      );
      const [r, g, b] = oklabToRgb(shifted[0], shifted[1], shifted[2]);

      const o = i * 4;
      out[o] = Math.round(rgba[o] + (r - rgba[o]) * weight);
      out[o + 1] = Math.round(rgba[o + 1] + (g - rgba[o + 1]) * weight);
      out[o + 2] = Math.round(rgba[o + 2] + (b - rgba[o + 2]) * weight);
    }

    return out;
  };
}
