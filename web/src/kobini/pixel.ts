import * as THREE from 'three';
import { Painter } from './Painter';

/** Raw pixel buffers and binary masks for procedural pixel art (food, characters, props). */

export type RGB = [number, number, number];

export function hex(c: string): RGB {
  let s = c.replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(c: RGB): string {
  return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/**
 * Pixel-artist colour ramp from dark to light around `base`: shadows drift toward cool purple and
 * gain saturation, lights drift toward warm yellow and lose a little.
 */
export function ramp(base: string, steps = 5, spread = 0.12): RGB[] {
  const [h, s, l] = rgbToHsl(hex(base));
  const mid = Math.floor(steps / 2);
  const out: RGB[] = [];
  for (let i = 0; i < steps; i++) {
    const k = i - mid;
    const dl = k * spread * (k < 0 ? 1.05 : 0.9);
    // hue: toward ~0.72 (blue-purple) in shadow, toward ~0.13 (warm yellow) in light
    const target = k < 0 ? 0.72 : 0.13;
    let dh = target - h;
    if (dh > 0.5) dh -= 1;
    if (dh < -0.5) dh += 1;
    const hh = (h + dh * Math.min(0.5, Math.abs(k) * 0.07) + 1) % 1;
    const ss = Math.max(0, Math.min(1, s * (k < 0 ? 1 + 0.08 * -k : 1 - 0.1 * k)));
    const ll = Math.max(0.02, Math.min(0.98, l + dl));
    out.push(hslToRgb(hh, ss, ll));
  }
  return out;
}

/** Hand-picked ramp from explicit colours (dark → light). */
export function rampOf(...colors: string[]): RGB[] {
  return colors.map(hex);
}

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Deterministic PRNG (mulberry32). */
export function prng(seed: number) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -------------------------------------------------------------------------------------------------

/** A binary mask on a pixel grid. Shapes are rasterised at pixel centres. */
export class Mask {
  readonly m: Uint8Array;
  constructor(readonly w: number, readonly h: number, data?: Uint8Array) {
    this.m = data ?? new Uint8Array(w * h);
  }

  get(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.m[y * this.w + x] : 0;
  }

  set(x: number, y: number, v = 1) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.m[y * this.w + x] = v;
    return this;
  }

  clone() {
    return new Mask(this.w, this.h, this.m.slice());
  }

  count() {
    let n = 0;
    for (let i = 0; i < this.m.length; i++) n += this.m[i];
    return n;
  }

  fill(test: (x: number, y: number) => boolean) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (test(x + 0.5, y + 0.5)) this.m[y * this.w + x] = 1;
    return this;
  }

  union(o: Mask) {
    for (let i = 0; i < this.m.length; i++) this.m[i] = this.m[i] | o.m[i];
    return this;
  }

  subtract(o: Mask) {
    for (let i = 0; i < this.m.length; i++) if (o.m[i]) this.m[i] = 0;
    return this;
  }

  intersect(o: Mask) {
    for (let i = 0; i < this.m.length; i++) this.m[i] = this.m[i] & o.m[i];
    return this;
  }

  shift(dx: number, dy: number) {
    const out = new Mask(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.m[y * this.w + x]) out.set(x + dx, y + dy);
    return out;
  }

  /** Grow by one pixel (4-neighbourhood, or 8 with diagonal). */
  dilate(diagonal = false) {
    const out = this.clone();
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.m[y * this.w + x]) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) out.m[y * this.w + x] = 1;
        else if (diagonal && (this.get(x - 1, y - 1) || this.get(x + 1, y - 1) || this.get(x - 1, y + 1) || this.get(x + 1, y + 1))) out.m[y * this.w + x] = 1;
      }
    return out;
  }

  erode() {
    const out = this.clone();
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (!this.m[y * this.w + x]) continue;
        if (!this.get(x - 1, y) || !this.get(x + 1, y) || !this.get(x, y - 1) || !this.get(x, y + 1)) out.m[y * this.w + x] = 0;
      }
    return out;
  }

  /** Pixels of the mask that touch the outside (4-neighbourhood). */
  edge() {
    const out = new Mask(this.w, this.h);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (!this.m[y * this.w + x]) continue;
        if (!this.get(x - 1, y) || !this.get(x + 1, y) || !this.get(x, y - 1) || !this.get(x, y + 1)) out.m[y * this.w + x] = 1;
      }
    return out;
  }

  bounds() {
    let x0 = this.w;
    let y0 = this.h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.m[y * this.w + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /** Approximate Euclidean distance (in px) from each inside pixel to the nearest outside pixel. */
  distance(): Float32Array {
    const { w, h } = this;
    const INF = 1e6;
    const d = new Float32Array(w * h);
    for (let i = 0; i < d.length; i++) d[i] = this.m[i] ? INF : 0;
    const a = 1;
    const b = Math.SQRT2;
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!d[i]) continue;
        d[i] = Math.min(d[i], at(x - 1, y) + a, at(x, y - 1) + a, at(x - 1, y - 1) + b, at(x + 1, y - 1) + b);
      }
    for (let y = h - 1; y >= 0; y--)
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (!d[i]) continue;
        d[i] = Math.min(d[i], at(x + 1, y) + a, at(x, y + 1) + a, at(x + 1, y + 1) + b, at(x - 1, y + 1) + b);
      }
    return d;
  }
}

// ---- shape constructors (all in pixel units; centres at pixel centres use +0.5 coordinates)

export function ellipse(w: number, h: number, cx: number, cy: number, rx: number, ry: number) {
  return new Mask(w, h).fill((x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1);
}

export function rect(w: number, h: number, x: number, y: number, rw: number, rh: number) {
  return new Mask(w, h).fill((px, py) => px >= x && px <= x + rw && py >= y && py <= y + rh);
}

export function roundRect(w: number, h: number, x: number, y: number, rw: number, rh: number, r: number) {
  return new Mask(w, h).fill((px, py) => {
    if (px < x || px > x + rw || py < y || py > y + rh) return false;
    const cx = Math.max(x + r, Math.min(x + rw - r, px));
    const cy = Math.max(y + r, Math.min(y + rh - r, py));
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  });
}

export function poly(w: number, h: number, pts: [number, number][]) {
  return new Mask(w, h).fill((x, y) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}

/** Stadium / thick line between two points with radius r. */
export function capsule(w: number, h: number, x0: number, y0: number, x1: number, y1: number, r: number) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  return new Mask(w, h).fill((x, y) => {
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
    const px = x0 + dx * t;
    const py = y0 + dy * t;
    return (x - px) ** 2 + (y - py) ** 2 <= r * r;
  });
}

/** Smooth closed blob through control points (Catmull-Rom sampled polygon). */
export function blob(w: number, h: number, pts: [number, number][], samples = 8) {
  const out: [number, number][] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let s = 0; s < samples; s++) {
      const t = s / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return poly(w, h, out);
}

// -------------------------------------------------------------------------------------------------

/** RGBA pixel buffer. */
export class Bitmap {
  readonly data: Uint8ClampedArray;
  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  static fromCanvas(c: HTMLCanvasElement) {
    const b = new Bitmap(c.width, c.height);
    const img = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    b.data.set(img.data);
    return b;
  }

  alpha(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.data[(y * this.w + x) * 4 + 3] : 0;
  }

  get(x: number, y: number): RGB {
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }

  set(x: number, y: number, c: RGB, a = 255) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }

  clearPx(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[(y * this.w + x) * 4 + 3] = 0;
  }

  /** Fill every pixel of the mask with a colour. */
  paint(mask: Mask, c: RGB | string) {
    const col = typeof c === 'string' ? hex(c) : c;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (mask.m[y * mask.w + x]) this.set(x, y, col);
    return this;
  }

  opaque(): Mask {
    const m = new Mask(this.w, this.h);
    for (let i = 0; i < this.w * this.h; i++) m.m[i] = this.data[i * 4 + 3] > 0 ? 1 : 0;
    return m;
  }

  /** Classic 1px ink line outside the silhouette. */
  outline(c: RGB | string, diagonal = false) {
    const col = typeof c === 'string' ? hex(c) : c;
    const ring = this.opaque().dilate(diagonal).subtract(this.opaque());
    return this.paint(ring, col);
  }

  blit(src: Bitmap, ox: number, oy: number, flipX = false) {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const sx = flipX ? src.w - 1 - x : x;
        const i = (y * src.w + sx) * 4;
        if (src.data[i + 3] === 0) continue;
        this.set(ox + x, oy + y, [src.data[i], src.data[i + 1], src.data[i + 2]], src.data[i + 3]);
      }
    return this;
  }

  toCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(this.w, this.h);
    img.data.set(this.data);
    ctx.putImageData(img, 0, 0);
    return c;
  }

  toPainter(): Painter {
    const p = new Painter(this.w, this.h);
    p.ctx.drawImage(this.toCanvas(), 0, 0);
    return p;
  }
}

/** Nearest-neighbour canvas texture with crisp pixels. */
export function pixelTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
