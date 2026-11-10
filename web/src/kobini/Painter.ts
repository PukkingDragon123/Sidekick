import * as THREE from 'three';
import { FONT_BIG, forEachTextPixel, measureText, type BitmapFont } from './pixelFont';

export interface TextOptions {
  font?: BitmapFont;
  color?: string;
  scale?: number;
  align?: 'left' | 'center' | 'right';
  outline?: string;
  outlineWidth?: number;
  shadow?: string;
  shadowOffset?: [number, number];
  bold?: boolean;
  spacing?: number;
}

export interface QRLike {
  size: number;
  isDark(r: number, c: number): boolean;
}

/** Integer-pixel canvas drawing helpers used for every texture in the game. */
export class Painter {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly w: number;
  readonly h: number;

  constructor(w: number, h: number) {
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
  }

  clear(color?: string) {
    this.ctx.clearRect(0, 0, this.w, this.h);
    if (color) this.rect(0, 0, this.w, this.h, color);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, color: string) {
    if (w <= 0 || h <= 0) return this;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    return this;
  }

  px(x: number, y: number, color: string) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    return this;
  }

  strokeRect(x: number, y: number, w: number, h: number, color: string, t = 1) {
    this.rect(x, y, w, t, color);
    this.rect(x, y + h - t, w, t, color);
    this.rect(x, y + t, t, h - 2 * t, color);
    this.rect(x + w - t, y + t, t, h - 2 * t, color);
    return this;
  }

  line(x0: number, y0: number, x1: number, y1: number, color: string) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    this.ctx.fillStyle = color;
    for (let i = 0; i < 4096; i++) {
      this.ctx.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return this;
  }

  /** Thick line drawn as a chain of discs. */
  thickLine(x0: number, y0: number, x1: number, y1: number, r: number, color: string) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, color);
    }
    return this;
  }

  /** Filled ellipse sampled at pixel centres. cx/cy may be fractional. */
  ellipse(cx: number, cy: number, rx: number, ry: number, color: string) {
    this.ctx.fillStyle = color;
    const y0 = Math.floor(cy - ry);
    const y1 = Math.ceil(cy + ry);
    for (let py = y0; py <= y1; py++) {
      const y = (py + 0.5 - cy) / ry;
      if (Math.abs(y) > 1) continue;
      const half = rx * Math.sqrt(1 - y * y);
      const xa = Math.round(cx - half);
      const xb = Math.round(cx + half);
      if (xb > xa) this.ctx.fillRect(xa, py, xb - xa, 1);
    }
    return this;
  }

  disc(cx: number, cy: number, r: number, color: string) {
    return this.ellipse(cx, cy, r, r, color);
  }

  ring(cx: number, cy: number, r: number, color: string, t = 1) {
    // draw by masking: outer disc minus inner disc using a temp layer
    const layer = new Painter(Math.ceil(r * 2 + 4), Math.ceil(r * 2 + 4));
    const lc = r + 2;
    layer.disc(lc, lc, r, color);
    layer.ctx.globalCompositeOperation = 'destination-out';
    layer.disc(lc, lc, r - t, '#000');
    layer.ctx.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(layer.canvas, Math.round(cx - lc), Math.round(cy - lc));
    return this;
  }

  roundRect(x: number, y: number, w: number, h: number, r: number, color: string) {
    x = Math.round(x);
    y = Math.round(y);
    w = Math.round(w);
    h = Math.round(h);
    r = Math.min(r, w / 2, h / 2);
    this.ctx.fillStyle = color;
    for (let row = 0; row < h; row++) {
      let inset = 0;
      const cy = row + 0.5;
      if (cy < r) inset = r - Math.sqrt(Math.max(0, r * r - (r - cy) * (r - cy)));
      else if (cy > h - r) inset = r - Math.sqrt(Math.max(0, r * r - (cy - (h - r)) * (cy - (h - r))));
      const i = Math.round(inset);
      this.ctx.fillRect(x + i, y + row, w - 2 * i, 1);
    }
    return this;
  }

  /** Scanline polygon fill (points in pixel space). */
  poly(points: [number, number][], color: string) {
    if (points.length < 3) return this;
    this.ctx.fillStyle = color;
    const ys = points.map((p) => p[1]);
    const minY = Math.floor(Math.min(...ys));
    const maxY = Math.ceil(Math.max(...ys));
    for (let py = minY; py <= maxY; py++) {
      const y = py + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xa = Math.round(xs[i]);
        const xb = Math.round(xs[i + 1]);
        if (xb > xa) this.ctx.fillRect(xa, py, xb - xa, 1);
      }
    }
    return this;
  }

  /** Arch shape: rectangle with a semicircular top. */
  arch(x: number, y: number, w: number, h: number, color: string) {
    const r = w / 2;
    this.ellipse(x + r, y + r, r, r, color);
    this.rect(x, y + r, w, h - r, color);
    return this;
  }

  star(cx: number, cy: number, rOuter: number, rInner: number, points: number, color: string, rot = -Math.PI / 2) {
    const pts: [number, number][] = [];
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? rOuter : rInner;
      const a = rot + (i * Math.PI) / points;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return this.poly(pts, color);
  }

  /** Burst / starburst sticker ("NEW!" badges). */
  burst(cx: number, cy: number, r: number, spikes: number, color: string) {
    return this.star(cx, cy, r, r * 0.78, spikes, color, 0);
  }

  checker(x: number, y: number, w: number, h: number, c1: string, c2: string, size = 1) {
    for (let yy = 0; yy < h; yy += size) {
      for (let xx = 0; xx < w; xx += size) {
        const odd = (Math.floor(xx / size) + Math.floor(yy / size)) % 2 === 1;
        this.rect(x + xx, y + yy, Math.min(size, w - xx), Math.min(size, h - yy), odd ? c2 : c1);
      }
    }
    return this;
  }

  /** Ordered dither overlay: density 0..1 of pixels painted with color. */
  dither(x: number, y: number, w: number, h: number, color: string, density = 0.5) {
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    this.ctx.fillStyle = color;
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const px = x + xx;
        const py = y + yy;
        const t = (bayer[(py & 3) * 4 + (px & 3)] + 0.5) / 16;
        if (t < density) this.ctx.fillRect(px, py, 1, 1);
      }
    }
    return this;
  }

  /** Vertical banded gradient with dithered transitions (pixel-art style). */
  gradientV(x: number, y: number, w: number, h: number, top: string, bottom: string, steps = 4) {
    const a = new THREE.Color(top);
    const b = new THREE.Color(bottom);
    const band = h / steps;
    for (let i = 0; i < steps; i++) {
      const c = a.clone().lerp(b, steps === 1 ? 0 : i / (steps - 1));
      this.rect(x, Math.round(y + i * band), w, Math.ceil(band) + 1, '#' + c.getHexString());
    }
    for (let i = 1; i < steps; i++) {
      const c = a.clone().lerp(b, i / (steps - 1));
      const yy = Math.round(y + i * band) - 2;
      this.dither(x, yy, w, 2, '#' + c.getHexString(), 0.5);
    }
    return this;
  }

  grid(x: number, y: number, w: number, h: number, spacing: number, color: string, offset = 0) {
    for (let xx = offset; xx < w; xx += spacing) this.rect(x + xx, y, 1, h, color);
    for (let yy = offset; yy < h; yy += spacing) this.rect(x, y + yy, w, 1, color);
    return this;
  }

  textWidth(text: string, opts: TextOptions = {}) {
    const font = opts.font ?? FONT_BIG;
    const scale = opts.scale ?? 1;
    const spacing = (opts.spacing ?? font.spacing) + (opts.bold ? 1 : 0);
    const w = measureText(font, text, 1, spacing);
    return w * scale;
  }

  text(text: string, x: number, y: number, opts: TextOptions = {}) {
    const font = opts.font ?? FONT_BIG;
    const scale = opts.scale ?? 1;
    const color = opts.color ?? '#000';
    const spacing = (opts.spacing ?? font.spacing) + (opts.bold ? 1 : 0);
    const tw = this.textWidth(text, opts);
    let ox = Math.round(x);
    if (opts.align === 'center') ox = Math.round(x - tw / 2);
    else if (opts.align === 'right') ox = Math.round(x - tw);
    const oy = Math.round(y);
    const pixels: [number, number][] = [];
    forEachTextPixel(font, text, (px, py) => {
      pixels.push([px, py]);
      if (opts.bold) pixels.push([px + 1, py]);
    }, spacing);

    const drawSet = (dx: number, dy: number, c: string) => {
      this.ctx.fillStyle = c;
      for (const [px, py] of pixels) this.ctx.fillRect(ox + px * scale + dx, oy + py * scale + dy, scale, scale);
    };
    if (opts.shadow) {
      const [sx, sy] = opts.shadowOffset ?? [1, 1];
      if (opts.outline) {
        const ow = opts.outlineWidth ?? 1;
        for (let dy = -ow; dy <= ow; dy++) for (let dx = -ow; dx <= ow; dx++) drawSet(dx + sx, dy + sy, opts.shadow);
      } else drawSet(sx, sy, opts.shadow);
    }
    if (opts.outline) {
      const ow = opts.outlineWidth ?? 1;
      for (let dy = -ow; dy <= ow; dy++) for (let dx = -ow; dx <= ow; dx++) if (dx || dy) drawSet(dx, dy, opts.outline);
    }
    drawSet(0, 0, color);
    return tw;
  }

  /** Draw pixel art from rows of palette characters. '.' or ' ' are transparent. */
  sprite(rows: string[], x: number, y: number, palette: Record<string, string>, scale = 1, flipX = false) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        const col = palette[ch];
        if (!col) continue;
        const cx = flipX ? row.length - 1 - c : c;
        this.ctx.fillStyle = col;
        this.ctx.fillRect(Math.round(x + cx * scale), Math.round(y + r * scale), scale, scale);
      }
    }
    return this;
  }

  blit(src: Painter | HTMLCanvasElement, x: number, y: number, scale = 1) {
    const c = src instanceof Painter ? src.canvas : src;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(c, Math.round(x), Math.round(y), c.width * scale, c.height * scale);
    return this;
  }

  /** Draw a QR code: one module = `m` pixels. */
  qr(qr: QRLike, x: number, y: number, m: number, dark: string, light?: string, quiet = 0) {
    const total = (qr.size + quiet * 2) * m;
    if (light) this.rect(x, y, total, total, light);
    this.ctx.fillStyle = dark;
    for (let r = 0; r < qr.size; r++) {
      for (let c = 0; c < qr.size; c++) {
        if (qr.isDark(r, c)) this.ctx.fillRect(Math.round(x + (c + quiet) * m), Math.round(y + (r + quiet) * m), m, m);
      }
    }
    return this;
  }

  /** Add a 1px outline around every opaque region (classic pixel-art ink line). */
  outline(color: string, thickness = 1, diagonal = false) {
    for (let pass = 0; pass < thickness; pass++) {
      const img = this.ctx.getImageData(0, 0, this.w, this.h);
      const d = img.data;
      const w = this.w;
      const h = this.h;
      const mark: number[] = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (d[i + 3] > 0) continue;
          let hit = false;
          for (let dy = -1; dy <= 1 && !hit; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              if (!diagonal && dx && dy) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              if (d[(ny * w + nx) * 4 + 3] > 0) {
                hit = true;
                break;
              }
            }
          }
          if (hit) mark.push(x, y);
        }
      }
      this.ctx.fillStyle = color;
      for (let i = 0; i < mark.length; i += 2) this.ctx.fillRect(mark[i], mark[i + 1], 1, 1);
    }
    return this;
  }

  /** Replace every opaque pixel with a flat color (useful for silhouettes / shadows). */
  silhouette(color: string) {
    this.ctx.globalCompositeOperation = 'source-in';
    this.rect(0, 0, this.w, this.h, color);
    this.ctx.globalCompositeOperation = 'source-over';
    return this;
  }

  /** Make every pixel either fully opaque or fully transparent (keeps edges crisp after drawImage). */
  hardenAlpha(threshold = 128) {
    const img = this.ctx.getImageData(0, 0, this.w, this.h);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= threshold ? 255 : 0;
    this.ctx.putImageData(img, 0, 0);
    return this;
  }

  clone() {
    const p = new Painter(this.w, this.h);
    p.ctx.drawImage(this.canvas, 0, 0);
    return p;
  }

  texture(repeat = false): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(this.canvas);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
    }
    t.needsUpdate = true;
    return t;
  }

  /** Upscale with nearest-neighbour for export. */
  scaled(scale: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w * scale;
    c.height = this.h * scale;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.canvas, 0, 0, c.width, c.height);
    return c;
  }
}

/** Shade a hex color: amount > 0 lightens, < 0 darkens (in sRGB space, like a pixel artist would). */
export function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, THREE.SRGBColorSpace);
  // hue shift toward warm when lightening and cool when darkening (classic pixel-art ramp)
  const hueShift = amount * 0.04;
  hsl.h = (hsl.h + hueShift + 1) % 1;
  hsl.l = THREE.MathUtils.clamp(hsl.l + amount, 0, 1);
  hsl.s = THREE.MathUtils.clamp(hsl.s * (1 - Math.abs(amount) * 0.25), 0, 1);
  c.setHSL(hsl.h, hsl.s, hsl.l, THREE.SRGBColorSpace);
  return '#' + c.getHexString(THREE.SRGBColorSpace);
}

export function mix(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return '#' + ca.lerp(cb, t).getHexString();
}
