// Colour utilities for pixel textures. Ramps are built in OKLCH with hue shifting
// (shadows drift cool, highlights drift warm) the way hand-made pixel palettes are.

export type RGB = number; // 0xRRGGBB

export const hex = (s: string): RGB => parseInt(s.replace('#', ''), 16);
export const toHex = (c: RGB): string => '#' + c.toString(16).padStart(6, '0');
export const col = (c: RGB | string): RGB => (typeof c === 'string' ? hex(c) : c);

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const gam = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

export function toLab(c: RGB): [number, number, number] {
  const r = lin(((c >> 16) & 255) / 255), g = lin(((c >> 8) & 255) / 255), b = lin((c & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function fromLab(L: number, a: number, b: number): RGB {
  // pull chroma in until the colour fits sRGB
  let k = 1;
  let rgb = labToLinear(L, a, b);
  for (let i = 0; i < 12 && rgb.some((v) => v < -0.0005 || v > 1.0005); i++) {
    k *= 0.88;
    rgb = labToLinear(L, a * k, b * k);
  }
  const q = (v: number) => Math.max(0, Math.min(255, Math.round(gam(Math.max(0, Math.min(1, v))) * 255)));
  return (q(rgb[0]) << 16) | (q(rgb[1]) << 8) | q(rgb[2]);
}

export function toLch(c: RGB): [number, number, number] {
  const [L, a, b] = toLab(c);
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

export function fromLch(L: number, C: number, h: number): RGB {
  const r = (h * Math.PI) / 180;
  return fromLab(Math.max(0, Math.min(1, L)), Math.cos(r) * C, Math.sin(r) * C);
}

const lerpHue = (a: number, b: number, t: number) => {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
};

export function mix(a: RGB | string, b: RGB | string, t: number): RGB {
  const A = toLab(col(a)), B = toLab(col(b));
  return fromLab(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

export function adjust(c: RGB | string, dL = 0, cMul = 1, dH = 0): RGB {
  const [L, C, h] = toLch(col(c));
  return fromLch(L + dL, C * cMul, h + dH);
}

export interface Ramp {
  c: RGB[];
  /** index of the base colour */
  mid: number;
}

export interface RampOpts {
  n?: number;
  /** lightness distance between neighbouring shades */
  step?: number;
  /** hue shadows drift towards / highlights drift towards */
  cool?: number;
  warm?: number;
  /** 0..1 how strongly hue shifts per step */
  shift?: number;
}

/** Dark-to-light shades around a base colour. */
export function ramp(base: RGB | string, o: RampOpts = {}): Ramp {
  const n = o.n ?? 7, step = o.step ?? 0.062, cool = o.cool ?? 285, warm = o.warm ?? 88, shift = o.shift ?? 0.085;
  const [L, C, h] = toLch(col(base));
  // very light bases need room below them, very dark ones room above
  let mid = Math.floor(n / 2);
  if (L > 0.9) mid = n - 2;
  else if (L > 0.8) mid = n - 3;
  else if (L < 0.32) mid = 1;
  else if (L < 0.45) mid = 2;
  const grey = C < 0.035;
  const c: RGB[] = [];
  for (let i = 0; i < n; i++) {
    const k = i - mid;
    const a = Math.abs(k);
    const Li = Math.max(0.1, Math.min(0.985, L + k * step * (k > 0 ? 0.78 : 1.06)));
    let Ci: number, hi: number;
    if (k < 0) {
      hi = grey ? cool : lerpHue(h, cool, Math.min(0.8, a * shift));
      Ci = grey ? C + a * 0.016 : C * (1 + 0.05 * Math.min(a, 2)) * (a > 2 ? 0.92 : 1);
    } else {
      hi = grey ? warm : lerpHue(h, warm, Math.min(0.8, a * shift * 0.8));
      Ci = grey ? Math.max(0, C - a * 0.004) : C * Math.max(0.35, 1 - 0.13 * a);
    }
    c.push(fromLch(Li, Ci, hi));
  }
  return { c, mid };
}

/** Pick a shade `level` steps from the ramp's base (negative = darker). */
export const tone = (r: Ramp, level: number): RGB =>
  r.c[Math.max(0, Math.min(r.c.length - 1, Math.round(r.mid + level)))];

export function luma(c: RGB): number {
  return toLab(c)[0];
}
