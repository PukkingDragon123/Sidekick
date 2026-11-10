// Forest kit: every plant is built from real boxes (no flat cross-planes) with painted pixel textures.
import { box, lean, type BoxSpec, type Painter, type Vec3 } from '../gfx/box.ts';
import { ramp, tone, type Ramp } from '../gfx/color.ts';
import { bark, flat, leaves, lvl, R, rock, smooth, solid, type Tint } from '../gfx/mats.ts';
import { hash, rng, type Rng } from '../gfx/noise.ts';

export const PAL = {
  grass: '#5cab3a', grassLight: '#8fd24e', grassDeep: '#3d8c3c',
  oak: '#4c9b3b', oakDeep: '#2f7a40', birchLeaf: '#9ccb3f', pine: '#2c7556', blossom: '#f5a3bd', maple: '#ee8a2e',
  barkOak: '#7b5235', barkBirch: '#ebe5d6', barkPine: '#5e3e2f', barkBlossom: '#5a4038',
  stone: '#8e93a2', moss: '#69a848', dirt: '#8a5b3d', path: '#c8a26a', sand: '#e2cf96',
  cream: '#f3e6cc', stem: '#5aa83f',
};

/** Blade/stem painter: dark at the base, bright at the tip. */
const blade = (c: Tint, from = -1.6, to = 1.6): Painter => {
  const r = R(c);
  return (t) => tone(r, from + (to - from) * (t.by / t.sy) + (t.face === 2 ? 0.5 : t.face === 1 || t.face === 5 ? -0.5 : 0));
};

/** Rotate a set of boxes together about one pivot. */
const turn = (boxes: BoxSpec[], rot: Vec3, pivot: Vec3): BoxSpec[] => boxes.map((b) => ({ ...b, rot, pivot }));

// ------------------------------------------------------------------ grass

export function grassClump(seed: number, tall = false, c: Tint = PAL.grass): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const mat = blade(c), tip = blade(c, 0.2, 2.2);
  const n = r.int(6, 9);
  for (let i = 0; i < n; i++) {
    const a = r.range(0, Math.PI * 2), d = r.range(0.3, 3.4);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = Math.round(tall ? r.range(7, 12) : r.range(3, 7));
    const tilt = r.range(8, 24);
    const rx = Math.sin(a) * tilt, rz = -Math.cos(a) * tilt;
    const w = r.chance(0.35) ? 2 : 1;
    const lower = Math.max(2, Math.round(h * 0.6));
    out.push(lean(box(x, 0, z, w, lower, 1, mat, { sway: 1, skip: 'd' }), rx, 0, rz));
    if (h - lower >= 1) {
      // upper segment bends further out, giving each blade a curve
      const k = (tilt * Math.PI) / 180;
      const tx = x + Math.cos(a) * Math.sin(k) * lower, tz = z + Math.sin(a) * Math.sin(k) * lower, ty = Math.cos(k) * lower - 0.3;
      out.push(lean(box(tx, ty, tz, 1, h - lower + 1, 1, tip, { sway: 1, skip: 'd' }), rx * 2, 0, rz * 2));
    }
  }
  return out;
}

/** Fern: arcing fronds built from stepped segments. */
export function fern(seed: number, c: Tint = '#4f9e45'): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const mat = blade(c, -1.2, 1.4);
  const n = r.int(5, 7);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.range(-0.3, 0.3);
    const cs = Math.cos(a), sn = Math.sin(a);
    let x = cs * 0.8, z = sn * 0.8, y = 0;
    const len = r.int(3, 4);
    for (let s = 0; s < len; s++) {
      const pitch = 62 - s * 26; // degrees above horizontal, arcing over
      const k = (pitch * Math.PI) / 180;
      const seg = 3.2;
      const w = s === len - 1 ? 2 : 3;
      out.push({
        ...box(x, y, z, w, 1, seg + 0.6, mat, { sway: 0.8 }),
        rot: [-pitch, (-a * 180) / Math.PI + 90, 0], pivot: [x, y, z],
      });
      x += cs * Math.cos(k) * seg; z += sn * Math.cos(k) * seg; y += Math.sin(k) * seg;
    }
  }
  return out;
}

// ------------------------------------------------------------------ flowers

const stemMat = blade(PAL.stem, -1.2, 0.8);
const leafMat = blade('#4c9f3c', -0.6, 1.2);

function stemAndLeaves(h: number, r: Rng, out: BoxSpec[], leafLen = 3) {
  out.push(box(0, 0, 0, 1, h, 1, stemMat, { sway: 1, skip: 'd' }));
  const y = Math.max(1, Math.round(h * 0.3));
  out.push(lean(box(1.6, y, 0, leafLen, 1, 2, leafMat, { sway: 1 }), 0, 0, 28));
  out.push(lean(box(-1.6, y + 1, 0, leafLen, 1, 2, leafMat, { sway: 1 }), 0, 0, -28));
}

export function daisy(seed: number, petal: Tint = '#fbfaf2', centre: Tint = '#f5c12f'): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const h = r.int(5, 8);
  stemAndLeaves(h, r, out);
  const p = solid(petal, { noise: 0.3, rim: 0.6 }), c = solid(centre, { noise: 0.5 });
  const head: BoxSpec[] = [
    box(0, h, 0, 2, 2, 2, c, { sway: 1 }),
    box(2, h, 0, 2, 1, 2, p, { sway: 1 }), box(-2, h, 0, 2, 1, 2, p, { sway: 1 }),
    box(0, h, 2, 2, 1, 2, p, { sway: 1 }), box(0, h, -2, 2, 1, 2, p, { sway: 1 }),
    box(1.5, h - 0.4, 1.5, 1, 1, 1, p, { sway: 1 }), box(-1.5, h - 0.4, 1.5, 1, 1, 1, p, { sway: 1 }),
    box(1.5, h - 0.4, -1.5, 1, 1, 1, p, { sway: 1 }), box(-1.5, h - 0.4, -1.5, 1, 1, 1, p, { sway: 1 }),
  ];
  out.push(...turn(head, [r.range(20, 38), r.range(-25, 25), 0], [0, h, 0]));
  return out;
}

export function tulip(seed: number, c: Tint = '#e9463f'): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const h = r.int(6, 9);
  out.push(box(0, 0, 0, 1, h, 1, stemMat, { sway: 1, skip: 'd' }));
  out.push(lean(box(1.2, 0, 0, 1, 5, 2, leafMat, { sway: 1 }), 0, 0, -18));
  out.push(lean(box(-1.2, 0, 0.3, 1, 4, 2, leafMat, { sway: 1 }), 0, 0, 20));
  const rr = R(c);
  const cup: Painter = (t) => tone(rr, lvl(t, { noise: 0.3 }) + (t.by / t.sy - 0.4) * 1.6);
  out.push(box(0, h, 0, 3, 3, 3, cup, { sway: 1 }));
  const tip = solid(rr, { face: 0.4, noise: 0 });
  const lift: Painter = (t) => tone(rr, 1.6 + (t.face === 2 ? 0.6 : 0));
  out.push(box(-1, h + 3, -1, 1, 1, 1, lift, { sway: 1 }), box(1, h + 3, 1, 1, 1, 1, lift, { sway: 1 }),
    box(1, h + 3, -1, 1, 1, 1, tip, { sway: 1 }), box(-1, h + 3, 1, 1, 1, 1, tip, { sway: 1 }));
  return out;
}

export function bluebell(seed: number, c: Tint = '#7281ea'): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const h = r.int(7, 9);
  out.push(lean(box(0, 0, 0, 1, h - 2, 1, stemMat, { sway: 1, skip: 'd' }), 0, 0, -8));
  out.push({ ...box(1, h - 2.4, 0, 1, 3, 1, stemMat, { sway: 1 }), rot: [0, 0, -50], pivot: [0.8, h - 2.4, 0] });
  out.push(lean(box(-1, 0, 0, 1, 5, 2, leafMat, { sway: 1 }), 0, 0, 16), lean(box(1, 0, 0.5, 1, 4, 2, leafMat, { sway: 1 }), 0, 30, -22));
  const rr = R(c);
  const bell: Painter = (t) => tone(rr, lvl(t, { noise: 0.2 }) + (t.by / t.sy - 0.5) * 1.5);
  const lip: Painter = (t) => tone(rr, 1.8);
  for (const [x, y] of [[1.6, h - 3.6], [3.2, h - 2.8], [0.6, h - 5.6]] as const) {
    out.push(box(x, y, 0, 2, 2, 2, bell, { sway: 1 }), box(x, y - 0.6, 0, 3, 1, 3, lip, { sway: 1, skip: 'u' }));
  }
  return out;
}

export function lavender(seed: number, c: Tint = '#a67ce2'): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const rr = R(c);
  const bud: Painter = (t) => tone(rr, lvl(t, { noise: 0.8, scale: 1.4 }) + (t.y > 7 ? 0.8 : 0));
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 2.4 + r.range(-0.4, 0.4), z = r.range(-1, 1), h = r.int(4, 6), tilt = (i - 1) * -12 + r.range(-5, 5);
    const stalk: BoxSpec[] = [box(x, 0, z, 1, h, 1, stemMat, { sway: 1, skip: 'd' })];
    for (let k = 0; k < 4; k++) stalk.push(box(x + (k & 1 ? 0.4 : -0.4), h + k * 1.4, z, 2, 2, 2, bud, { sway: 1 }));
    stalk.push(box(x, h + 5.8, z, 1, 1, 1, bud, { sway: 1 }));
    out.push(...turn(stalk, [0, 0, tilt], [x, 0, z]));
  }
  return out;
}

export function poppy(seed: number, c: Tint = '#f0683a'): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const h = r.int(6, 9);
  stemAndLeaves(h, r, out, 2);
  const rr = R(c);
  const petal: Painter = (t) => {
    const d = Math.hypot(t.x, t.z);
    return tone(rr, lvl(t, { noise: 0.3 }) + (d < 1.6 ? -1.6 : 0.3));
  };
  const head: BoxSpec[] = [
    box(0, h, 0, 5, 1, 5, petal, { sway: 1 }),
    box(0, h + 1, 0, 1, 1, 1, flat('#2c2430'), { sway: 1 }),
    lean(box(2.6, h + 0.4, 0, 1, 2, 4, petal, { sway: 1 }), 0, 0, -30), lean(box(-2.6, h + 0.4, 0, 1, 2, 4, petal, { sway: 1 }), 0, 0, 30),
    lean(box(0, h + 0.4, 2.6, 4, 2, 1, petal, { sway: 1 }), 30, 0, 0), lean(box(0, h + 0.4, -2.6, 4, 2, 1, petal, { sway: 1 }), -30, 0, 0),
  ];
  out.push(...turn(head, [r.range(14, 30), r.range(-30, 30), 0], [0, h, 0]));
  return out;
}

export function sunflower(seed: number): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const h = r.int(17, 22);
  out.push(box(0, 0, 0, 2, h, 2, blade('#5a9e3a', -1.2, 0.6), { sway: 0.7, skip: 'd' }));
  for (const [y, s] of [[5, 1], [9, -1], [13, 1]] as const) out.push(lean(box(s * 3, y, 0, 5, 1, 3, leafMat, { sway: 0.7 }), 0, 0, s * 24));
  const pr = ramp(0xf7c531), cr = ramp(0x7a4a28);
  const disc: Painter = (t) => {
    const dx = t.bx - t.sx / 2, dy = t.by - t.sy / 2, d = Math.hypot(dx, dy);
    if (t.face === 4 || t.face === 5) {
      if (d < 3) return tone(cr, (hash(t.u, t.v, 0, seed) > 0.6 ? 1 : -0.4) + (d < 1.5 ? -0.8 : 0));
      const ang = Math.atan2(dy, dx), spoke = Math.cos(ang * 7);
      if (d > 5.6 || (d > 4.2 && spoke < -0.1)) return -1;
      return tone(pr, spoke > 0.5 ? 1.2 : spoke < 0 ? -1.2 : 0);
    }
    return d > 4.6 ? -1 : tone(pr, -1);
  };
  out.push({ ...box(0, h - 3, 1.2, 11, 11, 1, disc, { sway: 0.7, cut: true }), rot: [-22, r.range(-20, 20), 0], pivot: [0, h, 0] });
  return out;
}

/** Low ground cover: clover leaves with the odd tiny blossom. */
export function clover(seed: number, bloom: Tint = '#fff6d8'): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const leaf = solid('#57a83e', { noise: 0.6, scale: 1.5 }), b = solid(bloom, { noise: 0.2 });
  for (let i = 0; i < 6; i++) {
    const x = r.range(-4, 4), z = r.range(-4, 4), y = r.range(0.6, 2);
    out.push(box(x, 0, z, 1, y, 1, stemMat, { skip: 'd', sway: 1 }));
    out.push(box(x - 1, y, z, 2, 1, 1, leaf, { sway: 1 }), box(x + 0.5, y, z + 1, 1, 1, 2, leaf, { sway: 1 }), box(x + 0.6, y, z - 0.8, 2, 1, 1, leaf, { sway: 1 }));
    if (r.chance(0.3)) out.push(box(x + r.range(-2, 2), 0, z + r.range(-2, 2), 1, 3, 1, stemMat, { sway: 1 }), box(x, 3, z, 2, 2, 2, b, { sway: 1 }));
  }
  return out;
}

// ------------------------------------------------------------------ mushrooms

function capMat(c: Tint, o: { spots?: Tint; seed?: number; gills?: Tint } = {}): Painter {
  const r = R(c), sp = o.spots ? R(o.spots) : null, g = R(o.gills ?? PAL.cream), seed = o.seed ?? 0;
  return (t) => {
    if (t.face === 3) return tone(g, (Math.floor(t.u) % 2 ? -1.4 : 0) - 0.4);
    const L = lvl(t, { noise: 0.5, scale: 3 });
    if (sp && t.face !== 3) {
      const cx = Math.floor(t.x / 2.5), cz = Math.floor(t.z / 2.5), cy = Math.floor(t.y / 2.5);
      const h = hash(cx, cy, cz, seed);
      if (h > 0.62 && hash(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z), seed + 1) > 0.42) return tone(sp, L * 0.4 + 0.5);
    }
    return tone(r, L);
  };
}
const stalk = (c: Tint = PAL.cream): Painter => {
  const r = R(c);
  return (t) => tone(r, lvl(t, { noise: 0.4 }) + (Math.floor(t.bx + t.bz) % 3 === 0 ? -0.5 : 0));
};

/** Classic spotted toadstool with a ringed stem and a two-tier domed cap. */
export function toadstool(seed: number, c: Tint = '#da4230', scale = 1): BoxSpec[] {
  const r = rng(seed), s = scale;
  const cap = capMat(c, { spots: '#fff8ea', seed });
  const h = Math.round(r.int(4, 6) * s), w = Math.round(7 * s);
  return [
    box(0, 0, 0, Math.max(2, Math.round(2 * s)), h, Math.max(2, Math.round(2 * s)), stalk(), { skip: 'd' }),
    box(0, Math.round(h * 0.55), 0, Math.round(3 * s) + 1, 1, Math.round(3 * s) + 1, solid(PAL.cream, { noise: 0.2 })),
    box(0, h, 0, w, Math.max(2, Math.round(2 * s)), w, cap),
    box(0, h + Math.max(2, Math.round(2 * s)), 0, w - 2, Math.max(1, Math.round(1.5 * s)), w - 2, cap, { skip: 'd' }),
    ...(s > 1.2 ? [box(0, h + Math.round(3.5 * s), 0, w - 5, 1, w - 5, cap, { skip: 'd' })] : []),
  ];
}

/** Plump brown bolete: thick stem, bun cap. */
export function bolete(seed: number, c: Tint = '#a96a3b'): BoxSpec[] {
  const r = rng(seed), cap = capMat(c, { gills: '#f1d9a0', seed });
  const h = r.int(3, 4);
  return [
    box(0, 0, 0, 4, h, 4, stalk('#f0dfc0'), { skip: 'd' }),
    box(0, 0, 0, 5, 2, 5, stalk('#ead2ab'), { skip: 'd' }),
    box(0, h, 0, 8, 2, 8, cap), box(0, h + 2, 0, 6, 2, 6, cap, { skip: 'd' }), box(0, h + 4, 0, 3, 1, 3, cap, { skip: 'd' }),
  ];
}

/** A cluster of thin-stemmed flat caps at different heights. */
export function chanterelles(seed: number, c: Tint = '#f08b2b'): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const cap = capMat(c, { gills: '#ffd58a', seed }), st = stalk('#fbe3a8');
  const spots: [number, number, number, number][] = [[0, 0, 7, 5], [4, 2, 4, 4], [-3, 3, 5, 3], [-4, -3, 3, 3], [3, -3, 2, 3]];
  for (const [x, z, h, w] of spots) {
    const hh = h + r.int(-1, 1), tilt = r.range(-10, 10);
    out.push(...turn([
      box(x, 0, z, 1, hh, 1, st, { skip: 'd' }),
      box(x, hh, z, w, 1, w, cap), box(x, hh + 1, z, Math.max(1, w - 2), 1, Math.max(1, w - 2), cap, { skip: 'd' }),
    ], [tilt, 0, tilt * 0.7], [x, 0, z]));
  }
  return out;
}

/** Small glowing caps for night-time. */
export function glowshroom(seed: number, c: Tint = '#69d7f3'): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const rr = R(c);
  const cap: Painter = (t) => (t.face === 3 ? tone(rr, -2) : tone(rr, 0.6 + (hash(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z), seed) > 0.7 ? 1.6 : 0) + (t.face === 2 ? 0.8 : 0)));
  for (const [x, z, h] of [[0, 0, 5], [3, 1, 3], [-2, 2, 2], [-1, -3, 4]] as const) {
    const hh = h + r.int(0, 1);
    out.push(box(x, 0, z, 1, hh, 1, stalk('#d7e8f2'), { skip: 'd' }), box(x, hh, z, 3, 2, 3, cap, { glow: true }), box(x, hh + 2, z, 1, 1, 1, cap, { glow: true, skip: 'd' }));
  }
  return out;
}

/** Bracket fungi that grow out of a vertical surface facing +z. */
export function shelfFungus(seed: number, c: Tint = '#d99a52'): BoxSpec[] {
  const cap = capMat(c, { gills: '#f6e2b8', seed });
  return [box(0, 0, 1.5, 6, 1, 3, cap), box(0, 1, 1, 4, 1, 2, cap, { skip: 'd' }), box(2, 3, 1, 4, 1, 2, cap), box(-2, -3, 1.5, 5, 1, 3, cap)];
}

// ------------------------------------------------------------------ bushes, rocks, logs

/** Voxel volume: unions of rough ellipsoids on a grid, emitted as cubes with hidden faces dropped. */
class Vox {
  private set = new Set<number>();
  cells: [number, number, number][] = [];
  constructor(public cell: number, public ox = 0, public oy = 0, public oz = 0) {}
  private key(i: number, j: number, k: number) { return (i + 64) | ((j + 64) << 8) | ((k + 64) << 16); }
  has(i: number, j: number, k: number) { return this.set.has(this.key(i, j, k)); }
  add(i: number, j: number, k: number) {
    const key = this.key(i, j, k);
    if (!this.set.has(key)) { this.set.add(key); this.cells.push([i, j, k]); }
  }
  /** Fill an ellipsoid (px, relative to the origin). `cut` trims the underside: 0 keeps it whole, 1 slices at the centre. */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, seed: number, rough = 0.4, cut = 0.5) {
    const c = this.cell;
    for (let i = Math.floor((cx - rx) / c); i <= Math.ceil((cx + rx) / c); i++)
      for (let j = Math.floor((cy - ry) / c); j <= Math.ceil((cy + ry) / c); j++)
        for (let k = Math.floor((cz - rz) / c); k <= Math.ceil((cz + rz) / c); k++) {
          const x = (i + 0.5) * c - cx, y = (j + 0.5) * c - cy, z = (k + 0.5) * c - cz;
          if (y < -ry * (1 - cut)) continue;
          const d = (x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2;
          if (d + (hash(i, j, k, seed) - 0.5) * rough * 2 < 1) this.add(i, j, k);
        }
    return this;
  }
  emit(mats: Painter[], sway: number, out: BoxSpec[], seed: number, tufts = 0.22, strands?: Painter) {
    const c = this.cell;
    const dirs: [number, number, number, string][] = [[1, 0, 0, 'e'], [-1, 0, 0, 'w'], [0, 1, 0, 'u'], [0, -1, 0, 'd'], [0, 0, 1, 's'], [0, 0, -1, 'n']];
    for (const [i, j, k] of this.cells) {
      let skip = '';
      for (const [dx, dy, dz, f] of dirs) if (this.has(i + dx, j + dy, k + dz)) skip += f;
      if (skip.length === 6) continue;
      const h = hash(i, j, k, seed + 11);
      const mat = mats[Math.floor(h * mats.length)];
      const x = this.ox + (i + 0.5) * c, y = this.oy + j * c, z = this.oz + (k + 0.5) * c;
      out.push(box(x, y, z, c, c, c, mat, { sway, skip }));
      // small cubes perched on exposed faces soften the silhouette
      const h2 = hash(i, j, k, seed + 12);
      if (h2 < tufts) {
        const open = dirs.filter((d) => d[3] !== 'd' && !skip.includes(d[3]));
        if (open.length) {
          const [dx, dy, dz] = open[Math.floor(hash(i, j, k, seed + 13) * open.length)];
          const s = Math.max(2, Math.round(c * (0.4 + hash(i, j, k, seed + 14) * 0.25)));
          const off = (c + s) / 2 - 0.5, jx = (hash(i, j, k, seed + 15) - 0.5) * (c - s), jz = (hash(i, j, k, seed + 16) - 0.5) * (c - s);
          out.push(box(x + dx * off + (dx ? 0 : jx), y + c / 2 - s / 2 + dy * off + (dy ? 0 : jx * 0.5), z + dz * off + (dz ? 0 : jz), s, s, s, mat, { sway: sway * 1.3 }));
        }
      }
      if (strands && !skip.includes('d') && hash(i, j, k, seed + 17) < 0.28) {
        const len = 3 + Math.floor(hash(i, j, k, seed + 18) * 8);
        out.push(box(x + (hash(i, j, k, seed + 19) - 0.5) * (c - 2), y - len, z + (hash(i, j, k, seed + 20) - 0.5) * (c - 2), 2, len + 1, 1, strands, { sway: sway * 2.5, skip: 'u' }));
      }
    }
  }
}

const leafSet = (c: Tint, seed: number, bloom?: Tint, rate?: number): Painter[] =>
  [-0.7, -0.25, 0.2, 0.65].map((lift) => leaves(c, { seed, bloom, rate, lift }));

export function bush(seed: number, c: Tint = '#4a9a3c', bloom?: Tint): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const v = new Vox(4);
  v.blob(0, 2, 0, r.range(8, 10), r.range(7, 9), r.range(8, 10), seed, 0.45, 0.8);
  v.blob(r.range(5, 7), 1, r.range(-3, 3), 6, 6, 6, seed + 1, 0.4, 0.85);
  v.blob(r.range(-7, -5), 1, r.range(-3, 3), 6, 5, 6, seed + 2, 0.4, 0.85);
  v.emit(leafSet(c, seed, bloom, bloom ? 0.07 : 0), 0.3, out, seed, 0.3);
  return out;
}

export function boulder(seed: number, c: Tint = PAL.stone, moss: Tint | undefined = PAL.moss): BoxSpec[] {
  const r = rng(seed);
  const mat = rock(c, { seed, moss });
  const out: BoxSpec[] = [
    { ...box(0, -1, 0, 11, 8, 9, mat), rot: [r.range(-6, 6), r.range(-25, 25), r.range(-6, 6)] },
    { ...box(5, -1, 3, 7, 5, 7, mat), rot: [0, r.range(10, 40), r.range(-8, 8)] },
    { ...box(-5, -1, 3, 5, 4, 6, mat), rot: [r.range(-8, 8), r.range(-40, -10), 0] },
    { ...box(1, 5, -1, 6, 4, 5, mat), rot: [r.range(-10, 10), r.range(-30, 30), r.range(-10, 10)] },
  ];
  if (r.chance(0.5)) out.push({ ...box(-6, -1, -4, 4, 3, 4, mat), rot: [0, r.range(0, 45), 0] });
  return out;
}

export function pebbles(seed: number, c: Tint = '#9a9eab'): BoxSpec[] {
  const r = rng(seed), mat = rock(c, { seed }), out: BoxSpec[] = [];
  for (let i = 0; i < 4; i++) {
    const s = r.int(2, 4);
    out.push({ ...box(r.range(-5, 5), -0.5, r.range(-5, 5), s, Math.max(1, s - 1), s, mat), rot: [0, r.range(0, 90), 0] });
  }
  return out;
}

const woodEnd = (c: Tint): Painter => {
  const r = R(c);
  return (t) => {
    const d = Math.max(Math.abs(t.u + 0.5 - t.w / 2), Math.abs(t.v + 0.5 - t.h / 2));
    return tone(r, (Math.floor(d) % 2 ? -0.8 : 0.5) + (d < 1 ? -1 : 0) + (d > Math.min(t.w, t.h) / 2 - 1 ? -1.6 : 0));
  };
};

export function fallenLog(seed: number): BoxSpec[] {
  const r = rng(seed);
  const b = bark(PAL.barkOak, { seed, moss: PAL.moss, axis: 'x', mossTo: 40 });
  const logMat: Painter = (t) => (t.face < 2 ? woodEnd('#d7a568')(t) : b(t));
  const hollow = flat('#2a1c18');
  const out: BoxSpec[] = [
    box(0, 0, 0, 26, 9, 9, logMat),
    box(13.1, 2, 0, 1, 5, 5, hollow, { skip: 'w' }),
    { ...box(-6, 6, 2, 3, 6, 3, bark(PAL.barkOak, { seed: seed + 1 })), rot: [20, 0, -25] },
    { ...box(6, 0, -5, 4, 4, 7, bark(PAL.barkOak, { seed: seed + 2, axis: 'z' })), rot: [0, 20, 0] },
  ];
  out.push(...toadstool(seed + 3, '#da4230', 0.8).map((x) => ({ ...x, at: [x.at[0] - 9, x.at[1] + 9, x.at[2] + 1] as Vec3 })));
  out.push(...chanterelles(seed + 4).map((x) => ({ ...x, at: [x.at[0] + 3, x.at[1] + 9, x.at[2] - 1] as Vec3, pivot: x.pivot ? ([x.pivot[0] + 3, x.pivot[1] + 9, x.pivot[2] - 1] as Vec3) : undefined })));
  if (r.chance(0.7)) out.push(...grassClump(seed + 5).map((x) => ({ ...x, at: [x.at[0] + 10, x.at[1], x.at[2] + 6] as Vec3, pivot: x.pivot ? ([x.pivot[0] + 10, x.pivot[1], x.pivot[2] + 6] as Vec3) : undefined })));
  return out;
}

export function stump(seed: number): BoxSpec[] {
  const r = rng(seed);
  const b = bark(PAL.barkOak, { seed, moss: PAL.moss, mossTo: 9 });
  const top = woodEnd('#d9a966');
  const mat: Painter = (t) => (t.face === 2 ? top(t) : b(t));
  const out: BoxSpec[] = [box(0, 0, 0, 11, 7, 11, mat, { skip: 'd' })];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r.range(-0.3, 0.3);
    out.push({ ...box(Math.cos(a) * 6, -1, Math.sin(a) * 6, 4, 4, 7, b), rot: [-28, (-a * 180) / Math.PI + 90, 0] });
  }
  return out;
}

// ------------------------------------------------------------------ trees

interface TreeStyle { bark: Tint; leaf: Tint; bloom?: Tint; rate?: number; moss?: boolean }

function trunkAndRoots(r: Rng, seed: number, s: TreeStyle, h: number, w: number, out: BoxSpec[]): [number, number] {
  const b = bark(s.bark, { seed, moss: s.moss ? PAL.moss : undefined, mossTo: 16 });
  let x = 0, z = 0, y = 0, ww = w;
  const segs = Math.ceil(h / 11);
  for (let i = 0; i < segs; i++) {
    const sh = Math.min(11, h - y) + 1;
    out.push({ ...box(x, y, z, ww, sh, ww, b, { skip: i ? 'd' : 'd' }), rot: [r.range(-3, 3), r.range(-8, 8), r.range(-3, 3)] });
    y += sh - 1; x += r.range(-1.2, 1.2); z += r.range(-1.2, 1.2); ww = Math.max(5, ww - 1.5);
  }
  const n = r.int(4, 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.range(-0.35, 0.35), len = r.range(8, 12);
    out.push({ ...box(Math.cos(a) * (w * 0.45), -1.5, Math.sin(a) * (w * 0.45), 4, 5, len, b), rot: [-24, (-a * 180) / Math.PI + 90, 0], pivot: [Math.cos(a) * w * 0.2, 3, Math.sin(a) * w * 0.2] });
  }
  return [x, z];
}

const strand = (c: Tint): Painter => blade(c, 0.4, -1.5);

function branches(r: Rng, seed: number, s: TreeStyle, x: number, y: number, z: number, n: number, len: number, out: BoxSpec[]): [number, number, number][] {
  const b = bark(s.bark, { seed: seed + 1 });
  const tips: [number, number, number][] = [];
  const a0 = r.range(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 + r.range(-0.3, 0.3), pitch = r.range(28, 42), k = (pitch * Math.PI) / 180;
    out.push({ ...box(x, y - 2, z + len / 2, 4, 4, len, b), rot: [-pitch, (a * 180) / Math.PI, 0], pivot: [x, y, z] });
    tips.push([x + Math.sin(a) * Math.cos(k) * len, y + Math.sin(k) * len, z + Math.cos(a) * Math.cos(k) * len]);
  }
  return tips;
}

export function oak(seed: number, o: Partial<TreeStyle> = {}): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const s: TreeStyle = { bark: PAL.barkOak, leaf: PAL.oak, moss: true, ...o };
  const h = r.int(40, 50);
  const [tx, tz] = trunkAndRoots(r, seed, s, h, 12, out);
  const tips = branches(r, seed, s, tx, h - 12, tz, 3, 22, out);
  const v = new Vox(10);
  const R0 = r.range(30, 36);
  v.blob(tx, h + 14, tz, R0, R0 * 0.72, R0, seed, 0.42, 0.42);
  for (const [bx, by, bz] of tips) v.blob(bx, by + 6, bz, r.range(16, 21), r.range(13, 16), r.range(16, 21), seed + 3, 0.4, 0.5);
  v.blob(tx + r.range(-8, 8), h + 14 + R0 * 0.55, tz + r.range(-8, 8), R0 * 0.5, R0 * 0.34, R0 * 0.5, seed + 4, 0.4, 0.7);
  v.emit(leafSet(s.leaf, seed, s.bloom, s.rate), 0.3, out, seed, 0.24, strand(s.leaf));
  return out;
}

export function birch(seed: number): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const bk = R(PAL.barkBirch), mark = R('#3a3532');
  const mat: Painter = (t) => {
    const L = lvl(t, { noise: 0.4, scale: 3 });
    const row = Math.floor(t.y / 3);
    const h = hash(row, t.face, 0, seed);
    if (h > 0.5 && Math.floor(t.y) % 3 === 0 && hash(Math.floor(t.face < 2 ? t.z : t.x), row, 1, seed) > 0.35) return tone(mark, L * 0.3);
    return tone(bk, L);
  };
  const h = r.int(50, 62);
  let x = 0, z = 0, y = 0, w = 7;
  while (y < h) {
    const sh = Math.min(13, h - y) + 1;
    out.push({ ...box(x, y, z, w, sh, w, mat, { skip: 'd' }), rot: [r.range(-2, 2), 0, r.range(-2, 2)] });
    y += sh - 1; x += r.range(-1, 1); z += r.range(-1, 1); w = Math.max(4, w - 1);
  }
  out.push({ ...box(x * 0.3, h * 0.45, 0, 3, 3, 12, mat), rot: [-40, r.range(0, 360), 0], pivot: [x * 0.3, h * 0.45, 0] });
  const v = new Vox(8);
  v.blob(x, h - 4, z, 17, 22, 17, seed, 0.45, 0.35);
  v.blob(x + r.range(-9, 9), h - 22, z + r.range(-9, 9), 12, 10, 12, seed + 1, 0.45, 0.5);
  v.blob(x + r.range(-6, 6), h + 14, z + r.range(-6, 6), 9, 9, 9, seed + 2, 0.4, 0.6);
  v.emit(leafSet(PAL.birchLeaf, seed), 0.35, out, seed, 0.26, strand(PAL.birchLeaf));
  return out;
}

export function pine(seed: number): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const b = bark(PAL.barkPine, { seed });
  const h = r.int(70, 88);
  out.push(box(0, 0, 0, 9, 16, 9, b, { skip: 'd' }), box(0, 15, 0, 6, h - 30, 6, b));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6;
    out.push({ ...box(Math.cos(a) * 5, -1.5, Math.sin(a) * 5, 3, 4, 8, b), rot: [-24, (-a * 180) / Math.PI + 90, 0] });
  }
  const v = new Vox(6);
  const tiers = r.int(5, 6);
  let y = 16;
  for (let i = 0; i < tiers; i++) {
    const f = 1 - i / tiers;
    const rad = 8 + f * 20;
    v.blob(r.range(-1.5, 1.5), y + 6, r.range(-1.5, 1.5), rad, 9, rad, seed + i, 0.3, 0.72);
    v.blob(0, y + 12, 0, rad * 0.6, 7, rad * 0.6, seed + i + 40, 0.2, 0.9);
    y += 11 + f * 3;
  }
  v.blob(0, y + 4, 0, 5, 9, 5, seed + 60, 0.1, 0.9);
  v.emit(leafSet(PAL.pine, seed), 0.22, out, seed, 0.3, strand(PAL.pine));
  return out;
}

export function blossomTree(seed: number): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const s: TreeStyle = { bark: PAL.barkBlossom, leaf: PAL.blossom, bloom: '#fff3f8', rate: 0.1 };
  const h = r.int(28, 34);
  const [tx, tz] = trunkAndRoots(r, seed, s, h, 9, out);
  const tips = branches(r, seed, s, tx, h - 8, tz, 4, 20, out);
  const v = new Vox(7);
  for (const [bx, by, bz] of tips) v.blob(bx, by + 5, bz, r.range(13, 16), r.range(10, 13), r.range(13, 16), seed + 3, 0.45, 0.45);
  v.blob(tx, h + 14, tz, 17, 14, 17, seed + 5, 0.45, 0.5);
  v.emit(leafSet(s.leaf, seed, s.bloom, s.rate), 0.32, out, seed, 0.3, strand('#f08fb0'));
  return out;
}

export function sapling(seed: number, leaf: Tint = PAL.oak): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const h = r.int(12, 18);
  out.push(box(0, 0, 0, 3, h, 3, bark(PAL.barkOak, { seed }), { skip: 'd' }));
  const v = new Vox(5);
  v.blob(0, h + 3, 0, 9, 9, 9, seed, 0.45, 0.4);
  v.emit(leafSet(leaf, seed), 0.4, out, seed, 0.3);
  return out;
}

// ------------------------------------------------------------------ pond dressing

export function lilyPad(seed: number, flower = false): BoxSpec[] {
  const pr = R('#4fa84a');
  const pad: Painter = (t) => {
    const dx = t.bx - t.sx / 2, dz = t.bz - t.sz / 2, d = Math.hypot(dx, dz);
    if (d > 4.4 || (dx > 0 && Math.abs(dz) < 0.9 && d > 1)) return -1;
    return tone(pr, (d > 3.3 ? -1 : 0.4) + (Math.abs(Math.sin(Math.atan2(dz, dx) * 3)) < 0.25 ? -0.8 : 0) + (t.face === 2 ? 0.6 : -1));
  };
  const out: BoxSpec[] = [box(0, 0, 0, 9, 1, 9, pad, { cut: true })];
  if (flower) {
    const p = smooth('#fbe3ee'), c = smooth('#f6c531');
    out.push(box(0, 1, 0, 2, 2, 2, c));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      out.push({ ...box(Math.cos(a) * 2, 1, Math.sin(a) * 2, 2, 1, 3, p), rot: [-28, (-a * 180) / Math.PI + 90, 0], pivot: [Math.cos(a) * 1, 1, Math.sin(a) * 1] });
    }
  }
  return out;
}

export function reeds(seed: number): BoxSpec[] {
  const r = rng(seed), out: BoxSpec[] = [];
  const st = blade('#6aa34a', -1.4, 0.8), head = solid('#6b4428', { noise: 0.6, scale: 1.3 });
  for (let i = 0; i < 5; i++) {
    const x = r.range(-4, 4), z = r.range(-3, 3), h = r.int(12, 20), tilt = r.range(-8, 8);
    const stem: BoxSpec[] = [box(x, 0, z, 1, h, 1, st, { sway: 0.8, skip: 'd' })];
    if (r.chance(0.6)) stem.push(box(x, h - 5, z, 2, 4, 2, head, { sway: 0.8 }), box(x, h - 1, z, 1, 2, 1, st, { sway: 0.8 }));
    else stem.push(lean(box(x + 0.8, h * 0.4, z, 1, h * 0.5, 2, st, { sway: 0.8 }), 0, 0, -22));
    out.push(...turn(stem, [tilt, 0, tilt * 0.6], [x, 0, z]));
  }
  return out;
}
