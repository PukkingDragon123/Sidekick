// 9-slice pixel-art UI frames for "The Bear Must Eat".
//
//   FRAMES[name] = { w, h, slice: [top, right, bottom, left], fill, repeat?, fixed? }
//   frameCanvas(name, scale = 2)  -> cached <canvas> (nearest-neighbour upscale)
//   frameURL(name, scale = 2)     -> cached data: URL
//   frameStyle(name, scale = 2)   -> CSS declarations (border-image ... / border-style)
//   injectFrameCSS()              -> once: <style id="tbme-frames"> with .f-<name> (2x)
//                                    and .f3-<name> (3x) for every frame
//
// Frames are painted procedurally into a small RGBA buffer the first time
// they are asked for. Importing this module never touches the DOM.
// Fixed-size pieces (medallion, bubble_tail, think_tail) have fixed: true and
// slice [0, 0, 0, 0]; frameStyle() returns a background for those.

// ---------------------------------------------------------------- colour
function rgb(h) {
  const s = h.replace('#', '');
  const n = parseInt(s.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, s.length >= 8 ? parseInt(s.slice(6, 8), 16) : 255];
}
const C = (h) => (h == null ? null : Array.isArray(h) ? h : rgb(h));

// ---------------------------------------------------------------- buffer
class Buf {
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
  set(x, y, c) {
    if (!this.in(x, y) || c == null) return this;
    c = C(c);
    const i = (y * this.w + x) * 4;
    if (c[3] === 255 || c[3] === undefined) {
      this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = 255;
      return this;
    }
    const sa = c[3] / 255, da = this.d[i + 3] / 255, oa = sa + da * (1 - sa);
    if (oa <= 0) return this;
    for (let k = 0; k < 3; k++) this.d[i + k] = Math.round((c[k] * sa + this.d[i + k] * da * (1 - sa)) / oa);
    this.d[i + 3] = Math.round(oa * 255);
    return this;
  }
  clear(x, y) {
    if (this.in(x, y)) this.d[(y * this.w + x) * 4 + 3] = 0;
    return this;
  }
  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    return this;
  }
  hline(x0, x1, y, c) {
    return this.rect(x0, y, x1 - x0 + 1, 1, c);
  }
  vline(x, y0, y1, c) {
    return this.rect(x, y0, 1, y1 - y0 + 1, c);
  }
  // paint rows; map: char -> colour ('.' skipped)
  rows(x, y, rows, map) {
    rows.forEach((r, j) => {
      for (let i = 0; i < r.length; i++) if (r[i] !== '.' && map[r[i]] !== undefined) this.set(x + i, y + j, map[r[i]]);
    });
    return this;
  }
  // mirrored copies of a corner motif drawn at the top-left
  corners(rows, map, inset = 0) {
    const w = rows[0].length, h = rows.length;
    const fx = rows.map((r) => r.split('').reverse().join(''));
    this.rows(inset, inset, rows, map);
    this.rows(this.w - w - inset, inset, fx, map);
    this.rows(inset, this.h - h - inset, rows.slice().reverse(), map);
    this.rows(this.w - w - inset, this.h - h - inset, fx.slice().reverse(), map);
    return this;
  }
}

// ---------------------------------------------------------------- shapes
// rounded-rect mask with corner radius r (pixel-centre test)
function rrMask(x0, y0, w, h, r) {
  return (x, y) => {
    if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false;
    if (r <= 0) return true;
    const cx = Math.min(Math.max(x + 0.5, x0 + r), x0 + w - r);
    const cy = Math.min(Math.max(y + 0.5, y0 + r), y0 + h - r);
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    return dx * dx + dy * dy <= r * r + 0.15 * r;
  };
}
// Erosion depth of every pixel in a mask + which way its ring faces.
// depth 0 = outermost ring. lit > 0 faces up/left (lit side), < 0 down/right.
function rings(w, h, mask, max = 12) {
  const N = w * h;
  const depth = new Int16Array(N).fill(-1);
  const lit = new Int8Array(N);
  let cur = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask(x, y)) cur[y * w + x] = 1;
  const at = (m, x, y) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x];
  for (let k = 0; k < max; k++) {
    const nxt = new Uint8Array(N);
    let any = false;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!cur[i]) continue;
        const up = !at(cur, x, y - 1), dn = !at(cur, x, y + 1), lf = !at(cur, x - 1, y), rt = !at(cur, x + 1, y);
        if (up || dn || lf || rt) {
          depth[i] = k;
          lit[i] = up + lf - dn - rt;
          if (!lit[i] && (up || lf) && (dn || rt)) lit[i] = up && rt ? 0 : 0;
        } else {
          nxt[i] = 1;
          any = true;
        }
      }
    cur = nxt;
    if (!any) break;
  }
  for (let i = 0; i < N; i++) if (cur[i]) depth[i] = max;
  return { depth, lit, get: (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? depth[y * w + x] : -1), L: (x, y) => lit[y * w + x] };
}
// Paint a bevelled shape: pal(depth, lit, x, y) -> colour | null
function bevel(b, mask, pal, max) {
  const R = rings(b.w, b.h, mask, max);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const d = R.get(x, y);
      if (d < 0) continue;
      const c = pal(d, R.L(x, y), x, y);
      if (c) b.set(x, y, c);
    }
  return R;
}
// a soft drop shadow under everything already drawn
function dropShadow(b, dx = 0, dy = 1, a = 70) {
  const src = new Uint8Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) src[y * b.w + x] = b.a(x, y) > 0 ? 1 : 0;
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const sx = x - dx, sy = y - dy;
      if (!src[y * b.w + x] && sx >= 0 && sy >= 0 && sx < b.w && sy < b.h && src[sy * b.w + sx]) b.set(x, y, [42, 26, 20, a]);
    }
  return b;
}
const nail = (b, x, y, hi = '#bcc2d4', base = '#62687e', dk = '#262838') =>
  b.rows(x, y, ['ab', 'bc'], { a: hi, b: base, c: dk }).set(x + 2, y + 1, [20, 12, 8, 90]).set(x + 1, y + 2, [20, 12, 8, 90]);
// deterministic hash noise
const hn = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------- palettes
const PAL = {
  parch: { ol: '#4a2f1d', hi: '#fbf0d0', base: '#f3e2b8', sh: '#e2c992', sh2: '#c9ab72', fleck: '#ead39f' },
  parchD: { ol: '#4a2f1d', hi: '#f3e2b8', base: '#e2c992', sh: '#c9ab72', sh2: '#a8864e', fleck: '#d6b984' },
  wood: { ol: '#3b2414', hi: '#c98f55', lt: '#a86d38', base: '#8b5a2b', sh: '#6b4220', dk: '#55331a', grain: '#7a4d24', fill: '#6b4220', fillHi: '#7a4d26' },
  woodD: { ol: '#1f120b', hi: '#8b5a2b', lt: '#6b4220', base: '#51321b', sh: '#3b2414', dk: '#2e1b10', grain: '#45291a', fill: '#3b2414', fillHi: '#45291a' },
  green: { ol: '#1f3f2c', hi: '#aee6b0', lt: '#6cc08a', base: '#3f8f5f', sh: '#2f6f4a', dk: '#255a3c' },
  greenH: { ol: '#1f3f2c', hi: '#d4f6d0', lt: '#8fd6a6', base: '#52a771', sh: '#3a805a', dk: '#2a6444' },
  red: { ol: '#4e1422', hi: '#ffc9a0', lt: '#f07a52', base: '#d9453b', sh: '#b0303a', dk: '#80202e' },
  gold: { ol: '#7a4a12', hi: '#fffbe0', lt: '#fff3a3', base: '#ffd23f', sh: '#e5a320', dk: '#b0661a' },
  grey: { ol: '#3c3c44', hi: '#e2e2e6', lt: '#c4c4c8', base: '#9a9aa0', sh: '#7a7a82', dk: '#5c5c66' },
  brass: { ol: '#2a1a0c', hi: '#f6e6ac', lt: '#dcbd72', base: '#b8924c', sh: '#8d6c32', dk: '#5c4219' },
  iron: { ol: '#0e0c12', hi: '#858394', lt: '#5e5c6c', base: '#43414f', sh: '#2e2c38', dk: '#201e28' },
};

// ---------------------------------------------------------------- builders
const BUILD = {};
export const FRAMES = {};
function def(name, spec, build) {
  FRAMES[name] = { w: spec.w, h: spec.h, slice: spec.slice, fill: spec.fill !== false, repeat: spec.repeat || 'stretch', ...(spec.fixed ? { fixed: true } : {}) };
  BUILD[name] = () => build(new Buf(spec.w, spec.h), spec);
}

// parchment: dark outline, light top/left lip, shaded bottom/right, curled corners
function parchment(P) {
  return (b) => {
    const W = b.w, H = b.h;
    bevel(b, rrMask(0, 0, W, H - 1, 2.2), (d, l) => {
      if (d === 0) return P.ol;
      if (d === 1) return l > 0 ? P.hi : l < 0 ? P.sh : P.base;
      if (d === 2 && l < 0) return P.sh;
      return P.base;
    });
    // flecks in the corners only (edges stay uniform so they stretch cleanly)
    for (const [x, y] of [[4, 3], [6, 5], [3, 6], [W - 5, 4], [W - 7, 3], [4, H - 6], [W - 6, H - 6], [W - 4, H - 8]]) b.set(x, y, P.fleck);
    // curled top-left and bottom-right corners
    b.rows(0, 0, [
      '..ooo.',
      '.ossho',
      'oshhb.',
      'oshb..',
      'ohb...',
      '.o....',
    ], { o: P.ol, s: P.sh2, h: P.hi, b: P.base });
    b.rows(W - 6, H - 7, [
      '....o.',
      '...bso',
      '..bsso',
      '.bss2o',
      'osss2o',
      '.oooo.',
    ], { o: P.ol, s: P.sh, 2: P.sh2, b: P.base });
    b.clear(W - 1, H - 2).clear(W - 1, H - 7);
    b.hline(1, W - 3, H - 1, [42, 26, 20, 70]);
    return b;
  };
}
def('parchment', { w: 24, h: 24, slice: [6, 6, 7, 6] }, parchment(PAL.parch));
def('parchment_dark', { w: 24, h: 24, slice: [6, 6, 7, 6] }, parchment(PAL.parchD));

// wood: mitred plank frame with grain, nails at the corners, recessed board
function wood(P) {
  return (b) => {
    const W = b.w, H = b.h, T = 6;
    bevel(b, rrMask(0, 0, W, H, 1.6), (d, l, x, y) => {
      if (d === 0) return P.ol;
      if (d === 1) return l > 0 ? P.lt : P.sh;
      if (d < T - 1) {
        // grain runs along each plank
        const horiz = Math.min(y, H - 1 - y) <= Math.min(x, W - 1 - x);
        const t = horiz ? y : x;
        return t % 3 === 0 ? P.grain : P.base;
      }
      if (d === T - 1) return P.ol;
      if (d === T) return l > 0 ? P.dk : P.fillHi;
      return P.fill;
    });
    // mitre joints
    for (let k = 1; k < T - 1; k++) {
      b.set(k, k, P.dk).set(W - 1 - k, k, P.dk).set(k, H - 1 - k, P.dk).set(W - 1 - k, H - 1 - k, P.dk);
    }
    nail(b, 2, 2); nail(b, W - 4, 2); nail(b, 2, H - 4); nail(b, W - 4, H - 4);
    return b;
  };
}
def('wood', { w: 24, h: 24, slice: [7, 7, 7, 7] }, wood(PAL.wood));
def('wood_dark', { w: 24, h: 24, slice: [7, 7, 7, 7] }, wood(PAL.woodD));

// ribbon header banner with folded, notched tails
function ribbon(P) {
  return (b) => {
    const W = b.w, H = b.h, TW = 9;
    // tails (behind)
    for (const side of [0, 1]) {
      const tb = new Buf(TW + 2, H - 3);
      const m = (x, y) => {
        if (y < 0 || y >= tb.h || x < 0 || x >= tb.w) return false;
        const mid = (tb.h - 1) / 2, notch = 3 - Math.round(Math.abs(y - mid) * 0.9);
        return x >= Math.max(0, notch);
      };
      bevel(tb, m, (d, l) => (d === 0 ? P.ol : d === 1 && l > 0 ? P.base : P.sh));
      for (let y = 0; y < tb.h; y++)
        for (let x = 0; x < tb.w; x++) {
          const i = (y * tb.w + x) * 4;
          if (!tb.d[i + 3]) continue;
          const X = side ? W - 1 - x : x;
          b.set(X, y + 3, [tb.d[i], tb.d[i + 1], tb.d[i + 2]]);
        }
    }
    // front band
    bevel(b, rrMask(5, 0, W - 10, H - 3, 1), (d, l, x, y) => {
      if (d === 0) return P.ol;
      if (y === 1) return P.lt;
      if (y === 2) return P.base;
      if (y >= H - 6) return P.sh;
      return P.base;
    });
    // fold shadows where band meets tails
    b.rows(5, H - 4, ['oo', 'do', '.o'], { o: P.ol, d: P.dk });
    b.rows(W - 7, H - 4, ['oo', 'od', 'o.'], { o: P.ol, d: P.dk });
    b.set(6, 1, P.hi).set(7, 1, P.hi);
    return b;
  };
}
def('ribbon_green', { w: 40, h: 17, slice: [4, 11, 6, 11] }, ribbon(PAL.green));
def('ribbon_red', { w: 40, h: 17, slice: [4, 11, 6, 11] }, ribbon(PAL.red));

// chunky pill buttons with a 3D bottom lip
function button(P, down = false) {
  return (b) => {
    const W = b.w, H = b.h, top = down ? 2 : 0, lip = down ? 0 : 2;
    const bodyH = H - top - lip;
    if (lip) bevel(b, rrMask(0, top + 2, W, bodyH, 3), (d) => (d === 0 ? P.ol : P.dk));
    bevel(b, rrMask(0, top, W, bodyH, 3), (d, l, x, y) => {
      if (d === 0) return P.ol;
      const yy = y - top;
      if (d === 1 && l < 0 && yy > 2) return P.sh;
      if (yy <= 2) return yy === 1 && d >= 1 ? P.lt : P.lt;
      if (yy === 3) return P.base;
      return P.base;
    });
    if (down) b.hline(2, W - 3, top + 1, P.sh).hline(3, W - 4, top + 2, P.base);
    else b.set(2, 2, P.hi).set(3, 1, P.hi).set(2, 3, P.hi);
    return b;
  };
}
const BTN = { w: 16, h: 16, slice: [5, 5, 6, 5] };
def('button_green', BTN, button(PAL.green));
def('button_green_hover', BTN, button(PAL.greenH));
def('button_green_down', BTN, button(PAL.green, true));
def('button_red', BTN, button(PAL.red));
def('button_gold', BTN, button(PAL.gold));
def('button_disabled', BTN, button(PAL.grey));

// ornate gold icon slot (filigree corners, recessed wooden field)
const FILIGREE = [
  '..kkk...',
  '.kGGGk..',
  'kGkkGGk.',
  'kGkGkGk.',
  'kGGkGk..',
  '.kGGk...',
  '..kk....',
  '........',
];
function goldSlot(active) {
  return (b) => {
    const W = b.w, H = b.h, G = PAL.gold;
    bevel(b, rrMask(0, 0, W, H, 3.2), (d, l) => {
      if (d === 0) return active ? '#fff6c0' : '#2a1a14';
      if (d === 1) return l > 0 ? G.lt : l < 0 ? G.sh : G.base;
      if (d === 2) return l > 0 ? G.base : l < 0 ? G.dk : G.base;
      if (d === 3) return l < 0 ? G.sh : G.base;
      if (d === 4) return G.ol;
      if (d === 5) return active ? (l > 0 ? '#c98f55' : '#a86d38') : l > 0 ? '#3b2414' : '#6b4220';
      return active ? '#a86d38' : '#7a4c26';
    });
    b.corners(FILIGREE, { k: G.ol, G: active ? G.hi : G.lt }, 1);
    if (active) {
      for (let x = 6; x < W - 6; x++) { b.set(x, 5, [255, 243, 163, 150]); b.set(x, H - 6, [255, 243, 163, 90]); }
      for (let y = 6; y < H - 6; y++) { b.set(5, y, [255, 243, 163, 150]); b.set(W - 6, y, [255, 243, 163, 90]); }
    }
    return b;
  };
}
def('slot_gold', { w: 26, h: 26, slice: [9, 9, 9, 9] }, goldSlot(false));
def('slot_gold_active', { w: 26, h: 26, slice: [9, 9, 9, 9] }, goldSlot(true));

// brass skill-node frame: clipped corners, rivets, dark field
function octMask(W, H, c) {
  return (x, y) => x >= 0 && y >= 0 && x < W && y < H && x + y >= c && W - 1 - x + y >= c && x + H - 1 - y >= c && W - 1 - x + H - 1 - y >= c;
}
def('slot_brass', { w: 24, h: 24, slice: [8, 8, 8, 8] }, (b) => {
  const P = PAL.brass;
  bevel(b, octMask(24, 24, 4), (d, l) => {
    if (d === 0) return P.ol;
    if (d === 1) return l > 0 ? P.hi : l < 0 ? P.sh : P.lt;
    if (d === 2) return l > 0 ? P.lt : l < 0 ? P.dk : P.base;
    if (d === 3) return l < 0 ? P.sh : P.base;
    if (d === 4) return P.ol;
    if (d === 5) return l > 0 ? '#120c08' : '#3a2a1c';
    return '#2a1e14';
  });
  for (const [x, y] of [[4, 2], [18, 2], [2, 4], [20, 4], [2, 18], [20, 18], [4, 20], [18, 20]]) b.rows(x, y, ['ab', 'bc'], { a: P.hi, b: P.base, c: P.dk });
  return b;
});

// locked node: dark iron plate wrapped in chain
def('slot_locked', { w: 24, h: 24, slice: [9, 9, 9, 9], repeat: 'round' }, (b) => {
  const P = PAL.iron;
  bevel(b, octMask(24, 24, 4), (d, l) => {
    if (d === 0) return P.ol;
    if (d === 1) return l > 0 ? P.lt : P.dk;
    if (d < 5) return d === 4 && l < 0 ? P.sh : P.base;
    if (d === 5) return P.ol;
    return '#18161c';
  });
  // chain links (period 6) along all four edges
  const L = { o: '#9a98a8', d: '#5e5c6c', h: '#d0d0dc' };
  for (let x = 0; x < 24; x += 6) {
    b.rows(x, 1, ['.ho...', 'o..odd', '.dd...'], L);
    b.rows(x, 20, ['.ho...', 'o..odd', '.dd...'], L);
  }
  for (let y = 0; y < 24; y += 6) {
    b.rows(1, y, ['.h.', 'o.d', 'o.d', '.d.', '.d.', '.d.'], L);
    b.rows(20, y, ['.h.', 'o.d', 'o.d', '.d.', '.d.', '.d.'], L);
  }
  return b;
});

// round wooden level medallion (fixed size)
def('medallion', { w: 30, h: 30, slice: [0, 0, 0, 0], fixed: true }, (b) => {
  const P = PAL.wood;
  const disc = (r) => (x, y) => Math.hypot(x + 0.5 - 15, y + 0.5 - 14.5) <= r;
  bevel(b, disc(14), (d, l, x, y) => {
    if (d === 0) return P.ol;
    if (d <= 3) {
      const lit = (x + 0.5 - 15) * -0.6 + (y + 0.5 - 14.5) * -0.8;
      return lit > 6 ? P.hi : lit > 1 ? P.lt : lit > -6 ? P.base : P.sh;
    }
    if (d === 4) return P.ol;
    // inner face with concentric grain rings
    const r = Math.hypot(x + 0.5 - 15, y + 0.5 - 14.5);
    const lit = ((x + 0.5 - 15) * -0.6 + (y + 0.5 - 14.5) * -0.8) / 9;
    if (d === 5) return lit > 0.2 ? '#55331a' : '#a86d38';
    return Math.round(r) % 3 === 0 ? '#7a4d24' : lit > 0.3 ? '#9a6532' : '#8b5a2b';
  });
  nail(b, 14, 2); nail(b, 14, 25); nail(b, 2, 13); nail(b, 26, 13);
  dropShadow(b, 0, 1, 80);
  return b;
});

// dark wood tooltip with small gold corner studs
def('tooltip', { w: 16, h: 16, slice: [5, 5, 5, 5] }, (b) => {
  const P = PAL.woodD;
  bevel(b, rrMask(0, 0, 16, 16, 2), (d, l) => (d === 0 ? P.ol : d === 1 ? (l > 0 ? '#6b4220' : '#2e1b10') : P.fill));
  b.corners(['...', '.y.', '...'], { y: '#e5a320' }, 1);
  return b;
});

// white comic speech bubble with 2px black outline
def('bubble_bw', { w: 20, h: 20, slice: [7, 7, 7, 7] }, (b) => {
  bevel(b, rrMask(0, 0, 20, 20, 6), (d) => (d <= 1 ? '#141414' : '#ffffff'));
  b.set(4, 3, '#ffffff');
  return b;
});
def('bubble_tail', { w: 12, h: 9, slice: [0, 0, 0, 0], fixed: true }, (b) =>
  b.rows(0, 0, [
    'KKwwwwwwwKK.',
    '.KKwwwwwKK..',
    '..KKwwwKK...',
    '...KwwwK....',
    '...KwwK.....',
    '..KwwKK.....',
    '..KwKK......',
    '.KKK........',
    '.K..........',
  ], { K: '#141414', w: '#ffffff' }),
);

// thought (cloud) bubble: scalloped edge, period 6 so it tiles
def('bubble_think', { w: 32, h: 32, slice: [12, 12, 12, 12], repeat: 'round' }, (b) => {
  const W = 32, H = 32, e = 5.5, r = 4.6;
  const lobes = [[e + 0.8, e + 0.8], [W - e - 0.8, e + 0.8], [e + 0.8, H - e - 0.8], [W - e - 0.8, H - e - 0.8]];
  for (const t of [8, 16, 24]) lobes.push([t, e], [t, H - e], [e, t], [W - e, t]);
  const inner = (x, y) => x >= 6 && y >= 6 && x < W - 6 && y < H - 6;
  const m = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (inner(x, y) || lobes.some(([cx, cy]) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r));
  bevel(b, m, (d, l) => (d <= 1 ? '#141414' : d === 2 && l < 0 ? '#e4e4ea' : '#ffffff'));
  return b;
});
def('think_tail', { w: 10, h: 10, slice: [0, 0, 0, 0], fixed: true }, (b) => {
  b.rows(0, 0, ['..KKKK....', '.KwwwwK...', '.KwwwwK...', '..KKKK....', '..........', '....KKK...', '...KwwwK..', '....KKK...', '.......KK.', '.......KK.'], { K: '#141414', w: '#ffffff' });
  return b;
});

// cream ruled ledger paper: red margin, blue rules every 4px, punched holes
def('paper_ledger', { w: 26, h: 24, slice: [6, 4, 6, 12], repeat: 'repeat' }, (b) => {
  const W = 26, H = 24;
  b.rect(0, 0, W - 1, H - 1, '#fbf3dc');
  b.hline(0, W - 2, 0, '#fffaf0');
  for (let y = 6; y < H - 6; y++) if ((y - 6) % 4 === 3) b.hline(0, W - 2, y, '#b9cfe6');
  b.vline(9, 0, H - 2, '#e88a8a');
  b.vline(10, 0, H - 2, '#f3c2b8');
  // a punched hole once per 12px tile on the left
  b.rows(2, 9, ['.oo.', 'oxxo', 'oxxo', '.oo.'], { o: '#c4a672', x: '#8a6a44' });
  // outline + lifted shadow
  for (let x = 0; x < W - 1; x++) { b.set(x, H - 1, '#c9ab72'); }
  for (let y = 0; y < H; y++) b.set(W - 1, y, '#c9ab72');
  b.vline(0, 0, H - 2, '#e9dcb8');
  return b;
});

// yellow sticky note with an adhesive strip and a lifted corner
def('sticky_note', { w: 20, h: 20, slice: [6, 6, 6, 6] }, (b) => {
  const W = 20, H = 20;
  b.rect(0, 0, W - 1, H - 1, '#fff1a0');
  b.rect(0, 0, W - 1, 4, '#f8e17a');
  b.hline(0, W - 2, 4, '#efd46a');
  b.hline(0, W - 2, 0, '#fff7c4');
  for (let y = 5; y < H - 1; y++) b.set(W - 2, y, '#f4de82');
  // lifted bottom-right corner
  b.rows(W - 6, H - 6, ['....s.', '...ss.', '..sfs.', '.sffs.', 'sssss.', '......'], { s: '#d8b84a', f: '#fff8d0' });
  for (let k = 0; k < 6; k++) b.clear(W - 1 - k, H - 1 - (5 - k));
  for (let y = H - 6; y < H; y++) for (let x = W - 6; x < W; x++) if (x + y > W + H - 8) b.clear(x, y);
  b.hline(1, W - 7, H - 1, [120, 90, 20, 70]);
  b.vline(W - 1, 1, H - 7, [120, 90, 20, 70]);
  return b;
});

// dark CRT bezel with rounded screen, power LED and vent grille
def('crt', { w: 34, h: 30, slice: [8, 8, 11, 8] }, (b) => {
  const W = 34, H = 30;
  bevel(b, rrMask(0, 0, W, H, 4), (d, l) => {
    if (d === 0) return '#141218';
    if (d === 1) return l > 0 ? '#6a6878' : '#2a2832';
    return '#43414f';
  });
  // screen recess
  const scr = rrMask(5, 5, W - 10, H - 13, 4.5);
  bevel(b, scr, (d, l, x, y) => {
    if (d === 0) return l > 0 ? '#1a1820' : '#5e5c6c';
    if (d === 1) return '#06100c';
    return '#0e1f17';
  });
  // glare in the screen corner
  b.set(8, 7, [180, 255, 210, 70]).set(7, 8, [180, 255, 210, 70]).set(9, 7, [180, 255, 210, 40]);
  // bottom: vents + LED
  for (let x = 6; x < 14; x += 2) b.vline(x, H - 6, H - 4, '#2a2832');
  b.rows(W - 9, H - 6, ['gG', 'gg'], { g: '#2f8a4a', G: '#8affb0' });
  b.rows(W - 6, H - 6, ['.k', 'kk'], { k: '#2a2832' });
  return b;
});

// inset text field
def('input', { w: 16, h: 16, slice: [5, 5, 5, 5] }, (b) => {
  bevel(b, rrMask(0, 0, 16, 16, 2), (d, l) => {
    if (d === 0) return '#4a2f1d';
    if (d === 1) return l > 0 ? '#c9ab72' : '#fffaf0';
    if (d === 2 && l > 0) return '#e2c992';
    return '#fbf0d0';
  });
  return b;
});

// folder tabs (open at the bottom)
function tab(active) {
  return (b) => {
    const W = 20, H = 16, top = active ? 0 : 2, P = active ? PAL.parch : PAL.parchD;
    bevel(b, rrMask(0, top, W, H - top + 3, 3), (d, l, x, y) => {
      if (y >= H) return null;
      if (d === 0) return P.ol;
      if (d === 1) return l > 0 ? P.hi : P.sh;
      return P.base;
    });
    if (!active) b.hline(0, W - 1, H - 1, PAL.parch.ol);
    else b.set(0, H - 1, P.ol).set(W - 1, H - 1, P.ol);
    return b;
  };
}
def('tab', { w: 20, h: 16, slice: [6, 6, 3, 6] }, tab(false));
def('tab_active', { w: 20, h: 16, slice: [6, 6, 3, 6] }, tab(true));

// progress bars
def('bar_track', { w: 12, h: 10, slice: [4, 4, 4, 4] }, (b) => {
  bevel(b, rrMask(0, 0, 12, 10, 2), (d, l) => (d === 0 ? '#3b2414' : d === 1 ? (l > 0 ? '#1f120b' : '#55331a') : '#2e1b10'));
  return b;
});
function barFill(P) {
  return (b) => {
    bevel(b, rrMask(0, 0, 8, 8, 1.6), (d, l, x, y) => {
      if (d === 0) return P.ol;
      if (y === 1) return P.lt;
      if (y === 6) return P.sh;
      return P.base;
    });
    b.set(1, 1, P.hi);
    return b;
  };
}
def('bar_fill_green', { w: 8, h: 8, slice: [3, 3, 3, 3] }, barFill(PAL.green));
def('bar_fill_red', { w: 8, h: 8, slice: [3, 3, 3, 3] }, barFill(PAL.red));
def('bar_fill_gold', { w: 8, h: 8, slice: [3, 3, 3, 3] }, barFill(PAL.gold));

// small pill for tags / labels
def('chip', { w: 12, h: 10, slice: [4, 5, 4, 5] }, (b) => {
  bevel(b, rrMask(0, 0, 12, 9, 4.5), (d, l) => (d === 0 ? '#4a2f1d' : d === 1 ? (l > 0 ? '#fffaf0' : '#e2c992') : '#fbf0d0'));
  b.hline(2, 9, 9, [42, 26, 20, 60]);
  return b;
});

// small wooden HUD plaque with brass pins
def('plaque', { w: 24, h: 16, slice: [5, 8, 6, 8] }, (b) => {
  const P = PAL.wood;
  bevel(b, rrMask(0, 0, 24, 15, 2.5), (d, l, x, y) => {
    if (d === 0) return P.ol;
    if (d === 1) return l > 0 ? P.hi : P.sh;
    if (d === 2) return l > 0 ? P.lt : P.base;
    return y % 4 === 1 ? P.grain : P.base;
  });
  nail(b, 2, 6, '#fff3a3', '#e5a320', '#7a4a12');
  nail(b, 20, 6, '#fff3a3', '#e5a320', '#7a4a12');
  b.hline(1, 22, 15, [42, 26, 20, 80]);
  return b;
});

// ---------------------------------------------------------------- API
const canvasCache = new Map();
const urlCache = new Map();
const normScale = (s) => Math.max(1, Math.round(+s || 1));
function getFrame(name) {
  const f = FRAMES[name];
  if (!f) throw new Error(`unknown frame '${name}'`);
  return f;
}

export function frameCanvas(name, scale = 2) {
  scale = normScale(scale);
  const key = name + '@' + scale;
  const hit = canvasCache.get(key);
  if (hit) return hit;
  const f = getFrame(name);
  let cv;
  if (scale === 1) {
    const b = BUILD[name]();
    cv = document.createElement('canvas');
    cv.width = f.w;
    cv.height = f.h;
    cv.getContext('2d', { willReadFrequently: true }).putImageData(new ImageData(b.d, f.w, f.h), 0, 0);
  } else {
    const base = frameCanvas(name, 1);
    cv = document.createElement('canvas');
    cv.width = f.w * scale;
    cv.height = f.h * scale;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0, cv.width, cv.height);
  }
  canvasCache.set(key, cv);
  return cv;
}

export function frameURL(name, scale = 2) {
  scale = normScale(scale);
  const key = name + '@' + scale;
  let u = urlCache.get(key);
  if (!u) {
    u = frameCanvas(name, scale).toDataURL('image/png');
    urlCache.set(key, u);
  }
  return u;
}

// [v28 crisp] device px per CSS px when the screen ratio is a whole number (iPad / iPhone 2x-3x).
// The frame image is painted at device resolution and shown 1:1, so the browser never resamples
// it: iPad Safari smooths scaled border-images (image-rendering is ignored there), which made the
// gold tool slots and every other frame look smeared / stretched.
const devK = () => {
  const r = (typeof window !== 'undefined' && window.devicePixelRatio) || 1, k = Math.round(r);
  return k >= 2 && k <= 4 && Math.abs(r - k) < 0.01 ? k : 1;
};

export function frameStyle(name, scale = 2) {
  scale = normScale(scale);
  const f = getFrame(name);
  const k = devK(); // [v28 crisp]
  const url = frameURL(name, scale * k);
  if (f.fixed) {
    return `width:${f.w * scale}px;height:${f.h * scale}px;background:url("${url}") no-repeat 0 0/100% 100%;image-rendering:pixelated`;
  }
  const [t, r, b, l] = f.slice.map((v) => v * scale);
  const [st, sr, sb, sl] = f.slice.map((v) => v * scale * k); // [v28 crisp] slice in source (device) px
  return [
    'border-style:solid',
    `border-width:${t}px ${r}px ${b}px ${l}px`,
    `border-image-source:url("${url}")`,
    `border-image-slice:${st} ${sr} ${sb} ${sl}${f.fill ? ' fill' : ''}`,
    `border-image-width:${t}px ${r}px ${b}px ${l}px`,
    `border-image-repeat:${f.repeat}`,
    'image-rendering:pixelated',
  ].join(';');
}

let injected = false;
export function injectFrameCSS() {
  if (injected || typeof document === 'undefined') return;
  if (document.getElementById('tbme-frames')) { injected = true; return; }
  let css = '';
  for (const name of Object.keys(FRAMES)) {
    const f = FRAMES[name];
    const extra = f.fill && !f.fixed ? ';background:none' : '';
    css += `.f-${name}{${frameStyle(name, 2)}${extra}}\n.f3-${name}{${frameStyle(name, 3)}${extra}}\n`;
  }
  const st = document.createElement('style');
  st.id = 'tbme-frames';
  st.textContent = css;
  document.head.appendChild(st);
  injected = true;
}
