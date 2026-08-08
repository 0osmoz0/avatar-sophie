/** Morphologie et composantes connexes sur un masque binaire 8 bits. */

export function erode(mask, width, height) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const keep =
        x > 0 &&
        x < width - 1 &&
        y > 0 &&
        y < height - 1 &&
        mask[i - 1] &&
        mask[i + 1] &&
        mask[i - width] &&
        mask[i + width];
      out[i] = keep ? 1 : 0;
    }
  }
  return out;
}

export function dilate(mask, width, height) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      out[i] = 1;
      if (x > 0) out[i - 1] = 1;
      if (x < width - 1) out[i + 1] = 1;
      if (y > 0) out[i - width] = 1;
      if (y < height - 1) out[i + width] = 1;
    }
  }
  return out;
}

/**
 * Retire les composantes connexes trop petites.
 *
 * C'est la contrainte spatiale du masque de peau : elle elimine les pixels
 * isoles arraches aux vetements ou aux contours, qui produiraient sinon des
 * taches colorees sur la veste et le pantalon.
 */
export function keepLargeComponents(mask, width, height, minArea) {
  const labels = new Int32Array(mask.length).fill(-1);
  const stack = new Int32Array(mask.length);
  const out = new Uint8Array(mask.length);

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;

    let top = 0;
    let area = 0;
    stack[top++] = start;
    labels[start] = start;
    const members = [];

    while (top > 0) {
      const i = stack[--top];
      members.push(i);
      area++;

      const x = i % width;
      const y = (i / width) | 0;

      if (x > 0 && mask[i - 1] && labels[i - 1] === -1) {
        labels[i - 1] = start;
        stack[top++] = i - 1;
      }
      if (x < width - 1 && mask[i + 1] && labels[i + 1] === -1) {
        labels[i + 1] = start;
        stack[top++] = i + 1;
      }
      if (y > 0 && mask[i - width] && labels[i - width] === -1) {
        labels[i - width] = start;
        stack[top++] = i - width;
      }
      if (y < height - 1 && mask[i + width] && labels[i + width] === -1) {
        labels[i + width] = start;
        stack[top++] = i + width;
      }
    }

    if (area >= minArea) {
      for (const i of members) out[i] = 1;
    }
  }

  return out;
}

/**
 * Adoucit le bord du masque pour eviter un lisere visible a la frontiere de la
 * retouche. Deux passes separables suffisent a approcher un flou gaussien.
 */
export function feather(mask, width, height, radius) {
  const passes = Math.max(1, Math.round(radius));
  let current = Float32Array.from(mask);

  for (let pass = 0; pass < passes; pass++) {
    const horizontal = new Float32Array(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const left = x > 0 ? current[i - 1] : current[i];
        const right = x < width - 1 ? current[i + 1] : current[i];
        horizontal[i] = (left + current[i] * 2 + right) / 4;
      }
    }

    const vertical = new Float32Array(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const up = y > 0 ? horizontal[i - width] : horizontal[i];
        const down = y < height - 1 ? horizontal[i + width] : horizontal[i];
        vertical[i] = (up + horizontal[i] * 2 + down) / 4;
      }
    }

    current = vertical;
  }

  return current;
}
