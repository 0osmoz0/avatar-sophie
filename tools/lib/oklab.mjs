/**
 * Conversions sRGB / OKLab / OKLCh.
 *
 * OKLab est choisi parce qu'il est perceptuellement uniforme : une distance
 * euclidienne y correspond a une difference visuelle constante, ce qui rend le
 * classement par plus proche centroide fiable pour separer la peau du pantalon
 * camel, dont les teintes se chevauchent en sRGB.
 */

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v) {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

/** @returns {[number, number, number]} L, a, b */
export function rgbToOklab(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** @returns {[number, number, number]} r, g, b sur 0-255 */
export function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** @returns {[number, number, number]} L, C, h en radians */
export function oklabToOklch(L, a, b) {
  return [L, Math.hypot(a, b), Math.atan2(b, a)];
}

/** @returns {[number, number, number]} L, a, b */
export function oklchToOklab(L, C, h) {
  return [L, C * Math.cos(h), C * Math.sin(h)];
}

/** Distance perceptuelle entre deux couleurs OKLab. */
export function oklabDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

/** Centroide OKLab d'une liste de couleurs hexadecimales. */
export function centroidFromHexList(hexList) {
  const labs = hexList.map((hex) => rgbToOklab(...hexToRgb(hex)));
  const sum = labs.reduce(
    (acc, lab) => [acc[0] + lab[0], acc[1] + lab[1], acc[2] + lab[2]],
    [0, 0, 0],
  );
  return sum.map((v) => v / labs.length);
}
