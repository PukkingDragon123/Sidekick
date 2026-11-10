// The animals: chibi, big-headed, blocky characters on one shared rig. Each species supplies its own
// head shape, ears, snout and tail; fur colours, markings, eyes and build come from the player's Look.
import * as THREE from 'three';
import type { EyeStyle, Look, Outfit, SpeciesId } from '@shared/types.ts';
import { box, buildRig, PX, type BoneSpec, type BoxSpec, type Painter, type Rig, type Texel, type Vec3 } from '../gfx/box.ts';
import { adjust, fromLch, hex, ramp, toLch, tone, type Ramp } from '../gfx/color.ts';
import { lvl } from '../gfx/mats.ts';
import { fbm, hash, vnoise } from '../gfx/noise.ts';
import { dressUp } from './outfits.ts';

// ------------------------------------------------------------------ expression frames

export const EYE_FRAMES = ['open', 'half', 'closed', 'happy', 'wide', 'angry', 'sad', 'heart', 'star', 'dizzy'] as const;
export type EyeFrame = (typeof EYE_FRAMES)[number];
export const MOUTH_FRAMES = ['smile', 'neutral', 'open1', 'open2', 'grin', 'o', 'frown', 'cat', 'chew1', 'chew2', 'blep'] as const;
export type MouthFrame = (typeof MOUTH_FRAMES)[number];

// Glossy chibi eyes: dark upper half with a catch-light, iris colour pooling at the bottom.
// K = dark rim, J = deep iris, I/i = iris, P = pupil black, W = catch-light, S = white of the eye
const OPEN: Record<EyeStyle, [string[], string[]]> = {
  round: [['.KKK.', 'KWWKK', 'KWJJK', 'KJIIK', 'KIiiK', '.KKK.'], ['.KKK.', 'KWWKK', 'KWJJK', 'KJIIK', 'KIiiK', '.KKK.']],
  sparkle: [['.KKK.', 'KWWJK', 'KWJJK', 'KJIIK', 'KIiWK', '.KKK.'], ['.KKK.', 'KWWJK', 'KWJJK', 'KJIIK', 'KIiWK', '.KKK.']],
  sleepy: [['.....', '.....', 'KKKKK', 'KWJIK', '.KKK.', '.....'], ['.....', '.....', 'KKKKK', 'KWJIK', '.KKK.', '.....']],
  sharp: [['KK...', 'KKKK.', 'KWJJK', 'KJIIK', '.KKK.', '.....'], ['...KK', '.KKKK', 'KWJJK', 'KJIIK', '.KKK.', '.....']],
  dot: [['.....', '.PPP.', '.WPP.', '.PPP.', '.....', '.....'], ['.....', '.PPP.', '.WPP.', '.PPP.', '.....', '.....']],
};
const mirrorRows = (rows: string[]) => rows.map((r) => r.split('').reverse().join(''));
const sym = (rows: string[]): [string[], string[]] => [rows, rows];
const asym = (rows: string[]): [string[], string[]] => [rows, mirrorRows(rows)];
const EYE_ART: Record<Exclude<EyeFrame, 'open'>, [string[], string[]]> = {
  half: sym(['.....', '.....', 'KKKKK', 'KJIIK', '.KKK.', '.....']),
  closed: sym(['.....', '.....', '.....', 'KKKKK', '.....', '.....']),
  happy: sym(['.....', '.....', '.KKK.', 'K...K', '.....', '.....']),
  wide: sym(['.KKK.', 'KSSSK', 'KSPSK', 'KSSSK', '.KKK.', '.....']),
  angry: asym(['.....', 'K....', 'KKK..', 'KWJKK', 'KJIIK', '.KKK.']),
  sad: asym(['.....', '....K', '..KKK', 'KKJWK', 'KIIJK', '.KKK.']),
  heart: sym(['.....', '.H.H.', 'HHHHH', 'HHHHH', '.HHH.', '..H..']),
  star: sym(['..Y..', '.YYY.', 'YYWYY', '.YYY.', '..Y..', '.....']),
  dizzy: sym(['.....', 'K...K', '.K.K.', '..K..', '.K.K.', 'K...K']),
};
const MOUTH_ART: Record<MouthFrame, string[]> = {
  smile: ['.....', 'K...K', '.KKK.'], neutral: ['.....', '.KKK.', '.....'], open1: ['.....', '.KKK.', '.RTR.'],
  open2: ['KKKKK', 'KRRRK', '.TTT.'], grin: ['KKKKK', 'KWWWK', '.KKK.'], o: ['..K..', '.KRK.', '..K..'],
  frown: ['.....', '.KKK.', 'K...K'], cat: ['.....', '.K.K.', '..K..'], chew1: ['.....', '.KKK.', '..K..'],
  chew2: ['.....', 'KKKKK', '.....'], blep: ['.....', 'K...K', '.KTK.'],
};

function artTexture(frames: string[][], pal: Record<string, number>, widen = 0): THREE.DataTexture {
  const rows = frames[0].length, w0 = frames[0][0].length, w = w0 + widen, n = frames.length;
  const data = new Uint8Array(w * n * rows * 4);
  frames.forEach((f, fi) => f.forEach((row0, ri) => {
    const mid = Math.floor(w0 / 2);
    const row = widen ? row0.slice(0, mid) + row0[mid].repeat(widen + 1) + row0.slice(mid + 1) : row0;
    for (let x = 0; x < w; x++) {
      const c = pal[row[x]];
      if (c === undefined) continue;
      const k = ((rows - 1 - ri) * w * n + fi * w + x) * 4;
      data[k] = (c >> 16) & 255; data[k + 1] = (c >> 8) & 255; data[k + 2] = c & 255; data[k + 3] = 255;
    }
  }));
  const tex = new THREE.DataTexture(data, w * n, rows, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.repeat.set(1 / n, 1);
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------------ species geometry

interface Geo {
  hw: number; hh: number; hd: number; hz: number;
  bw: number; bh: number; bd: number;
  legH: number; limb: number;
  eyeDx: number; eyeY: number;
  /** mouth plane: centre x is 0; y above the head bottom; z offset from the head front; extra width */
  mouthY: number; mouthZ: number; mouthWide: number; mouth: MouthFrame | null;
  nose: string;
  inner: string;
}

const GEO: Record<SpeciesId, Partial<Geo>> = {
  fox: { mouthZ: 4, mouthY: 0 },
  cat: { hd: 11, mouth: 'cat', nose: '#f08fa0' },
  bunny: { hw: 13, hd: 11, mouth: 'cat', nose: '#f08fa0', bw: 9 },
  raccoon: { hd: 11, mouthZ: 3, mouthY: 0 },
  frog: { hw: 16, hh: 10, bw: 10, bh: 7, bd: 8, legH: 3, eyeDx: 4.5, eyeY: 7, mouthY: 1, mouthWide: 4, inner: '#e8f5b8' },
  owl: { hd: 11, bw: 10, bd: 7, legH: 3, mouth: null, eyeY: 5 },
  bear: { bw: 11, bh: 9, bd: 8, limb: 4, mouthZ: 2, mouthY: 0 },
  redpanda: { hw: 15, hd: 11, mouthZ: 2, mouthY: 0, mouth: 'cat' },
  capybara: { hw: 12, hh: 10, hd: 14, hz: 2, bw: 12, bh: 9, bd: 9, legH: 3, limb: 4, eyeDx: 4, eyeY: 4, mouth: 'neutral', mouthY: 1, nose: '#4a342a' },
  axolotl: { hw: 15, hh: 10, bw: 8, eyeDx: 4.5, eyeY: 3, mouthY: 0, mouthWide: 4, inner: '#ffd0e0' },
};

export function geoFor(look: Look): Geo & { neck: number; hf: number } {
  const g: Geo = {
    hw: 14, hh: 12, hd: 12, hz: 0.5, bw: 9, bh: 8, bd: 6, legH: 4, limb: 3, eyeDx: 3.5, eyeY: 4,
    mouthY: 0, mouthZ: 0, mouthWide: 0, mouth: 'smile', nose: '#2b2026', inner: '#f5a5b5', ...GEO[look.species],
  };
  const grow = Math.round(Math.max(-1, Math.min(1, look.build)) * 1.4);
  g.bw += grow; g.bd += Math.max(0, grow);
  return { ...g, neck: g.legH + g.bh - 1, hf: g.hz + g.hd / 2 };
}

// ------------------------------------------------------------------ fur

const FUR = { noise: 0.5, scale: 3.2, speck: 0.45, jitter: 0.3 };

function furPainter(L: Look, g: ReturnType<typeof geoFor>): Painter {
  const base = ramp(hex(L.fur)), two = ramp(hex(L.fur2)), acc = ramp(hex(L.accent));
  const inner = ramp(hex(g.inner)), nose = ramp(hex(g.nose), { step: 0.08 });
  const beak = ramp(0xf2a531), blush = ramp(0xf58aa0);
  const sp = L.species, pat = L.pattern;
  const seed = hash(hex(L.fur), hex(L.accent), 0, 3) * 1000;
  const eyeLo = g.neck + g.eyeY, eyeHi = eyeLo + 6;

  /** 0 base, 1 secondary, 2 accent */
  const mark = (t: Texel): number => {
    const tag = t.tag, ax = Math.abs(t.x);
    const limb = tag === 'arm' || tag === 'leg';
    const hand = limb && t.by < 2.2 || tag === 'foot';
    if (tag === 'snout' || tag === 'chest') return 1;
    if (tag === 'cheek') return sp !== 'cat' && t.z > g.hf - 5.2 && t.y < g.neck + 4.6 ? 1 : 0;
    if (tag === 'tailTip') return pat === 'socks' ? (sp === 'fox' ? 1 : 2) : sp === 'bunny' ? 1 : 0;
    if (tag === 'earTip') return pat === 'socks' || sp === 'redpanda' ? 2 : 0;
    if (tag === 'gill') return t.bx < 1 || t.bx > t.sx - 1 ? 1 : 2;
    if (tag === 'ring') return Math.floor((t.z - 40) / 2.5) % 2 ? 2 : sp === 'redpanda' ? 1 : 0;
    if (tag === 'fin') return t.by > t.sy - 1.2 ? 2 : 0;
    if (tag === 'wing') return Math.floor(t.by / 2) % 2 === 0 && t.by < t.sy - 2 ? 2 : 0;
    if (sp === 'redpanda' && (limb || tag === 'foot')) return 2;
    if (hand && pat === 'socks') return 2;
    if (tag === 'body') {
      if (t.face === 3) return 1;
      if (t.face === 4 && ax < t.sx / 2 - 1.2 && t.by < t.sy - 1.5 && !(t.by > t.sy - 3.5 && ax > t.sx / 2 - 2.6)) {
        if (sp === 'owl' && Math.floor(t.by) % 3 === 1 && (Math.floor(t.bx) + (Math.floor(t.by / 3) & 1)) % 3 === 0) return 2;
        return sp === 'redpanda' ? 2 : 1;
      }
    }
    if (tag === 'head' && t.face === 4) {
      const inEyes = t.y >= eyeLo - 1 && t.y < eyeHi + 0.5;
      if (sp === 'owl' && Math.hypot(ax - g.eyeDx, t.y - (eyeLo + 3)) < 4.2) return 1;
      if ((sp === 'cat' || sp === 'bunny') && ax < 3.6 && t.y < g.neck + 4) return 1;
      if (sp === 'frog' || sp === 'axolotl') { if (t.y < g.neck + 2.5) return 1; }
      if (sp === 'redpanda') {
        if (ax > 3.5 && t.y < g.neck + 5) return 1;
        if (ax > 2 && ax < 4.5 && t.y >= eyeHi && t.y < eyeHi + 1.2) return 1;
        if (ax > 4.8 && ax < 6 && t.y < eyeLo + 1 && t.y > g.neck + 1) return 2;
      }
      if ((sp === 'fox' || sp === 'raccoon') && ax > 4.4 && t.y < g.neck + 3.6) return 1;
      if (pat === 'mask' && sp !== 'redpanda' && inEyes && ax > 0.9 && ax < g.hw / 2 - 0.2) return 2;
      if (pat === 'stripes' && t.y > eyeHi + 0.4 && (Math.floor(t.x + 100.5) % 3 === 0) && ax < 4) return 2;
    }
    if (tag === 'head' && pat === 'mask' && sp !== 'redpanda' && t.face < 2 && t.y >= eyeLo - 1 && t.y < eyeHi + 0.5 && t.z > g.hz) return 2;
    const top = t.face === 2 || t.face === 5 || (t.face < 2 && (tag !== 'head' || t.y > eyeHi)) || limb || tag === 'tail';
    if (pat === 'stripes' && top) {
      const along = tag === 'arm' || tag === 'leg' ? t.y : tag === 'tail' ? t.bz + t.by : t.z;
      if (Math.floor(along / 1.5 + hash(Math.floor(t.x / 3), 0, 0, seed) * 0.8 + 100) % 3 === 0 && !hand) return 2;
    }
    if (pat === 'spots' && top && tag !== 'ear') {
      if (vnoise(t.x / 2.6, t.y / 2.6, t.z / 2.6, seed) > 0.66) return sp === 'axolotl' || sp === 'frog' ? 2 : 2;
    }
    if (pat === 'patch') {
      if (tag === 'head' && Math.hypot(t.x - g.eyeDx - 0.5, t.y - eyeLo - 3, (t.z - g.hf) * 0.8) < 4.6) return 2;
      if ((tag === 'ear' || tag === 'earTip') && t.x > 0) return 2;
      if (tag === 'body' && t.face !== 4 && fbm(t.x / 4, t.y / 4, t.z / 4, seed + 3) > 0.56) return 2;
    }
    return 0;
  };

  return (t) => {
    const tag = t.tag;
    if (tag === 'nose') return tone(nose, lvl(t, { noise: 0, speck: 0, rim: 0.4 }) + (t.face === 2 || (t.face === 4 && t.v === t.h - 1 && t.u === 0) ? 1.6 : 0));
    if (tag === 'beak' || tag === 'talon') return tone(beak, lvl(t, { noise: 0.2, speck: 0 }));
    let L2 = lvl(t, FUR);
    // ragged fur ends along the bottom of each part
    if (t.face !== 2 && t.face !== 3 && t.v === 0 && t.w > 2 && (t.u + Math.floor(t.z)) % 2) L2 -= 0.55;
    if ((tag === 'ear' || tag === 'earTip') && t.face === 4 && t.u > 0 && t.u < t.w - 1 && (tag === 'ear' ? t.v > 0 || t.sy > 6 : t.v < t.h - 1) && t.w >= 3) {
      return tone(sp === 'redpanda' ? ramp(0x3a2420) : inner, L2 * 0.5 - 0.3);
    }
    if (tag === 'foot' && t.face === 3) return tone(inner, -0.5);
    if (L.blush && tag === 'head' && t.face === 4 && t.y >= eyeLo - 1.6 && t.y < eyeLo - 0.4 && Math.abs(Math.abs(t.x) - g.eyeDx - 1.5) < 1.1) return tone(blush, 0.3);
    if (sp === 'frog' && tag === 'head' && t.face === 4 && Math.abs(Math.abs(t.x) - 1.5) < 0.6 && Math.abs(t.y - (g.neck + 5.5)) < 0.6) return tone(base, -2.5);
    const m = mark(t);
    // whisker dots on the muzzle
    if (tag === 'snout' && t.face === 4 && t.v === 1 && (t.u === 0 || t.u === t.w - 1)) return tone(two, -2.2);
    return tone(m === 1 ? two : m === 2 ? acc : base, L2);
  };
}

// ------------------------------------------------------------------ building

export interface AnimalParts {
  bones: Record<string, BoneSpec>;
  g: ReturnType<typeof geoFor>;
  add(bone: string, ...boxes: BoxSpec[]): void;
}

const T = (tag: string, o: Partial<BoxSpec> = {}): Partial<BoxSpec> => ({ tag, ...o });

function skeleton(g: ReturnType<typeof geoFor>): Record<string, BoneSpec> {
  const sh: number = g.neck - 0.5, ax = g.bw / 2 + g.limb / 2 - 0.5, lx = g.bw / 2 - g.limb / 2 - 0.5;
  const bone = (name: string, parent: string | undefined, pivot: Vec3): BoneSpec => ({ name, parent, pivot, boxes: [] });
  const list = [
    bone('root', undefined, [0, 0, 0]), bone('hips', 'root', [0, g.legH, 0]), bone('body', 'hips', [0, g.legH, 0]),
    bone('head', 'body', [0, g.neck + 0.5, 0]), bone('earL', 'head', [-g.hw / 2 + 2.5, g.neck + g.hh - 1, g.hz]), bone('earR', 'head', [g.hw / 2 - 2.5, g.neck + g.hh - 1, g.hz]),
    bone('armL', 'body', [-ax, sh, 0]), bone('armR', 'body', [ax, sh, 0]), bone('handR', 'armR', [ax, sh - 6, 1]),
    bone('legL', 'hips', [-lx, g.legH, 0]), bone('legR', 'hips', [lx, g.legH, 0]),
    bone('tail', 'body', [0, g.legH + 2, -g.bd / 2]), bone('tail2', 'tail', [0, g.legH + 2, -g.bd / 2 - 6]),
    bone('cape', 'body', [0, g.neck, -g.bd / 2 - 1]),
  ];
  return Object.fromEntries(list.map((b) => [b.name, b]));
}

/** Rest-pose bone rotations in degrees (animations are layered on top of these). */
export type Rest = Record<string, Vec3>;

function species(P: AnimalParts, fur: Painter, look: Look, bare: boolean): Rest {
  const g = P.g, n = g.neck, s = look.species;
  const ears = look.ears === 'auto' ? s : look.ears, tail = look.tail === 'auto' ? s : look.tail;
  const rest: Rest = { armL: [0, 0, -7], armR: [0, 0, 7] };
  const both = (f: (side: number, bone: (b: string) => string) => void) => { f(-1, (b) => b + 'L'); f(1, (b) => b + 'R'); };
  const b = (x: number, y: number, z: number, w: number, h: number, d: number, tag: string, o: Partial<BoxSpec> = {}) => box(x, y, z, w, h, d, fur, T(tag, o));

  // torso and limbs
  P.add('body', b(0, g.legH, 0, g.bw, g.bh, g.bd, 'body'));
  const ax = g.bw / 2 + g.limb / 2 - 0.5, lx = g.bw / 2 - g.limb / 2 - 0.5;
  both((sd, bn) => {
    if (s === 'owl') P.add(bn('arm'), b(sd * (g.bw / 2 + 0.5), g.legH + 0.5, 0, 2, g.bh, 5, 'wing'));
    else P.add(bn('arm'), b(sd * ax, n - 6.5, 0, g.limb, 7, g.limb, 'arm'));
    P.add(bn('leg'), b(sd * lx, 0, 0, g.limb, g.legH + 0.5, g.limb, 'leg', { skip: 'u' }));
    const flat = s === 'frog' || s === 'owl';
    P.add(bn('leg'), b(sd * lx, 0, g.limb / 2 + (flat ? 1 : 0.5), g.limb + (flat ? 1 : 0), flat ? 1 : 2, flat ? 3 : 1, s === 'owl' ? 'talon' : 'foot'));
  });

  // head: a core block softened by a crown slab, a back bulge and cheeks so it never reads as a bare cube
  P.add('head', b(0, n, g.hz, g.hw, g.hh, g.hd, 'head'));
  P.add('head', b(0, n + g.hh, g.hz - 0.5, g.hw - 4, 1, g.hd - 4, 'head', { skip: 'd' }), b(0, n + 2, g.hz - g.hd / 2 - 0.5, g.hw - 4, g.hh - 4, 1, 'head', { skip: 's' }));
  const snout = (w: number, h: number, d: number, noseW: number, noseH = 2) => {
    P.add('head', b(0, n, g.hf + d / 2, w, h, d, 'snout', { skip: 'n' }), b(0, n + h - noseH, g.hf + d + 0.5, noseW, noseH, 1, 'nose', { skip: 'n' }));
  };
  /** Cheek ruff: a slab that rounds the jaw, plus one small spike of fur swept back. */
  const cheeks = (_w: number, h: number, tuft = true) => both((sd) => {
    const x = sd * (g.hw / 2), sk = sd > 0 ? 'w' : 'e';
    P.add('head', b(x + sd * 0.5, n, g.hz + 0.5, 1, h + 1, 9, 'cheek', { skip: sk }));
    if (tuft) P.add('head', { ...b(x + sd * 0.9, n + 1, g.hz + 1.5, 1, 3, 4, 'cheek'), rot: [0, sd * 20, sd * 12] }, { ...b(x + sd * 0.8, n + 2, g.hz - 2.5, 1, 2, 3, 'cheek'), rot: [0, sd * 30, sd * 20] });
  });
  const round = () => both((sd) => P.add('head', b(sd * (g.hw / 2 + 0.5), n + 1, g.hz + 0.5, 1, g.hh - 5, g.hd - 3, 'head', { skip: sd > 0 ? 'w' : 'e' })));
  /** A little crest of fur on the forehead. */
  const tuft = (tag = 'head') => P.add('head', { ...b(-1, n + g.hh, g.hf - 2.5, 2, 2, 2, tag), rot: [18, 0, 14] }, { ...b(1.2, n + g.hh, g.hf - 3, 2, 3, 2, tag), rot: [10, 0, -12] });
  const fluff = (y: number) => bare && P.add('body', b(0, y, g.bd / 2 + 0.5, 5, 3, 1, 'chest', { skip: 'n' }), b(0, y - 1.5, g.bd / 2 + 0.8, 3, 2, 1, 'chest', { skip: 'n' }));
  switch (s) {
    case 'fox': snout(6, 4, 4, 2); cheeks(2, 4); tuft(); fluff(g.legH + g.bh - 4); break;
    case 'cat': P.add('head', b(0, n + 3, g.hf + 0.5, 2, 1, 1, 'nose', { skip: 'n' })); cheeks(1, 4, false); round(); tuft(); break;
    case 'bunny': P.add('head', b(0, n + 3, g.hf + 0.5, 2, 1, 1, 'nose', { skip: 'n' })); round(); tuft(); fluff(g.legH + g.bh - 4); break;
    case 'raccoon': snout(6, 4, 3, 2); cheeks(2, 5); tuft(); break;
    case 'frog': both((sd) => P.add('head', b(sd * 4.5, n + g.hh - 2, g.hz + 3, 6, 5, 6, 'head', { skip: 'd' }), b(sd * 4.5, n + g.hh + 3, g.hz + 3, 4, 1, 4, 'head', { skip: 'd' }))); round(); break;
    case 'owl': P.add('head', b(0, n + 3, g.hf + 1, 2, 3, 2, 'beak', { skip: 'n' })); round(); fluff(g.legH + g.bh - 4); break;
    case 'bear': snout(6, 4, 2, 3); round(); break;
    case 'redpanda': snout(6, 3, 2, 2, 1); cheeks(2, 4); tuft(); fluff(g.legH + g.bh - 4); break;
    case 'capybara': P.add('head', b(0, n + 4, g.hf + 0.5, 4, 2, 1, 'nose', { skip: 'n' }), b(0, n, g.hf + 0.5, g.hw - 2, 4, 1, 'head', { skip: 'n' })); round(); break;
    case 'axolotl': round(); break;
  }
  // a soft belly bulge keeps the torso from being a plain box
  if (bare) P.add('body', b(0, g.legH + 0.5, g.bd / 2 + 0.5, g.bw - 2, g.bh - 4, 1, 'body', { skip: 'n' }));

  // ears
  const ey = n + g.hh - 1;
  both((sd, bn) => {
    const e = bn('ear'), x = sd * (g.hw / 2 - 2.5);
    switch (ears) {
      case 'fox': P.add(e, b(x, ey, g.hz, 5, 2, 2, 'ear'), b(x, ey + 2, g.hz, 4, 2, 2, 'ear'), b(x, ey + 4, g.hz, 3, 2, 2, 'earTip'), b(x, ey + 6, g.hz, 1, 1, 2, 'earTip')); rest[e] = [0, 0, -sd * 12]; break;
      case 'cat': P.add(e, b(x, ey, g.hz, 4, 3, 2, 'ear'), b(x, ey + 3, g.hz, 2, 2, 2, 'earTip')); rest[e] = [0, 0, -sd * 8]; break;
      case 'bunny': P.add(e, b(sd * 3, ey, g.hz - 0.5, 3, 11, 2, 'ear'), b(sd * 3, ey + 11, g.hz - 0.5, 2, 1, 2, 'earTip')); rest[e] = [-6, 0, -sd * 9]; break;
      case 'lop': P.add(e, b(sd * 3, ey, g.hz - 0.5, 3, 5, 2, 'ear'), { ...b(sd * 3, ey + 4, g.hz - 0.5, 3, 7, 2, 'ear'), rot: [0, 0, -sd * 140], pivot: [sd * 3, ey + 5, g.hz - 0.5] }); rest[e] = [0, 0, -sd * 14]; break;
      case 'raccoon': case 'bear': P.add(e, b(x - sd * 0.5, ey, g.hz - (s === 'bear' ? 1 : 0), 4, 3, 2, 'ear'), b(x - sd * 0.5, ey + 3, g.hz - (s === 'bear' ? 1 : 0), 2, 1, 2, 'earTip')); rest[e] = [0, 0, -sd * 6]; break;
      case 'redpanda': P.add(e, b(x - sd, ey, g.hz, 5, 4, 2, 'ear'), b(x - sd, ey + 4, g.hz, 3, 1, 2, 'earTip')); rest[e] = [0, 0, -sd * 14]; break;
      case 'owl': P.add(e, b(x - sd, ey - 0.5, g.hz, 3, 3, 2, 'earTip')); rest[e] = [0, 0, -sd * 22]; break;
      case 'capybara': P.add(e, b(sd * 4.5, ey - 0.2, g.hz - 3, 2, 2, 2, 'ear')); break;
      case 'axolotl': {
        const gx = sd * (g.hw / 2 + 1.5);
        P.add(e, { ...b(gx, n + 7, g.hz - 1, 5, 2, 2, 'gill'), rot: [0, 0, sd * 32], pivot: [sd * (g.hw / 2 - 1), n + 8, g.hz - 1] },
          b(gx + sd, n + 4, g.hz - 1, 6, 2, 2, 'gill'),
          { ...b(gx, n + 1, g.hz - 1, 5, 2, 2, 'gill'), rot: [0, 0, -sd * 32], pivot: [sd * (g.hw / 2 - 1), n + 2, g.hz - 1] });
        break;
      }
    }
  });

  // tail
  const tz = -g.bd / 2, ty = g.legH + 1;
  switch (tail) {
    case 'fox': P.add('tail', b(0, ty, tz - 2.5, 4, 4, 5, 'tail')); P.add('tail2', b(0, ty - 1, tz - 8.5, 6, 6, 7, 'tail'), b(0, ty, tz - 13, 4, 4, 3, 'tailTip')); rest.tail = [38, 0, 0]; rest.tail2 = [18, 0, 0]; break;
    case 'cat': P.add('tail', b(0, ty, tz - 3, 2, 2, 6, 'tail')); P.add('tail2', b(0, ty, tz - 9, 2, 2, 6, 'tail'), b(0, ty, tz - 13, 2, 2, 2, 'tailTip')); rest.tail = [50, 0, 0]; rest.tail2 = [42, 0, 0]; break;
    case 'bunny': P.add('tail', b(0, ty, tz - 1.5, 4, 4, 3, 'tailTip')); break;
    case 'raccoon': P.add('tail', b(0, ty - 0.5, tz - 3.5, 5, 5, 7, 'ring')); P.add('tail2', b(0, ty - 0.5, tz - 9.5, 5, 5, 6, 'ring'), b(0, ty, tz - 13.5, 4, 4, 2, 'ring')); rest.tail = [34, 0, 0]; rest.tail2 = [22, 0, 0]; break;
    case 'redpanda': P.add('tail', b(0, ty - 1, tz - 4, 6, 6, 8, 'ring')); P.add('tail2', b(0, ty - 1, tz - 11, 6, 6, 7, 'ring'), b(0, ty - 0.5, tz - 15.5, 5, 5, 2, 'ring')); rest.tail = [24, 0, 0]; rest.tail2 = [16, 0, 0]; break;
    case 'bear': P.add('tail', b(0, ty, tz - 1, 3, 3, 2, 'tail')); break;
    case 'owl': P.add('tail', b(0, ty - 1, tz - 2, 6, 2, 4, 'wing')); rest.tail = [-18, 0, 0]; break;
    case 'axolotl': P.add('tail', b(0, ty - 1, tz - 3, 2, 6, 6, 'fin')); P.add('tail2', b(0, ty - 0.5, tz - 8, 2, 5, 5, 'fin'), b(0, ty + 0.5, tz - 11.5, 2, 3, 2, 'fin')); rest.tail = [8, 0, 0]; break;
  }
  return rest;
}

export interface Animal {
  rig: Rig;
  look: Look;
  rest: Rest;
  geo: ReturnType<typeof geoFor>;
  setEyes(f: EyeFrame, side?: 'L' | 'R'): void;
  setMouth(f: MouthFrame): void;
  defaultMouth: MouthFrame;
  dispose(): void;
}

export function buildAnimal(look: Look, outfit: Outfit = {}): Animal {
  const g = geoFor(look);
  const bones = skeleton(g);
  const P: AnimalParts = { bones, g, add: (bone, ...boxes) => { bones[bone].boxes.push(...boxes); } };
  const fur = furPainter(look, g);
  const rest = species(P, fur, look, !outfit.body);
  dressUp(P, outfit, look);
  const rig = buildRig(Object.values(bones));
  for (const [name, r] of Object.entries(rest)) rig.bones[name]?.rotation.set((r[0] * Math.PI) / 180, (r[1] * Math.PI) / 180, (r[2] * Math.PI) / 180);

  // face overlays: tiny planes a hair in front of the head so frames can swap without rebuilding
  const iris = hex(look.eye);
  const dark = look.species === 'bear' || look.species === 'capybara' ? 0x241a18 : adjust(look.accent, -0.5, 0.4) & 0xffffff;
  const [, iC, iH] = toLch(iris);
  const eyePal = { K: fromLch(0.2, Math.min(0.05, iC), iH), J: fromLch(0.38, Math.min(0.13, iC), iH), P: 0x17131c, I: iris, i: adjust(iris, 0.13, 0.85), W: 0xffffff, S: 0xfdfdfd, H: 0xf0507a, Y: 0xffd84a };
  const framesL = EYE_FRAMES.map((f) => (f === 'open' ? OPEN[look.eyeStyle][0] : EYE_ART[f][0]));
  const framesR = EYE_FRAMES.map((f) => (f === 'open' ? OPEN[look.eyeStyle][1] : EYE_ART[f][1]));
  const head = rig.bones.head, hp = bones.head.pivot;
  const mk = (tex: THREE.DataTexture, w: number, h: number, x: number, y: number, z: number) => {
    const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w * PX, h * PX), mat);
    m.position.set((x - hp[0]) * PX, (y - hp[1]) * PX, (z - hp[2]) * PX);
    head.add(m);
    return m;
  };
  const ey = g.neck + g.eyeY + 3;
  const eyeL = mk(artTexture(framesL, eyePal), 5, 6, -g.eyeDx, ey, g.hf + 0.06);
  const eyeR = mk(artTexture(framesR, eyePal), 5, 6, g.eyeDx, ey, g.hf + 0.06);
  let mouthMesh: THREE.Mesh | null = null;
  if (g.mouth) {
    const mouthPal = { K: toDark(dark), R: 0x7a2c3a, T: 0xf07a8c, W: 0xffffff };
    mouthMesh = mk(artTexture(MOUTH_FRAMES.map((f) => MOUTH_ART[f]), mouthPal, g.mouthWide), 5 + g.mouthWide, 3, 0, g.neck + g.mouthY + 1.5, g.hf + g.mouthZ + 0.06);
  }
  const setFrame = (m: THREE.Mesh, i: number, n: number) => { ((m.material as THREE.MeshLambertMaterial).map as THREE.Texture).offset.x = i / n; };
  const animal: Animal = {
    rig, look, rest, geo: g, defaultMouth: g.mouth ?? 'smile',
    setEyes(f, side) {
      const i = EYE_FRAMES.indexOf(f);
      if (side !== 'R') setFrame(eyeL, i, EYE_FRAMES.length);
      if (side !== 'L') setFrame(eyeR, i, EYE_FRAMES.length);
    },
    setMouth(f) { if (mouthMesh) setFrame(mouthMesh, MOUTH_FRAMES.indexOf(f), MOUTH_FRAMES.length); },
    dispose() {
      rig.dispose();
      for (const m of [eyeL, eyeR, mouthMesh]) if (m) { m.geometry.dispose(); ((m.material as THREE.MeshLambertMaterial).map as THREE.Texture).dispose(); (m.material as THREE.Material).dispose(); }
    },
  };
  animal.setMouth(animal.defaultMouth);
  return animal;
}

function toDark(c: number): number {
  const r = ramp(c);
  return tone(r as Ramp, -1.5);
}
