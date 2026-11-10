// The animals: chibi, big-headed, blocky characters on one shared rig, textured at twice the world's
// texel density so fur, faces and outfits carry fine detail. Each species supplies its own head
// shape, ears, snout, fur ruffs and tail; colours, markings, eyes and build come from the Look.
import * as THREE from 'three';
import type { EyeStyle, Look, Outfit, SpeciesId } from '@shared/types.ts';
import { box, buildRig, PX, type BoneSpec, type BoxSpec, type Painter, type Rig, type Texel, type Vec3 } from '../gfx/box.ts';
import { adjust, fromLch, hex, ramp, toLch, tone } from '../gfx/color.ts';
import { lvl } from '../gfx/mats.ts';
import { fbm, hash, vnoise } from '../gfx/noise.ts';
import { dressUp } from './outfits.ts';

/** Texels per model pixel for characters. */
export const DENS = 2;
/** Eye size relative to the 5 x 6 px art: kept modest so the face reads cute, not bug-eyed. */
export const EYE = 0.74;
const EW = 2.5 * EYE, EH = 3 * EYE;

// ------------------------------------------------------------------ expression frames (10 x 12 eyes, 10 x 6 mouths)

export const EYE_FRAMES = ['open', 'half', 'closed', 'happy', 'wide', 'angry', 'sad', 'heart', 'star', 'dizzy'] as const;
export type EyeFrame = (typeof EYE_FRAMES)[number];
export const MOUTH_FRAMES = ['smile', 'neutral', 'open1', 'open2', 'grin', 'o', 'frown', 'cat', 'chew1', 'chew2', 'blep'] as const;
export type MouthFrame = (typeof MOUTH_FRAMES)[number];

// K lash/rim, J deep iris, I iris, i light iris, P pupil, W catch-light, S white of the eye, H heart, Y star
const OPEN: Record<EyeStyle, string[]> = {
  round: ['..KKKKKK..', '.KKKKKKKK.', 'KKJJJJJJKK', 'KJWWPPPJJK', 'KJWWPPPPJK', 'KJJPPPPPIK', 'KIIPPPPPIK', 'KIIIPPPIIK', 'KIiiIIIiiK', 'KKiiiiiWiK', '.KKiiiiKK.', '..KKKKKK..'],
  sparkle: ['..KKKKKK..', '.KKKKKKKK.', 'KKWWWJJJKK', 'KJWWWPPJJK', 'KJWWPPPPJK', 'KJJPPPPPIK', 'KIIPPPPPIK', 'KIIIPPPWWK', 'KIiiIIIWWK', 'KKiiiiiiiK', '.KKiiiiKK.', '..KKKKKK..'],
  sleepy: ['..........', '..........', '..........', '..........', 'KKKKKKKKKK', 'KKKKKKKKKK', 'KJWWPPPJJK', 'KIWPPPPIIK', 'KIIIPPIIIK', '.KiiiiiiK.', '..KKKKKK..', '..........'],
  sharp: ['KK........', 'KKKK......', '.KKKKKKKK.', 'KKKKKKKKKK', 'KJWWJPPJJK', 'KJWWPPPPJK', 'KJJPPPPPIK', 'KIIPPPPIIK', '.KIIPPIIK.', '.KiiiiiiK.', '..KKKKKK..', '..........'],
  dot: ['..........', '..........', '..........', '...PPPP...', '..PWWPPP..', '..PWPPPP..', '..PPPPPP..', '..PPPPPP..', '...PPPP...', '..........', '..........', '..........'],
};
const EYE_ART: Record<Exclude<EyeFrame, 'open'>, { rows: string[]; mirror?: boolean }> = {
  half: { rows: ['..........', '..........', '..........', '..........', '..........', 'KKKKKKKKKK', 'KJJPPPPJJK', 'KIIPPPPIIK', 'KIIIPPIIIK', '.KiiiiiiK.', '..KKKKKK..', '..........'] },
  closed: { rows: ['..........', '..........', '..........', '..........', '..........', '..........', 'K........K', 'KK......KK', '.KKKKKKKK.', '..KKKKKK..', '..........', '..........'] },
  happy: { rows: ['..........', '..........', '..........', '..........', '..KKKKKK..', '.KKKKKKKK.', 'KKK....KKK', 'KK......KK', 'K........K', '..........', '..........', '..........'] },
  wide: { rows: ['..KKKKKK..', '.KSSSSSSK.', 'KSSSSSSSSK', 'KSSSSSSSSK', 'KSSSPPSSSK', 'KSSPPPPSSK', 'KSSPPPPSSK', 'KSSSPPSSSK', 'KSSSSSSSSK', 'KSSSSSSSSK', '.KSSSSSSK.', '..KKKKKK..'] },
  angry: { mirror: true, rows: ['..........', 'KK........', 'KKKK......', 'KKKKKK....', 'KJKKKKKK..', 'KJWWKKKKKK', 'KJWWPPPPJK', 'KIJPPPPPIK', 'KIIPPPPIIK', '.KIIPPIIK.', '..KKKKKK..', '..........'] },
  sad: { mirror: true, rows: ['..........', '........KK', '......KKKK', '....KKKKKK', '..KKKKKKJK', 'KKKKKKWWJK', 'KJPPPPWWJK', 'KIPPPPPJIK', 'KIIPPPPIIK', '.KIIPPIIK.', '..KKKKKK..', '..........'] },
  heart: { rows: ['..........', '.HHH..HHH.', 'HHHHHHHHHH', 'HHWWHHHHHH', 'HHWHHHHHHH', 'HHHHHHHHHH', '.HHHHHHHH.', '..HHHHHH..', '...HHHH...', '....HH....', '..........', '..........'] },
  star: { rows: ['....YY....', '....YY....', '...YYYY...', 'YYYYYYYYYY', '.YYYWWYYY.', '..YYWWYY..', '..YYYYYY..', '.YYYYYYYY.', '.YYY..YYY.', 'YY......YY', '..........', '..........'] },
  dizzy: { rows: ['..........', '..KKKKKK..', '.K......K.', 'K..KKKK..K', 'K.K....K.K', 'K.K.KK.K.K', 'K.K.K..K.K', 'K.K.KKKK.K', 'K.K......K', '.K.KKKKKK.', '..K.......', '..........'] },
};
const MOUTH_ART: Record<MouthFrame, string[]> = {
  smile: ['..........', '..........', 'K........K', 'KK......KK', '.KKKKKKKK.', '..........'],
  neutral: ['..........', '..........', '..KKKKKK..', '..........', '..........', '..........'],
  open1: ['..........', '..KKKKKK..', '.KRRRRRRK.', '.KRTTTTRK.', '..KKKKKK..', '..........'],
  open2: ['.KKKKKKKK.', 'KRRRRRRRRK', 'KRRRRRRRRK', 'KRRTTTTRRK', '.KTTTTTTK.', '..KKKKKK..'],
  grin: ['KKKKKKKKKK', 'KWWWWWWWWK', 'KWWWWWWWWK', '.KRRRRRRK.', '..KKKKKK..', '..........'],
  o: ['..........', '...KKKK...', '..KRRRRK..', '..KRRRRK..', '...KKKK...', '..........'],
  frown: ['..........', '..........', '.KKKKKKKK.', 'KK......KK', 'K........K', '..........'],
  cat: ['..........', '..........', 'K...KK...K', 'K..K..K..K', '.KK....KK.', '..........'],
  chew1: ['..........', '..........', '.KKKKKKKK.', '..KKKKKK..', '..........', '..........'],
  chew2: ['..........', '..........', 'KKKKKKKKKK', '..........', '..........', '..........'],
  blep: ['..........', '..........', 'K........K', 'KK......KK', '.KKKTTKKK.', '....TT....'],
};
const flip = (rows: string[]) => rows.map((r) => r.split('').reverse().join(''));

function artTexture(frames: string[][], pal: Record<string, number>, widen = 0): THREE.DataTexture {
  const rows = frames[0].length, w0 = frames[0][0].length, w = w0 + widen, n = frames.length;
  const data = new Uint8Array(w * n * rows * 4);
  frames.forEach((f, fi) => f.forEach((row0, ri) => {
    const mid = Math.floor(w0 / 2);
    const row = widen ? row0.slice(0, mid) + row0[mid].repeat(widen) + row0.slice(mid) : row0;
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
  /** mouth plane: y above the head bottom, z offset from the head front, extra width in px */
  mouthY: number; mouthZ: number; mouthWide: number; mouth: MouthFrame | null;
  nose: string;
  inner: string;
}

const GEO: Record<SpeciesId, Partial<Geo>> = {
  fox: { mouthZ: 4 },
  cat: { hd: 11, mouth: 'cat', nose: '#f08fa0' },
  bunny: { hw: 13, hd: 11, mouth: 'cat', nose: '#f08fa0' },
  raccoon: { hd: 11, mouthZ: 3 },
  frog: { hw: 16, hh: 10, bw: 10, bh: 7, bd: 8, legH: 3, eyeDx: 4.5, eyeY: 7, mouthWide: 4, inner: '#e8f5b8' },
  owl: { hd: 11, bw: 10, bd: 7, legH: 3, mouth: null, eyeY: 5 },
  bear: { bw: 11, bh: 9, bd: 8, limb: 4, mouthZ: 2 },
  redpanda: { hw: 15, hd: 11, mouthZ: 2, mouth: 'cat' },
  capybara: { hw: 12, hh: 10, hd: 14, hz: 2, bw: 12, bh: 9, bd: 9, legH: 3, limb: 4, eyeDx: 4, eyeY: 4, mouth: 'neutral', nose: '#4a342a' },
  axolotl: { hw: 15, hh: 11, bw: 8, eyeDx: 4.5, eyeY: 4, mouthWide: 4, inner: '#ffd0e0' },
};

export function geoFor(look: Look): Geo & { neck: number; hf: number } {
  const g: Geo = {
    hw: 14, hh: 12, hd: 12, hz: 0.5, bw: 9, bh: 8, bd: 6, legH: 4, limb: 3, eyeDx: 3.5, eyeY: 4,
    mouthY: 1, mouthZ: 0, mouthWide: 0, mouth: 'smile', nose: '#2b2026', inner: '#f5a5b5', ...GEO[look.species],
  };
  const grow = Math.round(Math.max(-1, Math.min(1, look.build)) * 1.4);
  g.bw += grow; g.bd += Math.max(0, grow);
  return { ...g, neck: g.legH + g.bh - 1, hf: g.hz + g.hd / 2 };
}

// ------------------------------------------------------------------ fur

const FUR = { noise: 0.55, scale: 3.4, speck: 0.3, jitter: 0.3 };
const RUFFED = new Set<SpeciesId>(['fox', 'raccoon', 'redpanda']);

function furPainter(L: Look, g: ReturnType<typeof geoFor>): Painter {
  const base = ramp(hex(L.fur)), two = ramp(hex(L.fur2)), acc = ramp(hex(L.accent));
  const inner = ramp(hex(g.inner)), nose = ramp(hex(g.nose), { step: 0.08 });
  const beak = ramp(0xf2a531), blush = ramp(0xf58aa0), tooth = ramp(0xfffdf5), panda = ramp(0x3a2420);
  const sp = L.species, pat = L.pattern;
  const seed = hash(hex(L.fur), hex(L.accent), 0, 3) * 1000;
  const eyeLo = g.neck + g.eyeY, eyeHi = eyeLo + 6;

  /** 0 base, 1 secondary, 2 accent. `j` roughens region edges so markings end in fur, not ruler lines. */
  const mark = (t: Texel, j: number): number => {
    const tag = t.tag, ax = Math.abs(t.x) + j, y = t.y + j * 0.8;
    const limb = tag === 'arm' || tag === 'leg';
    const hand = tag === 'hand' || tag === 'foot' || tag === 'toe' || (limb && t.by + j < 2.2);
    if (tag === 'snout' || tag === 'chest' || tag === 'whisker') return 1;
    if (tag === 'ruff') return sp === 'cat' ? 0 : 1;
    if (tag === 'tailTip') return pat === 'socks' ? (sp === 'fox' ? 1 : 2) : sp === 'bunny' ? 1 : 0;
    if (tag === 'earTip') return pat === 'socks' || sp === 'redpanda' ? 2 : 0;
    if (tag === 'gill') return t.by > t.sy - 0.9 || t.bx < 0.6 || t.bx > t.sx - 0.6 ? 2 : 1;
    if (tag === 'ring') return Math.floor((t.z - 40 + j * 0.5) / 2.5) % 2 ? 2 : sp === 'redpanda' ? 1 : 0;
    if (tag === 'fin') return t.by + j * 0.4 > t.sy - 1.3 ? 2 : 0;
    if (tag === 'wing' || tag === 'feather') return Math.floor(t.by + (Math.floor(t.bz) % 2 ? 0.5 : 0)) % 2 === 0 && t.by < t.sy - 1 ? 2 : 0;
    if (sp === 'redpanda' && (limb || hand)) return 2;
    if (hand && pat === 'socks') return 2;
    if (tag === 'body') {
      if (t.face === 3) return 1;
      if (t.face === 4 && ax < g.bw / 2 - 1.4 && t.y < g.legH + g.bh - 1.6 && !(t.y > g.legH + g.bh - 3.6 && ax > g.bw / 2 - 2.8)) {
        if (sp === 'owl') { const row = Math.floor((t.y - g.legH) / 1.5), u = t.x + (row & 1 ? 1 : 0) + 20; if (Math.abs((u % 2) - 1) * 1.2 + ((t.y - g.legH) / 1.5 - row) < 0.75) return 2; }
        return sp === 'redpanda' ? 2 : 1;
      }
    }
    if (tag === 'head' && t.face === 4) {
      const inEyes = y >= eyeLo - 1 && y < eyeHi + 0.5;
      if (sp === 'owl' && Math.hypot(Math.abs(t.x) - g.eyeDx, t.y - (eyeLo + 3)) < 3.9 + j * 0.5) return 1;
      if ((sp === 'cat' || sp === 'bunny') && ax < 3.7 && y < g.neck + 4.6) return 1;
      if ((sp === 'frog' || sp === 'axolotl') && y < g.neck + 3.2) return 1;
      if (sp === 'capybara' && y < g.neck + 3.4 && ax < 4.6) return 1;
      if (sp === 'redpanda') {
        if (ax > 3.6 && y < g.neck + 5) return 1;
        if (ax > 2 && ax < 4.6 && y >= eyeHi + 0.2 && y < eyeHi + 1.5) return 1;
        if (ax > 5 && ax < 6.1 && y < eyeLo + 1 && y > g.neck + 1.4) return 2;
      }
      if (RUFFED.has(sp) && sp !== 'redpanda' && ax > 4.5 && y < g.neck + 4) return 1;
      if (pat === 'mask' && sp !== 'redpanda' && inEyes && ax > 1 && ax < g.hw / 2) return 2;
      if (pat === 'stripes' && y > eyeHi + 0.6 && Math.abs(((t.x + 100.5) % 3) - 1.5) > 1 && ax < 4.4) return 2;
    }
    if (tag === 'head' && pat === 'mask' && sp !== 'redpanda' && t.face < 2 && y >= eyeLo - 1 && y < eyeHi + 0.5 && t.z > g.hz + j) return 2;
    const top = t.face === 2 || t.face === 5 || (t.face < 2 && (tag !== 'head' || t.y > eyeHi)) || limb || tag === 'tail' || tag === 'tuft';
    if (pat === 'stripes' && top && !hand) {
      const along = limb ? t.y : tag === 'tail' ? t.bz + t.by : t.z;
      if (Math.abs(((along / 1.6 + hash(Math.floor(t.x / 3), 0, 0, seed) + j * 0.3 + 100) % 3) - 1.5) > 1.05) return 2;
    }
    if (pat === 'spots' && top && tag !== 'ear' && vnoise(t.x / 2.6, t.y / 2.6, t.z / 2.6, seed) > 0.66 + j * 0.03) return 2;
    if (pat === 'patch') {
      if (tag === 'head' && Math.hypot(t.x - g.eyeDx - 0.5, t.y - eyeLo - 3, (t.z - g.hf) * 0.8) < 4.7 + j) return 2;
      if ((tag === 'ear' || tag === 'earTip') && t.x > 0) return 2;
      if (tag === 'body' && t.face !== 4 && fbm(t.x / 4, t.y / 4, t.z / 4, seed + 3) > 0.56) return 2;
    }
    return 0;
  };

  return (t) => {
    const tag = t.tag;
    const hx = Math.floor(t.x * DENS), hy = Math.floor(t.y * DENS), hz = Math.floor(t.z * DENS);
    if (tag === 'nose') {
      const shine = t.face === 2 || (t.face === 4 && t.by > t.sy - 1 && t.bx < 1);
      return tone(nose, lvl(t, { noise: 0, speck: 0, rim: 0.5 }) + (shine ? 1.8 : 0));
    }
    if (tag === 'beak' || tag === 'talon') return tone(beak, lvl(t, { noise: 0.2, speck: 0 }) + (tag === 'beak' && t.by < 1 ? -1 : 0));
    if (tag === 'tooth') return tone(tooth, t.face === 4 && t.bx > t.sx / 2 - 0.26 && t.bx < t.sx / 2 + 0.26 ? -2 : 0);
    if (tag === 'claw') return tone(two, 1.2);
    // strands: short vertical dashes of lighter and darker fur
    let L2 = lvl(t, FUR) + (hash(hx, Math.floor(hy / 3), hz, 17) - 0.5) * 0.85;
    const side = t.face !== 2 && t.face !== 3;
    // ragged fur ends along the bottom edge of every part
    if (side && t.v === 0 && (t.u + hz) % 3 === 0) L2 -= 0.8;
    else if (side && t.v === 1 && (t.u + hz) % 3 === 1) L2 -= 0.4;
    const j = hash(hx, hy, hz, 91) - 0.5;

    if ((tag === 'ear' || tag === 'earTip') && t.face === 4 && t.bx > 0.9 && t.bx < t.sx - 0.9 && t.sx >= 3 && (tag === 'ear' ? t.by > 0.4 || t.sy > 6 : t.by < t.sy - 0.9)) {
      return tone(sp === 'redpanda' ? panda : inner, L2 * 0.4 - 0.2 - (t.bx < 1.5 ? 0.6 : 0) + (t.by / t.sy) * 0.8);
    }
    if ((tag === 'foot' && t.face === 3) || (tag === 'hand' && t.face === 3)) return tone(inner, -0.5);
    if (tag === 'toe' && t.face === 3) return tone(inner, 0.2);
    if (tag === 'head' && t.face === 4) {
      const ex = Math.abs(t.x) - g.eyeDx, ey = t.y - (eyeLo + 3);
      // rosy cheeks with a soft dithered edge, a couple of freckles, and a brow over each eye
      if (L.blush) {
        const d = Math.hypot((ex - 1.2) / 1.6, (ey + EH + 0.9) / 0.9);
        if (d < 0.8 || (d < 1.15 && (hx + hy) % 2 === 0)) return tone(blush, 0.2 + (d < 0.45 ? 0.5 : 0));
      }
      if (Math.abs(ex + 0.6) < 1.8 && ey > EH + 0.5 && ey < EH + 1.2 && sp !== 'owl' && sp !== 'frog' && sp !== 'axolotl' && sp !== 'capybara') L2 -= 1.5;
      // a soft dark socket around the eyes gives the face depth
      if (Math.abs(ex) < EW + 0.6 && Math.abs(ey) < EH + 0.6 && sp !== 'frog') L2 -= 0.55;
      if (sp === 'frog' && Math.abs(Math.abs(t.x) - 1.5) < 0.55 && Math.abs(t.y - (g.neck + 5.6)) < 0.55) return tone(base, -2.6);
      if (sp === 'capybara' && Math.abs(Math.abs(t.x) - 1.2) < 0.5 && Math.abs(t.y - (g.neck + 4.2)) < 0.5) return tone(nose, -1);
    }
    const m = mark(t, j);
    if (tag === 'snout' && t.face === 4 && Math.abs(t.by - 1.3) < 0.5 && (t.bx < 1.6 || t.bx > t.sx - 1.6) && (hx % 2 === 0)) return tone(two, -2.4);
    if (tag === 'whisker') return tone(two, 1.5);
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
  /** A block with every edge chamfered by `c`, so heads and bodies read as rounded forms. */
  const round = (bone: string, tag: string, x: number, y: number, z: number, w: number, h: number, d: number, c = 1) =>
    P.add(bone, b(x, y + c, z, w - 2 * c, h - 2 * c, d, tag), b(x, y + c, z, w, h - 2 * c, d - 2 * c, tag), b(x, y, z, w - 2 * c, h, d - 2 * c, tag));
  /** A tapering spike of fur: a thick base and a thin tip, swept by `rot`. */
  const spike = (bone: string, tag: string, x: number, y: number, z: number, len: number, th: number, rot: Vec3) => {
    const piv: Vec3 = [x, y + th / 2, z];
    P.add(bone, { ...b(x, y, z + len * 0.3, th, th, len * 0.6, tag), rot, pivot: piv }, { ...b(x, y + 0.5, z + len * 0.78, Math.max(1, th - 1), Math.max(1, th - 1), len * 0.5, tag), rot, pivot: piv });
  };

  // ---- torso and limbs
  round('body', 'body', 0, g.legH, 0, g.bw, g.bh, g.bd);
  if (bare) P.add('body', b(0, g.legH + 1, g.bd / 2 + 0.3, g.bw - 4, g.bh - 5, 0.8, 'body', { skip: 'n' }));
  const ax = g.bw / 2 + g.limb / 2 - 0.5, lx = g.bw / 2 - g.limb / 2 - 0.5;
  both((sd, bn) => {
    if (s === 'owl') {
      // layered wing: three overlapping rows of flight feathers
      const wx = sd * (g.bw / 2 + 0.6);
      P.add(bn('arm'), b(wx, g.legH + 3, 0, 2, g.bh - 2.5, 5, 'wing'), b(wx + sd * 0.5, g.legH + 1.4, -0.4, 1.4, 4, 4.4, 'feather'), b(wx + sd * 0.8, g.legH + 0.2, -1, 1, 3, 3.4, 'feather'));
    } else {
      P.add(bn('arm'), b(sd * ax, n - 5, 0, g.limb, 5.5, g.limb, 'arm', { skip: 'd' }), b(sd * ax, n - 6.6, 0.2, g.limb + 0.6, 2.2, g.limb + 0.6, 'hand'), b(sd * (ax - g.limb / 2 - 0.2), n - 6.2, 0.8, 1, 1.2, 1.2, 'hand'));
    }
    const flat = s === 'frog' || s === 'owl', fw = g.limb + (flat ? 1.4 : 0.6), fd = flat ? 3.4 : 1.6, tagF = s === 'owl' ? 'talon' : 'foot';
    P.add(bn('leg'), b(sd * lx, 0.6, 0, g.limb, g.legH, g.limb, 'leg', { skip: 'u' }), b(sd * lx, 0, 0.4, fw, flat ? 1 : 1.6, g.limb + 0.8, tagF), b(sd * lx, 0, g.limb / 2 + fd / 2, fw, flat ? 1 : 1.4, fd, tagF));
    // toes
    for (const k of [-1, 0, 1]) P.add(bn('leg'), b(sd * lx + k * (fw / 3), 0, g.limb / 2 + fd + 0.3, fw / 3 - 0.3, flat ? 0.9 : 1, 0.9, s === 'owl' ? 'talon' : 'toe'));
  });

  // ---- head
  round('head', 'head', 0, n, g.hz, g.hw, g.hh, g.hd);
  const snout = (w: number, h: number, d: number, noseW: number, noseH = 1.5) => {
    P.add('head', b(0, n + 1, g.hf + d / 2 - 0.5, w, h, d + 1, 'snout', { skip: 'n' }), b(0, n + 1.5, g.hf + d / 2, w - 1.4, h, d + 0.6, 'snout', { skip: 'n' }),
      b(0, n + 1 + h - noseH + 0.4, g.hf + d + 0.3, noseW, noseH, 1.2, 'nose', { skip: 'n' }), b(0, n + 1 + h - noseH + 0.8, g.hf + d + 0.2, noseW + 0.8, noseH - 0.8, 0.8, 'nose', { skip: 'n' }));
  };
  const button = (w = 2, h = 1.2) => P.add('head', b(0, n + 3.6, g.hf + 0.5, w, h, 1, 'nose', { skip: 'n' }), b(0, n + 3.2, g.hf + 0.3, w - 0.8, 0.8, 0.8, 'nose', { skip: 'n' }));
  /** Cheek ruff: a stepped wedge of fluff on each side of the jaw. */
  const ruff = (size = 1) => both((sd) => {
    const x = sd * (g.hw / 2 - 0.2);
    P.add('head', b(x + sd * 0.6, n + 0.8, g.hz + 1, 1.6, 4.6 * size, 5.4, 'ruff'));
    if (size >= 1) P.add('head', b(x + sd * 1.8, n + 1.1, g.hz + 0.8, 1.4, 3.2, 3.8, 'ruff'), b(x + sd * 2.8, n + 1.5, g.hz + 0.6, 1, 1.8, 2.2, 'ruff'));
  });
  /** A soft tuft of fur on the forehead. */
  const crest = (tag = 'tuft') => {
    P.add('head', { ...b(0.4, n + g.hh - 0.3, g.hf - 3.2, 3, 1.4, 2.6, tag), rot: [14, 0, -6] }, { ...b(0.9, n + g.hh + 0.8, g.hf - 3, 1.6, 1.2, 1.6, tag), rot: [20, 0, -14] });
  };
  const fluff = (y: number) => bare && P.add('body', b(0, y, g.bd / 2 + 0.5, 5.4, 2.6, 1, 'chest', { skip: 'n' }), b(0, y - 1.6, g.bd / 2 + 0.9, 4, 2.4, 1, 'chest', { skip: 'n' }), b(0, y - 3, g.bd / 2 + 1.1, 2, 2, 0.8, 'chest', { skip: 'n' }));
  const whiskers = (y: number, z: number, len = 3.4) => both((sd) => {
    for (const [dy, a] of [[0.5, 14], [-0.5, -10]] as const) P.add('head', { ...b(sd * (3 + len / 2), y + dy, z, len, 0.5, 0.5, 'whisker'), rot: [0, -sd * 24, sd * a], pivot: [sd * 3, y + dy, z] });
  });

  switch (s) {
    case 'fox': snout(6, 3, 4, 2); ruff(1.1); crest(); fluff(g.legH + g.bh - 4); break;
    case 'cat': button(); ruff(0.7); crest(); whiskers(n + 2.8, g.hf + 0.2, 3); break;
    case 'bunny':
      button(); crest(); fluff(g.legH + g.bh - 4); whiskers(n + 2.8, g.hf + 0.2, 2.4);
      P.add('head', b(0, n + 1.2, g.hf + 0.3, 2, 1.2, 0.6, 'tooth', { skip: 'n' }));
      both((sd) => P.add('head', b(sd * (g.hw / 2 - 0.2), n + 1.4, g.hz + 1.4, 1.4, 3.6, 4.6, 'ruff')));
      break;
    case 'raccoon': snout(6, 3, 3, 2); ruff(1); crest(); break;
    case 'frog':
      both((sd) => { round('head', 'head', sd * 4.5, n + g.hh - 2.4, g.hz + 3, 6, 5.4, 6, 1); });
      P.add('head', b(0, n + 0.4, g.hf - 0.4, g.hw - 5, 2, 1.2, 'head', { skip: 'n' }));
      both((sd) => P.add('body', b(sd * 2.4, g.legH + g.bh - 0.4, -1.5, 2, 1, 2, 'body', { skip: 'd' })));
      break;
    case 'owl':
      P.add('head', b(0, n + 3.4, g.hf + 0.8, 2.4, 2, 1.8, 'beak', { skip: 'n' }), b(0, n + 2.2, g.hf + 0.5, 1.4, 1.6, 1.2, 'beak', { skip: 'n' }));
      // stern feathered brows
      both((sd) => P.add('head', { ...b(sd * 3.6, n + 10.6, g.hf + 0.2, 5.6, 1.4, 1.4, 'tuft'), rot: [0, 0, -sd * 14] }));
      fluff(g.legH + g.bh - 3.6);
      break;
    case 'bear': snout(6.4, 3.4, 2, 3, 1.8); both((sd) => P.add('head', b(sd * (g.hw / 2 - 0.1), n + 1.4, g.hz + 1, 1.2, 4, 5, 'head'))); break;
    case 'redpanda': snout(6, 3, 2, 2, 1.2); ruff(1.1); crest(); fluff(g.legH + g.bh - 4); break;
    case 'capybara':
      P.add('head', b(0, n + 0.6, g.hf + 0.4, g.hw - 3, 5.4, 1.4, 'head', { skip: 'n' }), b(0, n + 4.2, g.hf + 1, 4.4, 2, 1, 'nose', { skip: 'n' }));
      both((sd) => P.add('head', b(sd * (g.hw / 2 - 0.1), n + 1.2, g.hz + 2, 1.2, 4, 6, 'head')));
      break;
    case 'axolotl':
      both((sd) => P.add('head', b(sd * (g.hw / 2 - 0.1), n + 1.4, g.hz + 1, 1.2, 4.4, 5, 'head')));
      P.add('head', b(0, n + g.hh - 0.2, g.hz - 1, 2, 1.4, 6, 'fin', { skip: 'd' }));
      break;
  }

  // ---- ears
  const ey = n + g.hh - 1;
  both((sd, bn) => {
    const e = bn('ear'), x = sd * (g.hw / 2 - 2.5);
    switch (ears) {
      case 'fox':
        P.add(e, b(x, ey, g.hz, 5, 2, 2.4, 'ear'), b(x, ey + 2, g.hz, 4.2, 1.6, 2.2, 'ear'), b(x, ey + 3.6, g.hz, 3.4, 1.6, 2, 'ear'), b(x, ey + 5.2, g.hz, 2.4, 1.4, 1.8, 'earTip'), b(x, ey + 6.6, g.hz, 1.2, 1.2, 1.4, 'earTip'),
          b(x - sd * 1, ey + 0.6, g.hz + 1.3, 1.4, 2.2, 0.8, 'ruff'));
        rest[e] = [0, 0, -sd * 12]; break;
      case 'cat':
        P.add(e, b(x, ey, g.hz, 4.4, 2, 2.2, 'ear'), b(x, ey + 2, g.hz, 3.4, 1.4, 2, 'ear'), b(x, ey + 3.4, g.hz, 2.2, 1.2, 1.8, 'earTip'), b(x, ey + 4.6, g.hz, 1, 1, 1.4, 'earTip'), b(x - sd * 0.8, ey + 0.6, g.hz + 1.2, 1.2, 1.8, 0.8, 'ruff'));
        rest[e] = [0, 0, -sd * 8]; break;
      case 'bunny':
        P.add(e, b(sd * 3, ey, g.hz - 0.5, 3, 4, 2, 'ear'), b(sd * 3, ey + 4, g.hz - 0.5, 3.4, 5, 2.2, 'ear'), b(sd * 3, ey + 9, g.hz - 0.5, 2.8, 2, 2, 'ear'), b(sd * 3, ey + 11, g.hz - 0.5, 1.8, 1.2, 1.6, 'earTip'));
        rest[e] = [-6, 0, -sd * 9]; break;
      case 'lop':
        P.add(e, b(sd * 3, ey, g.hz - 0.5, 3, 4.4, 2, 'ear'), { ...b(sd * 3, ey + 4, g.hz - 0.5, 3.2, 7.4, 2, 'ear'), rot: [0, 0, -sd * 142], pivot: [sd * 3, ey + 4.6, g.hz - 0.5] });
        rest[e] = [0, 0, -sd * 14]; break;
      case 'raccoon': case 'bear': {
        const z = g.hz - (s === 'bear' ? 1 : 0);
        P.add(e, b(x - sd * 0.5, ey, z, 4.4, 2.4, 2.2, 'ear'), b(x - sd * 0.5, ey + 2.4, z, 3.2, 1.2, 2, 'ear'), b(x - sd * 0.5, ey + 3.6, z, 1.8, 0.8, 1.6, 'earTip'));
        rest[e] = [0, 0, -sd * 6]; break;
      }
      case 'redpanda':
        P.add(e, b(x - sd, ey, g.hz, 5.4, 2.6, 2.2, 'ear'), b(x - sd, ey + 2.6, g.hz, 4.4, 1.6, 2, 'ear'), b(x - sd, ey + 4.2, g.hz, 2.8, 1, 1.6, 'earTip'), b(x - sd * 2, ey + 0.4, g.hz + 1.2, 1.4, 2.2, 0.8, 'ruff'));
        rest[e] = [0, 0, -sd * 14]; break;
      case 'owl':
        spike(e, 'earTip', x - sd, ey - 0.4, g.hz, 4, 2.4, [-74, sd * 10, 0]);
        rest[e] = [0, 0, -sd * 22]; break;
      case 'capybara': P.add(e, b(sd * 4.5, ey - 0.4, g.hz - 3, 2.2, 2, 2, 'ear'), b(sd * 4.5, ey + 1.6, g.hz - 3, 1.4, 0.8, 1.6, 'ear')); break;
      case 'axolotl': {
        // feathery gills: three stalks, each fringed with a row of nubs
        const gx = sd * (g.hw / 2 + 1.6);
        for (const [dy, a, len] of [[7.4, 34, 5], [4.4, 0, 6.2], [1.6, -32, 5]] as const) {
          const piv: Vec3 = [sd * (g.hw / 2 - 1), n + dy + 0.8, g.hz - 1], rot: Vec3 = [0, 0, sd * a];
          P.add(e, { ...b(gx + sd * (len - 5) / 2, n + dy, g.hz - 1, len, 1.6, 2, 'gill'), rot, pivot: piv });
          for (let k = 0; k < 3; k++) P.add(e, { ...b(sd * (g.hw / 2 + 0.6 + k * 1.7), n + dy + 1.4, g.hz - 1, 1, 1.2, 1.4, 'gill'), rot, pivot: piv });
        }
        break;
      }
    }
  });

  // ---- tail
  const tz = -g.bd / 2, ty = g.legH + 1;
  switch (tail) {
    case 'fox':
      P.add('tail', b(0, ty, tz - 2.5, 4, 4, 5, 'tail'));
      round('tail2', 'tail', 0, ty - 1.2, tz - 8.4, 6.6, 6.6, 7);
      P.add('tail2', b(0, ty - 0.4, tz - 12.6, 5, 5, 3, 'tailTip'), b(0, ty + 0.4, tz - 14.4, 3, 3, 2, 'tailTip'));
      for (const [x, y, r] of [[2.6, 1, 30], [-2.6, 1, -30], [0, 3.6, 0]] as const) spike('tail2', 'tail', x, ty + y, tz - 6, 2.6, 1.6, [x ? 0 : 50, 180 + r, 0]);
      rest.tail = [38, 0, 0]; rest.tail2 = [18, 0, 0]; break;
    case 'cat':
      P.add('tail', b(0, ty, tz - 3, 2.2, 2.2, 6, 'tail'));
      P.add('tail2', b(0, ty, tz - 9, 2.2, 2.2, 6, 'tail'), b(0, ty - 0.2, tz - 12.6, 2.6, 2.6, 2.4, 'tailTip'), b(0, ty + 0.2, tz - 14, 1.6, 1.6, 1, 'tailTip'));
      rest.tail = [50, 0, 0]; rest.tail2 = [42, 0, 0]; break;
    case 'bunny': round('tail', 'tailTip', 0, ty - 0.4, tz - 1.6, 4.4, 4.4, 3.6); spike('tail', 'tailTip', 0, ty + 2.6, tz - 1.4, 2, 1.6, [50, 180, 0]); break;
    case 'raccoon':
      round('tail', 'ring', 0, ty - 0.6, tz - 3.5, 5.4, 5.4, 7);
      round('tail2', 'ring', 0, ty - 0.6, tz - 9.5, 5.6, 5.6, 6);
      P.add('tail2', b(0, ty, tz - 13.4, 4, 4, 2.4, 'ring'), b(0, ty + 0.6, tz - 15, 2.4, 2.4, 1.4, 'ring'));
      rest.tail = [34, 0, 0]; rest.tail2 = [22, 0, 0]; break;
    case 'redpanda':
      round('tail', 'ring', 0, ty - 1.2, tz - 4, 6.4, 6.4, 8);
      round('tail2', 'ring', 0, ty - 1.2, tz - 11, 6.6, 6.6, 7);
      P.add('tail2', b(0, ty - 0.4, tz - 15.4, 5, 5, 2.4, 'ring'), b(0, ty + 0.4, tz - 17, 3, 3, 1.4, 'ring'));
      rest.tail = [24, 0, 0]; rest.tail2 = [16, 0, 0]; break;
    case 'bear': round('tail', 'tail', 0, ty, tz - 1, 3.4, 3.4, 2.4); break;
    case 'owl': for (const k of [-1, 0, 1]) P.add('tail', { ...b(k * 2, ty - 1, tz - 2.4, 2.2, 1.4, 4.6 - Math.abs(k), 'feather'), rot: [0, k * 14, 0], pivot: [0, ty, tz] }); rest.tail = [-18, 0, 0]; break;
    case 'axolotl':
      P.add('tail', b(0, ty - 1, tz - 3, 2, 5, 6, 'tail'), b(0, ty + 4, tz - 3, 1, 1.6, 5.4, 'fin', { skip: 'd' }));
      P.add('tail2', b(0, ty - 0.4, tz - 8, 2, 4, 5, 'tail'), b(0, ty + 3.6, tz - 8, 1, 1.4, 4.6, 'fin', { skip: 'd' }), b(0, ty + 0.6, tz - 11.4, 1.6, 2.6, 2.2, 'fin'));
      rest.tail = [8, 0, 0]; break;
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
  const rig = buildRig(Object.values(bones), { density: DENS });
  for (const [name, r] of Object.entries(rest)) rig.bones[name]?.rotation.set((r[0] * Math.PI) / 180, (r[1] * Math.PI) / 180, (r[2] * Math.PI) / 180);

  // face overlays: tiny planes a hair in front of the head so frames can swap without rebuilding
  const iris = hex(look.eye), [, iC, iH] = toLch(iris);
  const lineInk = look.species === 'bear' || look.species === 'capybara' ? 0x241a18 : fromLch(0.2, 0.04, toLch(hex(look.accent))[2]);
  const eyePal = { K: fromLch(0.17, Math.min(0.04, iC), iH), J: fromLch(0.36, Math.min(0.12, iC), iH), P: 0x16121b, I: iris, i: adjust(iris, 0.13, 0.85), W: 0xffffff, S: 0xfdfdfd, H: 0xf0507a, Y: 0xffd84a };
  const framesL = EYE_FRAMES.map((f) => (f === 'open' ? OPEN[look.eyeStyle] : EYE_ART[f].rows));
  const framesR = EYE_FRAMES.map((f) => (f === 'open' ? (look.eyeStyle === 'sharp' ? flip(OPEN.sharp) : OPEN[look.eyeStyle]) : EYE_ART[f].mirror ? flip(EYE_ART[f].rows) : EYE_ART[f].rows));
  const head = rig.bones.head, hp = bones.head.pivot;
  const mk = (tex: THREE.DataTexture, w: number, h: number, x: number, y: number, z: number) => {
    const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w * PX, h * PX), mat);
    m.position.set((x - hp[0]) * PX, (y - hp[1]) * PX, (z - hp[2]) * PX);
    head.add(m);
    return m;
  };
  const ey = g.neck + g.eyeY + 3;
  const eyeL = mk(artTexture(framesL, eyePal), 5 * EYE, 6 * EYE, -g.eyeDx, ey, g.hf + 0.06);
  const eyeR = mk(artTexture(framesR, eyePal), 5 * EYE, 6 * EYE, g.eyeDx, ey, g.hf + 0.06);
  let mouthMesh: THREE.Mesh | null = null;
  if (g.mouth) {
    const mouthPal = { K: lineInk, R: 0x7a2c3a, T: 0xf07a8c, W: 0xffffff };
    mouthMesh = mk(artTexture(MOUTH_FRAMES.map((f) => MOUTH_ART[f]), mouthPal, g.mouthWide * DENS), 5 + g.mouthWide, 3, 0, g.neck + g.mouthY + 1.5, g.hf + g.mouthZ + (g.mouthZ ? 0.56 : 0.06));
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
