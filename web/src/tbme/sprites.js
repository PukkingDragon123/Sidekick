// Pixel-art UI sprites for "The Bear Must Eat".
//
// Public API (unchanged):
//   SPRITES            name -> { w, h, rows, pal, alpha? }  (built lazily on first access)
//   FOX_EXPRESSIONS    ['smug', 'greedy', ...]; portraits are SPRITES['fox_' + expr]
//   hasSprite(name)
//   spriteCanvas(name, scale = 1)  -> cached <canvas>
//   spriteURL(name, scale = 1)     -> cached data: URL
//   spriteImg(name, scale = 2, cls = '') -> '<img class="px ...">' HTML
//   foxPortraitURL(expr = 'smug', scale = 4)
//
// Sprites are authored as rows of characters. Each character maps (through a
// per-sprite key) to either a flat colour or to a *material*: a hue-shifted
// 6-tone ramp (shadows cooler, highlights warmer). Material pixels are shaded
// automatically with light from the top-left, using the pixel's position
// inside its region; details can pin an exact tone ('gold:5'). A 1px outline
// darkened from the local colour is added around the silhouette, and 'k'
// pixels become inner lines darkened from their neighbours.
//
// Everything is plain data until a sprite is first read; canvases are built
// on first render and cached. Importing this module never touches the DOM.
import { FACE3D } from './faceHook.js'; // [v26 faces3d] character faces are 3D renders (src/ui/faces3d.js)

// ===========================================================================
// COLOUR
// ===========================================================================
const INK = [42, 26, 20]; // #2a1a14 warm near-black

function rgb(h) {
  let s = h.replace('#', '');
  if (s.length <= 4) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, s.length >= 8 ? parseInt(s.slice(6, 8), 16) : 255];
}
function hex(c) {
  return '#' + ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1);
}
function mix(a, b, t) {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

// Hue-shifted ramps, dark -> light. Tone 3 is the base colour, 1..5 are used
// by automatic shading, tone 0 is the deepest shade (inner lines).
const RAMPS = {
  gold: ['#7a4a12', '#b0661a', '#e5a320', '#ffd23f', '#ffe98a', '#fffbe0'],
  brass: ['#3a2610', '#5c4219', '#8d6c32', '#b8924c', '#dcbd72', '#f6e6ac'],
  copper: ['#4a1e14', '#74301e', '#a04a2a', '#c86a3a', '#e8945a', '#fcc490'],
  wood: ['#3b2414', '#55331a', '#6b4220', '#8b5a2b', '#a86d38', '#c98f55'],
  lwood: ['#5a3418', '#7c4c26', '#a06a36', '#c28a4c', '#dcaa6a', '#f0cf98'],
  dwood: ['#1f120b', '#2e1b10', '#3b2414', '#51321b', '#6b4220', '#8b5a2b'],
  parch: ['#8a6a44', '#c4a672', '#e2c992', '#f3e2b8', '#fbf0d0', '#fffaf0'],
  cream: ['#7a5e48', '#a88a6a', '#d4b894', '#eedcbc', '#f9efdc', '#ffffff'],
  white: ['#50506a', '#8286a0', '#b4b8cc', '#dcdfea', '#f2f4f9', '#ffffff'],
  red: ['#4e1422', '#80202e', '#b0303a', '#d9453b', '#f07a52', '#ffb888'],
  pink: ['#6a2448', '#a03c68', '#d0608a', '#f08aa8', '#fab6c8', '#ffe0ea'],
  orange: ['#6a2410', '#9c3a14', '#cc5a1c', '#ee7e2a', '#faa650', '#ffd08a'],
  fox: ['#5e220e', '#8e3414', '#c2501c', '#e8702c', '#f99a4c', '#ffc680'],
  yellow: ['#7c4a10', '#b27414', '#e0a01e', '#ffcc34', '#ffe478', '#fff8c8'],
  honey: ['#5e2806', '#8e420a', '#c0680e', '#e8921a', '#f8b840', '#ffdc80'],
  green: ['#1f3f2c', '#255a3c', '#2f6f4a', '#3f8f5f', '#6cc08a', '#aee6b0'],
  leaf: ['#173628', '#1f5236', '#2a723e', '#46963c', '#7cbe46', '#c2e274'],
  olive: ['#2a2e14', '#434a1c', '#626a26', '#869034', '#aab44c', '#d4dc80'],
  mint: ['#1c4a44', '#2a6e60', '#3c9a80', '#62c4a2', '#98e2c0', '#d4f8e4'],
  teal: ['#123840', '#1a5660', '#20807c', '#30ad9c', '#68d6bc', '#b2f2dc'],
  blue: ['#1a2658', '#223e84', '#2c60b2', '#3c88d8', '#6cb6ee', '#b8e6fa'],
  sky: ['#26508e', '#3576b8', '#4e9cd8', '#7cc2ee', '#b0e0f8', '#eafaff'],
  water: ['#16304e', '#1e4a72', '#28699a', '#3a8cbc', '#62b4d8', '#a4dcee'],
  navy: ['#10142e', '#1a2046', '#252e62', '#334080', '#4a5ca2', '#7488c6'],
  purple: ['#26163e', '#3a2262', '#54328c', '#7050b8', '#9a7ed8', '#cdb8f4'],
  plum: ['#23122e', '#3a1d46', '#542a62', '#6e3a7e', '#8e56a0', '#b680c4'],
  lilac: ['#3e2e6a', '#5c4896', '#7e6ac0', '#a092e0', '#c4baf2', '#ece6ff'],
  steel: ['#262838', '#40445a', '#62687e', '#8c92aa', '#bcc2d4', '#eef0f8'],
  iron: ['#141218', '#201e28', '#2e2c38', '#43414f', '#5e5c6c', '#858394'],
  stone: ['#302c34', '#4a444e', '#696270', '#8e8690', '#b4aab0', '#d8d0cc'],
  slate: ['#1c2230', '#2a3446', '#3c4a60', '#54667e', '#7890a4', '#a8bccc'],
  black: ['#0e0c12', '#17141d', '#221e2a', '#2f2a38', '#443e50', '#625a70'],
  bear: ['#351f14', '#4e2e1e', '#6a4128', '#8a5a38', '#aa7a4e', '#c89e6c'],
  tan: ['#5e3c26', '#8c6040', '#b88a60', '#dab284', '#eed0a4', '#faeacc'],
  skin: ['#6a3a2a', '#9a5a42', '#c88262', '#eaa884', '#f8c8a4', '#ffe6cc'],
  leather: ['#2a1810', '#442618', '#623822', '#84502e', '#a66e42', '#c8905c'],
  fire: ['#6e1a0e', '#b43414', '#e8601a', '#ffa028', '#ffd24c', '#fff6c0'],
  glass: ['#2a4c6e', '#4a7ca4', '#78aed2', '#a6d4ec', '#d2eefa', '#ffffff'],
  ice: ['#3a6a9a', '#5a92c0', '#86bce0', '#b4dcf2', '#dcf2fc', '#ffffff'],
  lime: ['#2e4a10', '#467014', '#62981e', '#88c02c', '#b4e04a', '#e2f89a'],
  bone: ['#6a5a48', '#948068', '#bcaa8c', '#dccfb2', '#f0e8d4', '#fffdf4'],
  ink: ['#08080a', '#141418', '#26262c', '#3c3c44', '#5c5c66', '#8a8a94'],
  grey: ['#2c2c30', '#4a4a50', '#707076', '#9a9aa0', '#c4c4c8', '#ececee'],
  moss: ['#1a2e1a', '#26422a', '#345a34', '#4c7a40', '#6e9c52', '#9cc070'],
  sand: ['#6a4e30', '#98744a', '#c4a068', '#e2c48c', '#f2dcaa', '#fcf0d0'],
  rose: ['#5a1428', '#8a1e3a', '#bc2c4c', '#e04a64', '#f47c8c', '#ffb4bc'],
  syrup: ['#3a1606', '#62280a', '#8c3e0e', '#b65e18', '#dc8a32', '#f6c070'],
  straw: ['#5a3a12', '#86581c', '#b27e2a', '#d6a444', '#ecc66c', '#fae6a4'],
  glyph: ['#6a5448', '#b4a292', '#dccdb6', '#f6ecd8', '#fffaee', '#ffffff'],
  bberry: ['#1a1840', '#28266a', '#3a3c96', '#5058c0', '#7a86dc', '#b4c0f4'],
  cinnamon: ['#4a2210', '#733618', '#9c5024', '#c47a3a', '#e3a462', '#f4d29c'],
  blackbear: ['#16121c', '#221c2a', '#302838', '#443a4e', '#5e5268', '#7c7088'],
  grizzly: ['#2e2016', '#4a3424', '#6a4c34', '#8c6848', '#b08c68', '#cfb08a'],
  polar: ['#6a7088', '#9aa2b8', '#c4cad8', '#e4e8f0', '#f4f6fa', '#ffffff'],
  cub: ['#4a2c16', '#6e4424', '#94603a', '#b67c46', '#d8a068', '#f0c890'],
  dkbear: ['#24160e', '#3a2416', '#52341f', '#6e472c', '#8c603c', '#aa7c52'],
  beaver: ['#2e160c', '#4a2414', '#6a361c', '#8a4c28', '#aa6a3c', '#c88c58'],
  furw: ['#5e4e4c', '#a0928e', '#cfc5bf', '#efe8e2', '#faf6f2', '#ffffff'],
  denim: ['#1a2440', '#26365e', '#344c80', '#4866a2', '#6a88c0', '#9cb4dc'],
};
const RAMP_RGB = {};
function ramp(name) {
  let r = RAMP_RGB[name];
  if (!r) {
    const src = RAMPS[name];
    if (!src) throw new Error('unknown ramp ' + name);
    r = RAMP_RGB[name] = src.map(rgb);
  }
  return r;
}

// ===========================================================================
// CHARACTER GRID (authoring surface)
// ===========================================================================
class Grid {
  constructor(w, h, fill = '.') {
    this.w = w;
    this.h = h;
    this.c = new Array(w * h).fill(fill);
  }
  static from(rows) {
    const h = rows.length;
    let w = 0;
    for (const r of rows) w = Math.max(w, r.length);
    const g = new Grid(w, h);
    rows.forEach((r, y) => {
      for (let x = 0; x < r.length; x++) g.c[y * w + x] = r[x];
    });
    g.bad = rows.some((r) => r.length !== w);
    return g;
  }
  in(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x, y) {
    return this.in(x, y) ? this.c[y * this.w + x] : '.';
  }
  set(x, y, ch) {
    x = Math.round(x);
    y = Math.round(y);
    if (this.in(x, y)) this.c[y * this.w + x] = ch;
    return this;
  }
  rect(x, y, w, h, ch) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, ch);
    return this;
  }
  // filled ellipse; centre/radii in pixel units, a pixel is in if its centre is
  ellipse(cx, cy, rx, ry, ch, only) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1 + 0.35 / Math.max(rx, ry)) {
          if (only && !only.includes(this.get(x, y))) continue;
          this.c[y * this.w + x] = ch;
        }
      }
    return this;
  }
  // filled polygon (pixel centres inside, even-odd)
  poly(pts, ch, only) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const px = x + 0.5, py = y + 0.5;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i], [xj, yj] = pts[j];
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside && (!only || only.includes(this.get(x, y)))) this.c[y * this.w + x] = ch;
      }
    return this;
  }
  line(x0, y0, x1, y1, ch) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, ch);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }
  // paint rows at (x, y); '.' keeps, '_' erases; map optionally renames chars
  stamp(x, y, rows, map) {
    rows.forEach((r, j) => {
      for (let i = 0; i < r.length; i++) {
        let ch = r[i];
        if (ch === '.') continue;
        if (ch === '_') ch = '.';
        else if (map && ch in map) ch = map[ch];
        this.set(x + i, y + j, ch);
      }
    });
    return this;
  }
  text(x, y, str, font, ch) {
    let cx = x;
    for (const c of str) {
      const gl = font.g[c] || font.g['?'];
      if (gl) this.stamp(cx, y, gl.map((r) => r.replace(/#/g, ch)));
      cx += (gl ? gl[0].length : font.w) + font.sp;
    }
    return this;
  }
  replace(from, to) {
    for (let i = 0; i < this.c.length; i++) if (from.includes(this.c[i])) this.c[i] = to;
    return this;
  }
  rows() {
    const out = [];
    for (let y = 0; y < this.h; y++) out.push(this.c.slice(y * this.w, (y + 1) * this.w).join(''));
    return out;
  }
}

// Row helpers kept from the original authoring style
function patch(rows, patches) {
  const g = Grid.from(rows);
  for (const [px, py, pr] of patches) g.stamp(px, py, pr);
  return g.rows();
}
function flipX(rows) {
  return rows.map((r) => r.split('').reverse().join(''));
}
function flipY(rows) {
  return rows.slice().reverse();
}

// ===========================================================================
// RGBA PIXEL BUFFER (render target, post-processing)
// ===========================================================================
class Pix {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  in(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  a(x, y) {
    return this.in(x, y) ? this.d[(y * this.w + x) * 4 + 3] : 0;
  }
  get(x, y) {
    const i = (y * this.w + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }
  put(x, y, c, a = 255) {
    if (!this.in(x, y)) return;
    const i = (y * this.w + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a;
  }
  // source-over composite of colour c with alpha a (0..255)
  over(x, y, c, a = 255) {
    if (!this.in(x, y) || a <= 0) return;
    const i = (y * this.w + x) * 4;
    const da = this.d[i + 3] / 255, sa = a / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    for (let k = 0; k < 3; k++) this.d[i + k] = Math.round((c[k] * sa + this.d[i + k] * da * (1 - sa)) / oa);
    this.d[i + 3] = Math.round(oa * 255);
  }
  // draw another Pix onto this one
  draw(src, ox = 0, oy = 0) {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const i = (y * src.w + x) * 4;
        if (src.d[i + 3]) this.over(x + ox, y + oy, [src.d[i], src.d[i + 1], src.d[i + 2]], src.d[i + 3]);
      }
    return this;
  }
  clone() {
    const p = new Pix(this.w, this.h);
    p.d.set(this.d);
    return p;
  }
  // grow the canvas by (l, t, r, b) transparent pixels
  pad(l, t = l, r = l, b = t) {
    const p = new Pix(this.w + l + r, this.h + t + b);
    return p.draw(this, l, t);
  }
}

// ===========================================================================
// RENDER: grid + key -> Pix
// ===========================================================================
// key values:
//   'line'                    inner line darkened from the neighbours ('k' by default)
//   '#rrggbb' / '#rrggbbaa'   flat colour
//   'ramp[:tone][.mode][@group][!]'
//       tone  0..5 pins a ramp tone (otherwise shaded automatically)
//       mode  r round (default) | x varies across (vertical form) | y varies down
//             (horizontal form) | i inset/recessed | f flat with 1px bevel | s solid
//       group pixels shade together when their group matches (default: the ramp;
//             an explicit group is shared across ramps)
//       !     casts no outline
const GLOBAL_KEY = { k: 'line', K: '#2a1a14', '+': '#fffcf0', '*': '#ffffff' };
const SPEC_CACHE = new Map();
function parseSpec(s) {
  let sp = SPEC_CACHE.get(s);
  if (sp) return sp;
  let noOl = false;
  let t = s;
  if (t.endsWith('!')) { noOl = true; t = t.slice(0, -1); }
  if (t === 'line') sp = { kind: 'line', noOl };
  else if (t[0] === '#') {
    const c = rgb(t);
    sp = { kind: 'hex', c: c.slice(0, 3), a: c[3], g: 'h' + t, noOl };
  } else {
    const m = /^([a-z]+)(?::(\d))?(?:\.([a-z]))?(?:@(\w+))?$/i.exec(t);
    if (!m) throw new Error('bad key spec ' + s);
    sp = { kind: 'mat', tones: ramp(m[1]), tone: m[2] != null ? +m[2] : -1, mode: m[3] || 'r', g: m[4] ? '@' + m[4] : m[1], a: 255, noOl };
    // pinned tones without an explicit group are details: they count as part of
    // whatever form surrounds them when shading
    sp.wild = sp.tone >= 0 && !m[4];
  }
  SPEC_CACHE.set(s, sp);
  return sp;
}

// Tone from the pixel's position in its region (u/d/l/r = run lengths to the
// region edge). Round forms get concentric bands around a light point up-left
// of centre; cylinders get bands along one axis. Upper-case modes are glossy
// (they also get the brightest tone as a specular spot).
const BANDS = { m: [0, 0.62, 1.12, 1.5], g: [0.3, 0.66, 1.12, 1.5] };
function shadeTone(mode, u, d, l, r, K) {
  if (mode === 's') return 3;
  if (mode === 'f' || mode === 'F') {
    const s = (u === 0) + (l === 0) - (d === 0) - (r === 0);
    return 3 + Math.sign(s) + (mode === 'F' && u === 0 && l === 0 ? 1 : 0);
  }
  const ty = ((u + 0.5) / (u + d + 1)) * 2 - 1; // -1 top .. 1 bottom
  const tx = ((l + 0.5) / (l + r + 1)) * 2 - 1;
  const lo = mode.toLowerCase();
  const gloss = mode !== lo;
  let dist;
  if (lo === 'x') dist = Math.abs(tx + 0.42) * 1.35 + Math.max(0, ty) * 0.25;
  else if (lo === 'y') dist = Math.abs(ty + 0.42) * 1.35 + Math.max(0, tx) * 0.25;
  else if (lo === 'i') dist = Math.hypot(tx - 0.42, ty - 0.5) * 0.9 + 0.25;
  else dist = Math.hypot(tx + 0.4, ty + 0.5);
  dist *= K / 3;
  const b = gloss ? BANDS.g : BANDS.m;
  if (dist < b[0]) return 5;
  if (dist < b[1]) return 4;
  if (dist < b[2]) return 3;
  if (dist < b[3]) return 2;
  return 1;
}

function render(g, key = {}, opt = {}) {
  const W = g.w, H = g.h, N = W * H;
  const K = key === GLOBAL_KEY ? key : { ...GLOBAL_KEY, ...key };
  const spec = new Array(N).fill(null);
  const local = {};
  for (let i = 0; i < N; i++) {
    const ch = g.c[i];
    if (ch === '.' || ch === ' ') continue;
    let s = local[ch];
    if (!s) {
      const def = K[ch];
      if (def == null) {
        (render.warn || []).push(`unknown char '${ch}'`);
        s = { kind: 'hex', c: [255, 0, 255], a: 255, g: '?' };
      } else s = parseSpec(def);
      local[ch] = s;
    }
    spec[i] = s;
  }
  const col = new Array(N).fill(null);
  const alpha = new Uint8Array(N);
  const inG = (x, y, gr) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const q = spec[y * W + x];
    return !!q && (q.g === gr || !!q.wild);
  };
  const kk = opt.k || 3;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x, s = spec[i];
      if (!s || s.kind === 'line') continue;
      alpha[i] = s.a;
      if (s.kind === 'hex') { col[i] = s.c; continue; }
      let t = s.tone;
      if (t < 0) {
        const G = s.g;
        let u = 0, d = 0, l = 0, r = 0;
        while (inG(x, y - u - 1, G)) u++;
        while (inG(x, y + d + 1, G)) d++;
        while (inG(x - l - 1, y, G)) l++;
        while (inG(x + r + 1, y, G)) r++;
        t = shadeTone(s.mode, u, d, l, r, kk);
      }
      col[i] = s.tones[t];
    }
  // inner lines
  const N4 = [[0, -1], [-1, 0], [1, 0], [0, 1]];
  const N8 = [...N4, [-1, -1], [1, -1], [-1, 1], [1, 1]];
  const darkOf = (s, c, f) => (s.kind === 'mat' ? (f < 0.7 ? s.tones[0] : mix(s.tones[0], INK, 0.5)) : mix(c, INK, f));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x, s = spec[i];
      if (!s || s.kind !== 'line') continue;
      let best = null;
      for (const nb of [N4, N8]) {
        for (const [dx, dy] of nb) {
          const X = x + dx, Y = y + dy;
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          const j = Y * W + X, sj = spec[j];
          if (!sj || sj.kind === 'line' || !col[j]) continue;
          const c = darkOf(sj, col[j], opt.lineF || 0.62);
          if (!best || lum(c) < lum(best)) best = c;
        }
        if (best) break;
      }
      col[i] = best || INK;
      alpha[i] = 255;
    }
  // outline
  const ol = opt.ol === undefined ? 'sel' : opt.ol;
  if (ol) {
    const nb = opt.ol8 ? N8 : N4;
    const add = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (spec[i]) continue;
        let best = null;
        for (const [dx, dy] of nb) {
          const X = x + dx, Y = y + dy;
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          const j = Y * W + X, sj = spec[j];
          if (!sj || sj.noOl || !col[j]) continue;
          const c = ol === 'ink' ? INK : sj.kind === 'line' ? mix(col[j], INK, 0.45) : darkOf(sj, col[j], 0.8);
          if (!best || lum(c) < lum(best)) best = c;
        }
        if (best) add.push([i, typeof ol === 'string' && ol[0] === '#' ? rgb(ol) : best]);
      }
    for (const [i, c] of add) { col[i] = c; alpha[i] = 255; }
  }
  const p = new Pix(W, H);
  for (let i = 0; i < N; i++) if (col[i]) {
    p.d[i * 4] = col[i][0]; p.d[i * 4 + 1] = col[i][1]; p.d[i * 4 + 2] = col[i][2]; p.d[i * 4 + 3] = alpha[i];
  }
  return p;
}

// ===========================================================================
// REGISTRY (lazy)
// ===========================================================================
export const SPRITES = {};
const BUILDERS = new Map();
const BUILD_WARN = [];

// sprite storage chars ('.' is transparent)
const CHARS = (() => {
  let s = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&*+,-/:;<=>?@^_`~|';
  for (let c = 0xc0; c < 0x250; c++) s += String.fromCharCode(c);
  return s;
})();

function finalize(p) {
  const { w, h, d } = p;
  const map = new Map();
  const pal = {};
  let alpha = null;
  let n = 0;
  const rows = [];
  for (let y = 0; y < h; y++) {
    let s = '';
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, a = d[i + 3];
      if (!a) { s += '.'; continue; }
      const k = ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | a) >>> 0;
      let ch = map.get(k);
      if (!ch) {
        ch = CHARS[n++] || '?';
        map.set(k, ch);
        pal[ch] = hex([d[i], d[i + 1], d[i + 2]]);
        if (a < 255) (alpha || (alpha = {}))[ch] = Math.round((a / 255) * 1000) / 1000;
      }
      s += ch;
    }
    rows.push(s);
  }
  const out = { w, h, rows, pal };
  if (alpha) out.alpha = alpha;
  Object.defineProperty(out, 'px', { value: p, enumerable: false });
  return out;
}

function reg(name, build) {
  BUILDERS.set(name, build);
  Object.defineProperty(SPRITES, name, {
    enumerable: true,
    configurable: true,
    get() {
      let s;
      try {
        render.warn = [];
        s = finalize(build());
        for (const w of render.warn) BUILD_WARN.push(name + ': ' + w);
      } catch (e) {
        BUILD_WARN.push(name + ': ' + e.message);
        s = placeholder();
      }
      Object.defineProperty(SPRITES, name, { value: s, enumerable: true, configurable: true, writable: false });
      return s;
    },
  });
}

// icon(name, key, rows, opt) - rows art with a key; opt.post(pix) post-process
function icon(name, key, rows, opt = {}) {
  reg(name, () => {
    const g = Grid.from(typeof rows === 'function' ? rows() : rows);
    if (g.bad) render.warn.push('ragged rows');
    let p = render(g, key, opt);
    if (opt.post) p = opt.post(p);
    return p;
  });
}
// draw(name, fn) - fn() returns a Pix
function draw(name, fn) {
  reg(name, fn);
}

// ===========================================================================
// ICONS
// ===========================================================================
//@@ART_BEGIN@@
// --- authoring helpers -------------------------------------------------------
// T('gold') -> { 0: 'gold:0', ..., 5: 'gold:5' }; chars remap tones (' '/'.' skip)
function T(r, chars = '012345', g = '') {
  const o = {};
  for (let i = 0; i < 6; i++) if (chars[i] && chars[i] !== ' ' && chars[i] !== '.') o[chars[i]] = r + ':' + i + (g ? '@' + g : '');
  return o;
}
// replace '#' in hand-drawn shape rows with a char
const R = (rows, ch) => rows.map((r) => r.replace(/#/g, ch));
// direction of the light (up-left) used by the procedural shaders
const LX = -0.6, LY = -0.8;

// Five-point star with bevelled facets lit from the top-left; pick(tone, x, y) -> char
function starFacets(g, cx, cy, Ro, Ri, pick) {
  const rot = -Math.PI / 2;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5, rr = i % 2 ? Ri : Ro;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  const tmp = new Grid(g.w, g.h).poly(pts, '#');
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      if (tmp.get(x, y) !== '#') continue;
      let a = Math.atan2(y + 0.5 - cy, x + 0.5 - cx) - rot;
      a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const seg = Math.floor(a / (Math.PI / 5)) % 10;
      const tip = seg % 2 === 0 ? pts[seg] : pts[(seg + 1) % 10];
      const inner = seg % 2 === 0 ? pts[(seg + 1) % 10] : pts[seg];
      const rx = tip[0] - cx, ry = tip[1] - cy, rl = Math.hypot(rx, ry);
      const ux = rx / rl, uy = ry / rl;
      const ix = inner[0] - cx, iy = inner[1] - cy, dp = ix * ux + iy * uy;
      let nx = ix - dp * ux, ny = iy - dp * uy;
      const nl = Math.hypot(nx, ny);
      nx /= nl; ny /= nl;
      const lit = nx * LX + ny * LY;
      const tone = lit > 0.6 ? 5 : lit > 0.2 ? 4 : lit > -0.2 ? 3 : lit > -0.6 ? 2 : 1;
      g.set(x, y, pick(tone, x, y));
    }
  return g;
}

// A gold coin face: bright rim lit from the top-left, an engraved groove and a
// recessed field. Paints tone digits '1'..'5' (use with T('gold')).
function coinFace(g, cx, cy, Rr, thick = 1.6) {
  const inC = (x, y, ox, oy) => {
    const dx = x + 0.5 - ox, dy = y + 0.5 - oy;
    return dx * dx + dy * dy <= Rr * Rr + 0.3 * Rr;
  };
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) if (inC(x, y, cx, cy + thick)) g.set(x, y, y + 0.5 > cy + thick + Rr * 0.55 ? '1' : '2');
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      if (!inC(x, y, cx, cy)) continue;
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy);
      const lit = r > 0 ? (dx * LX + dy * LY) / r : 0;
      let t;
      if (r > Rr - 1.75) t = lit > 0.8 && r > Rr - 1.1 ? 5 : lit > 0.1 ? 4 : lit > -0.55 ? 3 : 2;
      else if (r > Rr - 2.6) t = lit > -0.2 ? 2 : 4;
      else t = lit < -0.35 && r > Rr - 3.8 ? 4 : 3;
      g.set(x, y, String(t));
    }
  return g;
}

// deterministic RNG (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// egg silhouette: narrower, taller top half
function eggShape(g, cx, cy, rx, rt, rb, ch, only) {
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const ry = dy < 0 ? rt : rb;
      const k = dy < 0 ? 1 - 0.2 * Math.min(1, -dy / rt) : 1;
      const ex = dx / (rx * k), ey = dy / ry;
      if (ex * ex + ey * ey <= 1 + 0.3 / rx && (!only || only.includes(g.get(x, y)))) g.set(x, y, ch);
    }
  return g;
}
// petals: n discs around (cx, cy); chars can be a string (one per petal)
function petals(g, cx, cy, n, dist, r, chars, rot = -Math.PI / 2) {
  for (let k = 0; k < n; k++) {
    const a = rot + (k * 2 * Math.PI) / n;
    g.ellipse(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, r, r, chars[k % chars.length]);
  }
  return g;
}

// Paint a shape (mask(x, y) -> bool) with ch; where it overlaps something drawn
// earlier, a 'k' line is left around it so the layers stay readable.
function layer(g, mask, ch, line = 'k') {
  const m = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (mask(x, y)) m[y * g.w + x] = 1;
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      if (m[y * g.w + x]) continue;
      const nb = (x > 0 && m[y * g.w + x - 1]) || (x < g.w - 1 && m[y * g.w + x + 1]) || (y > 0 && m[(y - 1) * g.w + x]) || (y < g.h - 1 && m[(y + 1) * g.w + x]);
      if (nb && g.get(x, y) !== '.') g.set(x, y, line);
    }
  for (let i = 0; i < m.length; i++) if (m[i]) g.c[i] = ch;
  return g;
}
const discMask = (cx, cy, rx, ry = rx) => (x, y) => {
  const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
  return dx * dx + dy * dy <= 1 + 0.35 / Math.max(rx, ry);
};

// thick straight segment (quad) from (x0, y0) to (x1, y1)
function bar(g, x0, y0, x1, y1, w, ch, only) {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * (w / 2), ny = (dx / l) * (w / 2);
  return g.poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], ch, only);
}
// rotated rectangle centred at (cx, cy): length along angle a, width across
function rrect(g, cx, cy, a, len, wid, ch, only) {
  const ux = Math.cos(a), uy = Math.sin(a);
  return bar(g, cx - ux * len / 2, cy - uy * len / 2, cx + ux * len / 2, cy + uy * len / 2, wid, ch, only);
}

// --- money & ratings --------------------------------------------------------
icon('coin', T('gold'), () => {
  const g = coinFace(new Grid(20, 20), 10, 9.3, 8.1, 1.7);
  // engraved maple leaf
  g.stamp(6, 4, [
    '....1....',
    '..1.1.1..',
    '..11111..',
    '1.11111.1',
    '.1111111.',
    '..11111..',
    '....1....',
    '....1....',
  ]);
  return g.rows();
});

icon('coins', { ...T('gold'), k: 'line' }, () => {
  const g = new Grid(20, 20);
  // a stack of four coins seen from the side, the top one showing its face
  for (let k = 0; k < 4; k++) {
    const yb = 17 - k * 3;
    for (let y = yb - 2; y <= yb; y++)
      for (let x = 1; x <= 12; x++) {
        if (y === yb && (x === 1 || x === 12)) continue;
        g.set(x, y, y === yb - 2 ? '4' : y === yb - 1 ? '3' : '2');
      }
    for (let x = 2; x <= 11; x += 2) g.set(x, yb - 1, '2');
    g.set(1, yb - 2, '5');
  }
  g.stamp(1, 2, [
    '...444444...',
    '.4455555544.',
    '453333333342',
    '.4333333332.',
    '...222222...',
  ]);
  // a loose coin in front
  coinFace(g, 14, 12.6, 5.1, 1.3);
  return g.rows();
});

const STAR_KEY = { ...T('gold', '.12345'), a: 'stone:1', b: 'stone:2', c: 'stone:2', d: 'stone:3', e: 'stone:4' };
const goldT = (t) => String(Math.min(t, 4));
icon('star', STAR_KEY, () => starFacets(new Grid(20, 20), 10, 10.7, 9.1, 4.3, goldT).set(7, 6, '5').rows());
icon('star_empty', STAR_KEY, () => starFacets(new Grid(20, 20), 10, 10.7, 9.1, 4.3, (t) => ' abcde'[t]).rows());
icon('star_half', STAR_KEY, () => starFacets(new Grid(20, 20), 10, 10.7, 9.1, 4.3, (t, x) => (x < 10 ? goldT(t) : ' abcde'[t])).set(7, 6, '5').rows());

const HEART = [
  '....................',
  '....................',
  '...####......####...',
  '..######....######..',
  '.########..########.',
  '.##################.',
  '.##################.',
  '.##################.',
  '.##################.',
  '..################..',
  '...##############...',
  '....############....',
  '.....##########.....',
  '......########......',
  '.......######.......',
  '........####........',
  '.........##.........',
  '....................',
  '....................',
  '....................',
];
icon('heart', { R: 'red.R' }, () => Grid.from(R(HEART, 'R')).set(4, 4, '+').set(3, 5, '+').rows());

icon('heart_broken', { R: 'red.R@a', Q: 'red.R@b' }, () => {
  const src = Grid.from(R([
    '....................',
    '....................',
    '...####.....####....',
    '..######...######...',
    '.########.########..',
    '.#################..',
    '.#################..',
    '.#################..',
    '.#################..',
    '..###############...',
    '...#############....',
    '....###########.....',
    '.....#########......',
    '......#######.......',
    '.......#####........',
    '........###.........',
    '.........#..........',
    '....................',
    '....................',
    '....................',
  ], 'R'));
  const split = { 4: 9, 5: 10, 6: 9, 7: 8, 8: 9, 9: 10, 10: 9, 11: 8, 12: 9, 13: 10, 14: 9, 15: 9, 16: 9 };
  const g = new Grid(20, 20);
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      if (src.get(x, y) === '.') continue;
      const s = split[y] ?? 9;
      if (x < s) g.set(x, y, 'R');
      else if (x > s) g.set(x + 1, y + 1, 'Q');
    }
  return g.set(4, 4, '+').set(3, 5, '+').rows();
});

icon('trophy', { G: 'gold.R', g: 'gold:1', i: 'gold:2', H: 'gold.R@h', S: 'gold.x@s', B: 'gold.y@b', W: 'wood.F', p: 'gold:4@p', q: 'gold:2@p', s: 'gold:5', d: 'gold:2' }, [
  '....................',
  '....GGGGGGGGGGGG....',
  '...GgggggiiiiiiGG...',
  '.HHHGGggiiiiiiGGHHH.',
  '.H..GGGGGGGGGGGG..H.',
  '.H..GGGGGsdGGGGG..H.',
  '..H.GGGGsssdGGGG.H..',
  '...HHGGGGsdGGGGHH...',
  '.....GGGGGGGGGG.....',
  '......GGGGGGGG......',
  '.......GGGGGG.......',
  '........SSSS........',
  '.........SS.........',
  '.........SS.........',
  '........BBBB........',
  '......BBBBBBBB......',
  '.....WWWWWWWWWW.....',
  '.....WWWppppWWW.....',
  '.....WWWqqqqWWW.....',
  '....................',
]);

icon('crown', { G: 'gold.R', B: 'gold.y@band', o: 'gold.R@ball', r: 'red.R@gem', b: 'blue.R@gem', g: 'mint.R@gem', v: 'red:1', V: 'red:2' }, [
  '....................',
  '....................',
  '.........oo.........',
  '..oo.....oo.....oo..',
  '..oo....GGGG....oo..',
  '..GG....GGGG....GG..',
  '..GGGvVGGGGGGVvGGG..',
  '..GGGGvGGGGGGvGGGG..',
  '..GGGGGGGGGGGGGGGG..',
  '..GGGGGGGGGGGGGGGG..',
  '..GGGGGGGGGGGGGGGG..',
  '..BBBBBBBBBBBBBBBB..',
  '..BrrBBBBbbBBBBggB..',
  '..BrrBBBBbbBBBBggB..',
  '..BBBBBBBBBBBBBBBB..',
  '..GGGGGGGGGGGGGGGG..',
  '....................',
  '....................',
  '....................',
  '....................',
]);

icon('shield', { S: 'steel.R', R: 'red.r', L: 'gold.R@leaf', r: 'steel:5' }, [
  '....................',
  '..SSSSSSSSSSSSSSSS..',
  '..SrSRRRRRRRRRRSrS..',
  '..SSRRRRRRRRRRRRSS..',
  '..SRRRRRRLRRRRRRRS..',
  '..SRRRRRLLLRRRRRRS..',
  '..SRRRLRLLLRLRRRRS..',
  '..SRRRLLLLLLLRRRRS..',
  '..SRRRRLLLLLRRRRRS..',
  '..SRRRRRRLRRRRRRRS..',
  '..SRRRRRRLRRRRRRRS..',
  '...SRRRRRRRRRRRRS...',
  '...SRRRRRRRRRRRRS...',
  '....SRRRRRRRRRRS....',
  '....SSRRRRRRRRSS....',
  '.....SSRRRRRRSS.....',
  '......SSRRRRSS......',
  '........SSSS........',
  '....................',
  '....................',
]);

icon('clover', { A: 'leaf.r@a', B: 'leaf.r@b', C: 'leaf.r@c', D: 'leaf.r@d', v: 'leaf:4', S: 'leaf.x@stem' }, [
  '....................',
  '...AAA.....BBB......',
  '..AAAAA...BBBBB.....',
  '..AAAAAA.BBBBBB.....',
  '...AAvAA.BBvBB......',
  '.AA.AAvA.BvBB.BB....',
  'AAAAAAAvAvBBBBBBB...',
  'AAAAvvvv.vvvvBBBB...',
  '.AAAAAAA.BBBBBBB....',
  '.........S..........',
  '.CCCCCCC.DDDDDDD....',
  'CCCCvvvv.vvvvDDDD...',
  'CCCCCCCvDvDDDDDDD...',
  '.CC.CCvC.DvDD.DD....',
  '...CCvCC.DDvDD......',
  '..CCCCCC.DDDDDDS....',
  '..CCCCC...DDDDSS....',
  '...CCC.....DDS.S....',
  '.............SS.....',
  '..............S.....',
]);

icon('sparkle', { Y: 'yellow.R', y: 'yellow.R@s', w: '#ffffff' }, () => {
  const g = new Grid(20, 20);
  const astro = (cx, cy, r, ch) => {
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 20; x++) {
        const dx = Math.abs(x + 0.5 - cx) / r, dy = Math.abs(y + 0.5 - cy) / r;
        if (Math.pow(dx, 0.55) + Math.pow(dy, 0.55) <= 1) g.set(x, y, ch);
      }
  };
  astro(8.5, 11.5, 8.2, 'Y');
  astro(15.5, 4.5, 3.9, 'y');
  g.set(7, 10, 'w').set(8, 10, 'w').set(8, 11, 'w').set(7, 11, '+');
  g.set(16, 16, 'y').set(17, 15, 'y').set(15, 15, 'y').set(16, 14, 'y').set(16, 15, 'y');
  return g.rows();
});

icon('bolt', { Y: 'yellow.R' }, R([
  '....................',
  '...........######...',
  '..........######....',
  '.........######.....',
  '........######......',
  '.......######.......',
  '......######........',
  '.....############...',
  '....############....',
  '...############.....',
  '.........#####......',
  '........#####.......',
  '.......#####........',
  '......####..........',
  '.....####...........',
  '.....###............',
  '....###.............',
  '....##..............',
  '....#...............',
  '....................',
], 'Y'));

icon('beauty', { p: 'pink.r@p', P: 'pink.R@in', y: 'gold.R@c', t: 'pink.x@t1', u: 'pink.x@t2', k: 'line' }, () => {
  const g = new Grid(20, 20);
  g.poly([[6.5, 10], [10, 11], [7.5, 19], [5.5, 17.5], [3.2, 18.6]], 't');
  g.poly([[13.5, 10], [10, 11], [12.5, 19], [14.5, 17.5], [16.8, 18.6]], 'u');
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    g.ellipse(10 + Math.cos(a) * 5.6, 8.6 + Math.sin(a) * 5.6, 2.5, 2.5, 'p');
  }
  g.ellipse(10, 8.6, 6, 6, 'p');
  g.ellipse(10, 8.6, 4.6, 4.6, 'k');
  g.ellipse(10, 8.6, 3.9, 3.9, 'P');
  g.ellipse(10, 8.6, 2.3, 2.3, 'y');
  return g.rows();
});

icon('grade', { P: 'cream.f', l: 'slate:3', m: 'slate:2', r: 'red:3', f: 'cream:2', F: 'cream:4' }, [
  '....................',
  '..PPPPPPPPPPPPff....',
  '..PPPPPPPPPPPPfFf...',
  '..PmmmmmmmPPPPfffF..',
  '..PPPPPPPPPPPPPPPP..',
  '..PllllPllllllPPPP..',
  '..PPPPPPPPPPPPPPPP..',
  '..PlllllPlllllPPPP..',
  '..PPPPPPPPPPPPPPPP..',
  '..PllllPlllPPPPPPP..',
  '..PPPPPPPrrrPPPPPP..',
  '..PlllPPrrPrrPPrPP..',
  '..PPPPPPrrPrrPrrrP..',
  '..PllllPrrrrrPPrPP..',
  '..PPPPPPrrPrrPPPPP..',
  '..PlllPPrrPrrPPPPP..',
  '..PPPPPPPPPPPPPPPP..',
  '..PPPPPPPPPPPPPPPP..',
  '....................',
  '....................',
]);

// --- pond life, snacks & plants ----------------------------------------------
const FISH_ROWS = [
  '....................',
  '....................',
  '........FfF.........',
  '.......FfFfF........',
  '......BBBBBBBBB.....',
  '.TT..BBBBBBBBBBBB...',
  '.TtT.BBsBBBBBkBBBB..',
  '..TtBBBBBBsBBBkBweB.',
  '..TtBBBsBBBBBBkBeeB.',
  '..TtBBBBBBBsBBkBBBB.',
  '..TtbbbbbbbbbbkbbBm.',
  '.TtTbbbbbbbbbbbbbb..',
  '.TT..bbbbFFbbbbbb...',
  '.......bbbFfbbbb....',
  '.........FF.........',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
];
icon('fish', { B: 'blue.r@body', b: 'sky.r@body', s: 'blue:2', F: 'blue.r@fin', f: 'blue:2@fin', T: 'blue.x@tail', t: 'blue:2@tail', e: '#1a1420', w: '#ffffff', m: 'line' },
  () => Grid.from(FISH_ROWS).rows().map((r, y) => (y < 2 ? r : r)).slice(0, 20).map((r, y, a) => a[(y + 18) % 20]));

icon('fish_gold', { B: 'gold.R@body', b: 'yellow.R@body', s: 'gold:2', F: 'gold.r@fin', f: 'gold:2@fin', T: 'gold.x@tail', t: 'gold:2@tail', e: '#3a1a08', w: '#ffffff', m: 'line', Y: 'yellow:5' },
  () => {
    const g = Grid.from(FISH_ROWS.map((r, y, a) => a[(y + 18) % 20]));
    g.stamp(15, 0, ['.Y.', 'YwY', '.Y.']);
    g.stamp(1, 15, ['.Y.', 'YwY', '.Y.']);
    return g.rows();
  });

icon('egg', { E: 'cream.R', d: 'syrup:3', D: 'syrup:2' }, () => {
  const g = eggShape(new Grid(20, 20), 10, 11.2, 6.6, 9, 7.2, 'E');
  const r = rng(11);
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(4 + r() * 12), y = Math.floor(3 + r() * 15);
    if (g.get(x, y) !== 'E' || (x < 8 && y < 9)) continue;
    g.set(x, y, r() < 0.4 ? 'D' : 'd');
    if (r() < 0.25 && g.get(x + 1, y) === 'E') g.set(x + 1, y, 'd');
  }
  return g.rows();
});

icon('honey', { r: 'red.r@cloth', w: 'cream:4@cloth', s: 'tan:3', G: 'glass.x@rim', H: 'honey.R@jar', h: 'honey:5', L: 'parch.f@lab', y: 'yellow:3', K: '#2a1a14', v: 'glass:4', d: 'honey:4' }, [
  '....................',
  '......rrrrrrrr......',
  '.....rwrrwrrwrr.....',
  '....rrwrrwrrwrrw....',
  '....wrrrwrrrwrrr....',
  '.....ssssssssss.....',
  '......GGGGGGGG......',
  '....HHHHdHHHHHHH....',
  '...HHHHHdHHHHHHHH...',
  '..HhHLLLLLLLLLLHHH..',
  '..HhHLLLLvvLLLLHHH..',
  '..HhHLLLyKyKLLLHHH..',
  '..HhHLLLLLLLLLLHHH..',
  '..HHHHHHHHHHHHHHHH..',
  '...HHHHHHHHHHHHHH...',
  '....HHHHHHHHHHHH....',
  '......HHHHHHHH......',
  '....................',
  '....................',
  '....................',
]);

icon('syrup', { r: 'red.R@cap', q: 'red:2@cap', g: 'syrup.x@neck', S: 'syrup.R@body', h: 'syrup.r@h', L: 'parch.f@lab', m: 'red.r@leaf' }, [
  '....................',
  '........rrrr........',
  '........qqqq........',
  '........gggg.hhh....',
  '........gggghh..h...',
  '.......SSSSSS...h...',
  '.....SSSSSSSSSSh....',
  '....SSSSSSSSSSSS....',
  '...SSSSSSSSSSSSSS...',
  '...SSLLLLLLLLLLSS...',
  '...SSLLLLmmLLLLSS...',
  '...SSLLmLmmLmLLSS...',
  '...SSLLmmmmmmLLSS...',
  '...SSLLLmmmmLLLSS...',
  '...SSLLLLmmLLLLSS...',
  '....SSSSSSSSSSSS....',
  '.....SSSSSSSSSS.....',
  '.......SSSSSS.......',
  '....................',
  '....................',
]);

icon('berry', { A: 'denim.r@a', B: 'denim.r@b', C: 'denim.r@c', c: 'navy:1', n: 'lilac:4', L: 'leaf.r@l', v: 'leaf:4', s: 'olive.x@s' }, () => {
  const g = new Grid(20, 20);
  g.line(10, 5, 13, 2, 's').line(11, 5, 14, 2, 's');
  g.poly([[13, 3], [18.6, 0.8], [17.6, 6.2], [14, 6.4]], 'L');
  g.line(14, 5, 17, 2, 'v');
  g.ellipse(10.5, 8, 3.9, 3.9, 'C');
  g.ellipse(6.4, 12.6, 4.7, 4.7, 'A');
  g.ellipse(13.8, 13.2, 4.4, 4.4, 'B');
  // crowns + bloom
  g.stamp(9, 5, ['c.c', '.c.']);
  g.stamp(5, 9, ['c.c', '.c.']);
  g.stamp(13, 10, ['c.c', '.c.']);
  g.set(4, 12, 'n').set(4, 13, 'n').set(12, 12, 'n').set(9, 7, 'n');
  return g.rows();
});

icon('seaweed', { A: 'leaf.x@a', a: 'leaf:4', B: 'olive.x@b', b: 'olive:4', C: 'leaf.x@c', c: 'lime:4', r: 'stone.r@r1', R: 'stone.r@r2', s: 'sand.r@s' }, () => {
  const g = new Grid(20, 20);
  const blade = (x0, top, ph, amp, w0, ch, rib) => {
    for (let y = top; y <= 16; y++) {
      const t = (y - top) / (16 - top);
      const x = x0 + Math.sin(y * 0.55 + ph) * amp * (1 - t * 0.5);
      const w = 0.6 + t * w0;
      const xa = Math.round(x - w), xb = Math.round(x + w);
      for (let xx = xa; xx <= xb; xx++) g.set(xx, y, ch);
      if (xb - xa >= 2 && y > top + 1) g.set(Math.round(x), y, rib);
    }
  };
  blade(4.5, 5, 0.5, 1.6, 1.3, 'B', 'b');
  blade(15, 3, 2.0, 1.5, 1.3, 'C', 'c');
  blade(9.8, 1, 4.0, 1.9, 1.6, 'A', 'a');
  g.ellipse(10, 17.7, 8.8, 1.7, 's');
  g.ellipse(5, 17, 3.1, 1.8, 'r');
  g.ellipse(15.2, 17.3, 3.3, 1.6, 'R');
  return g.rows();
});

icon('bug', { E: 'teal.R@eye', B: 'teal.x@body', b: 'teal:2@body', W: 'glass.r@w1', V: 'glass.r@w2', X: 'glass.r@w3', Y: 'glass.r@w4', v: 'glass:2', w: '#ffffff' }, () => {
  const g = new Grid(20, 20);
  g.ellipse(5.3, 5.2, 4.6, 1.8, 'W');
  g.ellipse(14.7, 5.2, 4.6, 1.8, 'V');
  g.ellipse(5.8, 8.3, 4.1, 1.6, 'X');
  g.ellipse(14.2, 8.3, 4.1, 1.6, 'Y');
  g.line(2, 5, 8, 5, 'v').line(12, 5, 17, 5, 'v').line(3, 8, 8, 8, 'v').line(12, 8, 16, 8, 'v');
  g.rect(9, 4, 2, 6, 'B');
  for (let y = 10; y < 19; y++) { g.set(9, y, y % 2 ? 'B' : 'b'); g.set(10, y, y % 2 ? 'B' : 'b'); }
  g.set(9, 18, '.');
  g.ellipse(10, 2.9, 2.6, 1.9, 'E');
  g.set(8, 2, 'w').set(11, 2, 'w');
  return g.rows();
});

icon('flower', { 1: 'pink.r@p1', 2: 'pink.r@p2', 3: 'pink.r@p3', 4: 'pink.r@p4', 5: 'pink.r@p5', 6: 'lilac.r@q1', 7: 'lilac.r@q2', 8: 'lilac.r@q3', 9: 'lilac.r@q4', 0: 'lilac.r@q5', y: 'yellow.R@c1', z: 'yellow.R@c2', S: 'leaf.x@s', L: 'leaf.r@l', M: 'leaf.r@m' }, () => {
  const g = new Grid(20, 20);
  g.line(7, 9, 9, 18, 'S').line(15, 12, 11, 18, 'S');
  g.ellipse(4.6, 15.2, 3.2, 1.5, 'L');
  g.ellipse(15, 16.4, 3, 1.4, 'M');
  petals(g, 14.6, 11, 5, 2.3, 1.9, '67890', -Math.PI / 2 + 0.6);
  g.ellipse(14.6, 11, 1.2, 1.2, 'z');
  petals(g, 7, 7, 5, 3.3, 2.6, '12345');
  g.ellipse(7, 7, 1.8, 1.8, 'y');
  return g.rows();
});

icon('lilypad', { G: 'leaf.r@pad', v: 'leaf:2', P: 'pink.r@f1', Q: 'pink.r@f2', p: 'pink:5', y: 'yellow.R@c' }, () => {
  const g = new Grid(20, 20);
  g.ellipse(10.5, 12.6, 8.6, 5.9, 'G');
  g.poly([[10.5, 12.6], [20, 12.2], [20, 16.8]], '.');
  for (const [x, y] of [[3, 12], [6, 17], [12, 18], [16, 9], [9, 7]]) g.line(10.5, 12.6, x, y, 'v');
  // water lily
  const cx = 7.5, cy = 8.4;
  for (let k = 0; k < 6; k++) {
    const a = Math.PI + (k / 5) * Math.PI;
    g.poly([[cx, cy], [cx + Math.cos(a - 0.3) * 2.2, cy + Math.sin(a - 0.3) * 2.2], [cx + Math.cos(a) * 5, cy + Math.sin(a) * 4.2], [cx + Math.cos(a + 0.3) * 2.2, cy + Math.sin(a + 0.3) * 2.2]], k % 2 ? 'P' : 'Q');
  }
  g.ellipse(cx, cy + 0.6, 3.6, 1.8, 'P');
  g.ellipse(cx, cy - 0.2, 1.4, 1, 'y');
  g.set(5, 6, 'p').set(9, 5, 'p');
  return g.rows();
});

icon('cattail', { S: 'olive.x@s', H: 'leather.X@h1', I: 'leather.X@h2', J: 'leather.X@h3', L: 'leaf.x@l1', M: 'leaf.x@l2', N: 'leaf.x@l3', t: 'olive:4' }, () => {
  const g = new Grid(20, 20);
  // stalks
  g.line(8, 2, 8, 18, 'S').line(14, 4, 13, 18, 'S').line(4, 8, 5, 18, 'S');
  // velvety heads
  g.rect(7, 4, 3, 7, 'H').set(7, 4, 'S').set(9, 4, 'S');
  g.rect(13, 6, 3, 6, 'I').set(13, 6, 'S').set(15, 6, 'S');
  g.rect(3, 10, 3, 5, 'J').set(3, 10, 'S').set(5, 10, 'S');
  g.set(8, 1, 't').set(14, 3, 't').set(4, 7, 't');
  // leaves
  g.line(10, 18, 17, 9, 'L').line(11, 18, 17, 10, 'L');
  g.line(6, 18, 1, 11, 'M').line(7, 18, 2, 11, 'M');
  g.line(9, 18, 11, 12, 'N');
  return g.rows();
});

icon('willow', { C: 'leaf.r@c', S: 'lime.x@s', W: 'wood.x@t', g: 'moss.r@g' }, () => {
  const g = new Grid(20, 20);
  g.ellipse(10, 18.4, 7, 1.3, 'g');
  g.rect(9, 7, 3, 11, 'W').set(8, 17, 'W').set(12, 17, 'W');
  g.ellipse(10, 6, 8.4, 4.8, 'C');
  const lens = [11, 14, 16, 13, 16, 12, 15, 16, 13, 11];
  for (let i = 0; i < 9; i++) {
    const x = 2 + i * 2;
    if (x === 10) continue;
    g.line(x, 6, x, lens[i], 'S');
  }
  return g.rows();
});

icon('hive', { 1: 'straw.y@b1', 2: 'straw.y@b2', 3: 'straw.y@b3', 4: 'straw.y@b4', 5: 'straw.y@b5', 6: 'straw.y@b6', D: 'dwood:1', W: 'wood.F@base', y: 'yellow.R@bee', K: '#2a1a14', w: 'glass:5' }, () => {
  const g = new Grid(20, 20);
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      const dx = (x + 0.5 - 10) / 7.6, dy = (y + 0.5 - 12.6) / 9.4;
      if (y <= 16 && dx * dx + dy * dy <= 1.02) g.set(x, y, String(Math.max(1, Math.min(6, 1 + Math.floor((y - 3.2) / 2.3)))));
    }
  g.stamp(8, 13, ['.DD.', 'DDDD', 'DDDD', 'DDDD']);
  g.rect(2, 17, 16, 2, 'W');
  g.stamp(14, 1, ['.ww.', 'wwww', 'yKyK', '.yK.']);
  return g.rows();
});

icon('maple', { R: 'red.r', r: 'red:2', s: 'red:1' }, [
  '....................',
  '.........R..........',
  '........RRR.........',
  '....R...RRR...R.....',
  '....RR.RRRRR.RR.....',
  '.R..RRRRRRRRRRR..R..',
  '.RR.RRRRRRRRRRR.RR..',
  '..RRRRRRRrRRRRRRR...',
  'RRRRRRRRRrRRRRRRRRR.',
  '.RRRRRRrRrRrRRRRRR..',
  '..RRRRRRrrrRRRRRR...',
  '...RRRRRRrRRRRRR....',
  '....RRRRRrRRRRR.....',
  '...RRRRRRrRRRRRR....',
  '...RRR..RrR..RRR....',
  '.........s..........',
  '.........s..........',
  '.........s..........',
  '....................',
  '....................',
]);

icon('tree', { A: 'leaf.r@t1', B: 'leaf.r@t2', C: 'leaf.r@t3', W: 'wood.x@t', s: 'moss:2' }, [
  '....................',
  '.........A..........',
  '........AAA.........',
  '.......AAAAA........',
  '......AAAAAAA.......',
  '.....AAAAAAAAA......',
  '.......BBBBB........',
  '......BBBBBBB.......',
  '.....BBBBBBBBB......',
  '....BBBBBBBBBBB.....',
  '...BBBBBBBBBBBBB....',
  '......CCCCCCC.......',
  '.....CCCCCCCCC......',
  '....CCCCCCCCCCC.....',
  '...CCCCCCCCCCCCC....',
  '..CCCCCCCCCCCCCCC...',
  '........WWW.........',
  '........WWW.........',
  '.......sssss........',
  '....................',
]);

icon('wildrice', { S: 'olive.x@s', L: 'leaf.x@l', M: 'leaf.x@m', g: 'straw:4', G: 'straw:2', h: 'syrup:3', a: 'straw:5', W: 'water.y@w', w: 'water:5' }, () => {
  const g = new Grid(20, 20);
  g.ellipse(10, 17.4, 9.4, 2.3, 'W');
  g.line(3, 17, 6, 17, 'w').line(13, 18, 16, 18, 'w');
  g.line(9, 16, 3, 9, 'L');
  g.line(11, 16, 17, 10, 'M');
  const stalks = [[4, 16, 4, 6], [10, 16, 10, 2], [16, 16, 15, 5]];
  for (const [x0, y0, x1, y1] of stalks) {
    g.line(x0, y0, x1, y1, 'S');
    for (let k = 0; k < 6; k++) {
      const y = y1 + k;
      g.set(x1, y, k % 2 ? 'G' : 'g');
      if (k % 2 === 0) g.set(x1 - 1, y - 1, k % 4 ? 'h' : 'a');
      else g.set(x1 + 1, y - 1, k % 4 === 1 ? 'a' : 'h');
    }
  }
  return g.rows();
});

icon('mushroom', { C: 'orange.R@cap', c: 'orange:4@cap', u: 'orange:2@cap', S: 'cream.x@stem', s: 'cream:2@stem', G: 'leaf.r@g', g: 'leaf:4', L: 'wood.y@log', l: 'wood:2@log', r: 'lwood:4' }, [
  '....................',
  '....................',
  '.....CCCCCC.........',
  '...CCCCCCCCCC.......',
  '..CCCCCCCCCCCC......',
  '.CCCCCCCCCCCCCC.....',
  '.CCCCCCCCCCCCCC.....',
  '.uuuCCCCCCCCuuu.....',
  '...uuuuuuuuuu...CC..',
  '.....SSSSSS....CCCC.',
  '.....SSSSSS...CCCCCC',
  '.....SSSSSS...uuSSuu',
  '......SSSSS.....SS..',
  '......SSSSS.....SS..',
  '.....LLLLLLLLLLLLLL.',
  '....LLLLLLLLLLLLLLLr',
  '....LLllLLLLllLLLLLr',
  '....LLLLLLLLLLLLLLL.',
  '....................',
  '....................',
]);

icon('duckweed', { W: 'water.r@w', w: 'water:4', 1: 'lime.r@l1', 2: 'lime.r@l2', 3: 'lime.r@l3', 4: 'lime.r@l4', 5: 'lime.r@l5', 6: 'lime.r@l6', 7: 'lime.r@l7' }, () => {
  const g = new Grid(20, 20);
  g.ellipse(10, 11, 9.2, 7.2, 'W');
  g.line(3, 13, 6, 13, 'w').line(12, 16, 16, 16, 'w').line(4, 7, 6, 7, 'w');
  const leaves = [[6, 9, 2.4], [10.5, 7, 2.2], [14, 10, 2.5], [9, 12.5, 2.3], [5, 14.5, 1.8], [13.5, 14.6, 2.1], [16.2, 6.8, 1.6]];
  leaves.forEach(([x, y, r], i) => g.ellipse(x, y, r, r * 0.85, String(i + 1)));
  return g.rows();
});

icon('reeds', { A: 'leaf.x@a', B: 'olive.x@b', C: 'leaf.x@c', D: 'moss.x@d', P: 'straw.r@p1', Q: 'straw.r@p2', p: 'straw:5', W: 'water.y@w', w: 'water:5' }, () => {
  const g = new Grid(20, 20);
  g.ellipse(10, 18, 9.2, 1.6, 'W');
  g.line(4, 17, 5, 17, 'w');
  g.line(4, 18, 6, 5, 'A').line(5, 18, 6, 5, 'A');
  g.line(9, 18, 9, 2, 'B').line(10, 18, 10, 4, 'B');
  g.line(14, 18, 12, 6, 'C').line(15, 18, 13, 6, 'C');
  g.line(17, 18, 18, 9, 'D').line(2, 18, 1, 12, 'D');
  // feathery plumes nodding to the right
  g.poly([[6, 5.5], [7.5, 1.2], [10, 1.8], [8.6, 5.2]], 'P');
  g.poly([[12.5, 6.2], [14.4, 2.4], [16.8, 3.4], [14.6, 6.8]], 'Q');
  g.set(8, 2, 'p').set(15, 3, 'p');
  return g.rows();
});

icon('fern', { A: 'leaf.r@a', a: 'leaf.r@b', B: 'lime.r@c', b: 'lime.r@d', s: 'moss.x@s' }, () => {
  const g = new Grid(20, 20);
  const frond = (pts, big, c1, c2) => {
    for (let i = 0; i < pts.length - 1; i++) g.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 's');
    pts.forEach(([x, y], i) => {
      if (i === 0) return;
      const [px, py] = pts[i - 1];
      let dx = x - px, dy = y - py;
      const l = Math.hypot(dx, dy);
      dx /= l; dy /= l;
      const nx = -dy, ny = dx;
      const s = big * (1 - (i / pts.length) * 0.45);
      const last = i === pts.length - 1;
      if (last) { layer(g, discMask(x + dx * 1.2, y + dy * 1.2, s * 0.9, s * 0.9), c1); return; }
      layer(g, discMask(x + nx * s * 1.25 + dx * 0.5, y + ny * s * 1.25 + dy * 0.5, s, s * 0.85), i % 2 ? c1 : c2);
      layer(g, discMask(x - nx * s * 1.25 + dx * 0.5, y - ny * s * 1.25 + dy * 0.5, s, s * 0.85), i % 2 ? c2 : c1);
    });
    for (let i = 0; i < pts.length - 1; i++) g.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 's');
  };
  frond([[7, 19], [6, 16], [4.6, 13], [3.6, 10.2], [3.2, 7.4]], 1.45, 'B', 'b');
  frond([[8, 19], [9, 15.6], [11, 12.3], [13.4, 9.4], [15.6, 6.6], [17, 3.6]], 1.75, 'A', 'a');
  return g.rows();
});

icon('bone', { B: 'bone.r@b', b: 'bone:2', K: '#2a1a14' }, [
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '.............BBB....',
  '.B..B..B..B.BBBBB...',
  '.BB..B..B..BbBKKBB..',
  '..BB.B..B..BbBKKBBB.',
  '...BBBBBBBBBBBBBBBB.',
  '..BB.B..B..BbBBbbbB.',
  '.BB..B..B..BbBBBBB..',
  '.B..B..B..B.BBBBB...',
  '.............BBB....',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
].map((r, y, a) => a[(y + 19) % 20]));

icon('blood', { R: 'red.R' }, R([
  '....................',
  '.........#..........',
  '.........#..........',
  '........###.........',
  '........###.........',
  '.......#####........',
  '.......#####........',
  '......#######.......',
  '.....#########......',
  '.....#########......',
  '....###########.....',
  '....###########.....',
  '....###########.....',
  '....###########.....',
  '.....#########......',
  '.....#########......',
  '......#######.......',
  '........###.........',
  '....................',
  '....................',
], 'R').map((r, y) => (y === 9 ? r.slice(0, 7) + '++' + r.slice(9) : y === 10 ? r.slice(0, 6) + '+' + r.slice(7) : r)));

icon('pond', { W: 'water.r@w', w: 'water:5', v: 'water:4', G: 'leaf.r@g', s: 'sand.r@s', S: 'stone.r@st', T: 'stone.r@st2' }, () => {
  const g = new Grid(20, 20);
  g.ellipse(10, 11, 9.4, 7.6, 's');
  g.ellipse(10, 11, 8.2, 6.4, 'W');
  g.line(4, 9, 7, 9, 'w').line(11, 14, 15, 14, 'w').line(9, 6, 11, 6, 'v').line(5, 14, 7, 14, 'v');
  g.ellipse(14, 7.4, 2.4, 1.6, 'G');
  g.set(14, 7, '.');
  g.ellipse(3.2, 16.4, 2, 1.5, 'S');
  g.ellipse(16.8, 15.8, 1.8, 1.4, 'T');
  return g.rows();
});

// a glass fish tank on a wooden stand (the Tank tool / Glass Tank build)
icon('tank', { G: 'glass.x@g', g: 'glass:4', W: 'water.r@w', w: 'water:5', D: 'wood.F@stand', d: 'dwood:1', F: 'orange.R@fish', f: 'orange:2', e: '#1a1420', s: 'sand.r@s', p: 'leaf.r@p' }, () => {
  const g = new Grid(20, 20);
  g.rect(2, 3, 16, 11, 'G');
  g.rect(3, 5, 14, 8, 'W');
  g.rect(3, 12, 14, 1, 's');
  g.line(4, 6, 8, 6, 'w').line(11, 9, 14, 9, 'w');
  g.set(5, 11, 'p').set(5, 10, 'p').set(6, 9, 'p').set(14, 11, 'p').set(14, 10, 'p');
  g.rect(9, 8, 4, 2, 'F').set(13, 8, 'f').set(13, 9, 'f').set(8, 8, 'f').set(8, 9, 'f').set(11, 8, 'e');
  g.line(3, 4, 7, 4, 'g');
  g.rect(1, 14, 18, 2, 'D');
  g.rect(2, 16, 2, 3, 'd').rect(16, 16, 2, 3, 'd');
  return g.rows();
});

// --- tools & objects ---------------------------------------------------------
icon('hammer', { S: 'steel.R@head', s: 'steel:2', f: 'steel:4', W: 'lwood.x@h', G: 'leather.x@grip', g: 'leather:2' }, () => {
  const g = new Grid(20, 20);
  bar(g, 3.4, 17.6, 12.4, 8.6, 2.8, 'W');
  bar(g, 2.9, 18.1, 7, 14, 3.4, 'G');
  g.line(4, 16, 6, 14, 'g');
  rrect(g, 12.2, 7.8, Math.PI / 4, 12.2, 4.8, 'S');
  // claw notch at the lower-right end, face highlight at the upper-left end
  g.set(16, 12, '.').set(15, 13, '.').set(16, 13, '.');
  g.set(8, 3, 'f').set(9, 3, 'f');
  return g.rows();
});

icon('flask', { G: 'glass.X@g', L: 'lime.R@liq', l: 'lime:5', c: 'lwood.r@cork', b: 'glass:5', o: 'lime:5' }, () => {
  const g = new Grid(20, 20);
  g.poly([[7.6, 6.5], [12.4, 6.5], [17.2, 16.6], [16, 18.4], [4, 18.4], [2.8, 16.6]], 'G');
  g.rect(8, 3, 4, 4, 'G');
  g.rect(7, 1, 6, 2, 'c');
  for (let y = 11; y < 20; y++) for (let x = 0; x < 20; x++) if (g.get(x, y) === 'G') g.set(x, y, y === 11 ? 'l' : 'L');
  g.set(7, 14, 'o').set(12, 15, 'o').set(10, 13, 'o').set(13, 13, 'o');
  g.set(9, 8, 'b').set(11, 5, 'b').set(6, 12, 'b');
  return g.rows();
});

icon('shovel', { B: 'steel.R@blade', b: 'steel:2', W: 'lwood.x@shaft', H: 'lwood.r@grip', k: 'line' }, () => {
  const g = new Grid(20, 20);
  bar(g, 7.5, 12.5, 15.2, 4.8, 2.4, 'W');
  // D-grip
  bar(g, 14.2, 3.6, 17.8, 1.8, 1.8, 'H');
  bar(g, 15.8, 6.2, 18.2, 2.6, 1.8, 'H');
  // blade (rounded spade) pointing down-left
  g.poly([[5.2, 9.6], [10.4, 14.8], [8.2, 17.4], [4.2, 18.8], [2.2, 17.6], [1.2, 13.4]], 'B');
  g.line(6, 12, 3, 16, 'b');
  return g.rows();
});

icon('trash', { H: 'steel.R@h', L: 'steel.y@lid', B: 'steel.x@can', b: 'steel:2', f: 'steel:4' }, [
  '....................',
  '........HHHH........',
  '........H..H........',
  '..LLLLLLLLLLLLLLLL..',
  '..LLLLLLLLLLLLLLLL..',
  '....................',
  '...BBBBBBBBBBBBBB...',
  '...BBbBBbBBbBBbBB...',
  '...BBbBBbBBbBBbBB...',
  '...BBbBBbBBbBBbBB...',
  '...BBbBBbBBbBBbBB...',
  '...BBbBBbBBbBBbBB...',
  '....BbBBbBBbBBbB....',
  '....BbBBbBBbBBbB....',
  '....BbBBbBBbBBbB....',
  '....BBBBBBBBBBBB....',
  '.....BBBBBBBBBB.....',
  '....................',
  '....................',
  '....................',
].map((r, y, a) => a[(y + 19) % 20]));

icon('hand', { W: 'white.r@glove', w: 'white:2', C: 'white.y@cuff', c: 'white:2' }, [
  '....................',
  '........WW.WW.......',
  '.....WW.WW.WW.......',
  '.....WW.WW.WW.WW....',
  '.....WW.WW.WW.WW....',
  '.....WW.WW.WW.WW....',
  '.WW..WWWWWWWWWWW....',
  '.WWW.WWWWWWWWWWW....',
  '..WWWWWWWWWWWWWW....',
  '..WWWWWwWWwWWwWW....',
  '...WWWWwWWwWWwWW....',
  '....WWWwWWwWWwWW....',
  '.....WWWWWWWWWW.....',
  '.....CCCCCCCCCC.....',
  '....CCCCCCCCCCCC....',
  '....CcCCcCCcCCcC....',
  '....................',
  '....................',
  '....................',
  '....................',
].map((r, y, a) => a[(y + 19) % 20]));

icon('food', { F: 'tan.y@fold', f: 'tan:2', P: 'tan.r@bag', L: 'parch.f@lab', b: 'blue.r@fish', K: '#2a1a14', o: 'syrup.r@p1', O: 'syrup.r@p2', q: 'syrup.r@p3' }, [
  '....................',
  '.....FFFFFFFFFF.....',
  '.....ffffffffff.....',
  '....PPPPPPPPPPPP....',
  '....PPPPPPPPPPPP....',
  '....PLLLLLLLLLLP....',
  '....PLLLLbbbLLLP....',
  '....PLbLbbbbbLLP....',
  '....PLbbbbbbKbLP....',
  '....PLbLbbbbbLLP....',
  '....PLLLLbbLLLLP....',
  '....PLLLLLLLLLLP....',
  '....PPPPPPPPPPPP....',
  '....PPPPPPPPPPPP....',
  '...PPPPPPPPPPPPPP...',
  '...PPPPPPPPPPPPPP...',
  '....PPPPPPPPPPPP.oo.',
  '...............O.qq.',
  '..............OO....',
  '....................',
]);

icon('nurture', { R: 'rose.R@h', W: 'white.r@hand', w: 'white:2', C: 'white.y@cuff', s: 'yellow:5', y: 'yellow:3' }, [
  '....................',
  '....RRR....RRR......',
  '...RRRRR..RRRRR...s.',
  '...RRRRRRRRRRRR..sys',
  '...RRRRRRRRRRRR...s.',
  '....RRRRRRRRRR......',
  '.....RRRRRRRR.......',
  '......RRRRRR........',
  '.WW....RRRR.....WW..',
  '.WWW....RR.....WWW..',
  '..WWW.........WWWW..',
  '..WWWWW.....WWWWW...',
  '...WWWWWWWWWWWWWW...',
  '...WWWWwWWwWWwWW....',
  '....WWWWWWWWWWWW....',
  '.....CCCCCCCCCC.....',
  '.....CCCCCCCCCC.....',
  '....................',
  '....................',
  '....................',
]);

icon('tag', { R: 'red.f@tag', r: 'red:2', o: 'steel.r@eye', h: 'dwood:2', s: 'tan.x@str', w: 'cream:5', K: 'red:0' }, [
  '....................',
  '.s..................',
  '..s.................',
  '...s................',
  '....s...............',
  '.....s..RRRRRRRRRR..',
  '.....s.RRRRRRRRRRR..',
  '......RRRRRRRRRRRR..',
  '.....RRoooRRwwwwRR..',
  '....RRRohoRwKwwwwR..',
  '....RRRohoRRKwwwRR..',
  '.....RRoooRRRKRRRR..',
  '......RRRRRRRRRKRR..',
  '.......RRRRRRRRRRR..',
  '........RRRRRRRRRR..',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
].map((r, y, a) => a[(y + 18) % 20]));

icon('shop', { H: 'straw.R@h', A: 'cream.R@e1', B: 'sky.R@e2', C: 'tan.R@e3', d: 'syrup:3', W: 'straw.f@w1', V: 'straw:2', v: 'straw:4', M: 'straw.y@rim' }, () => {
  const g = new Grid(20, 20);
  // handle
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      const dx = (x + 0.5 - 10) / 7.2, dy = (y + 0.5 - 9.5) / 8.4;
      const r = dx * dx + dy * dy;
      if (y < 10 && r <= 1.02 && r >= 0.62) g.set(x, y, 'H');
    }
  eggShape(g, 7, 8.6, 2.6, 3.6, 2.8, 'A');
  eggShape(g, 13, 8.2, 2.6, 3.6, 2.8, 'B');
  eggShape(g, 10, 9.2, 2.6, 3.6, 2.8, 'C');
  g.set(9, 8, 'd').set(11, 9, 'd').set(10, 11, 'd');
  // basket
  g.poly([[1.5, 10.5], [18.5, 10.5], [16.2, 18.6], [3.8, 18.6]], 'W');
  for (let y = 12; y < 19; y++) for (let x = 0; x < 20; x++) if (g.get(x, y) === 'W') g.set(x, y, (Math.floor(x / 2) + y) % 2 ? 'V' : 'v');
  g.rect(1, 10, 18, 2, 'M');
  return g.rows();
});

icon('dna', { A: 'blue.x@a', B: 'rose.x@b', r: 'cream:4', R: 'cream:2' }, () => {
  const g = new Grid(20, 20);
  const pts = [];
  for (let y = 1; y <= 18; y++) {
    const s = Math.sin((y - 1) * 0.52);
    pts.push([y, 9.5 + 4.6 * s, 9.5 - 4.6 * s, Math.cos((y - 1) * 0.52)]);
  }
  // rungs first
  for (const [y, xa, xb] of pts) if (y % 2 === 0 && Math.abs(xa - xb) > 2.5) for (let x = Math.min(xa, xb) + 1; x < Math.max(xa, xb) - 0.5; x++) g.set(x, y, y % 4 ? 'r' : 'R');
  // back strand then front strand
  for (const front of [false, true])
    for (const [y, xa, xb, c] of pts) {
      const aFront = c > 0;
      if (aFront === front) g.rect(Math.round(xa - 1), y, 2, 1, 'A');
      if (!aFront === front) g.rect(Math.round(xb - 1), y, 2, 1, 'B');
    }
  return g.rows();
});

icon('palette', { W: 'lwood.r@p', w: 'lwood:2', r: 'red.R@1', y: 'yellow.R@2', b: 'blue.R@3', g: 'leaf.R@4', v: 'purple.R@5', h: 'white.R@6', S: 'wood.x@br', t: 'steel:3', T: 'black:4' }, () => {
  const g = new Grid(20, 20);
  g.ellipse(9.4, 10.6, 8.6, 7, 'W');
  g.ellipse(13.4, 14.2, 2.4, 1.8, '.');
  g.poly([[16, 11], [20, 9], [20, 13.5]], '.');
  g.ellipse(5.4, 8.4, 1.8, 1.8, 'r');
  g.ellipse(9.2, 6.2, 1.8, 1.7, 'y');
  g.ellipse(13.4, 7.2, 1.8, 1.7, 'b');
  g.ellipse(4.8, 12.8, 1.8, 1.7, 'g');
  g.ellipse(8.6, 15, 1.8, 1.6, 'v');
  g.ellipse(9.4, 10.6, 1.4, 1.3, 'h');
  // brush
  bar(g, 11, 12, 18.5, 2.5, 1.6, 'S');
  bar(g, 10.2, 13, 11.6, 11.2, 1.8, 't');
  g.set(9, 14, 'T').set(10, 13, 'T');
  return g.rows();
});

icon('gear', { G: 'steel.R', h: 'steel:1', H: 'steel:2' }, () => {
  const g = new Grid(20, 20);
  const cx = 10, cy = 10;
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx) + Math.PI / 8;
      const tooth = (((a / (Math.PI * 2)) * 8) % 1 + 1) % 1 < 0.5;
      if (r <= 6.4 || (tooth && r <= 9)) g.set(x, y, 'G');
      if (r <= 3.4 && r > 2.2) g.set(x, y, 'H');
      if (r <= 2.2) g.set(x, y, '.');
    }
  return g.rows();
});

icon('magnifier', { R: 'brass.R@ring', L: 'glass.r@lens', l: 'glass:5', W: 'wood.x@h', w: 'wood:4', b: 'brass.x@b' }, () => {
  const g = new Grid(20, 20);
  bar(g, 12, 12, 17.8, 17.8, 3.2, 'W');
  bar(g, 11.2, 11.2, 13.2, 13.2, 3.4, 'b');
  g.ellipse(8, 8, 6.8, 6.8, 'R');
  g.ellipse(8, 8, 4.8, 4.8, 'L');
  g.set(5, 5, 'l').set(6, 5, 'l').set(5, 6, 'l').set(7, 4, 'l');
  return g.rows();
});

icon('cursor_hand', { W: 'white.r@g', w: 'white:2', C: 'white.y@c' }, [
  '................',
  '....WW..........',
  '....WW..........',
  '....WW..........',
  '....WW.WW.......',
  '....WW.WW.WW....',
  '.WW.WWWWWWWWWW..',
  '.WWWWWWWWWWWWW..',
  '..WWWWWWWWWWWW..',
  '..WWWWWWWWWWWW..',
  '...WWWWWWWWWWW..',
  '....WWWWWWWWW...',
  '....WWWWWWWWW...',
  '....CCCCCCCCC...',
  '................',
  '................',
]);

icon('pen', { N: 'navy.R@body', g: 'gold.R@band', G: 'gold.R@nib', k: 'line', c: 'gold.x@clip' }, () => {
  const g = new Grid(20, 20);
  bar(g, 6.5, 13.5, 17.2, 2.8, 4, 'N');
  rrect(g, 9.4, 10.6, -Math.PI / 4, 1.4, 4.2, 'g');
  rrect(g, 14.6, 5.4, -Math.PI / 4, 1.4, 4.2, 'g');
  g.poly([[4.4, 12.4], [7.6, 15.6], [2, 18.8], [1.4, 18.2]], 'G');
  g.line(2, 18, 5, 15, 'k');
  bar(g, 16, 6.5, 18.2, 4.4, 1.2, 'c');
  return g.rows();
});

icon('paperclip', { S: 'steel.r@clip' }, () => {
  const g = new Grid(20, 20);
  // stylised clip: two nested stadium loops, tilted
  const P = [];
  const seg = (x0, y0, x1, y1) => { for (let i = 0; i <= 40; i++) P.push([x0 + (x1 - x0) * i / 40, y0 + (y1 - y0) * i / 40]); };
  const arc = (cx, cy, r, a0, a1) => { for (let i = 0; i <= 40; i++) { const a = a0 + (a1 - a0) * i / 40; P.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  seg(2.2, 4.5, 2.2, 13.5);
  arc(0.2, 13.5, 2, 0, Math.PI);
  seg(-1.8, 13.5, -1.8, 1.5);
  arc(1.2, 1.5, 3, Math.PI, Math.PI * 2);
  seg(4.2, 1.5, 4.2, 15);
  arc(1.2, 15, 3, 0, Math.PI);
  seg(-1.8, 15, -1.8, 13.8);
  const ca = Math.cos(0.45), sa = Math.sin(0.45);
  for (const [x, y] of P) {
    const X = 9.8 + (x - 1.2) * ca - (y - 8) * sa, Y = 10 + (x - 1.2) * sa + (y - 8) * ca;
    g.set(Math.floor(X), Math.floor(Y), 'S');
  }
  return g.rows();
});

icon('pushpin', { R: 'red.R@head', r: 'red.x@collar', S: 'steel.x@pin' }, () => {
  const g = new Grid(20, 20);
  bar(g, 3, 17, 8.6, 11.4, 1.3, 'S');
  rrect(g, 9.6, 10.4, -Math.PI / 4, 5.6, 2.6, 'r');
  g.ellipse(12.4, 7.4, 5.4, 5.4, 'R');
  return g.rows();
});

icon('clipboard', { W: 'wood.F@board', P: 'white.f@paper', S: 'steel.R@clip', s: 'steel:2', l: 'slate:4', b: 'slate:3', g: 'green:4', G: 'green:3' }, [
  '....................',
  '.......SSSSSS.......',
  '...WWWWSssssSWWWW...',
  '...WWWSSSSSSSSWWW...',
  '...WWPPPPPPPPPPWW...',
  '...WWPbbbPPPPPPWW...',
  '...WWPbPgPlllPPWW...',
  '...WWPbgbPPPPPPWW...',
  '...WWPPPPPPPPPPWW...',
  '...WWPbbbPPPPPPWW...',
  '...WWPbPgPllllPWW...',
  '...WWPbgbPPPPPPWW...',
  '...WWPPPPPPPPPPWW...',
  '...WWPbbbPPPPPPWW...',
  '...WWPbPbPlllPPWW...',
  '...WWPbbbPPPPPPWW...',
  '...WWPPPPPPPPPPWW...',
  '...WWWWWWWWWWWWWW...',
  '....................',
  '....................',
]);

icon('camera', { S: 'steel.y@top', s: 'steel:2', L: 'black.f@body', l: 'black:3', R: 'steel.R@ring', G: 'glass.R@lens', g: 'navy:2', K: 'black:1', r: 'red.R@btn', y: 'yellow:4' }, [
  '....................',
  '....................',
  '....................',
  '...rr.....SSSSS.....',
  '..SSSSSSSSSSSSSSSS..',
  '.SSSSSSSSSSSSSSSSSS.',
  '.SsSSSSSRRRRSSSSyyS.',
  '.LLLLLLRRKKKRRLLLLL.',
  '.LlLlLRKKGGGKKRLlLl.',
  '.LLLLLRKGGGGgKRLLLL.',
  '.LlLlLRKGGGggKRlLlL.',
  '.LLLLLRKGGggKKRLLLL.',
  '.LlLlLLRKKKKKRRLlLl.',
  '.LLLLLLLRRRRRLLLLLL.',
  '.LLLLLLLLLLLLLLLLLL.',
  '..LLLLLLLLLLLLLLLL..',
  '....................',
  '....................',
  '....................',
  '....................',
]);

icon('map', { A: 'parch.r@a', B: 'parch:2@b', C: 'parch.r@c', w: 'water:3', W: 'water:4', r: 'red:3', g: 'leaf:3', G: 'leaf:2', K: '#2a1a14' }, [
  '....................',
  '....................',
  '..AAAAAA....CCCCCC..',
  '..AAAAAABBBBCCCCCC..',
  '..AAgAAABBBBCCCCKC..',
  '..AgGgAABBBBCCCKCK..',
  '..AAgAAABBBrCCCCKC..',
  '..AAAAAAwWBBBCrCCC..',
  '..AAAAwWWWWBBrCCCC..',
  '..AAArwWWWWwBCCCCC..',
  '..AAAAwWWWWBBCCCCC..',
  '..AArAAwwBBBBCCgCC..',
  '..AAAAAABBBBBCgGgC..',
  '..ArAAAABBBBBCCgCC..',
  '..AArAAABBBBCCCCCC..',
  '..AAAAAABBBBCCCCCC..',
  '..AAAAAA....CCCCCC..',
  '....................',
  '....................',
  '....................',
]);

icon('book', { C: 'teal.f@cover', c: 'teal:2', S: 'teal.x@spine', g: 'gold.R@g', G: 'gold:2', P: 'parch.f@pages', p: 'parch:2', r: 'red.x@rib' }, [
  '....................',
  '....CCCCCCCCCCCCC...',
  '...SSCCCCCCCCCCCCP..',
  '...SgCgCCCCCCCgCCP..',
  '...SSCCCCCCCCCCCCP..',
  '...SSCCCCgggCCCCCP..',
  '...SgCCCgggggCCCCP..',
  '...SSCCgggggggCCCP..',
  '...SSCCCgggggCgCCP..',
  '...SgCCCCgggCgCCCP..',
  '...SSCCCCCCCCCCCCP..',
  '...SSCCCCCCCCCCCCP..',
  '...SgCgCCCCCCCgCCP..',
  '...SSCCCCCCCCCCCCP..',
  '...SSPPPPPPPPPPPPP..',
  '....SpPpPpPprrPpP...',
  '...........rr.......',
  '...........r........',
  '....................',
  '....................',
]);

icon('save', { B: 'blue.f@body', b: 'blue:2', S: 'steel.f@shut', s: 'steel:2', L: 'white.f@lab', l: 'slate:4', r: 'red:3' }, [
  '....................',
  '..BBBBSSSSSSSSBBB...',
  '..BBBBSSsSSSSSBBBB..',
  '..BBBBSSsSSSSSBBBB..',
  '..BBBBSSsSSSSSBBBB..',
  '..BBBBSSSSSSSSBBBB..',
  '..BBBBBBBBBBBBBBBB..',
  '..BBBBBBBBBBBBBBBB..',
  '..BBLLLLLLLLLLLLBB..',
  '..BBLrrrrrrrrrrLBB..',
  '..BBLLLLLLLLLLLLBB..',
  '..BBLllllllllLLLBB..',
  '..BBLLLLLLLLLLLLBB..',
  '..BBLlllllLLLLLLBB..',
  '..BBLLLLLLLLLLLLBB..',
  '..BBLLLLLLLLLLLLBB..',
  '..BBBBBBBBBBBBBBBB..',
  '....................',
  '....................',
  '....................',
].map((r, y, a) => a[(y + 19) % 20]));

icon('home', { R: 'red.f@roof', r: 'red:2', W: 'lwood.y@wall', w: 'lwood:2', D: 'wood.f@door', y: 'yellow.R@win', f: 'wood:1', C: 'stone.x@ch', s: 'white:3', t: 'white:4', g: 'gold:3' }, [
  '..............t.....',
  '.............ss.....',
  '.............CC.....',
  '.........RR..CC.....',
  '........RRRR.CC.....',
  '.......RRRRRRRR.....',
  '......RRRRRRRRRR....',
  '.....RRRRRRRRRRRR...',
  '....RRRRRRRRRRRRRR..',
  '...rrrrrrrrrrrrrrrr.',
  '....WWWWWWWWWWWWWW..',
  '....wwwwwwwwwwwwww..',
  '....WWDDDDWWyyyyWW..',
  '....wwDDDDwwyfyyww..',
  '....WWDDgDWWffffWW..',
  '....wwDDDDwwyfyyww..',
  '....WWDDDDWWyyyyWW..',
  '....wwDDDDwwwwwwww..',
  '....................',
  '....................',
]);

icon('newspaper', { P: 'parch.f@p', p: 'parch:2', h: 'ink:2', l: 'stone:3', i: 'slate:3', I: 'slate:4' }, [
  '....................',
  '....................',
  '..PPPPPPPPPPPPPPPP..',
  '..PhhhhhhhhhhhhhhP..',
  '..PhhhhhhhhhhhhhhP..',
  '..PPPPPPPPPPPPPPPP..',
  '..PiiiiiiPllllllPP..',
  '..PiIIIiiPPPPPPPPP..',
  '..PiIIIiiPllllllPP..',
  '..PiiiiiiPPPPPPPPP..',
  '..PiiiiiiPlllllPPP..',
  '..PPPPPPPPPPPPPPPP..',
  '..PllllllPllllllPP..',
  '..PPPPPPPPPPPPPPPP..',
  '..PlllllPPlllllPPP..',
  '..PPPPPPPPPPPPPPPP..',
  '..PllllllPlllPPppp..',
  '..PPPPPPPPPPPPpp....',
  '....................',
  '....................',
]);

icon('chart', { P: 'parch.f@card', a: 'blue.x@1', b: 'leaf.x@2', c: 'gold.x@3', d: 'red.x@4', l: 'wood:2', r: 'red:3' }, [
  '....................',
  '....................',
  '..PPPPPPPPPPPPPPPP..',
  '..PPPPPPPPPPPPPrrP..',
  '..PPPPPPPPPPPPrrrP..',
  '..PPPPPPPPPPPPPrrP..',
  '..PPPPPPPPPPPdPrPP..',
  '..PPPPPPPPPPdddPPP..',
  '..PPPPPPPPPPdddPPP..',
  '..PPPPPPPcccdddPPP..',
  '..PPPPPPPcccdddPPP..',
  '..PPPPbbbcccdddPPP..',
  '..PPPPbbbcccdddPPP..',
  '..PaaabbbcccdddPPP..',
  '..PaaabbbcccdddPPP..',
  '..PaaabbbcccdddPPP..',
  '..PllllllllllllllP..',
  '..PPPPPPPPPPPPPPPP..',
  '....................',
  '....................',
]);

icon('eye', { W: 'white.r@w', I: 'teal.R@iris', K: 'black:1', w: '#ffffff', l: 'ink:2' }, [
  '....................',
  '....................',
  '....................',
  '....................',
  '....l...l..l...l....',
  '.....l..l..l..l.....',
  '.......llllll.......',
  '.....llWWWWWWll.....',
  '...llWWWWIIIWWWll...',
  '..lWWWWWIIIIIWWWWl..',
  '.lWWWWWIIKKKIIWWWWl.',
  '..WWWWWIKwKKKIWWWW..',
  '...WWWWIKKKKKIWWW...',
  '....WWWWIIIIIWWW....',
  '......WWWWWWWW......',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
]);

icon('info', { B: 'blue.R', w: 'white:5', W: 'white:4' }, () => {
  const g = new Grid(20, 20).ellipse(10, 10, 8.6, 8.6, 'B');
  g.rect(9, 4, 2, 2, 'w').rect(8, 8, 3, 1, 'w').rect(9, 9, 2, 5, 'W').rect(8, 14, 4, 1, 'W');
  return g.rows();
});

icon('warning', { Y: 'yellow.R', K: '#2a1a14' }, R([
  '....................',
  '.........##.........',
  '........####........',
  '........####........',
  '.......######.......',
  '.......######.......',
  '......########......',
  '......########......',
  '.....##########.....',
  '.....##########.....',
  '....############....',
  '....############....',
  '...##############...',
  '...##############...',
  '..################..',
  '..################..',
  '..################..',
  '...##############...',
  '....................',
  '....................',
], 'Y').map((r, y) => ([5, 6, 7, 8, 9, 10, 11, 14, 15].includes(y) ? r.slice(0, 9) + 'KK' + r.slice(11) : r)));

icon('question', { Y: 'yellow.R' }, R([
  '................',
  '.....######.....',
  '....########....',
  '...###....###...',
  '...###....###...',
  '.........####...',
  '........####....',
  '.......####.....',
  '......###.......',
  '......###.......',
  '................',
  '......###.......',
  '......###.......',
  '................',
  '................',
  '................',
], 'Y').map((r, y, a) => a[(y + 15) % 16]));

icon('bell', { G: 'gold.R@bell', g: 'gold:2', H: 'wood.x@h', h: 'wood:4', c: 'gold.R@clap', r: 'gold.y@rim' }, [
  '....................',
  '.........HH.........',
  '.........HH.........',
  '........HHHH........',
  '.........gg.........',
  '.......GGGGGG.......',
  '......GGGGGGGG......',
  '.....GGGGGGGGGG.....',
  '.....GGGGGGGGGG.....',
  '.....GGGGGGGGGG.....',
  '....GGGGGGGGGGGG....',
  '....GGGGGGGGGGGG....',
  '...GGGGGGGGGGGGGG...',
  '..GGGGGGGGGGGGGGGG..',
  '..rrrrrrrrrrrrrrrr..',
  '........cccc........',
  '.........cc.........',
  '....................',
  '....................',
  '....................',
]);

icon('lock', { G: 'gold.R@body', S: 'steel.x@sh', K: 'gold:0', k: 'line' }, [
  '................',
  '.....SSSSSS.....',
  '....SSSSSSSS....',
  '....SS....SS....',
  '....SS....SS....',
  '....SS....SS....',
  '..GGGGGGGGGGGG..',
  '..GGGGGGGGGGGG..',
  '..GGGGGKKGGGGG..',
  '..GGGGGKKGGGGG..',
  '..GGGGGGKGGGGG..',
  '..GGGGGGKGGGGG..',
  '..GGGGGGGGGGGG..',
  '...GGGGGGGGGG...',
  '................',
  '................',
]);

icon('speech', { W: 'white.f@b', d: 'ink:3' }, [
  '....................',
  '....................',
  '....WWWWWWWWWWWW....',
  '..WWWWWWWWWWWWWWWW..',
  '.WWWWWWWWWWWWWWWWWW.',
  '.WWWWWWWWWWWWWWWWWW.',
  '.WWWWddWWddWWddWWWW.',
  '.WWWWddWWddWWddWWWW.',
  '.WWWWWWWWWWWWWWWWWW.',
  '.WWWWWWWWWWWWWWWWWW.',
  '..WWWWWWWWWWWWWWWW..',
  '....WWWWWWWWWWWW....',
  '.....WWWW...........',
  '.....WWW............',
  '....WW..............',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
].map((r, y, a) => a[(y + 18) % 20]));

// --- pond building -------------------------------------------------------------
// horizontal log with a cut end showing rings
function log(g, x0, x1, y, h, body, end, ring) {
  g.rect(x0, y, x1 - x0, h, body);
  g.ellipse(x1 + 0.2, y + h / 2, 1.6, h / 2 + 0.1, end);
  if (ring) g.set(x1, y + Math.floor(h / 2), ring);
}

icon('dam', { W: 'water.y@w', w: 'water:5', A: 'wood.y@l1', B: 'wood.y@l2', C: 'wood.y@l3', D: 'wood.y@l4', E: 'wood.y@l5', F: 'wood.y@l6', e: 'lwood.r@e', r: 'wood:1', b: 'wood:2', s: 'lwood.x@st', M: 'bear.r@mud', m: 'bear:2' }, () => {
  const g = new Grid(20, 20);
  g.ellipse(10, 5.2, 9.6, 3.4, 'W');
  g.line(3, 3, 6, 3, 'w').line(12, 2, 15, 2, 'w');
  g.ellipse(10, 17.2, 9.4, 2.2, 'M');
  g.set(4, 18, 'm').set(13, 18, 'm');
  const L = (x0, x1, y, ch) => {
    layer(g, (x, yy) => (yy >= y && yy < y + 3 && x >= x0 && x < x1) || discMask(x1 + 0.1, y + 1.5, 1.7, 1.6)(x, yy), ch);
    for (let yy = y; yy < y + 3; yy++) for (let x = x0; x < x1; x++) if ((x * 7 + yy * 3) % 5 === 0) g.set(x, yy, 'b');
    for (let yy = y; yy < y + 3; yy++) for (let x = x1 - 1; x <= x1 + 1; x++) if (discMask(x1 + 0.1, y + 1.5, 1.7, 1.6)(x, yy) && x >= x1 - 0) g.set(x, yy, 'e');
    g.set(x1, y + 1, 'r');
  };
  L(1, 5, 13, 'D'); L(7, 11, 13, 'E'); L(13, 17, 13, 'F');
  L(3, 8, 9, 'B'); L(10, 15, 9, 'C');
  L(5, 12, 5, 'A');
  g.line(4, 5, 2, 2, 's').line(14, 6, 17, 3, 's').line(9, 5, 8, 2, 's');
  return g.rows();
});

icon('fence', { P: 'lwood.x@p1', Q: 'lwood.x@p2', O: 'lwood.x@p3', R: 'wood.y@r1', S: 'wood.y@r2', n: 'steel:3', g: 'leaf.r@g' }, [
  '....................',
  '....................',
  '...P......Q......O..',
  '..PPP....QQQ....OOO.',
  '..PPP....QQQ....OOO.',
  '..PPP....QQQ....OOO.',
  'RRRRRRRRRRRRRRRRRRRR',
  'RRnRRRRRRRnRRRRRRnRR',
  '..PPP....QQQ....OOO.',
  '..PPP....QQQ....OOO.',
  '..PPP....QQQ....OOO.',
  'SSSSSSSSSSSSSSSSSSSS',
  'SSnSSSSSSSnSSSSSSnSS',
  '..PPP....QQQ....OOO.',
  '..PPP....QQQ....OOO.',
  '..PPP....QQQ....OOO.',
  '.gPPPgg.gQQQg..gOOOg',
  '..ggg....ggg....ggg.',
  '....................',
  '....................',
].map((r) => '.' + r.slice(1, 19) + '.'));

icon('platform', { D: 'lwood.f@deck', d: 'lwood:2', E: 'wood.y@edge', P: 'wood.x@p1', Q: 'wood.x@p2', O: 'wood.x@p3', W: 'water.y@w', w: 'water:5', v: 'water:4' }, [
  '....................',
  '....................',
  '....................',
  '....................',
  '.DDDdDDDDdDDDDdDDDD.',
  '.DDDdDDDDdDDDDdDDDD.',
  '.DDDdDDDDdDDDDdDDDD.',
  '.EEEEEEEEEEEEEEEEEE.',
  '..PP.....QQ.....OO..',
  '..PP.....QQ.....OO..',
  '..PP.....QQ.....OO..',
  '..PP.....QQ.....OO..',
  '.WPPWWWWWQQWWWWWOOW.',
  'WWPPWWwwWQQWWWvWOOWW',
  'WWWWWWWWWWWWWWWWWWWW',
  '.WWvWWWWWWWWwwWWWWW.',
  '..WWWWWWWWWWWWWWWW..',
  '....................',
  '....................',
  '....................',
].map((r) => '.' + r.slice(1, 19) + '.'));

icon('gate', { F: 'wood.x@f1', G: 'wood.x@f2', T: 'wood.y@top', P: 'lwood.f@g', p: 'lwood:2', S: 'steel.R@wh', s: 'steel:2', W: 'water.y@w', w: 'water:5' }, [
  '....................',
  '........SSSS........',
  '.......S.SS.S.......',
  '.......SSSSSS.......',
  '.......S.SS.S.......',
  '..TTTTTTSSSSTTTTTT..',
  '..TTTTTTTTTTTTTTTT..',
  '..FF..........GG....',
  '..FF.PPPPPPPP.GG....',
  '..FF.pppppppp.GG....',
  '..FF.PPPPPPPP.GG....',
  '..FF.pppppppp.GG....',
  '..FF.PPPPPPPP.GG....',
  '..FF.pppppppp.GG....',
  '..FFWPPPPPPPPWGG....',
  'WWFFWWWWWWWWWWGGWWW.',
  'WWFFWwwWWWWWwwGGWWW.',
  '.WWWWWWWWWWWWWWWWW..',
  '....................',
  '....................',
].map((r) => r.replace(/^(.{14})GG(.{4})$/, '$1GG$2')).map((r, y) => (y >= 7 && y <= 16 ? r.slice(0, 14) + r.slice(14, 16) + r.slice(16) : r)));

icon('feeder', { J: 'glass.R@jar', o: 'syrup:3', O: 'syrup:2', c: 'red.r@lid', H: 'lwood.f@hop', h: 'lwood:2', S: 'steel.R@sp', P: 'wood.x@post', C: 'brass.R@cog', q: 'brass:1', p: 'syrup:3' }, [
  '....................',
  '.......cccccc.......',
  '......JJJJJJJJ......',
  '......JoOoJoOJ......',
  '......JOoOoOoJ......',
  '......JoOoOoOJ......',
  '......JOoOoOoJ......',
  '.....HHHHHHHHHH.....',
  '.....HHHHHHHHHH.....',
  '......HHhhhhHH..CC..',
  '.......HHHHHH..CqqC.',
  '........SSSS...CqqC.',
  '.........SS.....CC..',
  '.........PP.p.......',
  '.........PP...p.....',
  '.........PP..p......',
  '.........PP.........',
  '.........PP.........',
  '........PPPP........',
  '....................',
]);

icon('aerator', { A: 'glass.R@b1', B: 'glass.R@b2', C: 'glass.R@b3', D: 'glass.R@b4', E: 'glass.R@b5', F: 'glass.R@b6', G: 'glass.R@b7', S: 'steel.y@base', s: 'steel:1', W: 'water.y@w', w: 'water:5' }, () => {
  const g = new Grid(20, 20);
  g.ellipse(10, 17, 9.5, 2.6, 'W');
  g.line(2, 16, 5, 16, 'w').line(14, 18, 17, 18, 'w');
  g.ellipse(10, 15.6, 5, 1.8, 'S');
  for (const x of [7, 10, 13]) g.set(x, 15, 's');
  const bub = [[10, 12.2, 1.5, 'A'], [6.6, 9.4, 1.3, 'B'], [12.8, 8.4, 1.9, 'C'], [8.6, 5, 1.5, 'D'], [15, 3.8, 1.2, 'E'], [5, 4.6, 1, 'F'], [11.8, 1.8, 0.9, 'G']];
  for (const [x, y, r, c] of bub) layer(g, discMask(x, y, r), c);
  return g.rows();
});

icon('bughotel', { R: 'red.f@roof', r: 'red:2', W: 'lwood.f@frame', w: 'lwood:2', K: 'dwood:1', s: 'wood:4', S: 'wood:2', p: 'syrup:3', P: 'syrup:2', t: 'straw:4', T: 'straw:2', b: 'bear:3' }, [
  '.........RR.........',
  '........RRRR........',
  '.......RRRRRR.......',
  '......RRRRRRRR......',
  '.....RRRRRRRRRR.....',
  '....RRRRRRRRRRRR....',
  '...rrrrrrrrrrrrrr...',
  '....WWWWWWWWWWWW....',
  '....WKsKsKWtTtTW....',
  '....WsKsKsWTtTtW....',
  '....WKsKsKWtTtTW....',
  '....WWWWWWWWWWWW....',
  '....WpPpWbKbKbKW....',
  '....WPpPWKbKbKbW....',
  '....WpPpWbKbKbKW....',
  '....WWWWWWWWWWWW....',
  '.....S........S.....',
  '.....S........S.....',
  '....................',
  '....................',
]);

icon('lodge', { A: 'wood.r@mound', a: 'lwood:3', b: 'wood:1', c: 'lwood:4', D: 'dwood:1', W: 'water.y@w', w: 'water:5' }, () => {
  const g = new Grid(20, 20);
  g.ellipse(10, 16.2, 9.6, 2.8, 'W');
  g.line(2, 17, 4, 17, 'w').line(15, 18, 17, 18, 'w');
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      const dx = (x + 0.5 - 10) / 8.4, dy = (y + 0.5 - 15.5) / 11;
      if (y <= 15 && dx * dx + dy * dy <= 1) g.set(x, y, 'A');
    }
  // criss-cross sticks
  const r = rng(5);
  for (let i = 0; i < 16; i++) {
    const x = 3 + r() * 14, y = 6 + r() * 9, l = 1.5 + r() * 2.5, a = r() * Math.PI;
    const x1 = x + Math.cos(a) * l, y1 = y + Math.sin(a) * l * 0.6;
    for (let t = 0; t <= 1; t += 0.2) { const px = Math.floor(x + (x1 - x) * t), py = Math.floor(y + (y1 - y) * t); if (g.get(px, py) === 'A') g.set(px, py, i % 3 ? 'a' : 'c'); }
  }
  g.stamp(8, 12, ['.DDD.', 'DDDDD', 'DDDDD']);
  g.set(9, 4, 'b').set(10, 4, 'b').set(10, 3, 'c');
  return g.rows();
});

icon('incubator', { B: 'wood.f@box', b: 'wood:2', G: 'glass.R@dome', E: 'cream.R@e1', F: 'sky.R@e2', s: 'straw:4', S: 'straw:2', L: 'red.R@lamp', l: 'yellow:5', y: 'yellow:4', K: 'steel:2', g: 'gold:3' }, [
  '.........KK.........',
  '........LLLL........',
  '.......LLLLLL.......',
  '........llll........',
  '.....y..yyyy..y.....',
  '....GGGGGGGGGGGG....',
  '...GGGGGGGGGGGGGG...',
  '..GGGGGGGGGGGGGGGG..',
  '..GGGEEEGGGGFFFGGG..',
  '..GGEEEEEGGFFFFFGG..',
  '..GGEEEEEGGFFFFFGG..',
  '..GsSEEEsSsSFFFsSG..',
  '.BBBBBBBBBBBBBBBBBB.',
  '.BBbBBBBBBBBBBBBbBB.',
  '.BBBBBBgggggBBBBBBB.',
  '.BBbBBBBBBBBBBBBbBB.',
  '.BBBBBBBBBBBBBBBBBB.',
  '..bb............bb..',
  '....................',
  '....................',
]);

icon('sprinkler', { B: 'lwood.x@barrel', b: 'lwood:2', H: 'steel.y@h1', I: 'steel.y@h2', S: 'steel.R@head', p: 'steel.x@pipe', d: 'sky.R@d1', e: 'sky.R@d2', f: 'sky.R@d3', w: 'water:4' }, [
  '..d..............e..',
  '.dd....e....f...ee..',
  '.....ff.........f...',
  '...e.....SS.....d...',
  '.........SS.........',
  '.........pp.........',
  '.........pp.........',
  '....BBBBBppBBBBB....',
  '...BBBBBBBBBBBBBB...',
  '...HHHHHHHHHHHHHH...',
  '...BBbBBBbBBbBBBB...',
  '...BBbBBBbBBbBBBB...',
  '...BBbBBBbBBbBBBB...',
  '...IIIIIIIIIIIIII...',
  '...BBbBBBbBBbBBBB...',
  '...BBbBBBbBBbBBBB...',
  '....BBBBBBBBBBBB....',
  '...wwwwwwwwwwwwww...',
  '....................',
  '....................',
]);

icon('buglamp', { P: 'wood.x@post', C: 'iron.R@cap', c: 'iron:4', G: 'glass.r@glass', L: 'yellow.R@bulb', l: 'yellow:5', m: 'lilac.r@m1', n: 'lilac.r@m2', o: 'tan.r@m3', y: 'yellow:4', k: 'line' }, [
  '....................',
  '..m........n........',
  '.mmm......nnn.......',
  '..m.................',
  '........CCCC....o...',
  '......CCCCCCCC.ooo..',
  '.....CCCCCCCCCC.o...',
  '.......GGGGGG.......',
  '.......GLLLLG.......',
  '...y...GLllLG...y...',
  '.......GLLLLG.......',
  '.......GGGGGG.......',
  '........CCCC........',
  '.........PP.........',
  '.........PP.........',
  '.........PP.........',
  '.........PP.........',
  '........PPPP........',
  '.......PPPPPP.......',
  '....................',
]);

icon('lantern', { B: 'brass.R@frame', b: 'brass:2', G: 'glass.r@glass', F: 'fire.R@flame', f: 'fire:5', y: 'yellow:5', k: 'line' }, [
  '.........BB.........',
  '........B..B........',
  '........B..B........',
  '.......BBBBBB.......',
  '......BBBBBBBB......',
  '.....BBBBBBBBBB.....',
  '.....BGGGBBGGGB.....',
  '.....BGGyBByGGB.....',
  '.....BGGFBBFGGB.....',
  '.....BGFFBBFFGB.....',
  '.....BGFfBBfFGB.....',
  '.....BGGFBBFGGB.....',
  '.....BGGGBBGGGB.....',
  '.....BBBBBBBBBB.....',
  '......BBBBBBBB......',
  '.......bbbbbb.......',
  '....................',
  '....................',
  '....................',
  '....................',
].map((r, y, a) => a[(y + 18) % 20]));

icon('chair', { R: 'red.f@back', r: 'red:2', S: 'red.y@seat', A: 'red.y@arm', L: 'red.x@leg', l: 'red:1' }, [
  '....................',
  '......R.RR.R........',
  '.....RR.RR.RR.......',
  '.....RR.RR.RR.......',
  '.....RR.RR.RR.......',
  '.....RR.RR.RR.......',
  '.....RR.RR.RR.......',
  '.AAAAAAAAAAAAAAAAA..',
  '.AAAAAAAAAAAAAAAAAA.',
  '..LL.RR.RR.RR..LL...',
  '..LL.RRrRRrRR..LL...',
  '..LLSSSSSSSSSSSLL...',
  '..LLSSSSSSSSSSSLL...',
  '..LL.SSSSSSSSS.LL...',
  '..LL.LL.....LL.LL...',
  '..LL.LL.....LL.LL...',
  '..ll.LL.....LL.ll...',
  '.....ll.....ll......',
  '....................',
  '....................',
]);

icon('picnic', { T: 'lwood.f@top', t: 'lwood:2', C: 'red.f@cloth', c: 'cream:5', B: 'lwood.y@bench', L: 'wood.x@leg', l: 'wood:1' }, [
  '....................',
  '....................',
  '....................',
  '....CCcCCcCCcCCc....',
  '...CcCCcCCcCCcCCc...',
  '..CCcCCcCCcCCcCCcC..',
  '..cCCcCCcCCcCCcCCc..',
  '..CCcCCcCCcCCcCCcC..',
  '..TTTTTTTTTTTTTTTT..',
  '..tttttttttttttttt..',
  '....L..L....L..L....',
  '.BBBBBBBBBBBBBBBBBB.',
  '.BBBBBBBBBBBBBBBBBB.',
  '...L.L.L....L.L.L...',
  '...L..L......L..L...',
  '..L...L......L...L..',
  '..L....L....L....L..',
  '..l....l....l....l..',
  '....................',
  '....................',
]);

icon('mailbox', { M: 'steel.y@box', D: 'steel.f@door', d: 'steel:2', y: 'gold.R@knob', F: 'red.f@flag', p: 'red.x@pole', P: 'wood.x@post', g: 'leaf.r@g', G: 'leaf:4', w: 'white:5', m: 'steel:1' }, [
  '....................',
  '....................',
  '..............pFFF..',
  '......MMMMMMM.pFFF..',
  '....MMMMMMMMMMpFFF..',
  '...DMMMMMMMMMMp.....',
  '..DDMMMMMMMMMMp.....',
  '..DDMMMMMMMMMMp.....',
  '..DyMMMMMMMMMMp.....',
  '..DDMMMMMMMMMMp.....',
  '..DDMMMMMMMMMMM.....',
  '...mmmmmmmmmmmm.....',
  '........PP..........',
  '........PP..........',
  '........PP..........',
  '........PP..........',
  '........PP..........',
  '......gGPPgG........',
  '.....ggggggggg......',
  '....................',
]);

icon('pinwheel', { A: 'red.r@a', B: 'yellow.r@b', C: 'blue.r@c', D: 'leaf.r@d', P: 'gold.R@pin', S: 'lwood.x@stick' }, [
  '....................',
  '.......AA...........',
  '.......AAAA....BB...',
  '.......AAAAA.BBBB...',
  '........AAAABBBBB...',
  '..DD.....AAABBBB....',
  '..DDDD...AAPBB......',
  '..DDDDDDDPPPP.......',
  '...DDDDDDPPPPCCCCC..',
  '......DDPPPCCCCCC...',
  '.......DDPCCC.......',
  '.........SCCC.......',
  '.........SS.CC......',
  '.........SS.........',
  '.........SS.........',
  '.........SS.........',
  '.........SS.........',
  '.........SS.........',
  '.........SS.........',
  '....................',
]);

icon('bench', { B: 'lwood.y@b1', C: 'lwood.y@b2', S: 'lwood.y@s1', T: 'lwood.y@s2', L: 'iron.x@leg', l: 'iron:4', m: 'red.r@leaf' }, [
  '....................',
  '....................',
  '....................',
  '..BBBBBBBBBBBBBBBB..',
  '..BBBBBBBmBBBBBBBB..',
  '..CCCCCCmmmCCCCCCC..',
  '..CCCCCCCmCCCCCCCC..',
  '..L.............L...',
  '..L.............L...',
  '.SSSSSSSSSSSSSSSSSS.',
  '.SSSSSSSSSSSSSSSSSS.',
  '.TTTTTTTTTTTTTTTTTT.',
  '..L.............L...',
  '..LL...........LL...',
  '..L.L.........L.L...',
  '..L..L.......L..L...',
  '..l.............l...',
  '....................',
  '....................',
  '....................',
].map((r, y) => (y >= 7 ? r.slice(0, 16) + r.slice(16).replace('L...', 'L...') : r)).map((r) => r.replace(/^(..L.{13})L(...)$/, '$1L$2')));

// --- decor -------------------------------------------------------------------
icon('birdhouse', { R: 'red.f@roof', r: 'red:2', H: 'sky.f@house', h: 'sky:2', K: 'navy:1', p: 'lwood.x@perch', P: 'wood.x@pole', y: 'yellow.R@bird', o: 'orange:3', k: 'line' }, [
  '....................',
  '.........RR.........',
  '........RRRR........',
  '.......RRRRRR.......',
  '......RRRRRRRR......',
  '.....RRRRRRRRRR.....',
  '....rrrrrrrrrrrr....',
  '.....HHHHHHHHHH.....',
  '.....HHHHKKHHHH.....',
  '.....HHHKyyKHHH.....',
  '.....HHHKyKoHHH.....',
  '.....HHHHKKHHHH.....',
  '.....HHHHHHHHHH.....',
  '.....HhHHppHHhH.....',
  '.....HHHHHHHHHH.....',
  '.....hhhhhhhhhh.....',
  '.........PP.........',
  '.........PP.........',
  '........PPPP........',
  '....................',
]);

icon('birdbath', { S: 'stone.y@bowl', T: 'stone.x@ped', U: 'stone.y@base', W: 'water.r@w', w: 'water:5', b: 'sky.R@bird', B: 'sky:2', y: 'orange:4', K: '#2a1a14', m: 'moss:3' }, [
  '....................',
  '....................',
  '....................',
  '....................',
  '...........bb.......',
  '..........bbKby.....',
  '..........bbbb......',
  '.........Bbbbb......',
  '..SSSSSSSSSSSSSSSS..',
  '..SWWWWwwWWWWWWWWS..',
  '...SSSSSSSSSSSSSS...',
  '....SSSSSSSSSSSS....',
  '......SSSSSSSS......',
  '........TTTT........',
  '........TTmT........',
  '........TTTT........',
  '.......UUUUUU.......',
  '......UUUUUUUU......',
  '.....UUUUUUUUUU.....',
  '....................',
].map((r, y, a) => a[(y + 1) % 20]));

icon('gnome', { R: 'red.r@hat', A: 'sand.r@ant', s: 'skin.r@face', K: '#2a1a14', p: 'pink.R@nose', W: 'white.r@beard', w: 'white:2', B: 'blue.r@coat', b: 'gold:3', L: 'leather.r@boot' }, [
  '....................',
  '.........R..........',
  '........RRR.........',
  '.A.A....RRR....A.A..',
  '.AAA...RRRRR...AAA..',
  '..AAA..RRRRR..AAA...',
  '....AA.RRRRR.AA.....',
  '.....AARRRRRRA......',
  '.....RRRRRRRRRR.....',
  '......ssssssss......',
  '......sKssssKs......',
  '.....WWWWppWWWW.....',
  '....WWWWWppWWWWW....',
  '...BBWWWwWWwWWWBB...',
  '...BBBWWWWWWWWBBB...',
  '...BBBBWWWWWWBbBB...',
  '....BBBBBWWBBBBB....',
  '....LLLL....LLLL....',
  '....................',
  '....................',
]);

icon('arch', { V: 'leaf.r@vine', v: 'leaf:4', r: 'rose.R@r', p: 'pink:5', T: 'white.x@trellis' }, () => {
  const g = new Grid(20, 20);
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      const dx = x + 0.5 - 10, dy = y + 0.5 - 9.6, r = Math.hypot(dx, dy);
      if (y + 0.5 <= 9.6 ? r >= 5.4 && r <= 8.8 : (x >= 1 && x <= 4) || (x >= 15 && x <= 18)) if (y <= 18) g.set(x, y, 'V');
    }
  // trellis legs peeking through
  for (let y = 12; y <= 18; y += 3) { g.set(2, y, 'T'); g.set(17, y, 'T'); }
  const roses = [[3, 8], [5, 4], [9, 2], [13, 3], [16, 6], [16, 11], [2, 13], [17, 15], [3, 17]];
  for (const [x, y] of roses) g.stamp(x - 1, y - 1, ['.r.', 'rpr', '.r.']);
  for (const [x, y] of [[7, 3], [11, 1], [14, 5], [4, 10], [16, 9], [3, 15]]) g.set(x, y, 'v');
  return g.rows();
});

icon('stringlights', { P: 'wood.x@post', w: 'iron:3', a: 'yellow.R@a', b: 'red.R@b', c: 'leaf.R@c', d: 'blue.R@d', e: 'pink.R@e', s: 'iron:4' }, () => {
  const g = new Grid(20, 20);
  g.rect(1, 2, 2, 17, 'P');
  g.rect(17, 2, 2, 17, 'P');
  const wy = (x) => 3 + 5.2 * (1 - Math.pow((x - 9.5) / 7, 2));
  for (let x = 3; x <= 16; x++) g.set(x, Math.round(wy(x)), 'w');
  [[4.5, 'a'], [7, 'b'], [9.5, 'c'], [12, 'd'], [14.5, 'e']].forEach(([x, c]) => {
    const y = Math.round(wy(x)) + 1;
    g.set(Math.round(x), y, 's');
    g.ellipse(Math.round(x) + 0.5, y + 2.4, 1.3, 1.8, c);
  });
  return g.rows();
});

icon('stonelantern', { S: 'stone.r@roof', T: 'stone.y@shelf', L: 'stone.f@box', y: 'fire:4', Y: 'fire:5', P: 'stone.x@pillar', B: 'stone.y@base', m: 'moss:3', M: 'moss:4' }, [
  '....................',
  '.........SS.........',
  '........SSSS........',
  '....SSSSSSSSSSSS....',
  '...SSSSSSSSSSSSSS...',
  '..SSSSSSSSSSSSSSSS..',
  '.....TTTTTTTTTT.....',
  '......LLyyyyLL......',
  '......LLyYYyLL......',
  '......LLyYYyLL......',
  '......LLyyyyLL......',
  '.....TTTTTTTTTT.....',
  '........PPPP........',
  '........PmPP........',
  '........PPPP........',
  '......BBBBBBBB......',
  '.....BBBBBBBBBB.....',
  '....BBBBMBBBBBBB....',
  '....................',
  '....................',
].map((r, y) => (y === 3 ? r.slice(0, 4) + 'm' + r.slice(5) : r)));

icon('campfire', { F: 'fire.r@f', Y: 'yellow.R@y', w: 'fire:5', L: 'wood.x@l1', M: 'wood.x@l2', e: 'orange:3', S: 'stone.r@s1', T: 'stone.r@s2', U: 'stone.r@s3', V: 'stone.r@s4', X: 'stone.r@s5' }, () => {
  const g = new Grid(20, 20);
  // stones ring (back)
  const ring = [[3, 15, 'S'], [6.5, 16.6, 'T'], [10, 17, 'U'], [13.5, 16.6, 'V'], [17, 15, 'X']];
  for (const [x, y, c] of ring) g.ellipse(x, y, 2.1, 1.6, c);
  // crossed logs
  bar(g, 4, 15, 15.5, 11, 2.4, 'L');
  bar(g, 4.5, 11, 16, 15, 2.4, 'M');
  g.set(4, 15, 'e').set(16, 15, 'e');
  // flame: outer, inner, core
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      const dx = x + 0.5 - 10, dy = y + 0.5 - 10;
      const w = dy > 0 ? Math.sqrt(Math.max(0, 1 - (dy / 3) ** 2)) * 5 : 5 * (1 + dy / 10) ** 1.2 + Math.sin(dy * 1.4) * 0.8;
      if (dy > -9.5 && dy < 3 && Math.abs(dx) <= w) g.set(x, y, 'F');
      const w2 = dy > 0 ? Math.sqrt(Math.max(0, 1 - (dy / 2.2) ** 2)) * 3 : 3 * (1 + dy / 6.5);
      if (dy > -6 && dy < 2.2 && Math.abs(dx - 0.3) <= w2) g.set(x, y, 'Y');
    }
  g.set(10, 8, 'w').set(9, 9, 'w').set(10, 9, 'w');
  g.set(14, 3, 'F').set(5, 5, 'F');
  return g.rows();
});

icon('flag', { P: 'steel.x@pole', o: 'gold.R@ball', R: 'red:3', r: 'red:2', q: 'red:4', W: 'white:4', w: 'white:3', v: 'white:5', L: 'red:3', l: 'red:2', G: 'leaf.r@g', g: 'leaf:4' }, () => {
  const g = new Grid(20, 20);
  g.rect(2, 1, 2, 17, 'P');
  g.ellipse(3, 1, 1.4, 1.2, 'o');
  const F = [
    'RRRRWWWWWWWWRRRR',
    'RRRRWWWWLWWWRRRR',
    'RRRRWWLWLWLWRRRR',
    'RRRRWWLLLLLWRRRR',
    'RRRRWLLLLLLLRRRR',
    'RRRRWWLLLLLWRRRR',
    'RRRRWWWWLWWWRRRR',
    'RRRRWWWWLWWWRRRR',
    'RRRRWWWWWWWWRRRR',
  ];
  for (let x = 0; x < 15; x++) {
    const off = Math.round(Math.sin(x * 0.55 + 0.4) * 0.9);
    const shade = Math.cos(x * 0.55 + 0.4);
    for (let y = 0; y < F.length; y++) {
      let c = F[y][x];
      if (shade < -0.45) c = { R: 'r', W: 'w', L: 'l' }[c];
      else if (shade > 0.6) c = { R: 'q', W: 'v', L: 'L' }[c];
      g.set(4 + x, 2 + y + off, c);
    }
  }
  g.ellipse(3, 18.4, 3.4, 1.4, 'G');
  g.set(1, 18, 'g');
  return g.rows();
});

icon('canoe', { R: 'red.y@hull', r: 'red:4', G: 'lwood.x@gun', i: 'lwood:2', I: 'lwood:3', W: 'lwood.x@pad', B: 'lwood.r@blade', w: 'water:4', v: 'water:3' }, [
  '....................',
  '....................',
  '....................',
  '...............W....',
  '..............W.....',
  '.............W......',
  '............W.......',
  '.G.........W......G.',
  '.GG.......W......GG.',
  '..GGiiiIiiBBiIiiGG..',
  '..RGGGGGGBBBBGGGGR..',
  '..RRRRRRRRBBRRRRRR..',
  '...RRRrRRRRRRRrRR...',
  '....RRRRRRRRRRRR....',
  '......RRRRRRRR......',
  '...vwwwwvwwwwvwww...',
  '....................',
  '....................',
  '....................',
  '....................',
]);

icon('hockey', { R: 'red.R@frame', m: 'white:3', M: 'white:4', S: 'lwood.x@stick', t: 'ink:3', K: 'black.R@puck', i: 'ice:4' }, [
  '....................',
  '....................',
  '..RRRRRRRRRRRRRRRR..',
  '..RmMmMmMmMmMmMmMR..',
  '..RMmMmMmMmMmMmMmR..',
  '..RmMmMmMmMmMmMSSR..',
  '..RMmMmMmMmMmMSSmR..',
  '..RmMmMmMmMmMSSmMR..',
  '..RMmMmMmMmMSSmMmR..',
  '..RmMmMmMmMSSmMmMR..',
  '..RMmMmMmMSSmMmMmR..',
  '..R.......SS.....R..',
  '..R......SS......R..',
  '.RR.....SS.......RR.',
  '.......tt...........',
  '....ttttt....KKK....',
  '...ttttt....KKKKK...',
  '..iiiiiiiiiiiiiiiii.',
  '....................',
  '....................',
]);

icon('moose', { A: 'sand.r@a1', B: 'sand.r@a2', E: 'bear.r@ear', M: 'bear.r@head', N: 'tan.r@muz', n: 'bear:1', K: '#2a1a14', w: '#ffffff', D: 'bear:2' }, [
  '....................',
  '.A.A.A........B.B.B.',
  '.AAAAA........BBBBB.',
  '.AAAAAA......BBBBBB.',
  '..AAAAAA....BBBBBB..',
  '....AAAA....BBBB....',
  '...EE.MMMMMMMM.EE...',
  '...EEEMMMMMMMMEEE...',
  '......MKMMMMKM......',
  '......MwMMMMwM......',
  '.......MMMMMM.......',
  '.......MMMMMM.......',
  '......NNNNNNNN......',
  '......NnNNNNnN......',
  '......NNNNNNNN......',
  '.......NNNNNN.......',
  '........DDDD........',
  '.........DD.........',
  '....................',
  '....................',
].map((r, y) => (y === 8 ? r.replace('MKMMMMKM', 'MKMMMMKM') : y === 9 ? r.replace('MwMMMMwM', 'MMMMMMMM') : r)));

icon('stones', { W: 'water.r@w', w: 'water:5', v: 'water:4', A: 'stone.r@a', B: 'stone.r@b', C: 'stone.r@c', D: 'stone.r@d', m: 'moss:4' }, () => {
  const g = new Grid(20, 20);
  g.ellipse(10, 11, 9.4, 7.4, 'W');
  g.line(2, 12, 4, 12, 'w').line(14, 16, 17, 16, 'w').line(10, 5, 12, 5, 'v');
  layer(g, discMask(5.5, 14.2, 3.3, 2.2), 'A');
  layer(g, discMask(11, 11, 3, 2), 'B');
  layer(g, discMask(15.2, 7.4, 2.8, 1.9), 'C');
  layer(g, discMask(7.8, 6.4, 2.3, 1.6), 'D');
  g.set(4, 13, 'm').set(10, 10, 'm');
  return g.rows();
});

icon('floatlantern', { W: 'water.r@w', w: 'water:5', A: 'red.r@l1', a: 'red:2', B: 'orange.r@l2', b: 'orange:2', y: 'yellow:5', Y: 'yellow:4', r: 'yellow:4', s: 'wood:2' }, [
  '....................',
  '....................',
  '....................',
  '......ss............',
  '....AAAAAA..........',
  '...AAAaAAAA.........',
  '...AAyyyyAA.....ss..',
  '...AaYyyYaA...BBBBB.',
  '...AAyyyyAA..BBbBBB.',
  '...AaYyyYaA..BByyBB.',
  '...AAAaAAAA..BbYYbB.',
  '....AAAAAA...BBBBBB.',
  '.WWWWWWWWWWWWWBBBBW.',
  'WWWWWrrrrWWWWWWWWWWW',
  'WWwWWWrrWWWWWWrrWWWW',
  'WWWWWWWWWWWWwWWWWWWW',
  '.WWWWWrWWWWWWWWWWWW.',
  '..WWWWWWWWWWWWWWWW..',
  '....................',
  '....................',
].map((r) => '.' + r.slice(1, 19) + '.'));

icon('decoy', { G: 'leaf.R@head', K: '#2a1a14', y: 'yellow.R@beak', w: 'white:4', C: 'syrup.r@chest', B: 'stone.y@body', b: 'stone:2', T: 'ink.r@tail', W: 'water.y@w', v: 'water:5', s: 'sky:4' }, [
  '....................',
  '....................',
  '....................',
  '....................',
  '............GGG.....',
  '...........GGGGG....',
  '...........GGKGGyy..',
  '...........GGGGGyy..',
  '............GGGG....',
  '............wwww....',
  '...TT..BBBBBCCCCC...',
  '..TTBBBBbBBBCCCCC...',
  '..TBBBbBBbBBBCCCC...',
  '...BBBBBBBBBBBBB....',
  '..WWWWWWWWWWWWWWWW..',
  '...WvWWWWWWWWWWvW...',
  '....................',
  '....................',
  '....................',
  '....................',
].map((r, y, a) => a[(y + 19) % 20]));

icon('fountain', { S: 'stone.y@basin', s: 'stone:2', P: 'stone.x@ped', W: 'water.r@w', w: 'water:5', j: 'sky.r@jet', J: 'sky:5', F: 'blue.r@fish', f: 'sky:4', K: '#2a1a14' }, [
  '....................',
  '........jJj.........',
  '.......jJ..j........',
  '......jj....j.......',
  '.....FFF.....j......',
  '....FFFFf....j......',
  '...FFKFFf....J......',
  '....FFFFFF...j......',
  '.......FFFF..J......',
  '........FFFFj.......',
  '...........FF.......',
  '..SSSSSSSSSSSSSSSS..',
  '..SWWwWWWWWWWwWWWS..',
  '...SSSSSSSSSSSSSS...',
  '.....SSSSSSSSSS.....',
  '.......PPPPPP.......',
  '.......PPPPPP.......',
  '.....SSSSSSSSSS.....',
  '....SSSSSSSSSSSS....',
  '....................',
]);

icon('lighthouse', { C: 'red.r@cap', G: 'glass.r@glass', y: 'yellow:4', Y: 'yellow:5', l: '#fff3a3!', k: 'line', B: 'black.y@gal', W: 'white.x@w1', X: 'white.x@w2', Z: 'white.x@w3', R: 'red.x@r1', Q: 'red.x@r2', D: 'wood.f@door', S: 'stone.r@rock', T: 'stone.r@rock2' }, [
  '.........C..........',
  '........CCC.........',
  '.......CCCCC........',
  'll.....GyyyG.....ll.',
  '..ll...GyYyG...ll...',
  '......BBBBBBB.......',
  '.......WWWWW........',
  '.......RRRRR........',
  '.......RRRRR........',
  '......XXXXXXX.......',
  '......XXXXXXX.......',
  '......QQQQQQQ.......',
  '......QQQQQQQ.......',
  '.....ZZZZZZZZZ......',
  '.....ZZZDZZZZZ......',
  '.....ZZZDZZZZZ......',
  '...SSSSSSSTTTTTT....',
  '..SSSSSSSSTTTTTTT...',
  '....................',
  '....................',
]);

// --- office, outfits & time ---------------------------------------------------
icon('briefcase', { L: 'leather.y@case', l: 'leather:2', s: 'leather:4', H: 'leather.x@h', G: 'gold.R@clasp', g: 'gold:2', P: 'gold.f@plate' }, [
  '....................',
  '....................',
  '.......HHHHHH.......',
  '......HH....HH......',
  '......H......H......',
  '..LLLLLLLLLLLLLLLL..',
  '.LLLLLLLLLLLLLLLLLL.',
  '.LsLsLsLsLsLsLsLsLL.',
  '.LLLLLLLLLLLLLLLLLL.',
  '.lllllGGllllGGlllll.',
  '.LLLLLGGLLLLGGLLLLL.',
  '.LLLLLLLLLLLLLLLLLL.',
  '.LLLLLLLPPPPLLLLLLL.',
  '.LLLLLLLPggPLLLLLLL.',
  '.LLLLLLLLLLLLLLLLLL.',
  '.LsLsLsLsLsLsLsLsLL.',
  '..LLLLLLLLLLLLLLLL..',
  '....................',
  '....................',
  '....................',
]);

icon('necktie', { T: 'red.x@tie', K: 'red.r@knot', s: 'gold:3', S: 'navy:3', C: 'white.f@collar', c: 'white:2' }, [
  '....................',
  '.....CCC....CCC.....',
  '......CCCKKCCC......',
  '.......CKKKKC.......',
  '........KKKK........',
  '.........TT.........',
  '........TTTT........',
  '........TsTT........',
  '.......TTTsST.......',
  '.......TTTTsS.......',
  '.......SsTTTT.......',
  '.......TSsTTT.......',
  '.......TTTSsT.......',
  '.......TTTTSs.......',
  '.......sSTTTT.......',
  '.......TsSTTT.......',
  '........TsST........',
  '.........TT.........',
  '....................',
  '....................',
]);

icon('tophat', { H: 'black.x@hat', h: 'black:5', T: 'black.r@top', R: 'red.y@band', r: 'red:4', B: 'black.y@brim', g: 'gold.R@pin' }, [
  '....................',
  '....................',
  '.....TTTTTTTTTT.....',
  '.....HHHHHHHHHH.....',
  '.....HhHHHHHHHH.....',
  '.....HhHHHHHHHH.....',
  '.....HhHHHHHHHH.....',
  '.....HHHHHHHHHH.....',
  '.....RRRRRRRRgR.....',
  '.....RRRRRRRRRR.....',
  '.....HHHHHHHHHH.....',
  '.BBBBBBBBBBBBBBBBBB.',
  '..BBBBBBBBBBBBBBBB..',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
].map((r, y, a) => a[(y + 17) % 20]));

icon('idbadge', { S: 'blue.x@strap', s: 'blue:2', C: 'steel.R@clip', W: 'white.f@card', b: 'blue:3', B: 'blue:2', f: 'bear:3', F: 'bear:4', m: 'tan:4', K: '#2a1a14', l: 'slate:4', L: 'slate:3', r: 'red:3' }, [
  '.....SS......SS.....',
  '......SS....SS......',
  '.......SS..SS.......',
  '........SSSS........',
  '.........CC.........',
  '....WWWWWCCWWWWW....',
  '....WbbbbbbbbbbW....',
  '....WWWWWWWWWWWW....',
  '....WBBBBWWWWWWW....',
  '....WBFFBWlllllW....',
  '....WfFmfWWWWWWW....',
  '....WfmmfWLLLLWW....',
  '....WBffBWWWWWWW....',
  '....WWWWWWlllWWW....',
  '....WWWWWWWWWWWW....',
  '....WrrrrrrrrrrW....',
  '....WWWWWWWWWWWW....',
  '....................',
  '....................',
  '....................',
]);

icon('alarm', { R: 'red.R@body', B: 'gold.R@b1', C: 'gold.R@b2', h: 'steel.x@ham', F: 'white.r@face', K: '#2a1a14', r: 'red:3', L: 'red.x@leg', t: 'slate:3' }, [
  '....................',
  '..BBB.........CCC...',
  '.BBBBB..hhh..CCCCC..',
  '.BBBB....h....CCCC..',
  '..BB.RRRRRRRR..CC...',
  '....RRRRRRRRRR......',
  '...RRFFFFtFFFFRR....',
  '...RFFFFFKFFFFFR....',
  '..RRFFFFFKFFFFFRR...',
  '..RFtFFFFKFFFFtFR...',
  '..RFFFFFFKKKKFFFR...',
  '..RRFFFFFFFFFFFRR...',
  '...RFFFFFFFFFFFR....',
  '...RRFFFFtFFFFRR....',
  '....RRRRRRRRRRR.....',
  '.....RRRRRRRRR......',
  '....LL.......LL.....',
  '...LL.........LL....',
  '....................',
  '....................',
].map((r) => r.slice(0, 19) + '.'));

icon('siren', { R: 'red.R@dome', r: 'red:5', Y: 'yellow:5!', y: 'yellow:4!', B: 'steel.y@base', b: 'steel:2' }, [
  '....................',
  '.y.......Y.......y..',
  '..y......Y......y...',
  '...y...........y....',
  '.......RRRRRR.......',
  '......RRrRRRRR......',
  '.....RRrrRRRRRR.....',
  'YY...RRrRRRRRRR...YY',
  '.....RRRRRRRRRR.....',
  '.....RRRRRRRRRR.....',
  '....BBBBBBBBBBBB....',
  '...BBBBBBBBBBBBBB...',
  '...BbBBBBBBBBBBbB...',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
].map((r, y, a) => a[(y + 17) % 20]));

icon('whistle', { B: 'brass.x@body', b: 'brass:2', D: 'brass.R@dome', L: 'wood.x@lever', S: 'white.r@s1', T: 'white.r@s2', U: 'white.r@s3', P: 'steel.x@pipe' }, [
  '..........SSS.......',
  '....TT...SSSSS......',
  '...TTTT..SSSSSSUU...',
  '...TTTTT..SSS.UUUU..',
  '....TT.........UU...',
  '........DDDD........',
  '.......DDDDDD.......',
  '.......BBBBBB.......',
  '.......BbBBbB.......',
  '.......BbBBbB.LL....',
  '.......BbBBbBLL.....',
  '.......BBBBBBL......',
  '.......BbBBbB.......',
  '.......BbBBbB.......',
  '.......BBBBBB.......',
  '........PPPP........',
  '........PPPP........',
  '.....PPPPPPPPPP.....',
  '....................',
  '....................',
]);

icon('calendar', { R: 'red.f@top', r: 'red:2', S: 'steel.R@ring', W: 'white.f@page', g: 'slate:4', K: 'ink:2', c: 'red:3' }, [
  '....................',
  '.....SS......SS.....',
  '..RRRSSRRRRRRSSRRR..',
  '..RRRSSRRRRRRSSRRR..',
  '..RRRRRRRRRRRRRRRR..',
  '..rrrrrrrrrrrrrrrr..',
  '..WWWWWWWWWWWWWWWW..',
  '..WgWgWgWgWgWgWgWW..',
  '..WWWWWWWWWWWWWWWW..',
  '..WgWgWgWcccWgWgWW..',
  '..WWWWWWcWgWcWWWWW..',
  '..WgWgWgWcccWgWgWW..',
  '..WWWWWWWWWWWWWWWW..',
  '..WgWgWgWgWgWgWgWW..',
  '..WWWWWWWWWWWWWWWW..',
  '..WgWgWgWgWWWWWWWW..',
  '..WWWWWWWWWWWWWWWW..',
  '....................',
  '....................',
  '....................',
]);

icon('clock', { W: 'wood.R@frame', F: 'cream.r@face', K: '#2a1a14', t: 'wood:2', r: 'red:3', g: 'gold.R@pin' }, () => {
  const g = new Grid(20, 20);
  g.ellipse(10, 10, 8.6, 8.6, 'W');
  g.ellipse(10, 10, 6.6, 6.6, 'F');
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    if (k % 3 === 0) g.set(Math.floor(10 + Math.cos(a) * 5.4), Math.floor(10 + Math.sin(a) * 5.4), 't');
  }
  // five o'clock
  g.line(10, 10, 10, 5, 'K');
  g.line(10, 10, 12, 13, 'K');
  g.set(10, 10, 'r');
  return g.rows();
});

icon('hourglass', { W: 'wood.y@frame', G: 'glass.r@glass', s: 'sand:4', S: 'sand:3', y: 'sand:5' }, [
  '....................',
  '...WWWWWWWWWWWWWW...',
  '...WWWWWWWWWWWWWW...',
  '....GGGGGGGGGGGG....',
  '....GsssssssssG.....',
  '.....GSsssssSG......',
  '......GSsssSG.......',
  '.......GSsSG........',
  '........GsG.........',
  '........GsG.........',
  '.......GGsGG........',
  '......GGGsGGG.......',
  '.....GGGGsGGGG......',
  '....GGGGyyyGGGG.....',
  '....GGGysssSyGG.....',
  '....GysssssssSG.....',
  '...WWWWWWWWWWWWWW...',
  '...WWWWWWWWWWWWWW...',
  '....................',
  '....................',
].map((r) => {
  const a = r.split('');
  return a.join('');
}));

icon('moon', { M: 'yellow.r@moon', c: 'yellow:2', s: 'yellow:5' }, () => {
  const g = new Grid(20, 20);
  g.ellipse(9.6, 10, 8, 8, 'M');
  g.ellipse(13.6, 7.2, 6.8, 6.8, '.');
  g.set(5, 12, 'c').set(6, 12, 'c').set(7, 15, 'c').set(4, 9, 'c');
  g.stamp(15, 13, ['.s.', 'sss', '.s.']);
  g.set(16, 3, 's');
  return g.rows();
});

icon('sun', { S: 'yellow.R@sun', R: 'orange.r@r1', Q: 'orange.r@r2' }, () => {
  const g = new Grid(20, 20);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
    const r0 = 6.6, r1 = k % 2 ? 8.6 : 9.6, w = k % 2 ? 0.26 : 0.3;
    g.poly([[10 + Math.cos(a - w) * r0, 10 + Math.sin(a - w) * r0], [10 + Math.cos(a) * r1, 10 + Math.sin(a) * r1], [10 + Math.cos(a + w) * r0, 10 + Math.sin(a + w) * r0]], k % 2 ? 'Q' : 'R');
  }
  g.ellipse(10, 10, 5.4, 5.4, 'S');
  return g.rows();
});

icon('sunrise', { S: 'yellow.R@sun', R: 'orange.r@rays', H: 'leaf.y@hill', h: 'leaf:4', W: 'water.y@w', w: 'water:5' }, () => {
  const g = new Grid(20, 20);
  for (let k = 0; k < 7; k++) {
    const a = Math.PI + (k / 6) * Math.PI;
    const x = 10 + Math.cos(a) * 8.2, y = 13 + Math.sin(a) * 8.2;
    g.poly([[10 + Math.cos(a - 0.2) * 5.6, 13 + Math.sin(a - 0.2) * 5.6], [x, y], [10 + Math.cos(a + 0.2) * 5.6, 13 + Math.sin(a + 0.2) * 5.6]], 'R');
  }
  g.ellipse(10, 13, 5.2, 5.2, 'S');
  g.rect(0, 13, 20, 20, '.');
  g.rect(1, 13, 18, 2, 'H');
  g.rect(2, 15, 16, 2, 'W');
  g.line(4, 16, 7, 16, 'w').line(11, 16, 13, 16, 'w');
  return g.rows();
});

icon('zzz', { Z: 'sky.r@z1', Y: 'sky.r@z2', X: 'sky.r@z3' }, [
  '....................',
  '...........XXXXXX...',
  '...........XXXXXX...',
  '..............XX....',
  '.............XX.....',
  '............XX......',
  '...........XXXXXX...',
  '.....YYYYY.XXXXXX...',
  '.....YYYYY..........',
  '........YY..........',
  '.......YY...........',
  '......YY............',
  '.ZZZZ.YYYYY.........',
  '.ZZZZ.YYYYY.........',
  '...Z................',
  '..Z.................',
  '.ZZZZ...............',
  '.ZZZZ...............',
  '....................',
  '....................',
].map((r) => r));

icon('lunch', { B: 'red.f@box', b: 'red:2', D: 'black.f@div', r: 'white.r@rice', K: 'ink:1', s: 'orange.r@salmon', S: 'orange:5', g: 'leaf.r@greens', G: 'leaf:4', y: 'yellow.r@egg', Y: 'yellow:5', p: 'pink.r@umeboshi', t: 'red.r@tomato' }, [
  '....................',
  '....................',
  '.BBBBBBBBBBBBBBBBBB.',
  '.BDDDDDDDDDDDDDDDDB.',
  '.BDrrrrrrDssssssSDB.',
  '.BDrrrrrrDsSsSsssDB.',
  '.BDrrprrrDssssssSDB.',
  '.BDrrrrrrDDDDDDDDDB.',
  '.BDrrrKrrDggGgyyyDB.',
  '.BDrrrrrrDgGggyYyDB.',
  '.BDrKrrrrDggggyyyDB.',
  '.BDrrrrrrDgGtgtggDB.',
  '.BDDDDDDDDDDDDDDDDB.',
  '.BBBBBBBBBBBBBBBBBB.',
  '..bbbbbbbbbbbbbbbb..',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
].map((r, y, a) => a[(y + 18) % 20]));

// --- interface glyphs (light symbols for buttons) ------------------------------
const GLY = { G: 'glyph.y', R: 'red.y@r', r: 'red:4' };

icon('play', GLY, R([
  '................',
  '................',
  '....##..........',
  '....####........',
  '....######......',
  '....########....',
  '....##########..',
  '....###########.',
  '....###########.',
  '....##########..',
  '....########....',
  '....######......',
  '....####........',
  '....##..........',
  '................',
  '................',
], 'G'));

icon('pause', GLY, R([
  '................',
  '................',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '................',
  '................',
], 'G'));

icon('fast', GLY, R([
  '................',
  '................',
  '................',
  '................',
  '.##.....##......',
  '.####...####....',
  '.######.######..',
  '.##############.',
  '.##############.',
  '.######.######..',
  '.####...####....',
  '.##.....##......',
  '................',
  '................',
  '................',
  '................',
], 'G'));

icon('faster', GLY, R([
  '................',
  '................',
  '................',
  '................',
  '.#...#...#......',
  '.##..##..##.....',
  '.###.###.###....',
  '.############...',
  '.############...',
  '.###.###.###....',
  '.##..##..##.....',
  '.#...#...#......',
  '................',
  '................',
  '................',
  '................',
].map((r) => '.' + r.slice(0, 15)), 'G'));

icon('menu', GLY, R([
  '................',
  '................',
  '................',
  '..############..',
  '..############..',
  '................',
  '................',
  '..############..',
  '..############..',
  '................',
  '................',
  '..############..',
  '..############..',
  '................',
  '................',
  '................',
], 'G'));

const SPEAKER = [
  '................',
  '................',
  '......G.........',
  '.....GG.........',
  '....GGG.........',
  '.GGGGGG.........',
  '.GGGGGG.........',
  '.GGGGGG.........',
  '.GGGGGG.........',
  '.GGGGGG.........',
  '.GGGGGG.........',
  '....GGG.........',
  '.....GG.........',
  '......G.........',
  '................',
  '................',
];
icon('speaker_on', GLY, () => Grid.from(SPEAKER).stamp(8, 3, [
  '....G...',
  '.G...G..',
  '..G..G..',
  '..G...G.',
  '..G...G.',
  '..G...G.',
  '..G...G.',
  '..G..G..',
  '.G...G..',
  '....G...',
]).rows());
icon('speaker_off', GLY, () => Grid.from(SPEAKER).stamp(8, 4, [
  'RR...RR',
  '.RR.RR.',
  '..RRR..',
  '..RRR..',
  '.RR.RR.',
  'RR...RR',
]).rows());

function ringArrow(flip) {
  const g = new Grid(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8, dy = y + 0.5 - 8.5, r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (r >= 3.7 && r <= 6.1 && !(a > -Math.PI / 2 && a < -Math.PI / 8)) g.set(x, y, 'G');
    }
  g.poly([[8.6, 0.4], [13.4, 3.4], [8.6, 7.4]], 'G');
  return flip ? flipX(g.rows()) : g.rows();
}
icon('rotate_right', GLY, () => ringArrow(false));
icon('rotate_left', GLY, () => ringArrow(true));

function zoomGlyph(plus) {
  const g = new Grid(16, 16);
  g.ellipse(6.5, 6.5, 5.6, 5.6, 'G');
  g.ellipse(6.5, 6.5, 3.4, 3.4, 'L');
  bar(g, 10, 10, 14.4, 14.4, 2.6, 'G');
  g.rect(4, 6, 5, 1, 'K');
  if (plus) g.rect(6, 4, 1, 5, 'K');
  return g.rows();
}
icon('zoom_in', { ...GLY, L: 'glass.r@lens', K: 'ink:2' }, () => zoomGlyph(true));
icon('zoom_out', { ...GLY, L: 'glass.r@lens', K: 'ink:2' }, () => zoomGlyph(false));

// --- coloured signs -------------------------------------------------------------
icon('check', { G: 'leaf.Y' }, R([
  '................',
  '................',
  '............##..',
  '...........###..',
  '..........###...',
  '.........###....',
  '.##.....###.....',
  '.###...###......',
  '..###.###.......',
  '...#####........',
  '....###.........',
  '.....#..........',
  '................',
  '................',
  '................',
  '................',
].map((r, y, a) => a[(y + 15) % 16]), 'G'));

icon('cross', { R: 'red.R' }, R([
  '................',
  '................',
  '...##......##...',
  '...###....###...',
  '....###..###....',
  '.....######.....',
  '......####......',
  '......####......',
  '.....######.....',
  '....###..###....',
  '...###....###...',
  '...##......##...',
  '................',
  '................',
  '................',
  '................',
].map((r, y, a) => a[(y + 15) % 16]), 'R'));

icon('plus', { G: 'leaf.R' }, R([
  '................',
  '................',
  '......####......',
  '......####......',
  '......####......',
  '......####......',
  '..############..',
  '..############..',
  '..############..',
  '..############..',
  '......####......',
  '......####......',
  '......####......',
  '......####......',
  '................',
  '................',
], 'G'));

icon('minus', { R: 'red.R' }, R([
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..############..',
  '..############..',
  '..############..',
  '..############..',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
], 'R'));

const ARROW = [
  '................',
  '.......##.......',
  '......####......',
  '.....######.....',
  '....########....',
  '...##########...',
  '..############..',
  '.....######.....',
  '.....######.....',
  '.....######.....',
  '.....######.....',
  '.....######.....',
  '.....######.....',
  '.....######.....',
  '................',
  '................',
];
const rot90 = (rows) => rows[0].split('').map((_, x) => rows.map((r) => r[x]).reverse().join(''));
icon('arrow_up', { G: 'leaf.R' }, R(ARROW, 'G'));
icon('arrow_down', { R: 'red.R' }, R(flipY(ARROW).map((r, y, a) => a[(y + 15) % 16]), 'R'));
icon('arrow_right', { G: 'leaf.R' }, R(rot90(ARROW), 'G'));
icon('arrow_left', { G: 'leaf.R' }, R(flipX(rot90(ARROW)).map((r) => r.slice(1) + '.'), 'G'));

// --- particles & reactions ------------------------------------------------------
icon('anger', { R: 'red.R' }, () => {
  const g = new Grid(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8, dy = y + 0.5 - 8;
      const r4 = Math.pow(dx ** 4 + dy ** 4, 0.25);
      const ax = Math.abs(dx), ay = Math.abs(dy);
      const thick = 0.5 + 0.9 * Math.min(1, Math.max(0, Math.min(ax, ay) - 1.6) / 3);
      if (Math.abs(r4 - 5.7) <= thick && ax > 1.6 && ay > 1.6) g.set(x, y, 'R');
    }
  return g.rows();
});

icon('note', { N: 'glyph.y' }, R([
  '............',
  '.....#####..',
  '.....######.',
  '.....##..##.',
  '.....##...#.',
  '.....##.....',
  '.....##.....',
  '..#####.....',
  '.######.....',
  '.######.....',
  '..####......',
  '............',
], 'N'));

icon('bang', { R: 'red.R' }, R([
  '............',
  '.....###....',
  '....####....',
  '....####....',
  '....###.....',
  '....###.....',
  '....##......',
  '....##......',
  '............',
  '...###......',
  '...###......',
  '............',
].map((r) => '.' + r.slice(0, 11)), 'R'));

icon('drop', { B: 'sky.R' }, R([
  '............',
  '.....#......',
  '.....##.....',
  '....####....',
  '....####....',
  '...######...',
  '..########..',
  '..########..',
  '..########..',
  '...######...',
  '....####....',
  '............',
].map((r) => r.replace(/^(.{6})/, '$1')), 'B'));

icon('music', { N: 'blue.R@n', M: 'blue.R@m', b: 'blue:2' }, [
  '....................',
  '.........NNNNNNNNN..',
  '.......NNNNNNNNNNN..',
  '.......NNNNNNNNNNN..',
  '.......NNbbbbbbbNN..',
  '.......NN.......NN..',
  '.......NN.......NN..',
  '.......NN.......NN..',
  '.......NN.......NN..',
  '.......NN.......NN..',
  '.......NN.......NN..',
  '.......NN....MMMNN..',
  '...MMMMNN...MMMMNN..',
  '..MMMMMNN..MMMMMNN..',
  '..MMMMMNN..MMMMMNN..',
  '..MMMMMN...MMMMMM...',
  '...MMMM.....MMMM....',
  '....................',
  '....................',
  '....................',
]);

icon('fastforward', { G: 'gold.R@a', H: 'gold.R@b', s: 'gold:4' }, [
  '....................',
  '....................',
  '....................',
  '....................',
  '..GG......HH........',
  '..GGGG....HHHH......',
  '..GGGGGG..HHHHHH....',
  '..GGGGGGGGHHHHHHHH..',
  '..GGGGGGGGGHHHHHHHH.',
  '..GGGGGGGGGHHHHHHHH.',
  '..GGGGGGGGHHHHHHHH..',
  '..GGGGGG..HHHHHH....',
  '..GGGG....HHHH......',
  '..GG......HH........',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
].map((r, y, a) => a[(y + 19) % 20]));

icon('skip', { G: 'gold.R@a', B: 'gold.x@bar' }, [
  '....................',
  '....................',
  '....................',
  '...GG.........BBB...',
  '...GGGG.......BBB...',
  '...GGGGGG.....BBB...',
  '...GGGGGGGG...BBB...',
  '...GGGGGGGGGG.BBB...',
  '...GGGGGGGGGGGBBB...',
  '...GGGGGGGGGGGBBB...',
  '...GGGGGGGGGG.BBB...',
  '...GGGGGGGG...BBB...',
  '...GGGGGG.....BBB...',
  '...GGGG.......BBB...',
  '...GG.........BBB...',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
].map((r, y, a) => a[(y + 19) % 20]));

icon('yum', { Y: 'yellow.R@face', K: '#2a1a14', p: 'pink.r@t', P: 'rose:3', c: 'pink:3', m: 'red:1' }, () => {
  const g = new Grid(20, 20).ellipse(10, 9.6, 8.4, 8.4, 'Y');
  g.stamp(4, 6, ['.KK...', 'K..K..']);
  g.stamp(11, 6, ['.KK...', 'K..K..'].map((r) => r));
  g.stamp(3, 10, ['cc..........cc']);
  g.stamp(5, 11, [
    'K........K',
    '.KmmmmmmK.',
    '..KmmPPK..',
    '....pPP...',
    '....ppP...',
    '.....pp...',
  ]);
  return g.rows();
});

// --- critters: bears, beaver, Reynard ----------------------------------------
// [v26 faces3d] "When using a character face never use 2D": the 2D bear / beaver / Reynard
// face art is gone. The names stay registered at their frame sizes (20 x 20 icons, 32 x 32
// Reynard portraits) and spriteCanvas / spriteURL / spriteImg fill them with renders of the
// real 3D rigs (src/ui/faces3d.js). Without WebGL they are blank.
const FACE_SPRITES = {
  20: ['bear', 'bear_happy', 'bear_angry', 'bear_office', 'bear_intern', 'bear_janitor', 'bear_accountant', 'bear_construction',
    'bear_boss', 'bear_ceo', 'bear_cub', 'bear_tourist', 'bear_critic', 'bear_lumberjack', 'beaver', 'fox'],
  32: ['smug', 'greedy', 'shocked', 'laugh', 'wink', 'angry', 'worried', 'sleepy', 'happy', 'proud', 'teacher', 'horror'].map((e) => 'fox_' + e),
};
for (const [n, names] of Object.entries(FACE_SPRITES)) for (const name of names) draw(name, () => new Pix(+n, +n));

//@@NEW_BEGIN@@
// --- shared pixel font (bold 5x6 caps) --------------------------------------
const FONT = {
  w: 5,
  sp: 1,
  g: {
    A: ['.###.', '##.##', '##.##', '#####', '##.##', '##.##'],
    B: ['####.', '##.##', '####.', '##.##', '##.##', '####.'],
    C: ['.####', '##...', '##...', '##...', '##...', '.####'],
    D: ['####.', '##.##', '##.##', '##.##', '##.##', '####.'],
    E: ['#####', '##...', '####.', '##...', '##...', '#####'],
    F: ['#####', '##...', '####.', '##...', '##...', '##...'],
    G: ['.####', '##...', '##.##', '##.##', '##.##', '.####'],
    I: ['####', '.##.', '.##.', '.##.', '.##.', '####'],
    J: ['...##', '...##', '...##', '...##', '##.##', '.###.'],
    K: ['##..#', '##.##', '####.', '####.', '##.##', '##..#'],
    L: ['##...', '##...', '##...', '##...', '##...', '#####'],
    M: ['#...#', '##.##', '#####', '#.#.#', '#.#.#', '#...#'],
    O: ['.###.', '##.##', '##.##', '##.##', '##.##', '.###.'],
    P: ['####.', '##.##', '##.##', '####.', '##...', '##...'],
    R: ['####.', '##.##', '##.##', '####.', '##.##', '##.##'],
    S: ['.####', '##...', '.###.', '...##', '...##', '####.'],
    U: ['##.##', '##.##', '##.##', '##.##', '##.##', '.###.'],
    V: ['##.##', '##.##', '##.##', '##.##', '.###.', '..#..'],
    W: ['#...#', '#...#', '#.#.#', '#.#.#', '#####', '.#.#.'],
    '!': ['##', '##', '##', '##', '..', '##'],
    '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..'],
    ' ': ['...', '...', '...', '...', '...', '...'],
  },
};
function textW(str, font = FONT) {
  let w = 0;
  for (const c of str) w += (font.g[c] || font.g[' '])[0].length + font.sp;
  return w - font.sp;
}
// scale a glyph's rows by an integer factor
const scaleRows = (rows, k) => rows.flatMap((r) => Array(k).fill(r.split('').map((c) => c.repeat(k)).join('')));
const P20 = (rows, w = 20) => rows.map((r) => r.padEnd(w, '.'));

// ===========================================================================
// STICKERS (die-cut: 2px white border + 1px soft shadow)
// ===========================================================================
function dieCut(p, bw = 2) {
  const P = p.pad(bw, bw, bw + 1, bw + 1);
  const W = P.w, H = P.h;
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (P.a(x, y) > 40) m[y * W + x] = 1;
  const rg = new Uint8Array(W * H);
  const r2 = (bw + 0.5) * (bw + 0.5);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      for (let dy = -bw; dy <= bw; dy++)
        for (let dx = -bw; dx <= bw; dx++) {
          if (dx * dx + dy * dy > r2) continue;
          const X = x + dx, Y = y + dy;
          if (X >= 0 && Y >= 0 && X < W && Y < H) rg[Y * W + X] = 1;
        }
    }
  const out = new Pix(W, H);
  const inR = (x, y) => x >= 0 && y >= 0 && x < W && y < H && rg[y * W + x];
  // soft shadow: region shifted 1px down-right
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (!inR(x, y) && inR(x - 1, y - 1)) out.put(x, y, INK, inR(x, y - 1) || inR(x - 1, y) ? 92 : 56);
  const WH = [255, 255, 255], EDGE = [232, 228, 238];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!rg[y * W + x]) continue;
      // outermost ring on the lower-right reads as the paper's thickness
      const edge = !inR(x + 1, y) || !inR(x, y + 1);
      out.put(x, y, edge && (!inR(x + 1, y + 1)) ? EDGE : WH);
    }
  return out.draw(P);
}
const spx = (name) => SPRITES[name].px.clone();
function sticker(name, fn) {
  draw(name, () => dieCut(fn()));
}
// add a cute face to a Pix: eyes at (ex0, ey) / (ex1, ey), smile centred at mx
function cuteFace(p, ex0, ex1, ey, mx, my, blush = true) {
  const K = [42, 26, 20], W = [255, 255, 255], B = [255, 128, 150];
  for (const ex of [ex0, ex1]) {
    p.put(ex, ey, W); p.put(ex + 1, ey, K); p.put(ex, ey + 1, K); p.put(ex + 1, ey + 1, K);
  }
  p.put(mx - 1, my, K); p.put(mx + 1, my, K); p.put(mx, my + 1, K);
  if (blush) {
    p.over(ex0 - 2, ey + 2, B, 190); p.over(ex0 - 1, ey + 2, B, 190);
    p.over(ex1 + 2, ey + 2, B, 190); p.over(ex1 + 3, ey + 2, B, 190);
  }
  return p;
}

sticker('sticker_star', () => cuteFace(spx('star'), 7, 11, 10, 10, 13));
sticker('sticker_heart', () => cuteFace(spx('heart'), 6, 12, 7, 10, 10));
sticker('sticker_fish', () => spx('fish'));
sticker('sticker_maple', () => spx('maple'));
sticker('sticker_crown', () => spx('crown'));
sticker('sticker_bear', () => spx('bear'));
sticker('sticker_egg', () => cuteFace(spx('egg'), 7, 11, 11, 10, 14));

sticker('sticker_smiley', () => {
  const g = new Grid(20, 20).ellipse(10, 10, 9, 9, 'Y');
  for (const ex of [7, 12]) g.set(ex, 6, 'w').set(ex, 7, 'K').set(ex, 8, 'K');
  g.set(4, 10, 'p').set(5, 10, 'p').set(14, 10, 'p').set(15, 10, 'p');
  g.stamp(5, 11, ['K........K', '.KKKKKKKK.', '..KrrrrK..', '...KKKK...']);
  return render(g, { Y: 'yellow.R', p: 'pink:3', K: '#2a1a14', w: '#ffffff', r: 'red:3' });
});

sticker('sticker_paw', () => {
  const g = new Grid(20, 20);
  g.ellipse(10, 13.2, 5.6, 4.6, 'P');
  g.ellipse(3.8, 8.2, 2.2, 2.7, 'T').ellipse(7.8, 4.4, 2.3, 2.8, 'U').ellipse(12.2, 4.4, 2.3, 2.8, 'V').ellipse(16.2, 8.2, 2.2, 2.7, 'X');
  return render(g, { P: 'pink.R@pad', T: 'pink.R@t1', U: 'pink.R@t2', V: 'pink.R@t3', X: 'pink.R@t4' });
});

sticker('sticker_thumb', () => {
  const g = Grid.from(P20([
    '....................',
    '.........SS.........',
    '........SSSS........',
    '........SSSS........',
    '.......SSSS.........',
    '.......SSSS.........',
    '......SSSSS.........',
    '.CCC.SSSSSSSSSSSSS..',
    '.CCC.SSSSSSSSSSSSSS.',
    '.CCC.SSSSSSkkkkkkkS.',
    '.CCC.SSSSSSSSSSSSSS.',
    '.CCC.SSSSSSkkkkkkkS.',
    '.CCC.SSSSSSSSSSSSSS.',
    '.CCC.SSSSSSkkkkkkS..',
    '.CCC.SSSSSSSSSSSSS..',
    '.CCC.SSSSSSkkkkkS...',
    '.CCC..SSSSSSSSSSS...',
    '....................',
  ]));
  g.set(2, 8, 'c').set(2, 9, 'c');
  return render(g, { S: 'yellow.R', C: 'blue.x', c: 'blue:5' });
});

sticker('sticker_rainbow', () => {
  const g = new Grid(22, 15);
  const bands = 'roygbp';
  for (let y = 0; y < 15; y++)
    for (let x = 0; x < 22; x++) {
      const d = Math.hypot(x + 0.5 - 11, y + 0.5 - 13);
      const i = Math.floor(10.5 - d);
      if (i >= 0 && i < 6 && y < 13) g.set(x, y, bands[i]);
    }
  for (const cx of [3.2, 18.8]) {
    g.ellipse(cx, 11.8, 3.2, 2.4, 'W').ellipse(cx - 1.6, 12.6, 2.2, 1.8, 'W').ellipse(cx + 1.8, 12.6, 2.2, 1.8, 'W');
  }
  return render(g, { r: 'red:3', o: 'orange:3', y: 'yellow:3', g: 'leaf:4', b: 'blue:3', p: 'purple:4', W: 'white.R' });
});

sticker('sticker_coffee', () => {
  const g = Grid.from(P20([
    '......s...s.........',
    '.....s...s..........',
    '......s...s.........',
    '....................',
    '..MMMMMMMMMMMMM.....',
    '..MccccccccccdM.....',
    '..MMMMMMMMMMMMMMMM..',
    '..MMMMMMMMMMMMM..MM.',
    '..MMMMHHMHHMMMM...M.',
    '..MMMMHHHHHMMMM...M.',
    '..MMMMMHHHMMMMM..MM.',
    '..MMMMMMHMMMMMMMMM..',
    '..MMMMMMMMMMMMM.....',
    '...MMMMMMMMMMM......',
    '.PPPPPPPPPPPPPPPP...',
    '..PPPPPPPPPPPPPP....',
  ]));
  return render(g, { M: 'red.x@mug', H: 'cream:4', c: 'syrup:2', d: 'syrup:3', P: 'cream.y', s: 'white:2!' });
});

sticker('sticker_wow', () => {
  const W = 27, H = 21, cx = 13.5, cy = 10.5;
  const g = new Grid(W, H);
  const pts = [];
  for (let i = 0; i < 24; i++) {
    const a = (i * Math.PI) / 12, rr = i % 2 ? 0.74 : 1;
    pts.push([cx + Math.cos(a) * 13.2 * rr, cy + Math.sin(a) * 10.2 * rr]);
  }
  g.poly(pts, 'Y');
  const tx = Math.round(cx - textW('WOW!') / 2);
  const t = new Grid(W, H).text(tx, 7, 'WOW!', FONT, 'r');
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (t.get(x, y) !== 'r') continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]]) if (t.get(x + dx, y + dy) === '.' && g.get(x + dx, y + dy) !== '.') g.set(x + dx, y + dy, dx + dy === 2 || dy === 1 ? 'q' : 'Q');
    }
  for (let i = 0; i < t.c.length; i++) if (t.c[i] === 'r') g.c[i] = 'r';
  for (const [x, y] of [[5, 5], [21, 4], [4, 15], [22, 16]]) g.set(x, y, 'o');
  return render(g, { Y: 'yellow.R', r: 'parch:5', Q: 'red:2', q: 'red:1', o: 'orange:4' });
});

sticker('sticker_good', () => {
  const W = 27, H = 17;
  const g = new Grid(W, H);
  g.rect(1, 0, W - 2, H, 'G').rect(0, 1, W, H - 2, 'G');
  g.text(Math.round(W / 2 - textW('GOOD') / 2), 2, 'GOOD', FONT, 't');
  g.text(Math.round(W / 2 - textW('JOB') / 2), 9, 'JOB', FONT, 't');
  g.set(2, 3, 'y').set(W - 3, 3, 'y').set(2, H - 4, 'y').set(W - 3, H - 4, 'y');
  return render(g, { G: 'green.f', t: 'parch:4', y: 'gold:4' });
});

// ===========================================================================
// RUBBER STAMPS (rough ink)
// ===========================================================================
const STAMP_INK = { red: [196, 44, 40], green: [44, 132, 70], blue: [44, 88, 178], amber: [200, 128, 22] };
function inkStamp(w, h, paint, ink, seed, angle = -0.07) {
  const src = new Grid(w, h);
  paint(src);
  const r = rng(seed);
  // value noise for uneven ink
  const nW = Math.ceil(w / 4) + 2, nH = Math.ceil(h / 4) + 2;
  const nz = Array.from({ length: nW * nH }, () => r());
  const noise = (x, y) => {
    const fx = x / 4, fy = y / 4, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const v = (i, j) => nz[Math.min(nH - 1, j) * nW + Math.min(nW - 1, i)];
    return (v(ix, iy) * (1 - tx) + v(ix + 1, iy) * tx) * (1 - ty) + (v(ix, iy + 1) * (1 - tx) + v(ix + 1, iy + 1) * tx) * ty;
  };
  const cx = w / 2, cy = h / 2, ca = Math.cos(angle), sa = Math.sin(angle);
  const m = new Uint8Array(w * h), T8 = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const sx = Math.floor(cx + dx * ca + dy * sa), sy = Math.floor(cy - dx * sa + dy * ca);
      const ch = src.get(sx, sy);
      if (ch !== '.') m[y * w + x] = 1;
      if (ch === 't') T8[y * w + x] = 1;
    }
  const p = new Pix(w, h);
  const dark = mix(ink, INK, 0.35);
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const on = at(x, y), clean = on && T8[y * w + x];
      const edge = on && (!at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1));
      const near = !on && (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1));
      const n = noise(x, y), q = r();
      if (on) {
        if (!clean && (q < 0.02 + (n < 0.22 ? 0.06 : 0) || (edge && q < 0.07))) continue;
        const a = Math.round(255 * ((clean ? 0.8 : 0.7) + (clean ? 0.2 : 0.3) * n));
        p.put(x, y, n > 0.78 ? dark : ink, a);
      } else if (near && q < 0.035) p.put(x, y, ink, 140);
    }
  return p;
}
function ringPaint(g, cx, cy, ro, ri) {
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= ro && d > ri) g.set(x, y, '#');
    }
}
function gradeStamp(name, letter, plus, ink) {
  draw(name, () =>
    inkStamp(42, 42, (g) => {
      ringPaint(g, 21, 21, 20.4, 18.2);
      ringPaint(g, 21, 21, 16.9, 15.9);
      const L = scaleRows(FONT.g[letter], 2);
      const lw = L[0].length + (plus ? 6 : 0);
      const x0 = Math.round(21 - lw / 2);
      g.stamp(x0, 15, L.map((r) => r.replace(/#/g, 't')));
      if (plus) g.stamp(x0 + L[0].length + 1, 17, ['..t..', '..t..', 'ttttt', '..t..', '..t..']);
      // little stars left/right
      for (const sx of [7, 34]) g.stamp(sx - 1, 20, ['.#.', '###', '.#.']);
    }, ink, hashStr(name), 0),
  );
}
gradeStamp('stamp_Aplus', 'A', true, STAMP_INK.green);
gradeStamp('stamp_A', 'A', false, STAMP_INK.green);
gradeStamp('stamp_B', 'B', false, STAMP_INK.blue);
gradeStamp('stamp_C', 'C', false, STAMP_INK.amber);
gradeStamp('stamp_D', 'D', false, STAMP_INK.amber);
gradeStamp('stamp_F', 'F', false, STAMP_INK.red);

function wordStamp(name, word, ink = STAMP_INK.red) {
  draw(name, () => {
    const tw = textW(word);
    const w = Math.max(42, tw + 14), h = 20;
    return inkStamp(w, h, (g) => {
      // double border with rounded corners
      g.rect(1, 0, w - 2, 2, '#').rect(1, h - 2, w - 2, 2, '#').rect(0, 1, 2, h - 2, '#').rect(w - 2, 1, 2, h - 2, '#');
      g.rect(3, 3, w - 6, 1, '#').rect(3, h - 4, w - 6, 1, '#').rect(3, 3, 1, h - 6, '#').rect(w - 4, 3, 1, h - 6, '#');
      g.set(0, 0, '.').set(w - 1, 0, '.').set(0, h - 1, '.').set(w - 1, h - 1, '.');
      g.text(Math.round(w / 2 - tw / 2), 7, word, FONT, 't');
    }, ink, hashStr(name), 0);
  });
}
wordStamp('stamp_approved', 'APPROVED');
wordStamp('stamp_paid', 'PAID');
wordStamp('stamp_seeme', 'SEE ME!');
wordStamp('stamp_overdue', 'OVERDUE');
wordStamp('stamp_closed', 'CLOSED');
wordStamp('stamp_offwork', 'OFF WORK');

// ===========================================================================
// EGGS (hatching ceremony): egg_<rarity>_<stage>
// ===========================================================================
const EGG_W = 24, EGG_H = 30, EGG_CX = 12, EGG_CY = 17.6;
const EGG_KEYS = {
  common: { E: 'cream.R@sh', d: 'syrup.R@sh', D: 'cinnamon.R@sh' },
  uncommon: { E: 'mint.R@sh', d: 'leaf.R@sh', D: 'green.R@sh' },
  rare: { E: 'sky.R@sh', d: 'blue.R@sh', D: 'white.R@sh' },
  epic: { E: 'purple.R@sh', d: 'lilac:5', D: 'yellow:4', s: 'lilac:3' },
  legendary: { E: 'gold.R@sh', d: 'red.R@sh', D: 'gold:1', r: 'rose:3', b: 'blue:4', g: 'mint:4' },
};
const EGG_PATTERN = {
  common(g, r) {
    for (let i = 0; i < 46; i++) {
      const x = Math.floor(3 + r() * 18), y = Math.floor(5 + r() * 23);
      if (g.get(x, y) !== 'E' || (x < 9 && y < 12 && r() < 0.7)) continue;
      g.set(x, y, r() < 0.4 ? 'D' : 'd');
      if (r() < 0.3 && g.get(x + 1, y) === 'E') g.set(x + 1, y, 'd');
      if (r() < 0.15 && g.get(x, y + 1) === 'E') g.set(x, y + 1, 'd');
    }
  },
  uncommon(g, r) {
    // a curling vine with leaves around the belly, plus a sprig on top
    const vy = (x) => 18 + Math.sin(x * 0.7) * 1.6;
    for (let x = 2; x < 22; x++) if (g.get(x, Math.round(vy(x))) === 'E') g.set(x, Math.round(vy(x)), 'D');
    const leaf = [['.dd', 'dd.'], ['dd.', '.dd']];
    for (let x = 4, k = 0; x < 20; x += 3, k++) {
      const y = Math.round(vy(x)) + (k % 2 ? 1 : -2);
      leaf[k % 2].forEach((row, j) => {
        for (let i = 0; i < 3; i++) if (row[i] === 'd' && g.get(x + i - 1, y + j) === 'E') g.set(x + i - 1, y + j, 'd');
      });
    }
    for (const [x, y] of [[12, 7], [13, 7], [11, 8], [12, 8], [14, 9], [9, 11], [10, 11], [15, 12], [16, 12], [7, 24], [8, 24], [15, 25], [16, 24]])
      if (g.get(x, y) === 'E') g.set(x, y, 'd');
  },
  rare(g) {
    for (const [y0, ph] of [[12, 0], [19, 1.6], [25, 0.8]]) {
      for (let x = 0; x < EGG_W; x++) {
        const y = Math.round(y0 + Math.sin(x * 0.9 + ph) * 1.2);
        for (const yy of [y, y + 1]) if (g.get(x, yy) === 'E') g.set(x, yy, 'd');
        if (Math.sin(x * 0.9 + ph) < -0.7 && g.get(x, y - 1) === 'E') g.set(x, y - 1, 'D');
      }
    }
  },
  epic(g, r) {
    const spark = (x, y, big) => {
      const pts = big ? [[0, -2], [0, -1], [-2, 0], [-1, 0], [1, 0], [2, 0], [0, 1], [0, 2]] : [[0, -1], [-1, 0], [1, 0], [0, 1]];
      for (const [dx, dy] of pts) if (g.get(x + dx, y + dy) === 'E') g.set(x + dx, y + dy, 's');
      if (g.get(x, y) === 'E') g.set(x, y, 'd');
    };
    spark(15, 10, true); spark(8, 17, true); spark(15, 22, true);
    spark(10, 9, false); spark(17, 16, false); spark(6, 24, false); spark(11, 25, false);
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(4 + r() * 16), y = Math.floor(6 + r() * 21);
      if (g.get(x, y) === 'E') g.set(x, y, 'D');
    }
  },
  legendary(g) {
    // jewelled band
    for (let x = 0; x < EGG_W; x++) for (const y of [24, 26]) if (g.get(x, y) === 'E') g.set(x, y, 'D');
    for (const [x, c] of [[6, 'b'], [9, 'r'], [12, 'g'], [15, 'r'], [18, 'b']]) {
      if (g.get(x, 25) === 'E') g.set(x, 25, c);
      if (g.get(x + 1, 25) === 'E') g.set(x + 1, 25, '+');
    }
    // maple-leaf emblem
    g.stamp(7, 11, [
      '.....d.....',
      '...d.d.d...',
      '...ddddd...',
      'd..ddddd..d',
      '.ddddddddd.',
      '..ddddddd..',
      '...ddddd...',
      '.....d.....',
      '.....d.....',
    ].map((row) => row.replace(/\./g, '.')));
  },
};
function eggBase(rar) {
  const g = eggShape(new Grid(EGG_W, EGG_H), EGG_CX, EGG_CY, 9, 13, 10.4, 'E');
  EGG_PATTERN[rar](g, rng(hashStr(rar)));
  return g;
}
const isShell = (ch) => ch !== '.' && ch !== 'k' && ch !== 'L';
function eggSprite(rar, stage) {
  const key = { ...EGG_KEYS[rar], L: '#fff6c0', l: '#ffe98a' };
  draw(`egg_${rar}_${stage}`, () => {
    let g = eggBase(rar);
    if (stage === 1) {
      const pts = [[15, 6], [14, 8], [16, 10], [13, 12], [14, 14], [12, 15]];
      for (let i = 1; i < pts.length; i++) {
        const t = new Grid(EGG_W, EGG_H).line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], '#');
        for (let j = 0; j < t.c.length; j++) if (t.c[j] === '#' && isShell(g.c[j])) g.c[j] = 'k';
      }
      g.set(16, 9, 'k');
    }
    let rays = null;
    if (stage === 2) {
      const zz = [0, -2, 1, -1, 2, -2, 0, 2, -1];
      const crack = new Grid(EGG_W, EGG_H);
      for (let i = 0; i < zz.length - 1; i++) crack.line(1 + i * 3, 15 + zz[i], 1 + (i + 1) * 3, 15 + zz[i + 1], '#');
      // a branch running down
      crack.line(13, 16, 11, 19, '#').line(11, 19, 12, 21, '#');
      const glow = [];
      for (let j = 0; j < crack.c.length; j++) {
        if (crack.c[j] !== '#' || !isShell(g.c[j])) continue;
        g.c[j] = 'L';
        glow.push(j);
      }
      for (const j of glow) {
        const x = j % EGG_W, y = (j / EGG_W) | 0;
        for (const [dx, dy] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
          const ch = g.get(x + dx, y + dy);
          if (isShell(ch)) g.set(x + dx, y + dy, dy < 0 ? 'k' : 'l');
        }
      }
      rays = glow;
    }
    if (stage === 3) {
      const crackY = (x) => 15.5 + [0, 1, 2, 1][x % 4] - 1;
      const cap = new Grid(EGG_W, EGG_H);
      const bottom = new Grid(EGG_W, EGG_H);
      for (let y = 0; y < EGG_H; y++)
        for (let x = 0; x < EGG_W; x++) {
          const ch = g.get(x, y);
          if (ch === '.') continue;
          (y >= crackY(x) ? bottom : cap).set(x, y, ch);
        }
      // hollow interior seen from slightly above
      for (let y = 0; y < EGG_H; y++)
        for (let x = 0; x < EGG_W; x++) {
          const dx = (x + 0.5 - EGG_CX) / 7.4, dy = (y + 0.5 - 17.2) / 2.3;
          if (dx * dx + dy * dy <= 1) bottom.set(x, y, dy < 0.2 ? 'I' : 'J');
        }
      // tipped cap floating up and to the right
      const out = new Grid(EGG_W, EGG_H);
      for (let y = 0; y < EGG_H; y++)
        for (let x = 0; x < EGG_W; x++) {
          const ch = cap.get(x, y);
          if (ch !== '.') out.set(x + 1, y - 4 - Math.round((x - 12) * 0.13), ch);
        }
      // the cap's broken lower edge shows its hollow underside
      for (let x = 0; x < EGG_W; x++) {
        let yb = -1;
        for (let y = EGG_H - 1; y >= 0; y--) if (out.get(x, y) !== '.') { yb = y; break; }
        if (yb >= 0) out.set(x, yb, 'J');
      }
      for (let i = 0; i < out.c.length; i++) if (bottom.c[i] !== '.') out.c[i] = bottom.c[i];
      g = out;
      key.I = EGG_KEYS[rar].E.split('.')[0].split(':')[0] + ':2';
      key.J = EGG_KEYS[rar].E.split('.')[0].split(':')[0] + ':1';
    }
    let p = render(g, key);
    if (rays) {
      // light leaking out: soft halo and rays from the crack ends
      const lt = [255, 243, 163];
      for (const [x0, y0, dx, dy] of [[0, 15, -1, -0.4], [23, 15, 1, -0.5], [0, 15, -1, 0.3], [23, 14, 1, 0.4]]) {
        for (let s = 1; s < 4; s++) {
          const x = Math.round(x0 + dx * s), y = Math.round(y0 + dy * s);
          if (!p.a(x, y)) p.over(x, y, lt, 200 - s * 45);
        }
      }
      for (const [x, y] of [[12, 1], [5, 4], [19, 4], [2, 9], [22, 9]]) if (!p.a(x, y)) p.over(x, y, lt, 170);
    }
    if (stage === 3) {
      const lt = [255, 246, 192];
      for (const [x, y, a] of [[4, 12, 220], [19, 15, 200], [7, 9, 150], [3, 16, 140], [21, 19, 160], [11, 13, 120]]) if (!p.a(x, y)) p.over(x, y, lt, a);
    }
    return p;
  });
}
for (const rar of ['common', 'uncommon', 'rare', 'epic', 'legendary']) for (let st = 0; st < 4; st++) eggSprite(rar, st);

// ===========================================================================
// B&W EMOTES (12x12) for comic speech bubbles
// ===========================================================================
const EMO_KEY = { K: '#141414', w: '#ffffff', g: '#9a9a9a', l: '#d4d4d4', d: '#505050' };
function emo(name, rows) {
  icon('emo_' + name, EMO_KEY, P20(rows, 12).slice(0, 12).concat(Array(Math.max(0, 12 - rows.length)).fill('............')), { ol: false });
}
emo('heart', [
  '............',
  '..KKK..KKK..',
  '.KKwKKKKKKK.',
  '.KwKKKKKKKK.',
  '.KKKKKKKKKK.',
  '.KKKKKKKKKK.',
  '..KKKKKKKK..',
  '...KKKKKK...',
  '....KKKK....',
  '.....KK.....',
  '............',
  '............',
]);
emo('anger', [
  '............',
  '...KK..KK...',
  '...KK..KK...',
  '.KKKK..KKKK.',
  '.KKK....KKK.',
  '............',
  '............',
  '.KKK....KKK.',
  '.KKKK..KKKK.',
  '...KK..KK...',
  '...KK..KK...',
  '............',
]);
emo('sweat', [
  '.....KK.....',
  '.....KK.....',
  '....KwwK....',
  '....KwwK....',
  '...KwwwwK...',
  '..KwwwwwwK..',
  '..KwKwwwlK..',
  '..KwKwwwlK..',
  '..KwwwwllK..',
  '...KwwllK...',
  '....KKKK....',
  '............',
]);
emo('exclaim', [
  '...KKKKKK...',
  '...KwwwwK...',
  '...KwwwwK...',
  '....KwwK....',
  '....KwwK....',
  '....KwlK....',
  '.....KK.....',
  '............',
  '....KKKK....',
  '....KwlK....',
  '....KKKK....',
  '............',
]);
emo('question', [
  '...KKKKKK...',
  '..KKKKKKKK..',
  '..KKK..KKK..',
  '.......KKK..',
  '......KKK...',
  '.....KKK....',
  '.....KK.....',
  '.....KK.....',
  '............',
  '.....KK.....',
  '.....KK.....',
  '............',
]);
emo('music', [
  '............',
  '....KKKKKKK.',
  '....KKKKKKK.',
  '....K.....K.',
  '....K.....K.',
  '....K.....K.',
  '....K.....K.',
  '..KKK...KKK.',
  '.KKKK..KKKK.',
  '.KKKK..KKKK.',
  '..KK....KK..',
  '............',
]);
emo('zzz', [
  '......KKKKKK',
  '......KKKKKK',
  '.........KK.',
  '........KK..',
  '.......KK...',
  '......KKKKKK',
  '......KKKKKK',
  'KKKK........',
  '...K........',
  '..K.........',
  '.K..........',
  'KKKK........',
]);
emo('skull', [
  '...KKKKKK...',
  '..KwwwwwwK..',
  '.KwwwwwwwlK.',
  '.KwKKwwKKlK.',
  '.KwKKwwKKlK.',
  '.KwwwKKwwlK.',
  '..KwwwwwlK..',
  '...KwKKwK...',
  '...KKKKKK...',
  'K..........K',
  '.KK......KK.',
  '...KK..KK...',
]);
emo('dollar', [
  '.....KK.....',
  '...KKKKKK...',
  '..KKKKKKKK..',
  '..KKK.KK....',
  '..KKKKKK....',
  '...KKKKKK...',
  '....KKKKKK..',
  '.....KK.KK..',
  '..KKKKKKKK..',
  '...KKKKKK...',
  '.....KK.....',
  '............',
]);
emo('sparkle', [
  '.....K......',
  '.....K......',
  '....KKK.....',
  '....KKK.....',
  '.KKKKKKKKK..',
  '....KKK.....',
  '....KKK...K.',
  '.....K...KKK',
  '.....K....K.',
  '.K..........',
  'KKK.........',
  '.K..........',
]);
emo('idea', [
  '....KKKK....',
  '...KwwwwK...',
  '..KwwKwwwK..',
  '..KwKwwwwK..',
  '..KwwwwwwK..',
  '..KwwwwwlK..',
  '...KwwwlK...',
  '....KwlK....',
  '....KKKK....',
  '....KllK....',
  '....KKKK....',
  '.....KK.....',
]);
emo('tear', [
  '............',
  '..K......K..',
  '...KKKKKK...',
  '............',
  '.......K....',
  '......KwK...',
  '......KwK...',
  '.....KwwwK..',
  '.....KwKlK..',
  '.....KwllK..',
  '......KKK...',
  '............',
]);
const FACE = (rows) => rows;
emo('stareyes', FACE([
  '...KKKKKK...',
  '..KwwwwwwK..',
  '.KwKwwwwKwK.',
  'KwKKKwwKKKwK',
  'KwwKwwwwKwwK',
  'KwwwwwwwwwwK',
  'KwwKKKKKKwwK',
  'KwwwKddKwwwK',
  '.KwwwKKwwwK.',
  '..KwwwwwwK..',
  '...KKKKKK...',
  '............',
]));
emo('drool', FACE([
  '...KKKKKK...',
  '..KwwwwwwK..',
  '.KwKwwwwKwK.',
  'KwKwKwwKwKwK',
  'KwwwwwwwwwwK',
  'KwwwwwwwwwwK',
  'KwKKKKKKKwwK',
  '.KKddddKKwK.',
  '..KKKKKKwK..',
  '...KwKKKK...',
  '...KwK......',
  '....K.......',
]));
emo('think', [
  '............',
  '.......KKKK.',
  '......KwwwwK',
  '......KwwwwK',
  '......KwwwlK',
  '.......KKKK.',
  '...KKK......',
  '..KwwlK.....',
  '...KKK......',
  '.KK.........',
  'KwlK........',
  '.KK.........',
]);
emo('hungry', [
  '.K.K.K....K.',
  '.K.K.K...KK.',
  '.K.K.K...KK.',
  '.KKKKK..KKK.',
  '..KKK...KKK.',
  '...K....KKK.',
  '...K.....KK.',
  '...K.....K..',
  '...K.....K..',
  '...K.....K..',
  '..KKK...KKK.',
  '..KKK...KKK.',
]);
emo('fish', [
  '............',
  '............',
  '....KKKKK...',
  'K.KKwwwwwKK.',
  'KKwwwwwwKwwK',
  'KwKwwwwwwwwK',
  'KKwwwllllwK.',
  'K.KKllllKK..',
  '....KKKKK...',
  '............',
  '............',
  '............',
]);
emo('bone', [
  '............',
  '.KK......KK.',
  'KwwK....KwwK',
  'KwwwKKKKwwwK',
  '.KwwwwwwwwK.',
  '.KwwwwwwwlK.',
  'KwwlKKKKKllK',
  'KwlK....KllK',
  '.KK......KK.',
  '............',
  '............',
  '............',
]);
emo('angry_face', FACE([
  '...KKKKKK...',
  '..KwwwwwwK..',
  '.KKKwwwwKKK.',
  'KwwwKwwKwwwK',
  'KwwKKwwKKwwK',
  'KwwKKwwKKwwK',
  'KwwwwwwwwwwK',
  'KwwwKKKKwwwK',
  '.KwKwwwwKwK.',
  '..KwwwwwwK..',
  '...KKKKKK...',
  '............',
]));
emo('happy_face', FACE([
  '...KKKKKK...',
  '..KwwwwwwK..',
  '.KwwwwwwwwK.',
  'KwwKwwwwKwwK',
  'KwKwKwwKwKwK',
  'KwwwwwwwwwwK',
  'KwKKKKKKKKwK',
  'KwwKddddKwwK',
  '.KwwKKKKwwK.',
  '..KwwwwwwK..',
  '...KKKKKK...',
  '............',
]));

//@@NEW_END@@
//@@ART_END@@

// ===========================================================================
// PLACEHOLDER + RENDER API
// ===========================================================================
let PLACEHOLDER = null;
function placeholder() {
  if (!PLACEHOLDER) {
    const g = Grid.from([
      '................',
      '................',
      '...MMMMMMMMMM...',
      '..MMMMMMMMMMMM..',
      '..MMM**MM**MMM..',
      '..MM**MMMM**MM..',
      '..MMMMMMMM**MM..',
      '..MMMMMMM**MMM..',
      '..MMMMMM**MMMM..',
      '..MMMMMM**MMMM..',
      '..MMMMMMMMMMMM..',
      '..MMMMMM**MMMM..',
      '..MMMMMM**MMMM..',
      '...MMMMMMMMMM...',
      '................',
      '................',
    ]);
    PLACEHOLDER = finalize(render(g, { M: 'pink' }));
  }
  return PLACEHOLDER;
}

// Extra icon modules: src/ui/icons/*.js export
//   UI_ICONS = { name: () => ({ w, h, d: Uint8ClampedArray(w * h * 4) RGBA }) }
// (pixels fully opaque or fully transparent). Same name = override.
const ICON_MODS = import.meta.glob('./icons/*.js', { eager: true });
for (const m of Object.values(ICON_MODS)) {
  for (const [name, fn] of Object.entries(m.UI_ICONS || {})) reg(name, () => { const r = fn(); return { w: r.w, h: r.h, d: r.d || r.data }; });
}

export const FOX_EXPRESSIONS = ['smug', 'greedy', 'shocked', 'laugh', 'wink', 'angry', 'worried', 'sleepy', 'happy', 'proud', 'teacher', 'horror'];

export function hasSprite(name) {
  return Object.prototype.hasOwnProperty.call(SPRITES, name);
}
function getSprite(name) {
  return hasSprite(name) ? SPRITES[name] : placeholder();
}

// dev helpers (used by the preview page)
export const __dev = { BUILD_WARN, RAMPS, Grid, Pix, render, finalize };

const canvasCache = new Map();
const urlCache = new Map();
const normScale = (scale) => {
  const s = Math.floor(Number(scale));
  return s >= 1 ? s : 1;
};
const cacheKey = (name, scale) => (hasSprite(name) ? name : '\0?') + '@' + scale;

function baseCanvas(s) {
  const cv = document.createElement('canvas');
  cv.width = s.w;
  cv.height = s.h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (s.px) {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(s.px.d), s.w, s.h), 0, 0);
  } else {
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        const ch = s.rows[y][x];
        if (ch === '.') continue;
        ctx.globalAlpha = s.alpha && s.alpha[ch] != null ? s.alpha[ch] : 1;
        ctx.fillStyle = s.pal[ch] || '#ff00ff';
        ctx.fillRect(x, y, 1, 1);
      }
  }
  return cv;
}

// [v26 faces3d] a character face (Reynard, bears, beavers) is never 2D: it is a render of the
// real 3D rig at the sprite's exact frame size (the pixel art below is only the no-WebGL fallback)
function face3d(name, w, h) {
  if (!FACE3D.sprite || !FACE3D.test(name) || !hasSprite(name)) return null;
  const s = getSprite(name);
  return FACE3D.sprite(name, w ? Math.round(w) : s.w, h ? Math.round(h) : s.h);
}

export function spriteCanvas(name, scale = 1) {
  scale = normScale(scale);
  if (FACE3D.sprite && FACE3D.test(name)) { const s = getSprite(name), f = face3d(name, s.w * scale, s.h * scale); if (f) return f.canvas; } // [v26 faces3d]
  const key = cacheKey(name, scale);
  const hit = canvasCache.get(key);
  if (hit) return hit;
  const s = getSprite(name);
  let cv;
  if (scale === 1) cv = baseCanvas(s);
  else {
    const base = spriteCanvas(name, 1);
    cv = document.createElement('canvas');
    cv.width = s.w * scale;
    cv.height = s.h * scale;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0, cv.width, cv.height);
  }
  canvasCache.set(key, cv);
  return cv;
}

export function spriteURL(name, scale = 1) {
  scale = normScale(scale);
  if (FACE3D.sprite && FACE3D.test(name)) { const s = getSprite(name), f = face3d(name, s.w * scale, s.h * scale); if (f) return f.url; } // [v26 faces3d]
  const key = cacheKey(name, scale);
  let url = urlCache.get(key);
  if (!url) {
    url = spriteCanvas(name, scale).toDataURL('image/png');
    urlCache.set(key, url);
  }
  return url;
}

export function spriteImg(name, scale = 2, cls = '') {
  scale = normScale(scale);
  const s = getSprite(name);
  const klass = cls ? `px ${cls}` : 'px';
  if (FACE3D.sprite && FACE3D.test(name)) { // [v26 faces3d] rendered at the device pixel size: 1 render px per screen px
    const k = Math.max(1, Math.min(3, Math.round((typeof window !== 'undefined' && window.devicePixelRatio) || 1)));
    const f = face3d(name, s.w * scale * k, s.h * scale * k);
    if (f) return `<img class="${klass} f3d" src="${f.url}" width="${s.w * scale}" height="${s.h * scale}" alt="" draggable="false" style="image-rendering:pixelated">`;
  }
  const k = crispArt(scale); // [v26 uiscale]
  // [v28 crisp] whole-number screen ratio: paint the icon at device resolution and show it 1:1
  // (iPad Safari otherwise smooths the 2x upscale, so toolbar icons looked smeared / stretched)
  const r = (typeof window !== 'undefined' && window.devicePixelRatio) || 1, dk = Math.round(r);
  const src = k === scale && dk >= 2 && dk <= 4 && Math.abs(r - dk) < 0.01 ? spriteURL(name, scale * dk) : spriteURL(name, scale);
  return `<img class="${klass}" src="${src}" width="${s.w * k}" height="${s.h * k}" alt="" draggable="false" style="image-rendering:pixelated">`;
}
// [v26 uiscale] CSS px per art pixel that is a whole number of device px. Integer devicePixelRatio: just
// `scale`. Fractional (browser / Safari page zoom, Windows 125%): 2 CSS px would be 2.5 device px, i.e.
// uneven, smeared pixels; snap to the nearest whole device px (the size attributes, so CSS sizes still win)
function crispArt(scale) {
  const r = (typeof window !== 'undefined' && window.devicePixelRatio) || 1, d = scale * r;
  return Math.abs(d - Math.round(d)) < 0.01 ? scale : +(Math.max(1, Math.round(d)) / r).toFixed(4);
}

export function foxPortraitURL(expr = 'smug', scale = 4) {
  const e = FOX_EXPRESSIONS.includes(expr) ? expr : 'smug';
  return spriteURL('fox_' + e, scale);
}
