// Handcrafted wood UI kit. Every frame, texture and decoration is painted here pixel by pixel at
// "art" resolution, then shown at A CSS px per art pixel and rendered at device resolution, so it
// stays razor-sharp on retina screens. Interiors are tiling textures (planks, parchment) rather than
// stretched images, so a big panel has as much grain and detail as a small one.
// The palette and the general language (wood boards, gold slots, parchment) follow The Bear Must Eat.

type RGBA = [number, number, number, number];
const hexc = (h: string): RGBA => { const n = parseInt(h.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length > 7 ? parseInt(h.slice(7, 9), 16) : 255]; };
const mixc = (a: RGBA, b: RGBA, t: number): RGBA => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 255].map(Math.round) as RGBA;
const h2 = (x: number, y: number, s = 0) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const n1 = (x: number, s = 0) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return h2(i, 0, s) * (1 - u) + h2(i + 1, 0, s) * u; };

/** A ramp of shades: index 0 darkest. */
function shades(...hx: string[]): RGBA[] { return hx.map(hexc); }

const INK = hexc('#24150d');
const WOOD = shades('#3b2212', '#5a3519', '#7a4a24', '#94602f', '#ad773d', '#c48e4f', '#d9a865', '#ecc283');
const WALNUT = shades('#1e120b', '#2c1b10', '#3d2616', '#51331d', '#664226', '#7c5532');
const IRON = shades('#1d1f26', '#383c48', '#575d6d', '#7d8496', '#aab2c4', '#dfe5f0');
const GOLD = shades('#5c3606', '#8a5410', '#b8781a', '#e0a52a', '#f6c94a', '#ffe98f', '#fff8d4');
const PAPER = shades('#8a6a3e', '#b5935c', '#d6b97f', '#e9d3a2', '#f4e4bd', '#fbf1d6', '#fffaea');
const LEAF = shades('#163d1c', '#22592a', '#2f7a35', '#46993f', '#68b84a', '#93d35e', '#c2ea7c');
const BARK = shades('#24170e', '#3a2616', '#53361f', '#6e4a2b');

class Px {
  d: Uint8ClampedArray<ArrayBuffer>;
  constructor(public w: number, public h: number) { this.d = new Uint8ClampedArray(w * h * 4); }
  set(x: number, y: number, c: RGBA | null) {
    if (!c || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = c[3];
  }
  get(x: number, y: number) { const i = (y * this.w + x) * 4; return this.d[i + 3]; }
  rect(x: number, y: number, w: number, h: number, c: RGBA) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c); }
  each(f: (x: number, y: number) => RGBA | null) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, f(x, y)); }
  /** Add a 1 px ink outline around everything painted so far. */
  outline(c: RGBA = INK) {
    const add: [number, number][] = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.get(x, y)) continue;
      if ((x > 0 && this.get(x - 1, y)) || (x < this.w - 1 && this.get(x + 1, y)) || (y > 0 && this.get(x, y - 1)) || (y < this.h - 1 && this.get(x, y + 1))) add.push([x, y]);
    }
    for (const [x, y] of add) this.set(x, y, c);
  }
  canvas(scale: number): HTMLCanvasElement {
    const base = document.createElement('canvas');
    base.width = this.w; base.height = this.h;
    base.getContext('2d')!.putImageData(new ImageData(this.d, this.w, this.h), 0, 0);
    if (scale === 1) return base;
    const c = document.createElement('canvas');
    c.width = this.w * scale; c.height = this.h * scale;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(base, 0, 0, c.width, c.height);
    return c;
  }
}

/** Distance from the nearest edge of a rounded rectangle (-1 outside). */
function rrd(x: number, y: number, w: number, h: number, r: number): number {
  const cx = Math.min(x, w - 1 - x), cy = Math.min(y, h - 1 - y);
  if (cx < r && cy < r) { const d = r - Math.hypot(r - cx - 0.5, r - cy - 0.5); return d < 0 ? -1 : Math.floor(d); }
  return Math.min(cx, cy);
}

/** Wood grain shade along one axis: long streaks, rings and pores. */
function grain(along: number, across: number, seed: number, ramp: RGBA[], base: number) {
  let v = base + (n1(across * 0.7 + seed * 3.1, seed) - 0.5) * 2.2 + (n1(along / 9 + across * 1.7, seed + 9) - 0.5) * 1.2;
  if (h2(Math.floor(along / 3), Math.floor(across), seed) > 0.93) v -= 1;
  if (h2(Math.floor(along), Math.floor(across), seed + 4) > 0.97) v += 1;
  return ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(v)))];
}

function nail(p: Px, x: number, y: number) {
  p.set(x, y, IRON[4]); p.set(x + 1, y, IRON[3]); p.set(x, y + 1, IRON[3]); p.set(x + 1, y + 1, IRON[1]);
  p.set(x - 1, y, IRON[2]); p.set(x, y - 1, IRON[5]);
}

// ---------------------------------------------------------------- frames

interface Frame { w: number; h: number; slice: [number, number, number, number]; fill: boolean; repeat?: string; paint(p: Px): void }
const F: Record<string, Frame> = {};

/** The main board: a beveled timber rim with grain, a recessed inner lip and iron corner brackets. */
function boardFrame(ramp: RGBA[], brackets: boolean, seed: number): Frame {
  const W = 44, S = 13;
  return {
    w: W, h: W, slice: [S, S, S, S], fill: false,
    paint(p) {
      p.each((x, y) => {
        const d = rrd(x, y, W, W, 4);
        if (d < 0) return null;
        if (d === 0) return INK;
        if (d >= S) return null;
        if (d === S - 1) return INK;
        if (d === S - 2) { const top = y < W / 2 && Math.abs(y - S + 2) <= Math.abs(x - S + 2) + 0.5; return top ? ramp[0] : ramp[ramp.length - 2]; }
        // which rim: horizontal grain on top/bottom, vertical on the sides, mitred at the corners
        const horiz = Math.min(y, W - 1 - y) <= Math.min(x, W - 1 - x);
        const along = horiz ? x : y, across = horiz ? Math.min(y, W - 1 - y) : Math.min(x, W - 1 - x);
        let base = 4 + (d === 1 ? 1.6 : d === 2 ? 0.8 : d >= S - 4 ? -0.8 : 0);
        if (horiz ? y < W / 2 : x < W / 2) base += 0.7; else base -= 0.9;
        // mitre seam
        if (Math.abs(Math.min(x, W - 1 - x) - Math.min(y, W - 1 - y)) < 0.5 && d > 1 && d < S - 2) return ramp[1];
        return grain(along, across, seed + (horiz ? 0 : 7), ramp, base);
      });
      if (!brackets) { for (const [x, y] of [[5, 5], [W - 7, 5], [5, W - 7], [W - 7, W - 7]]) nail(p, x, y); return; }
      for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        for (let j = 0; j < 11; j++) for (let i = 0; i < 11; i++) {
          if (i > 3 && j > 3) continue;
          const x = sx ? W - 2 - i : 1 + i, y = sy ? W - 2 - j : 1 + j;
          if (rrd(x, y, W, W, 4) <= 0) continue;
          const edge = i === 0 || j === 0 || (i === 3 && j > 3) || (j === 3 && i > 3) || i === 10 || j === 10;
          p.set(x, y, edge ? IRON[1] : (i + j) % 5 === 0 ? IRON[4] : IRON[i < 2 || j < 2 ? 3 : 2]);
        }
        nail(p, sx ? W - 4 : 2, sy ? W - 4 : 2);
        nail(p, sx ? W - 10 : 8, sy ? W - 4 : 2);
        nail(p, sx ? W - 4 : 2, sy ? W - 10 : 8);
      }
    },
  };
}
F.board = boardFrame(WOOD, true, 3);
F.boardDark = boardFrame(WALNUT.concat([WOOD[3], WOOD[4]]), false, 5);

/** Parchment with a torn, uneven edge and a darker deckle. */
F.parch = {
  w: 28, h: 28, slice: [9, 9, 9, 9], fill: false,
  paint(p) {
    p.each((x, y) => {
      const tear = Math.floor(h2(x + y * 3, 1, 8) * 2);
      const d = rrd(x, y, 28, 28, 3) - tear;
      if (d < 0) return null;
      if (d === 0) return PAPER[0];
      if (d === 1) return PAPER[1];
      if (d === 2) return PAPER[2];
      if (d >= 9) return null;
      const f = (h2(x, y, 3) - 0.5) * 1.4;
      return PAPER[Math.max(2, Math.min(6, Math.round(4.3 + f + (y < 14 ? 0.4 : -0.3))))];
    });
    // curled corner
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6 - i; j++) p.set(27 - 2 - i, 27 - 2 - j, j === 5 - i - 1 ? PAPER[1] : PAPER[5]);
  },
};
F.note = { ...F.parch, w: 20, h: 20, slice: [6, 6, 6, 6], paint(p) {
  p.each((x, y) => {
    const d = rrd(x, y, 20, 20, 2);
    if (d < 0) return null;
    if (d === 0) return WOOD[1];
    if (d === 1) return y < 10 ? PAPER[6] : PAPER[3];
    if (d >= 6) return null;
    return PAPER[Math.round(4.6 + (h2(x, y, 6) - 0.5))];
  });
  nail(p, 9, 2);
} };

/** A carved recess: dark well with the light catching its lower lip. */
function slotFrame(rim: RGBA[], well: RGBA[], gold: boolean): Frame {
  return {
    w: 22, h: 22, slice: [7, 7, 7, 7], fill: true,
    paint(p) {
      p.each((x, y) => {
        const d = rrd(x, y, 22, 22, 3);
        if (d < 0) return null;
        if (d === 0) return INK;
        if (d <= 2) {
          if (gold) return GOLD[(x + y) % 6 === 0 ? 6 : d === 1 ? (y < 11 ? 5 : 3) : 2];
          return grain(x + y, d, 4, rim, d === 1 ? 5 : 4);
        }
        if (d === 3) return INK;
        const top = Math.min(y, 21 - y) === d && y < 11, left = Math.min(x, 21 - x) === d && x < 11;
        if (d === 4) return top || left ? well[0] : well[3];
        return well[2 + ((h2(x, y, 2) > 0.85) ? 1 : 0)];
      });
      if (gold) for (const [x, y] of [[2, 2], [18, 2], [2, 18], [18, 18]]) { p.set(x, y, GOLD[6]); p.set(x + 1, y + 1, GOLD[1]); }
    },
  };
}
const WELL = shades('#4a3018', '#7a5a34', '#c7a874', '#d8bc88');
const WELL_ON = shades('#8a5c18', '#e8c070', '#fff0c4', '#fff6dc');
F.slot = slotFrame(WOOD, WELL, false);
F.slotOn = slotFrame(WOOD, WELL_ON, true);

/** Buttons: a painted plank slab with a raised base, so pressing it physically sinks. */
function buttonFrame(face: RGBA[], down: boolean): Frame {
  const W = 26, H = 30, base = 4;
  return {
    w: W, h: H, slice: [8, 9, 12, 9], fill: true,
    paint(p) {
      const off = down ? base : 0;
      p.each((x, y) => {
        const yy = y - off, hh = H - off - (down ? 0 : 0);
        if (yy < 0) return null;
        const d = rrd(x, yy, W, hh, 4);
        if (d < 0) return null;
        if (d === 0) return INK;
        const bottomZone = !down && yy >= hh - 1 - base;
        if (bottomZone) return yy === hh - 1 - base ? INK : grain(x, yy, 6, WOOD, 1.8);
        if (d === 1) return yy < 6 ? face[6] : x < 3 ? face[5] : face[3];
        if (d === 2 && yy < 6) return face[5];
        // face: soft gradient top to bottom with fine streaks like painted wood
        const t = yy / (hh - base), v = 4.6 - t * 1.4 + (n1(x * 0.6, 3) - 0.5) * 0.5 + (h2(x, yy >> 1, 7) > 0.92 ? -0.6 : 0);
        return face[Math.max(1, Math.min(6, Math.round(v)))];
      });
      // little brass rivets at the face corners
      for (const [x, y] of [[3, 3 + off], [W - 5, 3 + off]]) { p.set(x, y, GOLD[5]); p.set(x + 1, y + 1, GOLD[2]); }
    },
  };
}
const FACES: Record<string, RGBA[]> = {
  wood: shades('#4a2a14', '#6b3f1e', '#8a5528', '#a86c33', '#c48a4a', '#dca864', '#efc988'),
  leaf: shades('#173f1c', '#245a26', '#337a30', '#46983b', '#5fb44a', '#86cf63', '#b6eb8a'),
  berry: shades('#4a1014', '#6e1a1f', '#972a2c', '#b93a36', '#d65448', '#ee7f69', '#ffb39a'),
  gold: shades('#5c3606', '#8a5410', '#c2861e', '#e0a52a', '#f4c444', '#ffe07a', '#fff4bf'),
  sky: shades('#0f2a48', '#173f68', '#245b8c', '#3277b0', '#4a98d0', '#7cbde8', '#b8e2ff'),
  pap: shades('#7a5a34', '#a8875a', '#cdb07f', '#e2c99a', '#efdcb4', '#f8ecd0', '#fffaea'),
};
for (const [k, face] of Object.entries(FACES)) { F['btn_' + k] = buttonFrame(face, false); F['btn_' + k + '_down'] = buttonFrame(face, true); }

/** Speech bubble: warm white paper with a soft brown ink line. */
F.bubble = { w: 24, h: 24, slice: [8, 8, 8, 8], fill: true, paint(p) {
  p.each((x, y) => { const d = rrd(x, y, 24, 24, 6); if (d < 0) return null; if (d === 0) return WOOD[0]; if (d === 1 && y > 12) return PAPER[3]; return PAPER[6]; });
} };
/** Text field: a sheet of paper pressed into a wooden groove. */
F.field = { w: 16, h: 16, slice: [5, 5, 5, 5], fill: true, paint(p) {
  p.each((x, y) => { const d = rrd(x, y, 16, 16, 2); if (d < 0) return null; if (d === 0) return INK; if (d === 1) return y < 8 ? WOOD[2] : WOOD[5]; if (d === 2 && y < 8) return PAPER[3]; return PAPER[6]; });
} };
/** HUD tags and toasts: a dark walnut plaque with a lighter bevel and two brass pins. */
F.plaque = { w: 22, h: 22, slice: [7, 7, 7, 7], fill: true, paint(p) {
  p.each((x, y) => {
    const d = rrd(x, y, 22, 22, 3);
    if (d < 0) return null;
    if (d === 0) return INK;
    if (d === 1) return y < 11 ? WOOD[5] : WOOD[2];
    if (d === 2) return WOOD[1];
    return grain(x, y, 9, WALNUT, 3 + (y < 6 ? 0.6 : 0));
  });
  for (const [x, y] of [[3, 3], [17, 3]]) { p.set(x, y, GOLD[5]); p.set(x + 1, y + 1, GOLD[1]); }
} };
F.tab = buttonFrame(FACES.pap, false);
F.tabOn = buttonFrame(FACES.gold, true);

// ---------------------------------------------------------------- tiles

interface Tile { w: number; h: number; paint(p: Px): void }
const TILE: Record<string, Tile> = {
  /** Planks laid horizontally: seams, staggered butt joints with nails, grain and the odd knot. */
  planks: { w: 64, h: 40, paint(p) {
    const PH = 10;
    p.each((x, y) => {
      const row = Math.floor(y / PH), iy = y % PH, offs = [0, 37, 18, 51][row % 4], len = 64;
      const ax = (x + offs) % len;
      if (iy === 0) return WOOD[0];
      if (iy === 1) return WOOD[5];
      if (ax === 0) return WOOD[0];
      if (ax === 1) return WOOD[2];
      let base = 3.6 + (row % 2 ? 0.4 : -0.2) - (iy === PH - 1 ? 1 : 0);
      // knot: concentric rings round a dark core
      const kx = (row * 23 + 14) % 64, ky = row * PH + 5, kd = Math.hypot((x - kx) * 0.7, y - ky);
      if (row % 2 === 0 && kd < 3.2) return kd < 1.2 ? WOOD[0] : WOOD[kd < 2.2 ? 2 : 4];
      if (row % 2 === 0 && kd < 6) base += Math.sin(kd * 2.4) * 0.6;
      return grain(x + row * 40, iy + row * PH, row + 1, WOOD, base);
    });
    for (let row = 0; row < 4; row++) { const offs = [0, 37, 18, 51][row]; const jx = (64 - offs) % 64; nail(p, (jx + 3) % 64, row * 10 + 3); nail(p, (jx + 3) % 64, row * 10 + 7); }
  } },
  walnut: { w: 64, h: 40, paint(p) {
    p.each((x, y) => { const iy = y % 10; if (iy === 0) return WALNUT[0]; if (iy === 1) return WALNUT[4]; return grain(x + Math.floor(y / 10) * 30, y, 4, WALNUT, 2.6); });
  } },
  /** Parchment: fibres, faint stains and flecks. */
  paper: { w: 48, h: 48, paint(p) {
    p.each((x, y) => {
      let v = 4.7 + (h2(x >> 2, y >> 2, 2) - 0.5) * 0.5 + (h2(x, y, 5) - 0.5) * 0.6;
      if (h2(x, y, 11) > 0.985) v -= 1.4;
      if (h2(x >> 1, y, 13) > 0.97) v += 0.9;
      return PAPER[Math.max(2, Math.min(6, Math.round(v)))];
    });
  } },
};

// ---------------------------------------------------------------- sprites (decorations)

interface Sprite { w: number; h: number; paint(p: Px): void }
const SPR: Record<string, Sprite> = {};

function leafAt(p: Px, cx: number, cy: number, len: number, wid: number, ang: number, light: number) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  for (let y = Math.floor(cy - len); y <= cy + len; y++) for (let x = Math.floor(cx - len); x <= cx + len; x++) {
    const u = (x + 0.5 - cx) * ca + (y + 0.5 - cy) * sa, v = -(x + 0.5 - cx) * sa + (y + 0.5 - cy) * ca;
    const t = u / len;
    if (t < -0.05 || t > 1) continue;
    const half = wid * Math.sin(Math.min(1, t * 1.05) * Math.PI) * (t < 0.5 ? 1 : 1 - (t - 0.5) * 0.6);
    if (Math.abs(v) > half) continue;
    const vein = Math.abs(v) < 0.6 && t > 0.08;
    const side = v < 0 ? 1 : -0.6;
    p.set(x, y, vein ? LEAF[Math.min(6, light + 2)] : LEAF[Math.max(1, Math.min(6, Math.round(light + side * 0.8 - t * 0.6)))]);
  }
}

/** A trailing vine with leaves and a few berries, for panel corners. */
SPR.vine = { w: 56, h: 30, paint(p) {
  for (let x = 2; x < 54; x++) { const y = Math.round(6 + Math.sin(x / 7) * 2.4 + x * 0.08); p.set(x, y, LEAF[1]); p.set(x, y + 1, LEAF[0]); }
  const L: [number, number, number, number, number, number][] = [[4, 7, 9, 4, 1.2, 4], [12, 9, 8, 3.4, 2.2, 3], [19, 4, 8, 3.4, -0.9, 5], [27, 9, 9, 3.6, 1.9, 4], [34, 5, 7, 3, -1.1, 3], [42, 10, 8, 3.2, 1.6, 4], [49, 7, 6, 2.6, 0.6, 5], [8, 3, 7, 3, -2.2, 5], [31, 13, 7, 2.8, 2.6, 3]];
  for (const [x, y, l, w, a, li] of L) leafAt(p, x, y, l, w, a, li);
  for (const [x, y] of [[22, 15], [24, 17], [39, 16]]) { p.set(x, y, hexc('#d8343c')); p.set(x + 1, y, hexc('#ff7b6e')); p.set(x, y + 1, hexc('#8a1820')); p.set(x + 1, y + 1, hexc('#d8343c')); }
  p.outline();
} };

/** A sprig of three leaves with a little white flower, for smaller corners. */
SPR.sprig = { w: 22, h: 18, paint(p) {
  leafAt(p, 3, 12, 9, 3.2, -0.6, 4); leafAt(p, 6, 13, 8, 3, 0.4, 3); leafAt(p, 4, 9, 7, 2.6, -1.4, 5);
  const fl: [number, number][] = [[15, 4], [17, 5], [15, 7], [13, 5], [15, 5]];
  fl.forEach(([x, y], i) => { p.set(x, y, i === 4 ? GOLD[4] : PAPER[6]); p.set(x + 1, y, i === 4 ? GOLD[3] : PAPER[5]); p.set(x, y + 1, i === 4 ? GOLD[2] : PAPER[4]); p.set(x + 1, y + 1, i === 4 ? GOLD[3] : PAPER[5]); });
  p.outline();
} };

/** Rope for hanging signs. */
SPR.rope = { w: 4, h: 18, paint(p) { p.each((x, y) => (x === 0 || x === 3 ? INK : (x + y) % 3 === 0 ? hexc('#8a6a3a') : (x + y) % 3 === 1 ? hexc('#d4b072') : hexc('#b48c52'))); } };

/** Log slice token for the dock: bark rim, sapwood, growth rings and a crack. */
SPR.token = { w: 34, h: 34, paint(p) {
  const c = 16.5;
  p.each((x, y) => {
    const r = Math.hypot(x - c, y - c);
    if (r > 16.4) return null;
    if (r > 15.4) return INK;
    if (r > 13.2) return BARK[Math.round(1.5 + (h2(Math.floor(Math.atan2(y - c, x - c) * 9), 0, 2) - 0.5) * 2 + (y < c ? 0.6 : -0.6))];
    if (r > 12.4) return WOOD[6];
    const ring = Math.sin(r * 1.65 + n1(Math.atan2(y - c, x - c) * 3, 4) * 1.2);
    if (Math.abs(x - c - 4) < 0.8 && y > c && r > 3 && r < 12) return WOOD[2];
    return WOOD[Math.max(3, Math.min(7, Math.round(5.6 + ring * 0.9 - r * 0.03 + (y < c ? 0.3 : -0.2))))];
  });
} };
SPR.tail = { w: 10, h: 7, paint(p) { const rows = ['KPPPPPPPPK', '.KPPPPPPK.', '..KPPPPK..', '...KPPK...', '....KK....', '..........', '..........']; rows.forEach((r, y) => [...r].forEach((ch, x) => p.set(x, y, ch === 'K' ? WOOD[0] : ch === 'P' ? PAPER[6] : null))); } };

// ---------------------------------------------------------------- CSS

/** CSS px per art pixel. 2 keeps the pixel art fine-grained; the device factor makes it sharp. */
export const A = 2;
const DK = () => { const r = window.devicePixelRatio || 1; return Math.max(1, Math.min(3, Math.round(r))); };

const urls = new Map<string, string>();
function url(kind: string, name: string, painter: { w: number; h: number; paint(p: Px): void }) {
  const key = kind + name;
  let u = urls.get(key);
  if (!u) { const p = new Px(painter.w, painter.h); painter.paint(p); u = p.canvas(A * DK()).toDataURL(); urls.set(key, u); }
  return u;
}

function frameCss(name: string, important = true): string {
  const f = F[name], k = A * DK(), im = important ? ' !important' : '';
  const [t, r, b, l] = f.slice;
  return [
    `border-style:solid${im}`,
    `border-width:${t * A}px ${r * A}px ${b * A}px ${l * A}px${im}`,
    `border-image-source:url(${url('f', name, f)})${im}`,
    `border-image-slice:${t * k} ${r * k} ${b * k} ${l * k}${f.fill ? ' fill' : ''}${im}`,
    `border-image-width:${t * A}px ${r * A}px ${b * A}px ${l * A}px${im}`,
    `border-image-repeat:${f.repeat ?? 'stretch'}${im}`,
    'image-rendering:pixelated',
  ].join(';');
}
const tileCss = (name: string, extra = '') => `background:url(${url('t', name, TILE[name])}) 0 0/${TILE[name].w * A}px ${TILE[name].h * A}px repeat padding-box${extra};image-rendering:pixelated`;
export const spriteUrl = (name: string) => url('s', name, SPR[name]);
export const spriteSize = (name: string) => ({ w: SPR[name].w * A, h: SPR[name].h * A });

export function woodCss(): string {
  const rules: string[] = [];
  const R = (sel: string, css: string) => rules.push(`${sel}{${css}}`);
  // big boards with plank interiors; small ones are walnut plaques
  R('.fr.wood', frameCss('board') + ';' + tileCss('planks'));
  R('.fr.wood.sm', frameCss('boardDark') + ';' + tileCss('walnut'));
  R('.fr.paper', frameCss('parch') + ';' + tileCss('paper'));
  R('.fr.paper.sm, .task.fr.paper', frameCss('note') + ';' + tileCss('paper'));
  R('.fr.slot, .cell.fr.slot, .task .tick.fr.slot', frameCss('slot') + ';background:none');
  R('.fr.slot.on, .cell.fr.slot.on', frameCss('slotOn') + ';background:none');
  R('.fr.dark, .fr.dark.sm', frameCss('plaque') + ';background:none;color:#fff3dc');
  R('.fr.bubblef', frameCss('bubble'));
  R('.fr.field, .inp.fr.field', frameCss('field') + ';background:none');
  for (const k of Object.keys(FACES)) {
    const sel = k === 'wood' ? '.btn' : `.btn.${k}`;
    R(sel, frameCss('btn_' + k).replace(/border-image-source/, 'border-image-source'));
    R(`${sel}:active:not(:disabled), ${sel}.down`, `border-image-source:url(${url('f', 'btn_' + k + '_down', F['btn_' + k + '_down'])}) !important`);
  }
  R('.btn', 'border-image-outset:0;min-height:48px;padding:0 4px');
  R('.btn.tiny', 'min-height:40px;font-size:16px');
  R('.btn:active:not(:disabled) > *, .btn.down > *', `transform:translateY(${4 * A}px)`);
  R('.tabs .btn', frameCss('tab'));
  R('.tabs .btn.gold', frameCss('tabOn'));
  // decorations
  const vine = spriteSize('vine'), sprig = spriteSize('sprig'), rope = spriteSize('rope');
  R('.sheet::before, .modal::before', `content:'';position:absolute;left:${-4 * A}px;top:${-10 * A}px;width:${vine.w}px;height:${vine.h}px;background:url(${spriteUrl('vine')}) 0 0/100% 100%;image-rendering:pixelated;pointer-events:none;z-index:2`);
  R('.sheet::after, .modal::after', `content:'';position:absolute;right:${-3 * A}px;top:${-7 * A}px;width:${sprig.w}px;height:${sprig.h}px;background:url(${spriteUrl('sprig')}) 0 0/100% 100%;image-rendering:pixelated;transform:scaleX(-1);pointer-events:none;z-index:2`);
  R('.sheet > header h2', 'position:relative');
  R('.say::after', `background-image:url(${spriteUrl('tail')}) !important;width:${10 * A}px !important;height:${7 * A}px !important;margin-left:${-5 * A}px !important;bottom:${-6 * A - 2}px !important`);
  R('.hangs', 'position:relative');
  R('.hangs::before, .hangs::after', `content:'';position:absolute;top:${-rope.h + 6}px;width:${rope.w}px;height:${rope.h}px;background:url(${spriteUrl('rope')}) 0 0/100% 100%;image-rendering:pixelated`);
  R('.hangs::before', 'left:22%');
  R('.hangs::after', 'right:22%');
  return rules.join('\n');
}
