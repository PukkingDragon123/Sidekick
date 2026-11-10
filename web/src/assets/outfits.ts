// Wearables. Every piece is real geometry layered on the animal's bones (shells, brims, collars,
// capes), textured in the same pixel style as the fur so outfits look modelled, not pasted on.
import type { Look, Outfit, OutfitSlot } from '@shared/types.ts';
import { box, type BoxSpec, type Painter } from '../gfx/box.ts';
import { ramp, tone } from '../gfx/color.ts';
import { cloth, flat, leaves, lvl, metal, R, smooth, solid, type Tint } from '../gfx/mats.ts';
import { hash } from '../gfx/noise.ts';
import type { AnimalParts } from './animals.ts';

export interface PieceDef {
  id: string;
  slot: OutfitSlot;
  name: string;
  make(P: AnimalParts, look: Look): void;
}

export const PIECES: Record<string, PieceDef> = {};
const def = (id: string, slot: OutfitSlot, name: string, make: PieceDef['make']) => { PIECES[id] = { id, slot, name, make }; };

const GOLD = '#f2b632';

// ---- shared construction helpers

const torso = (P: AnimalParts, mat: Painter, from = 0, inflate = 0.6): BoxSpec =>
  box(0, P.g.legH + from, 0, P.g.bw, P.g.bh - from - 0.5, P.g.bd, mat, { inflate, tag: 'torso', skip: 'u' });

function sleeves(P: AnimalParts, mat: Painter, len = 5, inflate = 0.55, wide = 0) {
  const g = P.g;
  if (P.bones.armL.boxes.some((b) => b.tag === 'wing')) return; // winged arms stay bare
  const ax = g.bw / 2 + g.limb / 2 - 0.5;
  for (const [bone, sd] of [['armL', -1], ['armR', 1]] as const) {
    P.add(bone, box(sd * ax, g.neck - 6.5 + (7 - len), 0, g.limb, len, g.limb, mat, { inflate, tag: 'sleeve', skip: 'u' }));
    if (wide) P.add(bone, box(sd * ax, g.neck - 6.5 + (7 - len), 0, g.limb + wide, 2, g.limb + wide + 1, mat, { tag: 'cuff' }));
  }
}

/** Skirt/coat panels hanging from the waist down to `to` px above the ground. */
function tails(P: AnimalParts, mat: Painter, to = 1, open = true) {
  const g = P.g, h = g.legH - to + 1, y = to, w = g.bw + 1.2, d = g.bd + 1.2;
  P.add('body', box(0, y, -d / 2, w, h, 1, mat, { tag: 'tail' }), box(-w / 2, y, 0, 1, h, d, mat, { tag: 'tail' }), box(w / 2, y, 0, 1, h, d, mat, { tag: 'tail' }));
  if (open) {
    const pw = Math.floor(g.bw / 2) - 0.5;
    P.add('body', box(-(g.bw / 4 + 1), y, d / 2, pw, h, 1, mat, { tag: 'tail' }), box(g.bw / 4 + 1, y, d / 2, pw, h, 1, mat, { tag: 'tail' }));
  } else P.add('body', box(0, y, d / 2, w, h, 1, mat, { tag: 'tail' }));
}

/** Wrap a base fabric with front-of-torso details. `f` gets x from the centre and y from the hem. */
const front = (base: Painter, f: (x: number, y: number, t: Parameters<Painter>[0]) => number | null): Painter => (t) => {
  if (t.tag === 'torso' && t.face === 4) {
    const c = f(t.x, t.by, t);
    if (c !== null) return c;
  }
  return base(t);
};

const rib = (base: Painter, c: Tint): Painter => {
  const r = R(c);
  return (t) => ((t.tag === 'torso' || t.tag === 'sleeve') && t.face !== 2 && t.face !== 3 && t.by < 1.2 ? tone(r, (t.u & 1 ? -0.6 : 0.4) + lvl(t, { noise: 0, rim: 0, grad: 0 })) : base(t));
};

// ---- body

function hoodie(id: string, name: string, c: string, trim: string) {
  def(id, 'body', name, (P) => {
    const g = P.g, cr = R(c), tr = R(trim);
    const mat = rib(front(cloth(cr), (x, y, t) => {
      const ax = Math.abs(x);
      if (y >= 1.5 && y < 4 && ax < g.bw / 2 - 1.2) return tone(cr, (y < 2.5 && ax > g.bw / 2 - 2.4 ? -1.6 : y >= 3.2 ? -1.4 : -0.5));
      if (Math.abs(ax - 1.5) < 0.6 && y > t.sy - 3.5) return tone(tr, y > t.sy - 2.6 ? 1.5 : 2.2);
      return null;
    }), trim);
    P.add('body', torso(P, mat));
    sleeves(P, mat, 6);
    // hood resting on the shoulders
    P.add('body', box(0, g.neck - 2.5, -g.bd / 2 - 1.6, g.bw + 0.6, 5, 3, cloth(cr), { tag: 'hood' }), box(0, g.neck - 1, -g.bd / 2 - 3.2, g.bw - 2, 3, 1.4, cloth(cr, { shade: { face: 0.6 } })));
    P.add('body', box(0, g.neck - 1.2, 0, g.bw + 1.6, 1.6, g.bd + 1.6, cloth(tr), { tag: 'collar', skip: 'ud' }));
  });
}

function blazer(id: string, name: string, c: string, tie: string) {
  def(id, 'body', name, (P) => {
    const g = P.g, cr = R(c), shirt = R('#fbfbff'), tr = R(tie), gold = ramp(0xf2b632);
    const mat = front(cloth(cr), (x, y, t) => {
      const ax = Math.abs(x), topRow = t.sy - y;
      if (ax < 0.6 + Math.max(0, 3 - topRow) * 0.9 && topRow < 4.2) return ax < 0.7 ? tone(tr, topRow < 1.2 ? 0.6 : -0.2 + (Math.floor(y) & 1 ? 0.5 : 0)) : tone(shirt, -0.2);
      if (ax < 0.7 && y > 0.5 && Math.floor(y) % 2 === 1) return tone(gold, 1.2);
      if (ax > g.bw / 2 - 2.6 && ax < g.bw / 2 - 0.9 && Math.abs(y - 4.5) < 0.6) return tone(cr, 1.6);
      return null;
    });
    P.add('body', torso(P, mat));
    sleeves(P, mat, 6);
    P.add('body', box(0, g.neck - 1.4, 0.4, g.bw + 0.8, 1.6, g.bd + 1.6, solid(shirt, { noise: 0.1 }), { tag: 'collar', skip: 'ud' }));
  });
}

function cloak(id: string, name: string, c: string, trim: string) {
  def(id, 'body', name, (P) => {
    const g = P.g;
    const mat = cloth(c, { trim, hem: 1.2 });
    P.add('body', torso(P, front(mat, (x, y, t) => (Math.abs(x) < 1.1 && t.sy - y < 2.2 ? tone(ramp(0xf2b632), 1) : null))));
    // the cloak proper: a mantle over the shoulders that widens towards the hem
    const top = g.neck + 0.5;
    P.add('body',
      box(0, top - 3, -0.2, g.bw + 5, 3, g.bd + 3.4, mat, { tag: 'mantle', skip: 'd' }),
      box(0, top - 6, -0.6, g.bw + 6.4, 3.4, g.bd + 4.4, mat, { tag: 'mantle', skip: 'ud' }),
      box(0, g.legH - 2, -g.bd / 2 - 2, g.bw + 6, top - g.legH - 3, 1.4, mat, { tag: 'mantle' }),
      box(-(g.bw / 2 + 3), g.legH - 1, -1, 1.2, top - g.legH - 4, g.bd + 1, mat, { tag: 'mantle' }),
      box(g.bw / 2 + 3, g.legH - 1, -1, 1.2, top - g.legH - 4, g.bd + 1, mat, { tag: 'mantle' }));
    P.add('body', box(0, top - 1.6, g.bd / 2 + 1.2, 2, 2, 1, metal(GOLD)));
  });
}

function dramaCoat(id: string, name: string, c: string, lining: string) {
  def(id, 'body', name, (P) => {
    const g = P.g, cr = R(c), ln = R(lining), gold = ramp(0xf2b632, { step: 0.085 });
    const mat = front(cloth(cr, { shade: { noise: 0.2 } }), (x, y, t) => {
      const ax = Math.abs(x), topRow = t.sy - y;
      if (ax < 1.2 + topRow * 0.0 && topRow < 3.4 && ax < 1.3 + (3.4 - topRow) * 0.8) return tone(ln, 0.4 - topRow * 0.3);
      if (ax < 0.6) return tone(cr, -2.2);
      if (Math.abs(ax - 2) < 0.6 && (Math.floor(y) === 1 || Math.floor(y) === 3)) return tone(gold, 1.4);
      if (y < 1.2) return tone(gold, ax < 1.6 ? 2 : (t.u & 1 ? 0.4 : -0.6));
      return null;
    });
    P.add('body', torso(P, mat));
    sleeves(P, mat, 7, 0.6, 1.2);
    tails(P, cloth(cr, { trim: lining, hem: 1 }), 0.4, true);
    // towering popped collar
    const cm = cloth(cr, { trim: GOLD, hem: 0, collar: 1 });
    P.add('body',
      { ...box(-(g.bw / 2 + 0.8), g.neck - 2, 0.6, 1.4, 6, g.bd + 1, cm, { tag: 'collar' }), rot: [0, 0, 14] },
      { ...box(g.bw / 2 + 0.8, g.neck - 2, 0.6, 1.4, 6, g.bd + 1, cm, { tag: 'collar' }), rot: [0, 0, -14] },
      box(0, g.neck - 2, -g.bd / 2 - 0.8, g.bw + 2.6, 6, 1.4, cm, { tag: 'collar' }));
    // chain across the chest
    P.add('body', { ...box(0, g.legH + g.bh - 5, g.bd / 2 + 1, g.bw - 1, 1, 0.8, metal(GOLD)), rot: [0, 0, -16] });
  });
}

function haori(id: string, name: string, c: string, inner: string, obi: string) {
  def(id, 'body', name, (P) => {
    const g = P.g, cr = R(c), ir = R(inner), ob = R(obi);
    const pat: Painter = (t) => {
      const L = lvl(t, { noise: 0.25, speck: 0.2 });
      const k = hash(Math.floor(t.x / 3 + 20), Math.floor(t.y / 3), Math.floor(t.z / 3 + 20), 5);
      return k > 0.8 && (Math.floor(t.x + 40) + Math.floor(t.y)) % 3 === 0 ? tone(ir, 1) : tone(cr, L);
    };
    const mat = front(pat, (x, y, t) => {
      const ax = Math.abs(x), topRow = t.sy - y;
      if (y >= 1.5 && y < 3.5) return tone(ob, (y < 2.2 ? -0.7 : 0.5) + (ax < 1 ? 0.9 : 0));
      if (Math.abs(ax - topRow * 0.55) < 0.75 && topRow < 5) return tone(ir, 0.6);
      return null;
    });
    P.add('body', torso(P, mat));
    sleeves(P, pat, 6, 0.6, 2.4);
    tails(P, pat, 1.6, false);
  });
}

def('overalls', 'body', 'Garden Overalls', (P) => {
  const g = P.g, dn = R('#4d79c7'), st = R('#f6d06a');
  const mat = front(cloth(dn, { shade: { noise: 0.5, scale: 1.6 } }), (x, y, t) => {
    const ax = Math.abs(x), topRow = t.sy - y;
    if (topRow < 3 && ax > g.bw / 2 - 2.6) return -2;
    if (Math.abs(ax - 1) < 1.6 && Math.abs(y - 3.5) < 1.3) return tone(dn, y > 4.2 || ax > 2 ? -1.6 : 0.8);
    if (topRow >= 3 && topRow < 3.8 && Math.abs(ax - (g.bw / 2 - 2)) < 0.6) return tone(st, 1.4);
    return null;
  });
  // bib and straps drawn on the shell; the shell is cut away at the shoulders
  P.add('body', { ...torso(P, (t) => { const c = mat(t); return c === -2 || (t.tag === 'torso' && t.face !== 4 && t.face !== 5 && t.sy - t.by < 3) ? -1 : c; }), cut: true });
  P.add('body', box(-(g.bw / 2 - 1.5), g.legH + g.bh - 4, 0, 1.4, 4, g.bd + 1.4, cloth(dn), { tag: 'strap', skip: 'd' }), box(g.bw / 2 - 1.5, g.legH + g.bh - 4, 0, 1.4, 4, g.bd + 1.4, cloth(dn), { tag: 'strap', skip: 'd' }));
});

def('tunic', 'body', 'Ranger Tunic', (P) => {
  const g = P.g, gr = R('#5c9c4a'), belt = R('#7a4a2b'), gold = ramp(0xf2b632);
  const mat = front(cloth(gr, { trim: '#3f7a3c', hem: 1 }), (x, y, t) => {
    if (y >= 2 && y < 3.4) return Math.abs(x) < 1.1 ? tone(gold, 1.2) : tone(belt, y < 2.6 ? -0.6 : 0.5);
    if (Math.abs(x) < 0.6 && t.sy - y < 3) return tone(gr, -1.8);
    return null;
  });
  P.add('body', torso(P, mat));
  sleeves(P, cloth(gr), 3);
  tails(P, cloth(gr, { trim: '#3f7a3c', hem: 1 }), 2.4, false);
  P.add('body', box(0, g.neck - 1.2, 0, g.bw + 2.4, 2, g.bd + 2.4, cloth('#3f7a3c'), { tag: 'collar', skip: 'ud' }));
});

function sweater(id: string, name: string, a: string, b: string) {
  def(id, 'body', name, (P) => {
    const mat = rib(cloth(a, { stripe: b, stripeEvery: 3, shade: { noise: 0.5, scale: 1.4 } }), a);
    P.add('body', torso(P, mat));
    sleeves(P, mat, 6);
    P.add('body', box(0, P.g.neck - 1.2, 0, P.g.bw + 1.4, 1.6, P.g.bd + 1.4, cloth(a), { tag: 'collar', skip: 'ud' }));
  });
}

function varsity(id: string, name: string, c: string, sleeve: string) {
  def(id, 'body', name, (P) => {
    const g = P.g, cr = R(c), wh = R('#fbf6ea');
    const mat = rib(front(cloth(cr), (x, y, t) => {
      const ax = Math.abs(x);
      if (ax < 0.6) return tone(wh, Math.floor(y) % 2 ? -0.4 : 0.6);
      if (x > 1.2 && x < 3.8 && t.sy - y > 1 && t.sy - y < 4.2) return (Math.abs(x - 2.5) < 0.6 || Math.abs(t.sy - y - 1.6) < 0.6) ? tone(wh, 0.8) : null;
      return null;
    }), '#fbf6ea');
    P.add('body', torso(P, mat));
    sleeves(P, rib(cloth(sleeve), c), 6);
    P.add('body', box(0, g.neck - 1.2, 0, g.bw + 1.6, 1.6, g.bd + 1.6, cloth(c, { stripe: '#fbf6ea', stripeEvery: 1 }), { tag: 'collar', skip: 'ud' }));
  });
}

hoodie('hoodie_red', 'Cherry Hoodie', '#e2504a', '#fbf1e6');
hoodie('hoodie_mint', 'Mint Hoodie', '#6fd3b0', '#f7fff9');
hoodie('hoodie_ink', 'Midnight Hoodie', '#2f3350', '#f2c94c');
blazer('blazer_navy', 'School Blazer', '#2e3f73', '#d8433f');
blazer('blazer_wine', 'Prefect Blazer', '#7c2d43', '#f2b632');
cloak('cloak_violet', 'Wanderer Cloak', '#8d62d6', GOLD);
cloak('cloak_moss', 'Forest Cloak', '#4f8a4a', '#d9a441');
dramaCoat('drama_magenta', 'Dramatic Coat', '#c2378f', '#35c8c0');
dramaCoat('drama_azure', 'Stardust Coat', '#2d55b8', '#f2c230');
haori('haori_wave', 'Wave Haori', '#3d6fb5', '#f4f7ff', '#e25555');
haori('haori_sakura', 'Blossom Haori', '#f3a9c0', '#ffffff', '#7a4fa8');
sweater('sweater_bee', 'Bee Sweater', '#f4c63d', '#3a2f2a');
sweater('sweater_berry', 'Berry Sweater', '#d45b7a', '#fbe6ec');
varsity('varsity_red', 'Varsity Jacket', '#c93a3a', '#fbf6ea');
varsity('varsity_teal', 'Club Jacket', '#2f8f8a', '#2b2f3f');

// ---- head

const headTop = (P: AnimalParts) => P.g.neck + P.g.hh;

function beanie(id: string, name: string, c: string, fold: string) {
  def(id, 'head', name, (P) => {
    const g = P.g, y = headTop(P);
    const knit = cloth(c, { shade: { noise: 0.6, scale: 1.3 } }), band: Painter = (t) => tone(R(fold), (t.u & 1 ? -0.6 : 0.4) + lvl(t, { noise: 0, grad: 0.5 }));
    P.add('head', box(0, y - 3, g.hz, g.hw + 1, 4, g.hd + 1, knit, { skip: 'd' }), box(0, y - 3.4, g.hz, g.hw + 2, 2.4, g.hd + 2, band, { skip: 'ud' }),
      box(0, y + 1, g.hz, g.hw - 3, 2, g.hd - 3, knit, { skip: 'd' }), box(0, y + 3, g.hz, 3, 3, 3, solid(fold, { noise: 0.9, scale: 1.2 })));
  });
}

function cap(id: string, name: string, c: string, brim: string, backwards = false) {
  def(id, 'head', name, (P) => {
    const g = P.g, y = headTop(P), cr = R(c);
    const crown: Painter = (t) => (t.face === (backwards ? 5 : 4) && Math.abs(t.x) < 2.2 && t.by > 0.8 && t.by < 3.4 ? tone(R(brim), Math.abs(t.x) < 1 ? 1 : -0.2) : cloth(cr)(t));
    const s = backwards ? -1 : 1;
    P.add('head', box(0, y - 2, g.hz, g.hw + 1, 3.4, g.hd + 1, crown, { skip: 'd' }), box(0, y + 1.4, g.hz - 0.5 * s, g.hw - 2, 1.6, g.hd - 2, cloth(cr), { skip: 'd' }),
      { ...box(0, y - 2, g.hz + s * (g.hd / 2 + 2.6), g.hw - 2, 1, 5, cloth(brim)), rot: [s * 10, 0, 0] }, box(0, y + 3, g.hz, 1, 1, 1, cloth(brim)));
  });
}

def('wizard', 'head', 'Stargazer Hat', (P) => {
  const g = P.g, y = headTop(P), cr = R('#5146b8'), star = ramp(0xffe066);
  const mat: Painter = (t) => (hash(Math.floor(t.x + 50), Math.floor(t.y), Math.floor(t.z + 50), 4) > 0.93 ? tone(star, 1) : cloth(cr)(t));
  P.add('head', box(0, y - 1, g.hz, g.hw + 7, 1, g.hd + 7, mat), box(0, y, g.hz, g.hw - 2, 4, g.hd - 2, mat, { skip: 'd' }),
    box(0, y, g.hz, g.hw - 1.4, 1.6, g.hd - 1.4, metal(GOLD), { skip: 'ud' }),
    box(0.6, y + 4, g.hz - 0.4, g.hw - 6, 4, g.hd - 6, mat, { skip: 'd' }),
    { ...box(1.6, y + 8, g.hz - 0.8, 5, 4, 5, mat), rot: [0, 0, -14] }, { ...box(3.6, y + 11, g.hz - 1, 3, 4, 3, mat), rot: [0, 0, -38] },
    { ...box(6.4, y + 12.4, g.hz - 1, 2, 2, 2, solid(star, { noise: 0 }), { glow: true }), rot: [0, 0, 45] });
});

def('straw', 'head', 'Straw Hat', (P) => {
  const g = P.g, y = headTop(P), sr = R('#e6c26a');
  const weave: Painter = (t) => tone(sr, lvl(t, { noise: 0.2 }) + ((t.u + t.v) % 3 === 0 ? -0.9 : (t.u - t.v + 30) % 3 === 0 ? 0.6 : 0));
  P.add('head', box(0, y - 1, g.hz, g.hw + 9, 1, g.hd + 9, weave), box(0, y, g.hz, g.hw - 2, 3, g.hd - 2, weave, { skip: 'd' }),
    box(0, y, g.hz, g.hw - 1.4, 1.2, g.hd - 1.4, cloth('#d8433f'), { skip: 'ud' }), box(0, y + 3, g.hz, g.hw - 5, 1, g.hd - 5, weave, { skip: 'd' }));
});

def('crown', 'head', 'Tiny Crown', (P) => {
  const g = P.g, y = headTop(P), m = metal(GOLD);
  const band: Painter = (t) => (t.face !== 2 && t.face !== 3 && Math.floor(t.v) === 0 && t.u % 3 === 1 ? tone(ramp(t.u % 6 === 1 ? 0xe5484d : 0x4aa8f0), 1) : m(t));
  P.add('head', box(0, y, g.hz, 8, 2, 8, band, { skip: 'd' }));
  for (const [x, z, h] of [[-3.5, -3.5, 2], [3.5, -3.5, 2], [-3.5, 3.5, 2], [3.5, 3.5, 2], [0, 3.5, 3], [0, -3.5, 3], [3.5, 0, 3], [-3.5, 0, 3]] as const) P.add('head', box(x, y + 2, g.hz + z, 1, h, 1, m, { skip: 'd' }));
});

def('flowercrown', 'head', 'Flower Crown', (P) => {
  const g = P.g, y = headTop(P) - 1.6, leaf = leaves('#5aa846', { seed: 3 });
  const cols = ['#f58fb0', '#fbfaf2', '#f6c531', '#a57be0', '#f0683a'];
  const n = 12, rx = g.hw / 2 + 0.2, rz = g.hd / 2 + 0.2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, x = Math.cos(a) * rx, z = g.hz + Math.sin(a) * rz;
    P.add('head', box(x, y, z, 3, 2, 3, leaf));
    if (i % 2 === 0) P.add('head', box(x * 1.06, y + 0.8, g.hz + (z - g.hz) * 1.06, 2, 2, 2, smooth(cols[(i / 2) % cols.length])), box(x * 1.1, y + 1.4, g.hz + (z - g.hz) * 1.1, 1, 1, 1, flat('#f6c531')));
  }
});

function headphones(id: string, name: string, c: string) {
  def(id, 'head', name, (P) => {
    const g = P.g, y = headTop(P), dk = solid('#2c2f3d', { noise: 0.15 }), cr = R(c);
    const cup: Painter = (t) => {
      if (t.face > 1) return tone(cr, lvl(t, { noise: 0.2 }));
      const d = Math.max(Math.abs(t.u + 0.5 - t.w / 2), Math.abs(t.v + 0.5 - t.h / 2));
      return tone(cr, d < 1 ? 1.8 : d < 2 ? -1.2 : 0.3);
    };
    P.add('head', box(0, y, g.hz, g.hw + 2, 1.2, 2.4, dk, { skip: 'd' }));
    for (const s of [-1, 1]) P.add('head', box(s * (g.hw / 2 + 0.6), y - 5, g.hz, 1.2, 6, 2.4, dk), box(s * (g.hw / 2 + 1.6), g.neck + 3, g.hz, 2.4, 6, 6, cup));
  });
}

def('headband', 'head', 'Focus Headband', (P) => {
  const g = P.g, y = g.neck + g.eyeY + 6.6, m = cloth('#d8433f');
  P.add('head', box(0, y, g.hz, g.hw + 0.9, 2, g.hd + 0.9, m, { skip: 'ud' }), box(1.5, y, g.hz - g.hd / 2 - 1, 2, 2, 1.4, m),
    { ...box(2.6, y - 4, g.hz - g.hd / 2 - 1.2, 1.6, 5, 1, m), rot: [-14, 0, 14] }, { ...box(0.4, y - 5, g.hz - g.hd / 2 - 1.2, 1.6, 6, 1, m), rot: [-22, 0, -8] });
});

def('beret', 'head', 'Artist Beret', (P) => {
  const g = P.g, y = headTop(P), m = cloth('#c9433f', { shade: { noise: 0.4 } });
  P.add('head', box(0, y - 1, g.hz, g.hw - 1, 2, g.hd - 1, m, { skip: 'd' }), { ...box(2, y + 0.6, g.hz, g.hw - 2, 2, g.hd - 2, m), rot: [0, 0, -8] }, box(2.4, y + 2.6, g.hz, 1, 1.4, 1, m));
});

def('tophat', 'head', 'Top Hat', (P) => {
  const g = P.g, y = headTop(P), m = cloth('#2a2b36', { shade: { noise: 0.15 } });
  P.add('head', box(0, y, g.hz, 12, 1, 12, m), box(0, y + 1, g.hz, 8, 7, 8, m, { skip: 'd' }), box(0, y + 1, g.hz, 8.6, 2, 8.6, cloth('#b8323f'), { skip: 'ud' }));
});

def('bow', 'head', 'Ribbon Bow', (P) => {
  const g = P.g, y = headTop(P) - 2, z = g.hf - 2.5, m = cloth('#f0597e'), x = g.hw / 2 - 3;
  P.add('head', box(x, y, z, 2, 2.4, 2, cloth('#d63f66')), { ...box(x - 2.6, y - 0.6, z, 3.4, 3.6, 1.6, m), rot: [0, 0, 12] }, { ...box(x + 2.6, y - 0.6, z, 3.4, 3.6, 1.6, m), rot: [0, 0, -12] });
});

def('sprout', 'head', 'Lucky Sprout', (P) => {
  const g = P.g, y = headTop(P), st = solid('#5aa83f', { noise: 0.2 }), lf = solid('#7ccf52', { noise: 0.3 });
  P.add('head', box(0, y, g.hz, 1, 3, 1, st, { skip: 'd' }), { ...box(-2, y + 2.4, g.hz, 4, 1, 2.4, lf), rot: [0, 0, -28] }, { ...box(2, y + 2.4, g.hz, 4, 1, 2.4, lf), rot: [0, 0, 28] });
});

def('yuzu', 'head', 'Zen Yuzu', (P) => {
  const g = P.g, y = headTop(P), m = smooth('#f6a531', { noise: 0.5, scale: 1.4 });
  P.add('head', box(0, y, g.hz, 5, 4, 5, m, { skip: 'd' }), box(0, y + 4, g.hz, 3, 1, 3, m, { skip: 'd' }), box(0, y + 5, g.hz, 1, 1, 1, flat('#5a7a2f')),
    { ...box(1.6, y + 5, g.hz, 3, 1, 2, solid('#69b64a', { noise: 0.2 })), rot: [0, 0, 20] });
});

def('gradcap', 'head', 'Graduation Cap', (P) => {
  const g = P.g, y = headTop(P), m = cloth('#27304f', { shade: { noise: 0.15 } });
  P.add('head', box(0, y - 1, g.hz, g.hw - 3, 2, g.hd - 3, m, { skip: 'd' }), { ...box(0, y + 1, g.hz, g.hw + 3, 1, g.hd + 3, m), rot: [0, 45, 0] },
    box(0, y + 2, g.hz, 1.4, 0.8, 1.4, metal(GOLD)), box(g.hw / 2 + 1.4, y - 3.2, g.hz + 0.4, 1, 4.4, 1, solid(GOLD, { noise: 0.4 })), box(g.hw / 2 + 1.4, y - 4.6, g.hz + 0.4, 2, 2, 2, solid(GOLD, { noise: 0.6 })));
});

beanie('beanie_sky', 'Sky Beanie', '#5aa9e6', '#f4f7ff');
beanie('beanie_plum', 'Plum Beanie', '#8a4f9e', '#f6c531');
cap('cap_red', 'Street Cap', '#d8433f', '#fbf6ea');
cap('cap_back', 'Backwards Cap', '#2f3350', '#6fd3b0', true);
headphones('phones_pink', 'Bubblegum Headphones', '#f58fb0');
headphones('phones_lime', 'Lo-fi Headphones', '#9bd94a');

// ---- face

function glasses(id: string, name: string, frameC: string, lens: string | null, round = true) {
  def(id, 'face', name, (P) => {
    const g = P.g, y = g.neck + g.eyeY - 0.2, z = g.hf + 0.9, fr = R(frameC), ln = lens ? R(lens) : null;
    const rim: Painter = (t) => {
      if (t.face !== 4) return tone(fr, -0.5);
      const edge = t.u === 0 || t.v === 0 || t.u === t.w - 1 || t.v === t.h - 1;
      const corner = (t.u === 0 || t.u === t.w - 1) && (t.v === 0 || t.v === t.h - 1);
      if (round && corner) return -1;
      if (edge) return tone(fr, t.v === t.h - 1 ? 0.8 : -0.2);
      if (!ln) return (t.u === 1 && t.v === t.h - 2) ? 0xffffff : -1;
      return tone(ln, (t.u + t.v === t.h - 1 || t.u + t.v === t.h) ? 1.8 : -0.4);
    };
    for (const s of [-1, 1]) P.add('head', box(s * g.eyeDx, y, z, 6, 6, 1, rim, { cut: true, skip: 'n' }), box(s * (g.hw / 2 + 0.4), y + 3.5, g.hf - 2.6, 1, 1, 7, solid(fr, { noise: 0 })));
    P.add('head', box(0, y + 3.5, z, g.eyeDx * 2 - 6 + 0.6, 1, 1, solid(fr, { noise: 0 })));
  });
}
glasses('glasses_round', 'Round Glasses', '#3a3340', null);
glasses('glasses_gold', 'Scholar Specs', '#e0a82e', null, false);
glasses('shades', 'Cool Shades', '#23242e', '#2d3352', false);
glasses('shades_heart', 'Rose Shades', '#f0597e', '#ffb3c8');

// ---- neck

function scarf(id: string, name: string, a: string, b: string) {
  def(id, 'neck', name, (P) => {
    const g = P.g, m = cloth(a, { stripe: b, stripeEvery: 2 });
    const fringe: Painter = (t) => (t.by < 1 && t.u % 2 ? -1 : m(t));
    P.add('body', box(0, g.neck - 1.8, 0.3, g.bw + 2.6, 3, g.bd + 2.8, m, { tag: 'scarf', skip: 'd' }), box(g.bw / 2 - 1.4, g.neck - 8, g.bd / 2 + 1.5, 3, 7, 1, fringe, { cut: true, tag: 'scarf' }));
  });
}
scarf('scarf_red', 'Cosy Scarf', '#d8433f', '#fbf1e6');
scarf('scarf_teal', 'Lake Scarf', '#2f9f9a', '#f6d06a');

def('bandana', 'neck', 'Trail Bandana', (P) => {
  const g = P.g, r = R('#e4572e');
  const tri: Painter = (t) => (t.face === 4 && Math.abs(t.x) > (t.by + 1) * 1.15 ? -1 : hash(Math.floor(t.x + 30), Math.floor(t.y), 0, 2) > 0.8 ? tone(R('#fff3d6'), 0.5) : tone(r, lvl(t, { noise: 0.2 })));
  P.add('body', box(0, g.neck - 1.6, 0.2, g.bw + 2, 1.8, g.bd + 2.2, cloth(r), { skip: 'ud' }), box(0, g.neck - 5.6, g.bd / 2 + 1.1, g.bw + 1, 4.2, 1, tri, { cut: true }));
});

def('bowtie', 'neck', 'Bow Tie', (P) => {
  const g = P.g, y = g.neck - 3, z = g.bd / 2 + 1.2, m = cloth('#2f3350');
  P.add('body', box(0, y + 0.3, z, 1.6, 1.6, 1.4, cloth('#1f2238')), box(-2, y, z, 2.6, 2.4, 1, m), box(2, y, z, 2.6, 2.4, 1, m));
});

def('chain', 'neck', 'Gold Chain', (P) => {
  const g = P.g, m = metal(GOLD);
  const links: Painter = (t) => (t.u % 2 ? m(t) : -1);
  P.add('body', box(0, g.neck - 1.4, 0.3, g.bw + 2, 1, g.bd + 2.2, links, { cut: true, skip: 'ud' }), box(0, g.neck - 4.4, g.bd / 2 + 1.1, 3, 3, 1, metal(GOLD)), box(0, g.neck - 2, g.bd / 2 + 1.1, 1, 1.6, 0.8, m));
});

def('bell', 'neck', 'Bell Collar', (P) => {
  const g = P.g;
  P.add('body', box(0, g.neck - 1.5, 0.2, g.bw + 1.6, 1.4, g.bd + 1.8, cloth('#d8433f'), { skip: 'ud' }), box(0, g.neck - 3.6, g.bd / 2 + 1.2, 2.4, 2.4, 2, metal(GOLD)), box(0, g.neck - 3.6, g.bd / 2 + 2.3, 0.8, 1, 0.4, flat('#5a3d12')));
});

// ---- back

function backpack(id: string, name: string, c: string, flap: string) {
  def(id, 'back', name, (P) => {
    const g = P.g, y = g.legH + 1, z = -g.bd / 2 - 2.6, m = cloth(c), f = cloth(flap);
    const fr = R(c);
    const pocket: Painter = (t) => (t.face === 5 && t.by < 3 && Math.abs(t.x) < 2.6 ? tone(fr, t.by > 2 || Math.abs(t.x) > 1.8 ? -1.5 : 0.7) : m(t));
    P.add('body', box(0, y, z, g.bw - 1, g.bh - 2, 4, pocket), box(0, y + g.bh - 4, z - 0.3, g.bw - 0.4, 2.6, 4.8, f), box(0, y + g.bh - 2.2, z, g.bw - 3, 1.4, 2, m),
      box(0, y + g.bh - 4.6, z - 2.7, 1.4, 1.4, 0.6, metal(GOLD)));
    for (const s of [-1, 1]) P.add('body', box(s * (g.bw / 2 - 1.6), g.legH + 1, g.bd / 2 + 0.8, 1.4, g.bh - 1.6, 0.8, f), box(s * (g.bw / 2 - 1.6), g.legH + g.bh - 0.8, 0, 1.4, 0.8, g.bd + 2, f));
  });
}
backpack('pack_red', 'School Backpack', '#d8433f', '#a82f33');
backpack('pack_leaf', 'Explorer Pack', '#6a9b46', '#7a4a2b');

function cape(id: string, name: string, c: string, lining: string) {
  def(id, 'back', name, (P) => {
    const g = P.g, cr = R(c), ln = R(lining);
    const m: Painter = (t) => (t.face === 4 ? tone(ln, lvl(t, { noise: 0.2 })) : cloth(cr, { trim: GOLD, hem: 1 })(t));
    const ragged: Painter = (t) => (t.by < 1.5 && (Math.floor(t.bx / 2) + (t.by < 0.6 ? 1 : 0)) % 2 === 0 && t.by < 1 ? -1 : m(t));
    P.add('cape', { ...box(0, 1.6, -g.bd / 2 - 1.4, g.bw + 4, g.neck - 1.6, 1, ragged, { cut: true, tag: 'cape' }), rot: [9, 0, 0], pivot: [0, g.neck, -g.bd / 2 - 1] });
    P.add('body', box(0, g.neck - 1.4, -0.2, g.bw + 3, 1.6, g.bd + 2.6, cloth(cr), { skip: 'ud' }), box(0, g.neck - 1.6, g.bd / 2 + 1.3, 2, 2, 0.8, metal(GOLD)));
  });
}
cape('cape_hero', 'Hero Cape', '#d8433f', '#f6c531');
cape('cape_night', 'Night Cape', '#2b2f55', '#8d62d6');

def('wings', 'back', 'Fairy Wings', (P) => {
  const g = P.g, wr = R('#bfe9ff');
  const wing: Painter = (t) => {
    const d = Math.hypot((t.bx - t.sx / 2) / (t.sx / 2), (t.by - t.sy / 2) / (t.sy / 2));
    if (d > 1.02) return -1;
    return tone(wr, d > 0.78 ? -1.4 : (t.u + t.v) % 4 === 0 ? 1.6 : 0.4);
  };
  for (const s of [-1, 1]) {
    P.add('body', { ...box(s * 5, g.legH + 4, -g.bd / 2 - 1.2, 8, 9, 1, wing, { cut: true, glow: false }), rot: [0, s * 28, s * 18], pivot: [s * 1, g.legH + 5, -g.bd / 2 - 1] },
      { ...box(s * 4, g.legH - 0.5, -g.bd / 2 - 1.2, 6, 6, 1, wing, { cut: true }), rot: [0, s * 28, -s * 20], pivot: [s * 1, g.legH + 4, -g.bd / 2 - 1] });
  }
});

def('quiver', 'back', 'Ranger Quiver', (P) => {
  const g = P.g, lt = R('#8a5a34');
  const body: BoxSpec[] = [box(0, g.legH + 1, -g.bd / 2 - 2, 4, 8, 3, cloth(lt, { trim: GOLD, hem: 1, collar: 1 }))];
  for (const [x, c] of [[-1, '#e5484d'], [0.6, '#f6c531'], [1.4, '#4aa8f0']] as const) body.push(box(x, g.legH + 9, -g.bd / 2 - 2, 1, 3, 1, solid('#d9c7a0', { noise: 0 })), box(x, g.legH + 11, -g.bd / 2 - 2, 2, 2, 1, solid(c, { noise: 0.2 })));
  P.add('body', ...body.map((b) => ({ ...b, rot: [0, 0, -20] as [number, number, number], pivot: [0, g.legH + 5, -g.bd / 2 - 2] as [number, number, number] })));
  P.add('body', { ...box(0, g.legH + 3, g.bd / 2 + 0.8, g.bw + 1.4, 1, 0.8, cloth(lt)), rot: [0, 0, -24] });
});

const ORDER: OutfitSlot[] = ['body', 'back', 'neck', 'head', 'face'];

export function dressUp(P: AnimalParts, outfit: Outfit, look: Look) {
  for (const slot of ORDER) {
    const id = outfit[slot];
    if (id && PIECES[id]) PIECES[id].make(P, look);
  }
}
