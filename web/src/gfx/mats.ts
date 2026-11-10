// Pixel-texture painters. Each returns a colour for one texel, shading with a small hue-shifted
// ramp so faces read as hand-pixelled: lit tops, shadowed undersides, rim highlights, clustered noise.
import { col, ramp, tone, type Ramp, type RGB } from './color.ts';
import { fbm, hash, vnoise } from './noise.ts';
import type { Painter, Texel } from './box.ts';

export type Tint = Ramp | string | RGB;
export const R = (c: Tint): Ramp => (typeof c === 'object' ? c : ramp(col(c)));

/** Baked light per face: east, west, up, down, south (front), north. */
const FACE_L = [0, -0.3, 0.85, -1.4, 0.15, -0.4];

export interface Shade {
  face?: number;
  rim?: number;
  grad?: number;
  noise?: number;
  /** size of the noise clusters in px */
  scale?: number;
  speck?: number;
  jitter?: number;
  seed?: number;
}

/** Shade level (in ramp steps) for a texel from face direction, edges, gradient and clustered noise. */
export function lvl(t: Texel, o: Shade = {}): number {
  const seed = o.seed ?? 0;
  let L = (o.face ?? 1) * FACE_L[t.face];
  const rim = o.rim ?? 1, grad = o.grad ?? 1;
  if (t.face !== 2 && t.face !== 3) {
    if (t.h >= 3) {
      L += grad * ((t.v + 0.5) / t.h - 0.5) * 1.1;
      if (t.v === t.h - 1) L += 0.6 * rim;
      else if (t.v === 0) L -= 0.7 * rim;
    }
    if (t.w >= 4 && (t.u === 0 || t.u === t.w - 1)) L -= 0.3 * rim;
  } else if (t.face === 2 && t.w >= 3 && t.h >= 3) {
    if (t.u === 0 || t.v === 0 || t.u === t.w - 1 || t.v === t.h - 1) L += 0.35 * rim;
  }
  const noise = o.noise ?? 1;
  if (noise) {
    const s = o.scale ?? 2.6;
    L += (fbm(t.x / s, t.y / s, t.z / s, seed) - 0.5) * 1.7 * noise;
  }
  const qx = Math.floor(t.x * 2), qy = Math.floor(t.y * 2), qz = Math.floor(t.z * 2);
  const sp = o.speck ?? 1;
  if (sp) {
    const h = hash(qx, qy, qz, seed + 3);
    if (h > 1 - 0.035 * sp) L += 1;
    else if (h < 0.035 * sp) L -= 1;
  }
  return L + (hash(qx + 11, qy, qz + 5, seed) - 0.5) * (o.jitter ?? 0.35);
}

export const flat = (c: string | RGB): Painter => {
  const v = col(c);
  return () => v;
};

/** Plain shaded surface. */
export const solid = (c: Tint, o?: Shade): Painter => {
  const r = R(c);
  return (t) => tone(r, lvl(t, o));
};

/** Smooth, low-noise surface for cute/clean things (plastic toys, fruit, ceramics). */
export const smooth = (c: Tint, o: Shade = {}): Painter => solid(c, { noise: 0.35, speck: 0.3, ...o });

type Axis = 'x' | 'y' | 'z';
const AX: Record<Axis, number> = { x: 0, y: 1, z: 2 };
/** For a face, the box-local coordinate along `axis` and across it; `end` when the face is the end grain. */
function grain(t: Texel, axis: Axis): { along: number; across: number; end: boolean } {
  const fa = t.face >> 1; // 0 x, 1 y, 2 z
  const b = [t.bx, t.by, t.bz];
  const a = AX[axis];
  if (fa === a) return { along: 0, across: 0, end: true };
  const other = 3 - fa - a;
  return { along: b[a], across: b[other], end: false };
}

export interface WoodOpts { axis?: Axis; plank?: number; seed?: number; shade?: Shade; rings?: boolean }

/** Sawn planks: seams, staggered joints, long grain streaks, lit top edge on every board. */
export function wood(c: Tint, o: WoodOpts = {}): Painter {
  const r = R(c);
  const axis = o.axis ?? 'y', pw = o.plank ?? 4, seed = o.seed ?? 0;
  return (t) => {
    const g = grain(t, axis);
    let L = lvl(t, { noise: 0.25, speck: 0.4, ...o.shade });
    if (g.end) {
      if (o.rings) {
        const d = Math.max(Math.abs(t.u + 0.5 - t.w / 2), Math.abs(t.v + 0.5 - t.h / 2));
        L += Math.floor(d) % 2 ? -0.6 : 0.5;
        if (d < 1) L -= 0.8;
      } else L += (hash(t.u, t.v, 0, seed) - 0.5) * 0.9 - 0.3;
      return tone(r, L);
    }
    const ac = Math.floor(g.across + 0.01);
    const p = pw > 0 ? Math.floor(ac / pw) : 0, inP = ac - p * pw;
    if (pw > 0) {
      if (inP === 0 && ac > 0) L -= 1.7;
      else if (inP === 1 || (inP === 0 && ac === 0)) L += 0.45;
      const len = 9 + Math.floor(hash(p, 0, 0, seed) * 9);
      const al = Math.floor(g.along + hash(p, 1, 0, seed) * len);
      if (al % len === 0 && g.along > 1) L -= 1.3;
      L += (hash(p, 7, 0, seed) - 0.5) * 0.9;
    }
    L += (vnoise(g.along / 4.5, ac * 0.95 + 0.5, p * 3.7, seed) - 0.5) * 1.5;
    return tone(r, L);
  };
}

/** Tree bark: tall ridges and dark crevices that wrap around the trunk, optional moss creeping up. */
export function bark(c: Tint, o: { seed?: number; moss?: Tint; mossTo?: number; axis?: Axis } = {}): Painter {
  const r = R(c), seed = o.seed ?? 0;
  const moss = o.moss ? R(o.moss) : null;
  const axis = o.axis ?? 'y';
  return (t) => {
    const g = grain(t, axis);
    if (g.end) {
      const d = Math.max(Math.abs(t.u + 0.5 - t.w / 2), Math.abs(t.v + 0.5 - t.h / 2));
      const lim = Math.min(t.w, t.h) / 2 - 1;
      if (d >= lim) return tone(r, -0.6 + (hash(t.u, t.v, 3, seed) - 0.5));
      const ring = ramp(0xd9a865);
      return tone(ring, (Math.floor(d) % 2 ? -0.9 : 0.4) + (d < 1 ? -1 : 0) + FACE_L[t.face] * 0.6);
    }
    const around = axis === 'y' ? (t.face < 2 ? t.z + 31 : t.x) : g.across + t.face * 17;
    const along = axis === 'y' ? t.y : g.along;
    const n = vnoise(around * 0.8, along * 0.2, t.face * 0.37, seed);
    let L = (n - 0.5) * 3.6 + lvl(t, { noise: 0.2, grad: 0.5, speck: 0.5, seed });
    if (hash(Math.floor(around), Math.floor(along / 3), 2, seed) > 0.9) L -= 1;
    if (moss) {
      const m = fbm(t.x / 3, t.y / 3, t.z / 3, seed + 9) + (t.face === 2 ? 0.3 : 0) - along / (o.mossTo ?? 14) * 0.5;
      if (m > 0.62) return tone(moss, L * 0.5 + (m > 0.72 ? 0.6 : -0.4));
    }
    return tone(r, L);
  };
}

/** Mottled foliage: small leaf clusters lit from above with dark gaps between them, per-block rims. */
export function leaves(c: Tint, o: { seed?: number; bloom?: Tint; rate?: number; lift?: number } = {}): Painter {
  const r = R(c), seed = o.seed ?? 0;
  const bloom = o.bloom ? R(o.bloom) : null;
  const rate = o.rate ?? 0.05, lift = o.lift ?? 0;
  const s = 1.9;
  return (t) => {
    const x = t.x / s, y = t.y / s, z = t.z / s;
    const n = fbm(x, y, z, seed);
    // relief: a cluster's upper edge catches light, its underside falls into shadow
    const up = fbm(x, y + 0.42, z + 0.2, seed) - fbm(x, y - 0.42, z - 0.2, seed);
    let L = (n - 0.5) * 3 + up * 5.5 + lift;
    if (n < 0.31) L -= 1.1;
    L += (fbm(t.x / 9, t.y / 9, t.z / 9, seed + 2) - 0.5) * 1.8;
    if (t.face === 2) L += 0.9;
    else if (t.face === 3) L -= 1.9;
    else {
      L += (t.by / t.sy - 0.5) * 1.1 + FACE_L[t.face] * 0.9;
      if (t.v === t.h - 1) L += 0.5;
      else if (t.v === 0) L -= 0.6;
    }
    const h = hash(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z), seed + 5);
    if (bloom && h < rate && t.face !== 3) return tone(bloom, (up > 0 ? 0.8 : -0.2) + (t.face === 2 ? 0.6 : 0));
    if (h > 0.93) L += 1;
    return tone(r, L);
  };
}

/** Natural rock: broad facets, hairline cracks, moss settling on top. */
export function rock(c: Tint, o: { seed?: number; moss?: Tint } = {}): Painter {
  const r = R(c), seed = o.seed ?? 0;
  const moss = o.moss ? R(o.moss) : null;
  return (t) => {
    let L = lvl(t, { noise: 1.3, scale: 4.5, seed });
    const cr = vnoise(t.x / 3.3, t.y / 3.3, t.z / 3.3, seed + 4);
    if (Math.abs(cr - 0.5) < 0.035) L -= 1.6;
    if (moss) {
      const m = fbm(t.x / 2.8, t.y / 2.8, t.z / 2.8, seed + 8) + (t.face === 2 ? 0.22 : t.face === 3 ? -1 : (t.by / t.sy - 0.75) * 0.5);
      if (m > 0.6) return tone(moss, L * 0.4 + (m > 0.7 ? 0.7 : -0.5) + (t.face === 2 ? 0.5 : 0));
    }
    return tone(r, L);
  };
}

/** Cut stone blocks with mortar lines. */
export function bricks(c: Tint, o: { w?: number; h?: number; seed?: number; mortar?: Tint } = {}): Painter {
  const r = R(c), bw = o.w ?? 6, bh = o.h ?? 3, seed = o.seed ?? 0;
  const mortar = o.mortar ? R(o.mortar) : null;
  return (t) => {
    const horiz = t.face === 2 || t.face === 3;
    const row = Math.floor(t.v / bh), inV = t.v - row * bh;
    const uo = t.u + (row & 1) * Math.floor(bw / 2);
    const cu = Math.floor(uo / bw), inU = uo - cu * bw;
    let L = lvl(t, { noise: 0.3, rim: horiz ? 0.4 : 1, seed }) + (hash(cu, row, t.face, seed) - 0.5) * 1.3;
    if (inV === 0 || inU === 0) return tone(mortar ?? r, mortar ? L * 0.3 : L - 1.8);
    if (inV === bh - 1) L += 0.5;
    if (inU === 1) L += 0.3;
    return tone(r, L);
  };
}

export interface ClothOpts { trim?: Tint; hem?: number; collar?: number; stripe?: Tint; stripeEvery?: number; check?: Tint; shade?: Shade; seed?: number }

/** Fabric: soft folds, a hem, optional trim band, stripes or checks. */
export function cloth(c: Tint, o: ClothOpts = {}): Painter {
  const r = R(c);
  const trim = o.trim ? R(o.trim) : null, stripe = o.stripe ? R(o.stripe) : null, check = o.check ? R(o.check) : null;
  const seed = o.seed ?? 0, hem = o.hem ?? 1, every = o.stripeEvery ?? 3;
  return (t) => {
    const side = t.face !== 2 && t.face !== 3;
    let L = lvl(t, { noise: 0.3, speck: 0.25, jitter: 0.25, ...o.shade, seed });
    if (side) {
      const colm = t.face < 2 ? t.bz : t.bx;
      const fold = hash(Math.floor(colm), t.face, 9, seed);
      if (fold > 0.72 && t.v < t.h - 1) L -= 0.75;
      else if (fold < 0.2) L += 0.35;
      if (trim && t.v < hem) return tone(trim, lvl(t, { noise: 0, rim: 0, grad: 0 }) + 0.4);
      if (trim && o.collar && t.v >= t.h - o.collar) return tone(trim, L * 0.4 + 0.5);
    }
    if (stripe && Math.floor(t.y) % every === 0) return tone(stripe, L);
    if (check && (Math.floor(t.x / 2) + Math.floor(t.y / 2) + Math.floor(t.z / 2)) % 2 === 0) return tone(check, L);
    return tone(r, L);
  };
}

/** Polished metal: hard contrast with diagonal glints, as on gold trims and brass fittings. */
export function metal(c: Tint, o: { seed?: number } = {}): Painter {
  const r = ramp(typeof c === 'object' ? c.c[c.mid] : col(c), { step: 0.085 });
  return (t) => {
    let L = lvl(t, { noise: 0, speck: 0, rim: 1.3, jitter: 0.15 });
    const d = (t.u + t.v + Math.floor(hash(t.face, 1, 2, o.seed ?? 0) * 5)) % 7;
    if (d === 2) L += 1.5;
    else if (d === 3) L += 0.6;
    else if (d === 6) L -= 0.6;
    return tone(r, L);
  };
}

/** Self-lit surface: brightest in the middle of each face. Use on `glow` boxes. */
export function lamp(c: Tint): Painter {
  const r = R(c);
  return (t) => {
    const d = Math.max(Math.abs((t.u + 0.5) / t.w - 0.5), Math.abs((t.v + 0.5) / t.h - 0.5)) * 2;
    return tone(r, 1.6 - d * 2.2);
  };
}

/** Soil with pebbles and darker damp clumps. */
export function dirt(c: Tint, o: { seed?: number } = {}): Painter {
  const r = R(c), seed = o.seed ?? 0;
  return (t) => {
    let L = lvl(t, { noise: 1.1, scale: 3, seed, rim: 0.5 });
    const h = hash(Math.floor(t.x / 2), Math.floor(t.y / 2), Math.floor(t.z / 2), seed + 1);
    if (h > 0.93) L += 1.4;
    return tone(r, L);
  };
}

/** Paint `over` wherever `mask` says so, otherwise `base`. */
export const layer = (base: Painter, over: Painter, mask: (t: Texel) => boolean): Painter => (t) => (mask(t) ? over(t) : base(t));

/** Wrap a painter so some texels become see-through (for `cut` boxes). */
export const cutout = (p: Painter, hole: (t: Texel) => boolean): Painter => (t) => (hole(t) ? -1 : p(t));
