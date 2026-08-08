/**
 * Operations sur un buffer RGBA brut.
 *
 * Les planches sources font jusqu'a 3168x5112, soit 64 Mo une fois decodees.
 * On les decode une seule fois par planche et on travaille ensuite directement
 * sur le buffer, sans repasser par un decodage image a chaque frame.
 */

/** En dessous de cette valeur, un pixel est considere comme du vide. */
export const ALPHA_THRESHOLD = 10;

/**
 * Boite englobante des pixels opaques d'une sous-region.
 * @returns {{left:number, top:number, width:number, height:number} | null}
 */
export function alphaBounds(data, sheetWidth, region) {
  const { left: rx, top: ry, width: rw, height: rh } = region;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let y = 0; y < rh; y++) {
    const rowStart = ((ry + y) * sheetWidth + rx) * 4;
    for (let x = 0; x < rw; x++) {
      if (data[rowStart + x * 4 + 3] < ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (minX === Infinity) return null;

  return {
    left: rx + minX,
    top: ry + minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Abscisse d'ancrage du personnage : milieu de l'etendue opaque dans le bas de
 * la boite englobante.
 *
 * Le centre de la boite serait instable, car la chevelure tres longue part d'un
 * cote ou de l'autre selon la pose et deplacerait le personnage lateralement a
 * chaque frame. Les pieds, eux, restent au meme endroit.
 */
export function footAnchorX(data, sheetWidth, bounds, bottomRatio = 0.12) {
  const bandHeight = Math.max(1, Math.round(bounds.height * bottomRatio));
  const bandTop = bounds.top + bounds.height - bandHeight;

  let minX = Infinity;
  let maxX = -Infinity;

  for (let y = bandTop; y < bounds.top + bounds.height; y++) {
    const rowStart = y * sheetWidth * 4;
    for (let x = bounds.left; x < bounds.left + bounds.width; x++) {
      if (data[rowStart + x * 4 + 3] < ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }

  if (minX === Infinity) return bounds.left + bounds.width / 2;
  return (minX + maxX + 1) / 2;
}

export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
