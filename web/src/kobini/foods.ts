import { Chef, INK } from './chef';
import { Mask, hex, prng, type RGB } from './pixel';

/**
 * Detailed pixel-art food sprites for the shelves. Each recipe draws one sprite (usually 32×32,
 * 3/4 top-down view, lit from the top-left, dark ink outline) with the procedural Chef. Sprites are
 * deterministic, bottom-aligned and horizontally centred in their canvas so they stand on a shelf.
 */

export type Aisle = 'bakery' | 'snacks' | 'candy' | 'breakfast' | 'fresh' | 'drinks' | 'frozen' | 'meals' | 'pantry';

export interface FoodDef {
  id: string;
  aisle: Aisle;
  draw: () => HTMLCanvasElement;
  /** Display name for labels and price tags. */
  name: string;
}

type Pt = [number, number];
type Ramp = RGB[];

const pal = (...c: string[]): Ramp => c.map(hex);

// -------------------------------------------------------------------------------------------------
// Palette: hand-picked 5-step ramps (dark → light). Shadows lean red/purple, lights lean yellow.

const P = {
  crust: pal('#5e2a14', '#9a5022', '#cf8a3e', '#eeb866', '#fbdc9c'),
  bun: pal('#6a2c10', '#a8531e', '#dc8a34', '#f4b75a', '#fde096'),
  crumb: pal('#c0925a', '#e0bc86', '#f3d9aa', '#fcedd0', '#fffaee'),
  toast: pal('#76360f', '#b46224', '#dc9442', '#f0c170', '#fae2a4'),
  toastIn: pal('#c07830', '#e0a24e', '#f2c676', '#fadc9c', '#fff0c8'),
  cookie: pal('#6e3510', '#a86224', '#d59442', '#ecbd6c', '#f9dfa2'),
  fried: pal('#652409', '#a44a16', '#d87c28', '#f2ab44', '#fdd57e'),
  choco: pal('#23100b', '#401d13', '#63301d', '#8a4c2e', '#b0704a'),
  chip: pal('#1c0c08', '#341710', '#522618', '#733a24', '#96583a'),
  sausage: pal('#561210', '#94261a', '#c9482c', '#ea7a4c', '#fbab7c'),
  pepperoni: pal('#4c0a10', '#8a1a1c', '#c23228', '#e45c42', '#f8927a'),
  pizzaCheese: pal('#a24c0a', '#d88418', '#f6b42c', '#ffd85c', '#fff09c'),
  cheese: pal('#8a520a', '#cc8a16', '#f2bc2a', '#ffdf62', '#fff3ad'),
  lettuce: pal('#17441e', '#2a7229', '#52a635', '#8cd254', '#c8ef88'),
  tomato: pal('#5a0f10', '#9a2016', '#d63e28', '#f47650', '#ffae88'),
  beef: pal('#2c110b', '#4f2114', '#77391f', '#9e5932', '#c27e50'),
  whip: pal('#c8989e', '#ecd8d8', '#faf0ee', '#fffaf8', '#ffffff'),
  rice: pal('#979db8', '#c8cde0', '#e9ecf6', '#fbfcff', '#ffffff'),
  nori: pal('#0b1511', '#16271e', '#243d2e', '#355644', '#4f745c'),
  salmon: pal('#9a3016', '#d45628', '#f47e48', '#ffa672', '#ffd0a8'),
  pink: pal('#86294f', '#c24d7c', '#ee7fa6', '#ffb1c9', '#ffe0ea'),
  strawberry: pal('#5c0c1e', '#a01a30', '#de3648', '#ff6e68', '#ffa99a'),
  apple: pal('#570f19', '#98202a', '#d63a3a', '#f76e5c', '#ffa68a'),
  leaf: pal('#133a1e', '#1f6230', '#358f40', '#64bd57', '#a6e282'),
  stem: pal('#2e170c', '#4d2a16', '#6e4224', '#8f5e38', '#b07e52'),
  white: pal('#99a2b8', '#c9d0de', '#eaeef5', '#f9fbfe', '#ffffff'),
  sky: pal('#1c4670', '#2f72aa', '#4ea2da', '#86cbf2', '#c8ecff'),
  bone: pal('#9a8568', '#c8b492', '#e8dabe', '#f8f0e0', '#fffdf8'),
  wrapper: pal('#7a1f45', '#b53a68', '#e0668f', '#f797b5', '#ffc8d8'),
  batter: pal('#b87a34', '#dea45a', '#f2cc84', '#fbe4ae', '#fff4d6'),
  cooked: pal('#6a2e0e', '#a2531c', '#cf8034', '#e9a854', '#f8cc84'),
  syrup: pal('#3a1204', '#6a2a0a', '#9c4c14', '#cc7a26', '#f0aa4c'),
  butter: pal('#b08a1c', '#dcbc3c', '#f8e67a', '#fff4b0', '#fffce2'),
  custard: pal('#a86c10', '#d89a28', '#f4c654', '#ffe08a', '#fff4c4'),
  caramel: pal('#3c1406', '#6e2a0c', '#a04c16', '#cf7a2a', '#f0aa52'),
  matcha: pal('#4a6424', '#6f8f36', '#98b852', '#bcd67a', '#e0efb0'),
  matchaSkin: pal('#253a14', '#3f5c22', '#5e8032', '#86a84c', '#b2cc78'),
  blueberry: pal('#141434', '#262a64', '#3c4696', '#5e70c4', '#96aee6'),
  raspberry: pal('#5a0a26', '#961a3c', '#d0325a', '#f06684', '#ffa2b4'),
  sponge: pal('#b8862c', '#deb04e', '#f4d27a', '#fde8a8', '#fff8dc'),
  pieFill: pal('#9a5a10', '#c88a24', '#e8b448', '#f8d47a', '#fff0b0'),
  bamboo: pal('#5a3a12', '#8a6024', '#b88c3e', '#d8b464', '#f0d894'),
  bao: pal('#b08e78', '#dcc6b2', '#f3e9dd', '#fcf8f2', '#ffffff'),
  mint: pal('#12402a', '#1f6a40', '#34985a', '#62c47c', '#a8eab0'),
  mustard: pal('#8a5a06', '#c8900c', '#f2c21c', '#ffe050', '#fff29a'),
  steak: pal('#3a100c', '#661e14', '#96341e', '#c05a30', '#de8652'),
  fat: pal('#b08466', '#d8b490', '#f0d8b6', '#faeed8', '#fffaf0'),
  bowlRed: pal('#4e0e16', '#8c1c24', '#c83434', '#ea6448', '#fc9c7a'),
  broth: pal('#7a3410', '#b0601c', '#dc8e36', '#f2b660', '#fcda96'),
  noodle: pal('#a87818', '#d8aa34', '#f2d260', '#fce894', '#fff8d0'),
  eggWhite: pal('#b4aabc', '#dcd6e2', '#f4f2f6', '#fffefa', '#ffffff'),
  yolk: pal('#b0520a', '#e88414', '#ffb424', '#ffd85a', '#fff2a6'),
  corn: pal('#8a4e0a', '#c8841a', '#eeb030', '#fcd462', '#fff0a2'),
  mince: pal('#2c120a', '#502414', '#763c20', '#985830', '#b87848'),
  pasta: pal('#b0801a', '#dcae38', '#f4d262', '#fdea98', '#fff8cc'),
  marinara: pal('#4c0c0a', '#881a12', '#be321c', '#e05632', '#f68656'),
  meatball: pal('#2e120a', '#582414', '#80401e', '#a4622e', '#c48a4e'),
  onion: pal('#6a3a6a', '#a8709e', '#dcb0d0', '#f4dcec', '#fff6fb'),
  pepper: pal('#123e12', '#1e6a1c', '#36982a', '#62c448', '#a2e67a'),
  bechamel: pal('#b89a74', '#dcc6a4', '#f2e6cc', '#fcf6e6', '#ffffff'),
  ham: pal('#7a2a3a', '#b04a5e', '#e07a8a', '#f7a8ae', '#ffd6d2'),
  wood: pal('#5a3418', '#8a5a2e', '#b88a52', '#dab47c', '#f2d8a8'),
  red: pal('#5a0f16', '#9a1d24', '#d8353a', '#f7695e', '#ffa18e'),
  glass: pal('#86a8c4', '#b4d2e6', '#d8eef8', '#f0faff', '#ffffff'),
  lemonade: pal('#c8a018', '#ecd03a', '#faec78', '#fff6ae', '#fffcdc'),
  lemon: pal('#8a6a06', '#caa20e', '#f2d024', '#fff06a', '#fffbc4'),
  oj: pal('#a8420a', '#e06e18', '#fc9a2a', '#ffc052', '#ffe08c'),
  orange: pal('#7a300a', '#c05812', '#f08a20', '#ffb64c', '#ffdc8c'),
  tea: pal('#3e6a26', '#5e9038', '#86b852', '#b0d67c', '#dcefb0'),
  boba: pal('#140806', '#2c140c', '#4a2416', '#6e3a24', '#94583a'),
  coffee: pal('#1c0b07', '#361a0f', '#562c18', '#7a4424', '#a0663c'),
  crema: pal('#8a5428', '#b8783c', '#d8a064', '#ecc48e', '#f8e2bc'),
  mug: pal('#1c5a60', '#2a8288', '#3eaeb0', '#72d2cc', '#b4efe6'),
  can: pal('#5a0c14', '#9c1822', '#d82c34', '#f45a52', '#ff9486'),
  steel: pal('#4a5262', '#707a8c', '#9aa4b4', '#c4ccd8', '#eef2f8'),
  juiceBox: pal('#1f5a2a', '#2e8a3a', '#4cb84e', '#84dc72', '#c0f2a4'),
  creamsicle: pal('#9a360a', '#dc6014', '#fc9030', '#ffba5e', '#ffe09e'),
  vanilla: pal('#c49a62', '#e6c48e', '#f8e4bc', '#fff4dc', '#fffdf6'),
  grape: pal('#2e1248', '#50207a', '#7a3aae', '#a466d6', '#d2a2f2'),
  popStick: pal('#8a6038', '#c0935a', '#e0bc84', '#f2d9a8', '#fcf0d0'),
  wafer: pal('#80440e', '#b87426', '#dca048', '#f2c678', '#fce4a8'),
  candy: pal('#4e0610', '#8c0c1c', '#d0162a', '#f44a4a', '#ff9a8a'),
  brownie: pal('#1a0a07', '#32150d', '#4e2415', '#6c3a22', '#8e5634'),
  fudgeTop: pal('#2a120b', '#4a2414', '#6e3a20', '#946034', '#b88452'),
  pudding: pal('#1e0c08', '#3a1a0e', '#5a2e18', '#7c4626', '#9e6438'),
  gummyR: pal('#6a0818', '#b0142a', '#ec3040', '#ff6a6a', '#ffb0a8'),
  gummyY: pal('#9a5a04', '#d8900a', '#fcc020', '#ffe266', '#fff6b4'),
  gummyG: pal('#1a5410', '#2c8a1a', '#4cc02e', '#8ae45c', '#c8f8a0'),
  foil: pal('#5a6272', '#8690a2', '#b4bccb', '#dce2ec', '#ffffff'),
  wrapBlue: pal('#12245a', '#1e3c92', '#2e5cc8', '#5a8ce8', '#9cc0ff'),
  brulee: pal('#5a2808', '#96480e', '#cc7a1c', '#eaa640', '#fad27a'),
  cucumber: pal('#1a4a1a', '#2c7428', '#4ea43c', '#86cc62', '#c4ec9c'),
  tamago: pal('#a86a0a', '#dc9c18', '#f8c83a', '#ffe274', '#fff4b8'),
  appleFlesh: pal('#c4a05a', '#e4c888', '#f6e4b4', '#fff4d8', '#fffcf0'),
  banana: pal('#8a5e08', '#c8921a', '#f0c42e', '#fce066', '#fff4ac'),
  melon: pal('#6a0c1c', '#b01c30', '#e8384a', '#ff6e70', '#ffa8a0'),
  rind: pal('#0e3a16', '#1a5e22', '#2c8a30', '#5cb44a', '#a4dc7c'),
  bread: pal('#b88a50', '#dcb880', '#f2dcae', '#fbeed4', '#fffaf0'),
  bowlBlue: pal('#14305e', '#20509a', '#3478cc', '#66a6ec', '#a8d4ff'),
  milk: pal('#a8b0c8', '#d2d8e8', '#f0f3fa', '#fcfdff', '#ffffff'),
  popcorn: pal('#c09a58', '#e6cc90', '#faecc4', '#fffae8', '#ffffff'),
  bag: pal('#6a1a0a', '#b0341a', '#e85a28', '#ff8a4a', '#ffbe86'),
  edamame: pal('#1c4a12', '#2e7420', '#4aa032', '#7ccc54', '#b8ec8a'),
  lacquer: pal('#140a0c', '#2a1418', '#40202a', '#5c3440', '#7c5060'),
  jam: pal('#3e0614', '#700e24', '#a81c34', '#d83c4c', '#f47a7a'),
  honey: pal('#6a3206', '#a8600e', '#dc9420', '#f6c048', '#ffe490'),
  foam: pal('#b0a8a0', '#d8d2ca', '#f2eee8', '#fcfaf6', '#ffffff'),
  springRoll: pal('#6e300c', '#ae5e1c', '#dc9038', '#f4bc5e', '#fde09c'),
  grill: pal('#4a1a0c', '#7a3214', '#a8522a', '#cc7a44', '#e8a66a'),
  sprinkle: ['#ffffff', '#ffe066', '#7fd3ff', '#8be07a', '#c89bff', '#ff7aa8'],
};

const WHITE = '#ffffff';

// -------------------------------------------------------------------------------------------------
// Registry

const FOODS: FoodDef[] = [];

/** Final sprite size of the recipe being drawn (recipes paint on a slightly larger canvas). */
let target: [number, number] | null = null;
const PAD = 4;

function food(id: string, aisle: Aisle, name: string, draw: () => HTMLCanvasElement) {
  let cache: HTMLCanvasElement | null = null;
  FOODS.push({
    id,
    aisle,
    name,
    draw: () => {
      if (!cache) {
        target = null;
        const art = draw();
        cache = settle(art, target ?? [art.width, art.height]);
      }
      return copyCanvas(cache);
    },
  });
}

/** Crop to the final size so the sprite stands on the bottom row, centred horizontally. */
function settle(src: HTMLCanvasElement, [w, h]: [number, number]): HTMLCanvasElement {
  const { width: sw, height: sh } = src;
  const data = src.getContext('2d')!.getImageData(0, 0, sw, sh).data;
  let x0 = sw;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++)
      if (data[(y * sw + x) * 4 + 3]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  if (x1 < 0) return out;
  const dx = Math.floor((w - (x1 - x0 + 1)) / 2) - x0;
  const dy = h - 1 - y1;
  out.getContext('2d')!.drawImage(src, dx, dy);
  return out;
}

function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  out.getContext('2d')!.drawImage(src, 0, 0);
  return out;
}

// -------------------------------------------------------------------------------------------------
// Shared bits

/** A Chef with the house style: clean bands, no dithering. */
function chef(w: number, h: number, seed: number) {
  // a little spare room on the right and bottom so shapes that overhang never lose their outline
  target = [w, h];
  const c = new Chef(w + PAD, h + PAD, seed);
  c.shadeDefaults = { dither: false, clean: true };
  return c;
}

/** Pixels of `m` not covered by `m` shifted by (dx, dy): the edge facing away from the shift. */
function lip(m: Mask, dx: number, dy: number) {
  return m.clone().subtract(m.shift(dx, dy));
}

/** A glint that only lands on painted pixels (never grows the silhouette). */
function glint(c: Chef, x: number, y: number, len = 1, color: string | RGB = WHITE) {
  const col = typeof color === 'string' ? hex(color) : color;
  for (let k = 0; k < len; k++) if (c.bmp.alpha(x + k, y - k)) c.bmp.set(x + k, y - k, col);
}

/** Single highlight pixels (only on painted pixels). */
function dots(c: Chef, pts: Pt[], color: string | RGB = WHITE) {
  const col = typeof color === 'string' ? hex(color) : color;
  for (const [x, y] of pts) if (c.bmp.alpha(x, y)) c.bmp.set(x, y, col);
}

/** Wobble a silhouette with little bumps along its edge (crispy coatings, crumbly edges). */
function bumpy(c: Chef, m: Mask, seed: number, every = 4, r0 = 1.1, r1 = 1.8) {
  const rand = prng(seed);
  const out = m.clone();
  const e = m.edge();
  let k = 0;
  for (let i = 0; i < e.m.length; i++) {
    if (!e.m[i]) continue;
    if (k++ % every) continue;
    out.union(c.circle((i % c.w) + 0.5, ((i / c.w) | 0) + 0.5, r0 + rand() * (r1 - r0)));
  }
  return c.tidy(out);
}

/**
 * Shave single-pixel nubs, ink the silhouette, then add soft extras that must not get the dark
 * outline (steam wisps). Returns the finished canvas like `Chef.done()`; pass `nubs: false` to keep
 * deliberate 1px points (leaf tips, crimped seams).
 */
function finish(c: Chef, extras?: () => void, o: { nubs?: boolean } = {}) {
  if (o.nubs !== false) c.removeNubs();
  c.bmp.outline(INK);
  extras?.();
  return c.bmp.toCanvas();
}

/** A wisp of steam: a pale 1px stroke with a soft lilac edge, drawn after the ink outline. */
function steam(c: Chef, pts: Pt[]) {
  const core = c.curve(pts, 0.5);
  const edge = core.dilate().subtract(core);
  for (let i = 0; i < edge.m.length; i++) {
    const x = i % c.w;
    const y = (i / c.w) | 0;
    if (edge.m[i] && !c.bmp.alpha(x, y)) c.bmp.set(x, y, hex('#b9bdd8'));
  }
  for (let i = 0; i < core.m.length; i++) {
    const x = i % c.w;
    const y = (i / c.w) | 0;
    if (core.m[i] && !c.bmp.alpha(x, y)) c.bmp.set(x, y, hex('#ffffff'));
  }
}

/**
 * A see-through glass: pale walls, the drink inside with its surface, the far inside wall and the
 * rim. Returns the masks so recipes can add glare, ice, fruit and straws.
 */
function glass(c: Chef, cx: number, top: number, bottom: number, rxTop: number, rxBot: number, ry: number, level: number, drink: Ramp) {
  const g = cyl(c, cx, top, bottom, rxTop, rxBot, ry);
  c.layer(g.body, P.glass, { form: 'cylY', bias: 0.1 });
  const k = (level - top) / (bottom - top);
  const rxL = rxTop + (rxBot - rxTop) * k - 1;
  const inner = cyl(c, cx, level, bottom - 1, rxL, rxBot - 1, ry - 0.6);
  c.layer(inner.body, drink, { form: 'cylY', bias: 0.05 });
  c.layer(inner.top, drink, { form: 'flat', bevel: 1, bias: 0.25, shadow: false });
  // the far inside wall of the glass shows between the rim and the drink
  c.paint(g.top.clone().subtract(inner.top).subtract(inner.body).intersect(c.rect(0, 0, c.w, level)), P.glass[1]);
  c.paint(c.ring(cx, top, rxTop, ry, 1), P.glass[3]);
  c.paint(lip(c.ring(cx, top, rxTop, ry, 1), 0, 1).intersect(c.rect(0, top, c.w, 10)), P.glass[1]);
  return { body: g.body, inner: inner.body, surface: inner.top };
}

/** A citrus wheel facing us: rind, pith ring and juicy segments. */
function citrusWheel(c: Chef, x: number, y: number, r: number, rind: Ramp, flesh: Ramp) {
  const disc = c.circle(x, y, r);
  c.layer(disc, rind, { form: 'soft', bevel: 1, rim: true });
  c.paint(c.circle(x, y, r - 1), flesh[4]);
  const juicy = c.circle(x, y, r - 1.7);
  c.layer(juicy, flesh, { form: 'soft', bevel: 1, bias: 0.05, shadow: false });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    c.line(x - 0.5, y - 0.5, x - 0.5 + Math.cos(a) * (r - 1.5), y - 0.5 + Math.sin(a) * (r - 1.5), flesh[4], juicy);
  }
  return disc;
}

/** A white ceramic plate seen from above-front: underside rim, top, and a shallow well. */
function plate(c: Chef, cx: number, cy: number, rx: number, ry: number, ramp: Ramp = P.white) {
  c.layer(c.ellipse(cx, cy + 1.5, rx, ry), ramp, { form: 'flat', bevel: 1, bias: -0.3 });
  c.layer(c.ellipse(cx, cy, rx, ry), ramp, { form: 'flat', bevel: 1, bias: 0.06, shadow: false });
  const well = c.ellipse(cx, cy + 0.6, rx * 0.72, ry * 0.66);
  c.paint(lip(well, 0, 1), ramp[1]);
  c.paint(lip(well, 0, -1).subtract(lip(well, 0, 1)), ramp[4]);
}

/** Upright cylinder / frustum: side body and elliptical top face. */
function cyl(c: Chef, cx: number, top: number, bottom: number, rxTop: number, rxBot: number, ry: number) {
  const body = c
    .poly([
      [cx - rxTop, top],
      [cx + rxTop, top],
      [cx + rxBot, bottom],
      [cx - rxBot, bottom],
    ])
    .union(c.ellipse(cx, bottom, rxBot, ry))
    .union(c.ellipse(cx, top, rxTop, ry));
  return { body, top: c.ellipse(cx, top, rxTop, ry) };
}

/**
 * A box in 3/4 view: the front face (w × h, top edge at y + dy), the right side receding by
 * (dx, −dy), and the top face between them.
 */
function box(c: Chef, x: number, y: number, w: number, h: number, dx: number, dy: number) {
  return {
    front: c.rect(x, y + dy, w, h),
    side: c.poly([
      [x + w, y + dy],
      [x + w + dx, y],
      [x + w + dx, y + h],
      [x + w, y + dy + h],
    ]),
    top: c.poly([
      [x, y + dy],
      [x + dx, y],
      [x + w + dx, y],
      [x + w, y + dy],
    ]),
  };
}

/** Vertical ridges on a cylinder side (fluted tart shells, paper cups, ramekins). */
function flutes(c: Chef, body: Mask, x0: number, x1: number, step: number, dark: RGB, light: RGB) {
  for (let x = x0; x <= x1; x += step) {
    c.line(x, 0, x, c.h, dark, body);
    c.line(x - 1, 0, x - 1, c.h, light, body);
  }
}

/** A mint leaf: a pointed oval with a centre vein. */
function mintLeaf(c: Chef, x: number, y: number, len: number, wid: number, deg: number) {
  const m = c.oval(x, y, len, wid, deg);
  c.layer(m, P.mint, { form: 'soft', bevel: 1.2, bias: 0.08, rim: true });
  const t = (deg * Math.PI) / 180;
  c.line(x - Math.cos(t) * (len - 1), y - Math.sin(t) * (len - 1), x + Math.cos(t) * (len - 1.5), y + Math.sin(t) * (len - 1.5), P.mint[1], m);
  return m;
}

/** A small whole strawberry with seeds and a leafy cap. */
function strawberry(c: Chef, x: number, y: number, r: number) {
  // rounded shoulders tapering to a soft point
  const body = c
    .ellipse(x, y - r * 0.2, r, r * 0.8)
    .union(
      c.poly([
        [x - r * 0.97, y - r * 0.1],
        [x + r * 0.97, y - r * 0.1],
        [x + r * 0.25, y + r * 1.15],
        [x - r * 0.25, y + r * 1.15],
      ]),
    );
  const b = c.tidy(body);
  c.layer(b, P.strawberry, { form: 'puff', reflect: true, rim: true });
  const seeds = b.clone().intersect(b.erode());
  c.scatter(seeds, { count: Math.round(r * r * 0.35), colors: ['#ffe9a0'], kind: 'dot', seed: Math.round(x * 7 + y) });
  // leafy crown sitting on the shoulders, with a little stem on top
  const cap = c.poly([
    [x - r * 1.05, y - r * 0.5],
    [x - r * 0.45, y - r * 0.95],
    [x - r * 0.1, y - r * 1.25],
    [x + r * 0.1, y - r * 1.25],
    [x + r * 0.45, y - r * 0.95],
    [x + r * 1.05, y - r * 0.5],
    [x + r * 0.45, y - r * 0.62],
    [x + r * 0.2, y - r * 0.3],
    [x, y - r * 0.6],
    [x - r * 0.2, y - r * 0.3],
    [x - r * 0.45, y - r * 0.62],
  ]);
  c.layer(cap, P.leaf, { form: 'soft', bevel: 1, clean: false });
  dots(c, [[Math.round(x - r * 0.55), Math.round(y)]]);
  return b;
}

/** A flat wooden popsicle stick. */
function popStick(c: Chef, x: number, y0: number, y1: number, w = 4) {
  const m = c.roundRect(x - w / 2, y0, w, y1 - y0, w / 2 - 0.2);
  c.layer(m, P.popStick, { form: 'soft', bevel: 1 });
  return m;
}

/** A bowl seen from above-front: body, rim and the contents' surface. */
function bowl(c: Chef, cx: number, cy: number, rx: number, ry: number, depth: number, ramp: Ramp, fill: Ramp) {
  const body = c.ellipse(cx, cy, rx, depth).intersect(c.rect(0, cy, c.w, c.h)).union(c.ellipse(cx, cy, rx, ry));
  c.layer(body, ramp, { form: 'cylY', bias: 0.05 });
  c.layer(c.ellipse(cx, cy + depth - 1, rx * 0.45, 1.6).intersect(body.shift(0, 1)), ramp, { form: 'flat', bevel: 1, bias: -0.2 });
  c.layer(c.ellipse(cx, cy, rx, ry), ramp, { form: 'flat', bevel: 1, bias: 0.25, shadow: false });
  const surf = c.ellipse(cx, cy + 0.4, rx - 1.6, ry - 1.1);
  c.layer(surf, fill, { form: 'flat', bevel: 1, bias: 0.05, shadow: false });
  return { body, surf };
}

// =================================================================================================
// Bakery

food('croissant', 'bakery', 'Croissant', () => {
  const c = chef(32, 32, 5);
  // rolled segments along a crescent, tips first so the fat middle roll sits on top; the tips
  // curl inward like a real crescent
  const segs: [number, number, number, number, number][] = [
    // x, y, half-width, half-length, tilt
    [6.2, 25.6, 2.1, 3.3, -48],
    [25.8, 25.6, 2.1, 3.3, 48],
    [5.4, 21.2, 3.2, 5, -58],
    [26.6, 21.2, 3.2, 5, 58],
    [9.8, 17, 4.2, 6.8, -30],
    [22.2, 17, 4.2, 6.8, 30],
    [16, 15.2, 5.5, 8.3, 0],
  ];
  segs.forEach(([x, y, a, b, deg], i) => {
    const m = c.oval(x, y, a, b, deg);
    c.layer(m, P.crust, { form: 'puff', rim: true, depth: 0.85, bias: i < 2 ? -0.04 : i < 4 ? 0.02 : 0.06 });
    // flaky layer edge: a pale lip just inside the lit side of each roll
    if (i >= 2) c.paint(lip(m, 1, 1).intersect(m.erode()).intersect(c.rect(0, 0, x + 1, 32)), P.crust[3]);
  });
  glint(c, 13, 11, 2);
  dots(c, [
    [8, 15],
    [21, 12],
    [4, 20],
  ]);
  return finish(c);
});

food('donut', 'bakery', 'Sprinkle Donut', () => {
  const c = chef(32, 32, 11);
  const hole = c.ellipse(16, 14.5, 4.2, 2.8);
  const body = c.ellipse(16, 16.5, 13.5, 11).subtract(hole);
  c.layer(body, P.crust, { form: 'puff' });
  // the far inner wall shows through the top of the hole
  c.paint(c.ellipse(16, 14.5, 4.2, 2.8).subtract(c.ellipse(16, 15.8, 4.2, 2.8)), P.crust[1]);
  const icing = c
    .blob([
      [4.5, 14],
      [7.5, 7.5],
      [16, 5],
      [24.5, 7.5],
      [27.5, 13.5],
      [26.5, 18.5],
      [24, 20.5],
      [22, 19.5],
      [20.5, 23],
      [18, 20.5],
      [13.5, 21],
      [11, 23.5],
      [9, 20],
      [6.5, 19],
    ])
    .subtract(c.ellipse(16, 14.5, 5.4, 4));
  c.layer(icing, P.pink, { form: 'puff', depth: 0.55 });
  c.scatter(icing, { count: 18, colors: P.sprinkle, kind: 'sprinkle', margin: 1, seed: 3 });
  glint(c, 7, 12, 2);
  dots(c, [[10, 8]]);
  return finish(c);
});

food('cupcake', 'bakery', 'Cherry Cupcake', () => {
  const c = chef(32, 32, 9);
  const wrap = c.poly([
    [7.5, 19],
    [24.5, 19],
    [22.5, 30],
    [9.5, 30],
  ]);
  c.layer(wrap, P.wrapper, { form: 'cylY' });
  for (const x of [11, 14, 17, 20, 23]) c.line(x, 20, x - (x - 16) * 0.16, 29, P.wrapper[1], wrap);
  c.layer(c.ellipse(16, 19, 9, 2.5), P.choco, { form: 'soft' });
  const t1 = c.ellipse(16, 16.5, 10, 4.2);
  const t2 = c.ellipse(16, 12.6, 7.6, 3.8);
  const t3 = c.ellipse(16, 9.2, 5, 3);
  for (const t of [t1, t2, t3]) c.layer(t, P.whip, { form: 'puff', depth: 0.8, rim: true, bias: 0.06 });
  c.scatter(t1.clone().union(t2).union(t3), { count: 10, colors: P.sprinkle.slice(1), kind: 'sprinkle', margin: 1, seed: 4 });
  c.layer(c.circle(16.5, 5, 3), P.strawberry, { form: 'puff', reflect: true });
  c.line(16, 2, 17, 1, P.stem[1]).line(17, 1, 19, 0, P.stem[1]);
  dots(c, [
    [15, 4],
    [10, 15],
    [11, 14],
  ]);
  return finish(c);
});

food('berry_tart', 'bakery', 'Berry Tart', () => {
  const c = chef(32, 32, 31);
  const shell = cyl(c, 16, 18.5, 24, 13.5, 11.5, 6.5);
  c.layer(shell.body, P.crust, { form: 'cylY', bias: 0.04 });
  flutes(c, shell.body.clone().subtract(shell.top), 5, 28, 3, P.crust[1], P.crust[3]);
  c.layer(shell.top, P.crust, { form: 'flat', bevel: 1.5, bias: 0.1, shadow: false });
  const fill = c.ellipse(16, 18.5, 11, 4.8);
  c.layer(fill, P.custard, { form: 'flat', bevel: 1, bias: -0.08 });
  // a mound of berries, back to front
  const berries: [number, number, 'b' | 'r' | 's'][] = [
    [10, 16, 'r'],
    [15, 14.5, 'b'],
    [20.5, 15.5, 'r'],
    [7.5, 19, 'b'],
    [12.5, 18.5, 's'],
    [18, 18.5, 'b'],
    [23.5, 19, 'b'],
    [15.5, 21.5, 'r'],
    [10, 21.8, 'b'],
    [21, 21.8, 'r'],
  ];
  for (const [x, y, k] of berries) {
    if (k === 'b') {
      const b = c.circle(x, y, 2.1);
      c.layer(b, P.blueberry, { form: 'puff', rim: true, reflect: true });
      dots(c, [[Math.round(x - 1.5), Math.round(y - 1.5)]], P.blueberry[4]);
    } else if (k === 'r') {
      const b = c.circle(x, y, 2.5);
      c.layer(b, P.raspberry, { form: 'puff', rim: true });
      c.scatter(b, { count: 3, colors: [P.raspberry[4]], kind: 'dot', margin: 1, seed: x * 3 + y });
    } else {
      const b = c.ellipse(x, y, 3, 2.4);
      c.layer(b, P.strawberry, { form: 'puff', rim: true });
      c.paint(c.ellipse(x - 0.3, y - 0.2, 1.6, 1.1), P.strawberry[4]);
    }
  }
  mintLeaf(c, 16, 11.5, 3.6, 1.8, -30);
  glint(c, 5, 18, 1);
  return finish(c);
});

food('shortcake', 'bakery', 'Strawberry Shortcake', () => {
  const c = chef(32, 32, 33);
  const T: Pt = [3.5, 16];
  const BL: Pt = [15, 6.5];
  const BR: Pt = [28.5, 11];
  const H = 12;
  // front cut face with layers
  const face = c.poly([T, BR, [BR[0], BR[1] + H], [T[0], T[1] + H]]);
  c.layer(face, P.sponge, { form: 'flat', bevel: 1, bias: -0.04 });
  const band = (y0: number, y1: number) =>
    c
      .poly([
        [T[0], T[1] + y0],
        [BR[0], BR[1] + y0],
        [BR[0], BR[1] + y1],
        [T[0], T[1] + y1],
      ])
      .intersect(face);
  c.layer(band(0, 2.2), P.whip, { form: 'none', bias: 0.12 });
  c.layer(band(5.6, 8.4), P.whip, { form: 'none', bias: 0.12 });
  // strawberry slices in the middle cream layer
  for (let k = 0; k < 4; k++) {
    const x = T[0] + 3.5 + k * 6.2;
    const y = T[1] + ((BR[1] - T[1]) * (x - T[0])) / (BR[0] - T[0]) + 7;
    c.layer(c.ellipse(x, y, 2.2, 1.4).intersect(face), P.strawberry, { form: 'soft', bevel: 1, shadow: false });
  }
  // cream top
  const top = c.poly([T, BL, BR]);
  c.layer(top, P.whip, { form: 'soft', bevel: 1.5, bias: 0.16 });
  // a cream swirl on top holding a whole berry
  c.layer(c.ellipse(17, 9.2, 4, 2.4), P.whip, { form: 'puff', rim: true, bias: 0.14 });
  strawberry(c, 17, 5.6, 3.8);
  return finish(c);
});

food('swiss_roll', 'bakery', 'Matcha Roll', () => {
  const c = chef(32, 32, 35);
  // the roll lies back-right; its cut end faces us at the front-left
  const fx = 11.5;
  const fy = 18.5;
  const body = c.empty();
  for (let t = 0; t <= 1; t += 0.05) body.union(c.ellipse(fx + t * 10, fy - t * 5.5, 8.5, 9.5));
  c.layer(body, P.matchaSkin, { form: 'puff', depth: 0.7 });
  c.scatter(body, { count: 12, colors: [WHITE, P.matcha[4]], kind: 'dot', margin: 2, seed: 4 });
  const face = c.ellipse(fx, fy, 8.5, 9.5);
  c.layer(face, P.matchaSkin, { form: 'flat', bevel: 1, bias: -0.1, shadow: false });
  const sponge = face.erode();
  c.layer(sponge, P.matcha, { form: 'flat', bevel: 1, bias: 0.1, shadow: false });
  // thick cream spiral winding out from the middle
  const pts: Pt[] = [];
  for (let a = 0.4; a < Math.PI * 4.3; a += 0.12) {
    const r = 0.58 * a;
    pts.push([fx + Math.cos(a) * r * 0.92, fy + Math.sin(a) * r]);
  }
  const cream = c.path(pts, 0.75).intersect(sponge);
  c.paint(lip(cream, -1, -1).intersect(sponge), P.matcha[1]);
  c.layer(cream, P.whip, { form: 'none', bias: 0.12, shadow: false, clean: false });
  glint(c, 20, 9, 2);
  dots(c, [[23, 8]]);
  return finish(c);
});

food('bread_loaf', 'bakery', 'Bread Loaf', () => {
  const c = chef(32, 32, 37);
  // body sweeps back-right from the cut face
  const loafAt = (x: number, y: number) => c.roundRect(x - 8, y - 3, 16, 12, 2).union(c.ellipse(x, y - 3, 8, 6));
  const body = c.empty();
  for (let t = 0; t <= 1; t += 0.1) body.union(loafAt(12 + t * 11, 20 - t * 7));
  c.layer(body, P.crust, { form: 'puff', depth: 0.8 });
  // score marks on the crust
  for (const k of [0.35, 0.62, 0.88]) {
    const x = 12 + k * 11;
    const y = 20 - k * 7 - 8.5;
    c.line(x - 2, y + 1.5, x + 2, y - 1.5, P.crust[4], body);
    c.line(x - 2, y + 2.5, x + 2, y - 0.5, P.crust[1], body);
  }
  const face = loafAt(12, 20);
  c.layer(face, P.crust, { form: 'flat', bevel: 1, bias: -0.1, shadow: false });
  const crumb = face.erode();
  c.layer(crumb, P.crumb, { form: 'soft', bevel: 2, shadow: false });
  c.scatter(crumb, { count: 16, colors: [P.crumb[0]], kind: 'pore', margin: 1, seed: 8 });
  glint(c, 15, 7, 2);
  return finish(c);
});

food('apple_pie', 'bakery', 'Apple Pie Slice', () => {
  const c = chef(32, 32, 39);
  const T: Pt = [3, 22];
  const BL: Pt = [11, 5.5];
  const BR: Pt = [29, 11];
  const H = 7;
  const at = (x: number, dy: number): Pt => [x, T[1] + ((BR[1] - T[1]) * (x - T[0])) / (BR[0] - T[0]) + dy];
  const face = c.poly([T, BR, [BR[0], BR[1] + H], [T[0], T[1] + H]]);
  c.layer(face, P.pieFill, { form: 'flat', bevel: 1, bias: -0.08 });
  // stacked apple slices in syrup
  for (let x = 5; x < 28; x += 3.2) {
    const [ax, ay] = at(x, 3 + ((x * 7) % 3) * 0.4);
    c.layer(c.ellipse(ax, ay, 1.7, 1).intersect(face), P.pieFill, { form: 'none', bias: 0.3, shadow: false, clean: false });
  }
  const bottom = c
    .poly([
      [T[0], T[1] + H - 1.6],
      [BR[0], BR[1] + H - 1.6],
      [BR[0], BR[1] + H + 1],
      [T[0], T[1] + H + 1],
    ])
    .intersect(face);
  c.layer(bottom, P.crust, { form: 'flat', bevel: 1, bias: 0.05 });
  // golden top crust with steam vents and sugar
  const top = c.poly([T, BL, BR]);
  c.layer(top, P.crust, { form: 'soft', bevel: 1.5, bias: 0.14 });
  for (const [x, y] of [
    [9, 17],
    [14.5, 12.5],
    [21, 11.5],
  ] as Pt[]) {
    const vent = c.capsule(x - 1.5, y + 1, x + 1.5, y - 1, 0.5).intersect(top);
    c.paint(vent.shift(0, 1).subtract(vent).intersect(top), P.crust[4]);
    c.paint(vent, P.syrup[1]);
  }
  c.scatter(top, { count: 6, colors: [WHITE], kind: 'dot', margin: 2, seed: 3 });
  c.paint(lip(top, 0, -1).intersect(c.poly([T, BR, [BR[0], BR[1] + 1], [T[0], T[1] + 1]])), P.crust[4]);
  // puffy fluted crust along the back edge
  const rim = c.empty();
  for (let t = 0; t <= 1.001; t += 0.125) rim.union(c.circle(BL[0] + (BR[0] - BL[0]) * t, BL[1] + (BR[1] - BL[1]) * t - 0.5, 2.3));
  c.layer(rim, P.crust, { form: 'puff', rim: true, bias: 0.05 });
  // whipped cream dollop at the back
  const cream = c.ellipse(18, 11.5, 4.2, 2.6).union(c.ellipse(18, 9.2, 3, 2.2)).union(c.ellipse(18.4, 7.2, 1.6, 1.6));
  c.layer(cream, P.whip, { form: 'puff', rim: true, bias: 0.22 });
  c.line(15.5, 10.5, 20, 9, P.whip[1], cream);
  dots(c, [
    [16, 8],
    [15, 9],
  ]);
  return finish(c);
});

// =================================================================================================
// Breakfast

food('pancakes', 'breakfast', 'Pancake Stack', () => {
  const c = chef(32, 32, 21);
  plate(c, 16, 26.8, 14.5, 4.2);
  const stack: [number, number, number][] = [
    [16, 22.5, 11.8],
    [15.5, 18.8, 11.4],
    [16.4, 15.1, 11.6],
  ];
  for (const [x, y, rx] of stack) {
    const side = c.empty();
    for (let k = 0; k <= 2.6; k += 0.5) side.union(c.ellipse(x, y + k, rx, 3.4));
    c.layer(side, P.batter, { form: 'cylY', bias: 0.12 });
    // cooked underside edge
    c.paint(lip(side, 0, -1), P.cooked[1]);
    c.layer(c.ellipse(x, y, rx, 3.4), P.cooked, { form: 'flat', bevel: 1, shadow: false });
  }
  // syrup pooled on top and running down the sides
  const syrup = c
    .ellipse(16.4, 14.9, 9.2, 2.5)
    .union(c.capsule(9, 16, 9, 20.5, 1.1))
    .union(c.circle(9, 21, 1.5))
    .union(c.capsule(18.5, 16.5, 18.5, 23.5, 1.1))
    .union(c.circle(18.5, 24, 1.5))
    .union(c.capsule(24, 16, 24, 18, 1.1));
  c.layer(syrup, P.syrup, { form: 'soft', bevel: 1.5, reflect: true });
  dots(c, [
    [10, 14],
    [11, 14],
    [18, 22],
    [9, 19],
    [22, 15],
  ]);
  // butter pat
  c.layer(c.roundRect(12.5, 11.8, 7, 3, 0.8), P.butter, { form: 'flat', bevel: 1, bias: -0.3 });
  c.layer(c.roundRect(12.5, 10.2, 7, 2.6, 0.8), P.butter, { form: 'flat', bevel: 1 });
  dots(c, [
    [13, 11],
    [14, 11],
  ]);
  return finish(c);
});

food('toast', 'breakfast', 'Butter Toast', () => {
  const c = chef(32, 32, 45);
  const shape = (dy: number) =>
    c
      .roundRect(5, 11 + dy, 22, 16, 2)
      .union(c.circle(10, 10 + dy, 6))
      .union(c.circle(22, 10 + dy, 6))
      .union(c.rect(9, 5 + dy, 14, 8));
  const side = shape(2);
  c.layer(side, P.toast, { form: 'flat', bias: -0.35 });
  const slice = shape(0);
  c.layer(slice, P.toast, { form: 'soft', bevel: 2 });
  const inner = slice.erode().erode();
  c.layer(inner, P.toastIn, { form: 'puff', depth: 0.3, shadow: false });
  c.scatter(inner, { count: 16, colors: [P.toastIn[0]], kind: 'pore', margin: 1, seed: 3 });
  // melted butter puddle with a little pat on top
  const puddle = c.blob([
    [10, 15.5],
    [13, 12.5],
    [18, 12],
    [22.5, 14.5],
    [22, 18.5],
    [19, 20],
    [17.5, 22.5],
    [15.5, 20],
    [11, 19.5],
  ]);
  c.layer(puddle, P.butter, { form: 'soft', bevel: 1.5, bias: -0.15 });
  const pat = c.poly([
    [16.5, 12],
    [21, 15],
    [16.5, 18],
    [12, 15],
  ]);
  c.layer(c.poly([
    [12, 15],
    [16.5, 18],
    [21, 15],
    [21, 16.5],
    [16.5, 19.5],
    [12, 16.5],
  ]), P.butter, { form: 'flat', bevel: 1, bias: -0.3 });
  c.layer(pat, P.butter, { form: 'flat', bevel: 1, bias: 0.1 });
  dots(c, [
    [15, 13],
    [16, 13],
    [14, 14],
    [11, 17],
  ]);
  return finish(c);
});

food('poptart', 'breakfast', 'Frosted Pop-Tart', () => {
  const c = chef(32, 32, 47);
  c.layer(c.roundRect(5, 8, 22, 21, 2), P.crust, { form: 'flat', bias: -0.35 });
  const pastry = c.roundRect(5, 6, 22, 21, 2);
  c.layer(pastry, P.cookie, { form: 'soft', bevel: 1.5, bias: 0.12 });
  // crimped border: fork marks
  for (let x = 7; x <= 25; x += 2) {
    c.px(x, 7, P.cookie[1]);
    c.px(x, 26, P.cookie[1]);
  }
  for (let y = 9; y <= 24; y += 2) {
    c.px(6, y, P.cookie[1]);
    c.px(25, y, P.cookie[1]);
  }
  const icing = c.roundRect(8.5, 9.5, 15, 14, 1.5);
  c.layer(icing, P.pink, { form: 'soft', bevel: 1.5, rim: true });
  c.scatter(icing, { count: 24, colors: P.sprinkle, kind: 'sprinkle', margin: 1, seed: 5 });
  dots(c, [
    [10, 11],
    [11, 11],
    [10, 12],
  ]);
  return finish(c);
});

food('fried_egg', 'breakfast', 'Fried Egg', () => {
  const c = chef(32, 32, 137);
  const white = c.blob([
    [3.5, 17],
    [5, 10.5],
    [11, 7],
    [17, 8],
    [24, 7],
    [28.5, 12],
    [28, 19],
    [23.5, 24],
    [16, 25],
    [8, 24.5],
  ]);
  c.layer(white, P.eggWhite, { form: 'soft', bevel: 2 });
  // crispy golden lace along the edge
  c.paint(white.clone().subtract(white.erode()).intersect(c.rect(0, 16, 32, 16)), P.crust[3]);
  c.scatter(white.clone().subtract(white.erode().erode()), { count: 8, colors: [P.crust[3]], kind: 'dot', seed: 4 });
  const yolk = c.circle(14.5, 15, 5.2);
  c.layer(yolk, P.yolk, { form: 'puff', reflect: true, rim: true });
  glint(c, 11, 13, 2);
  dots(c, [[12, 11]]);
  return finish(c);
});

food('cereal', 'breakfast', 'Cereal Bowl', () => {
  const c = chef(32, 32, 141);
  c.layer(c.capsule(21, 14, 29, 5, 1.3), P.steel, { form: 'cylX', clean: false });
  const b = bowl(c, 15.5, 16, 14, 5.5, 13, P.bowlBlue, P.milk);
  const loops: [number, number, Ramp][] = [
    [7.5, 16, P.orange],
    [12, 14.5, P.pink],
    [17, 15.5, P.gummyY],
    [10.5, 18.8, P.gummyG],
    [16, 19, P.orange],
    [21.5, 18.5, P.pink],
    [23.5, 15.5, P.gummyG],
  ];
  for (const [x, y, ramp] of loops) {
    const ring = c.ring(x, y, 2.4, 1.8, 1.3).intersect(b.surf);
    c.layer(ring, ramp, { form: 'soft', bevel: 1, rim: true, clean: false });
  }
  c.layer(c.ellipse(21.5, 14.2, 2.5, 1.4), P.steel, { form: 'soft', bevel: 1, rim: true });
  glint(c, 4, 20, 2);
  return finish(c);
});

// =================================================================================================
// Snacks

food('cookie', 'snacks', 'Choco Chip Cookie', () => {
  const c = chef(32, 32, 12);
  const bite = c.circle(25.5, 5.5, 5.4).union(c.circle(29.5, 12.5, 4.8));
  const side = c.ellipse(16, 18.5, 13.5, 11).subtract(bite);
  const top = c.ellipse(16, 16.5, 13.5, 11).subtract(bite);
  c.layer(side, P.cookie, { form: 'flat', bias: -0.3 });
  c.layer(top, P.cookie, { form: 'soft', bevel: 2.5, grain: 0.05, seed: 2 });
  // bitten edge: crumbly paler inside
  c.paint(bite.dilate().intersect(top), P.cookie[3]);
  c.scatter(bite.dilate().dilate().intersect(top), { count: 4, colors: [P.cookie[1]], kind: 'dot', seed: 9 });
  // cracks
  for (const [a, b] of [
    [
      [7, 14],
      [10, 16],
    ],
    [
      [10, 16],
      [12, 15],
    ],
    [
      [16, 22],
      [19, 21],
    ],
    [
      [18, 11],
      [20, 13],
    ],
  ] as [Pt, Pt][]) {
    c.line(a[0], a[1], b[0], b[1], P.cookie[1], top);
    c.line(a[0], a[1] + 1, b[0], b[1] + 1, P.cookie[4], top);
  }
  c.scatter(top, { count: 10, colors: [P.chip[1], P.chip[2]], kind: 'chip', margin: 2, seed: 7 });
  // crumbs
  const crumbs = c.rect(28, 27, 2, 1.5).union(c.rect(29.5, 23.5, 1.5, 1.5));
  c.layer(crumbs, P.cookie, { form: 'none', bias: 0.12, clean: false });
  c.px(29, 28, P.cookie[1]);
  glint(c, 7, 11, 2, P.cookie[4]);
  return finish(c);
});

food('nachos', 'snacks', 'Tortilla Chips', () => {
  const c = chef(32, 32, 143);
  const chips: Pt[][] = [
    [
      [3, 19],
      [12, 4.5],
      [18, 19],
    ],
    [
      [11, 23],
      [18, 6],
      [28, 18],
    ],
    [
      [3.5, 27.5],
      [9, 13],
      [20, 25],
    ],
  ];
  chips.forEach((tri, i) => {
    const m = c.poly(tri);
    c.layer(m, P.corn, { form: 'soft', bevel: 1.5, rim: true, rimColor: '#8a4e0a', bias: i === 1 ? 0.06 : 0 });
    c.paint(lip(m, 1, 1).subtract(lip(m, -1, -1)).intersect(m), P.corn[4]);
    c.scatter(m, { count: 5, colors: [P.corn[1]], kind: 'dot', margin: 2, seed: i * 7 + 1 });
    c.scatter(m, { count: 3, colors: [WHITE], kind: 'dot', margin: 2, seed: i * 7 + 2 });
  });
  // a little cup of salsa
  const cup = bowl(c, 23.5, 25, 6.5, 2.4, 5.5, P.white, P.tomato);
  c.scatter(cup.surf, { count: 4, colors: [P.tomato[4], P.lettuce[3]], kind: 'dot', seed: 3 });
  glint(c, 11, 10, 2);
  return finish(c);
});

food('popcorn', 'snacks', 'Popcorn Bucket', () => {
  const c = chef(32, 36, 145);
  // popcorn heaped above the rim
  const puffs: [number, number, number][] = [
    [8, 11, 3],
    [13, 7.5, 3.2],
    [18.5, 7, 3],
    [23.5, 10.5, 3],
    [10.5, 13, 3],
    [16, 11.5, 3.4],
    [21.5, 13.5, 3],
    [6, 14.5, 2.4],
    [26, 14.5, 2.4],
    [15.5, 4, 2.2],
  ];
  for (const [x, y, r] of puffs) {
    const m = c.circle(x, y, r).union(c.circle(x + r * 0.6, y - r * 0.4, r * 0.6));
    c.layer(m, P.popcorn, { form: 'puff', rim: true });
    c.scatter(m, { count: 1, colors: [P.butter[2]], kind: 'dot', margin: 1, seed: x * 11 + y });
  }
  // striped bucket
  const bucket = c
    .poly([
      [4, 15.5],
      [28, 15.5],
      [24.5, 33],
      [7.5, 33],
    ])
    .union(c.ellipse(16, 33, 8.5, 1.6));
  c.layer(bucket, P.can, {
    form: 'cylY',
    bias: 0.05,
    pattern: {
      ramps: [P.can, P.white],
      at: (x, y) => {
        const t = (y - 15.5) / 17.5;
        const half = 12 - 3.5 * t;
        const u = (x + 0.5 - 16) / half;
        return Math.floor((u + 1) * 3.5) % 2;
      },
    },
  });
  const rim = c.roundRect(3, 14, 26, 3.5, 1.6);
  c.layer(rim, P.can, { form: 'soft', bevel: 1, bias: 0.1 });
  c.layer(c.roundRect(11, 21, 10, 7, 2), P.white, { form: 'soft', bevel: 1 });
  c.layer(c.circle(16, 24.5, 2.2), P.gummyY, { form: 'puff', clean: false });
  glint(c, 7, 8, 2);
  return finish(c);
});

food('chips_bag', 'snacks', 'Potato Chips', () => {
  const c = chef(32, 36, 147);
  const bag = c.tidy(c.roundRect(5, 4, 22, 29, 4).union(c.rect(6, 3, 20, 31)));
  // crimped seams
  const seamT = c.rect(5, 2.5, 22, 3);
  const seamB = c.rect(5, 31, 22, 3);
  const teeth = c.empty();
  for (let x = 5; x < 27; x += 2) {
    teeth.set(x, 2);
    teeth.set(x, 34);
  }
  const all = bag.clone().union(seamT).union(seamB).subtract(teeth);
  c.layer(all, P.bag, { form: 'puff', depth: 0.45 });
  c.layer(seamT.clone().subtract(teeth), P.bag, { form: 'flat', bevel: 1, bias: -0.15, shadow: false, clean: false });
  c.layer(seamB.clone().subtract(teeth), P.bag, { form: 'flat', bevel: 1, bias: -0.25, shadow: false, clean: false });
  for (let x = 6; x < 27; x += 2) {
    c.px(x, 4, P.bag[1]);
    c.px(x, 32, P.bag[1]);
  }
  // label and a big chip
  c.layer(c.roundRect(8, 8, 16, 5, 2), P.gummyY, { form: 'soft', bevel: 1 });
  c.line(10, 10, 21, 10, P.bag[1]);
  const chip = c.blob([
    [10, 20],
    [14, 15.5],
    [20, 16],
    [23, 21],
    [19, 26.5],
    [12.5, 25.5],
  ]);
  c.layer(chip, P.corn, { form: 'puff', depth: 0.6, rim: true });
  c.scatter(chip, { count: 4, colors: [P.corn[1]], kind: 'dot', margin: 1, seed: 3 });
  c.line(8, 14, 8, 28, P.bag[4], all);
  dots(c, [[9, 13]]);
  return finish(c, undefined, { nubs: false });
});

food('spring_rolls', 'snacks', 'Spring Rolls', () => {
  const c = chef(32, 32, 149);
  const roll = (x0: number, y0: number, x1: number, y1: number, seed: number) => {
    const m = c.capsule(x0, y0, x1, y1, 3.7);
    c.layer(m, P.springRoll, { form: 'puff', rim: true, depth: 0.85 });
    // a few crackly blisters and the folded wrapper at each end
    c.scatter(m, { count: 7, colors: [P.springRoll[4]], kind: 'crumb', margin: 1, seed: seed + 1 });
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    for (const s of [3, len - 3]) {
      const x = x0 + ux * s;
      const y = y0 + uy * s;
      c.line(x - uy * 3, y + ux * 3, x + uy * 3 + ux * 1.5, y - ux * 3 + uy * 1.5, P.springRoll[1], m);
    }
    // long highlight along the lit side
    c.line(x0 + ux * 4 + uy * 1.8, y0 + uy * 4 - ux * 1.8, x0 + ux * (len - 5) + uy * 1.8, y0 + uy * (len - 5) - ux * 1.8, P.springRoll[4], m);
    return m;
  };
  roll(5, 10.5, 25, 6.5, 3);
  roll(6, 24, 23, 17.5, 7);
  // cut end with cabbage and carrot filling
  const end = c.ellipse(24.5, 17, 3, 4).union(c.ellipse(25.5, 16.5, 2.4, 3.2));
  c.layer(end, P.springRoll, { form: 'flat', bevel: 1, bias: 0.25, rim: true });
  const fill = c.ellipse(25, 16.8, 1.8, 2.6);
  c.layer(fill, P.cucumber, { form: 'none', bias: 0.1, shadow: false, clean: false });
  c.px(24, 16, P.orange[3]).px(25, 18, P.orange[2]).px(26, 16, P.white[3]).px(25, 15, P.orange[3]);
  glint(c, 8, 20, 2);
  return finish(c);
});

food('edamame', 'snacks', 'Edamame', () => {
  const c = chef(32, 32, 151);
  const b = bowl(c, 16, 19, 14, 5, 10.5, P.white, P.white);
  c.paint(b.surf, P.white[1]);
  const pod = (x0: number, y0: number, x1: number, y1: number, seed: number) => {
    const m = c.capsule(x0, y0, x1, y1, 1.2);
    for (const t of [0.2, 0.5, 0.8]) m.union(c.circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 2.1));
    c.layer(m, P.edamame, { form: 'puff', rim: true });
    for (const t of [0.2, 0.5, 0.8]) dots(c, [[Math.round(x0 + (x1 - x0) * t - 1.2), Math.round(y0 + (y1 - y0) * t - 1.2)]], P.edamame[4]);
    c.scatter(m, { count: 1, colors: [WHITE], kind: 'dot', margin: 1, seed });
  };
  pod(5, 14, 14, 11, 1);
  pod(15, 10, 25, 12, 2);
  pod(8, 18, 17, 15.5, 3);
  pod(17, 16, 27, 17, 4);
  pod(11, 20, 20, 20.5, 5);
  // the bowl's front lip over the pile
  const rim = c.ellipse(16, 19, 14, 5).subtract(c.ellipse(16, 19.4, 12.4, 3.9)).intersect(c.rect(0, 19.5, 32, 10));
  c.layer(rim, P.white, { form: 'flat', bevel: 1, bias: 0.25, shadow: false });
  c.layer(c.ellipse(16, 19, 14, 10.5).intersect(c.rect(0, 25, 32, 5)), P.bowlBlue, { form: 'cylY', shadow: false });
  glint(c, 4, 23, 2);
  return finish(c);
});

// =================================================================================================
// Candy & sweets

food('flan', 'candy', 'Caramel Flan', () => {
  const c = chef(32, 32, 43);
  plate(c, 16, 25, 15, 4.8);
  // caramel pool around the foot
  c.layer(c.ellipse(16, 24.6, 12.5, 3.3), P.caramel, { form: 'soft', bevel: 1, bias: 0.15, shadow: false });
  const f = cyl(c, 16, 10, 22.8, 7, 10.2, 2.8);
  c.layer(f.body, P.custard, { form: 'cylY', bias: 0.1 });
  c.line(9, 13, 7.5, 21, P.custard[4], f.body);
  // glossy caramel cap with thin drips running down the sides
  const car = c
    .ellipse(16, 10, 7, 2.8)
    .union(c.ellipse(16, 11.6, 6.6, 1.8))
    .union(c.capsule(10.2, 12, 9.8, 15.5, 0.8))
    .union(c.circle(9.8, 16, 1.1))
    .union(c.capsule(14, 13, 14, 17.5, 0.9))
    .union(c.circle(14, 18.1, 1.15))
    .union(c.capsule(18.6, 13, 18.6, 14.8, 0.8))
    .union(c.capsule(21.6, 12.2, 21.9, 16, 0.8))
    .union(c.circle(21.9, 16.5, 1.05))
    .intersect(f.body.dilate());
  c.layer(car, P.caramel, { form: 'soft', bevel: 1.2, bias: 0.12, reflect: true });
  c.layer(c.ellipse(16, 9.7, 6, 1.9), P.caramel, { form: 'puff', depth: 0.5, bias: 0.2, shadow: false });
  glint(c, 11, 9, 2);
  dots(c, [
    [21, 9],
    [14, 16],
  ]);
  return finish(c);
});

food('candy_apple', 'candy', 'Candy Apple', () => {
  const c = chef(32, 36, 97);
  c.layer(c.roundRect(14.5, 1.5, 3, 12, 1.2), P.popStick, { form: 'soft', bevel: 1 });
  // hardened candy foot
  c.layer(c.ellipse(16, 31, 11, 3.2), P.candy, { form: 'soft', bevel: 1.5, bias: -0.1 });
  const body = c.circle(11, 22, 9).union(c.circle(21, 22, 9)).union(c.ellipse(16, 25, 11, 7.5));
  const apple = c.tidy(body.subtract(c.ellipse(16, 12.5, 3, 1.8)));
  c.layer(apple, P.candy, { form: 'puff', reflect: true });
  // candy glaze glare
  glint(c, 7, 19, 3);
  c.paint(c.oval(9.5, 18.5, 2.4, 1.1, -45).intersect(apple), P.candy[4]);
  dots(c, [
    [8, 20],
    [8, 19],
    [7, 21],
    [23, 26],
  ]);
  c.line(22, 28, 25, 25, P.candy[3], apple);
  return finish(c);
});

food('brownie', 'candy', 'Fudge Brownies', () => {
  const c = chef(32, 32, 99);
  const cube = (x: number, y: number, w: number, h: number, d: number, seed: number) => {
    const { front, side, top } = box(c, x, y, w, h, d, d);
    c.layer(front, P.brownie, { form: 'flat', bevel: 1, grain: 0.08, seed });
    c.layer(side, P.brownie, { form: 'flat', bevel: 1, bias: -0.25, grain: 0.08, seed: seed + 1 });
    c.scatter(front, { count: 4, colors: [P.brownie[4]], kind: 'crumb', margin: 1, seed: seed + 2 });
    c.layer(top, P.fudgeTop, { form: 'flat', bevel: 1, bias: 0.12 });
    // crackly shiny top
    c.scatter(top, { count: 5, colors: [P.fudgeTop[1]], kind: 'dash', dir: 0, margin: 1, seed: seed + 3 });
    c.scatter(top, { count: 3, colors: [P.fudgeTop[4]], kind: 'dot', margin: 1, seed: seed + 4 });
  };
  cube(12, 4.5, 14, 8, 4, 3);
  cube(4, 13, 15, 9, 5, 7);
  cube(17.5, 17.5, 10, 7, 4, 11);
  glint(c, 8, 16, 2, P.fudgeTop[4]);
  return finish(c);
});

food('sprinkle_brownie', 'candy', 'Sprinkle Brownie', () => {
  const c = chef(32, 32, 101);
  const x = 4;
  const y = 7;
  const w = 19;
  const h = 10;
  const d = 7;
  const { front, side, top } = box(c, x, y, w, h, d, d);
  c.layer(front, P.brownie, { form: 'flat', bevel: 1, grain: 0.08, seed: 2 });
  c.layer(side, P.brownie, { form: 'flat', bevel: 1, bias: -0.25, grain: 0.08, seed: 3 });
  c.scatter(front, { count: 6, colors: [P.brownie[4]], kind: 'crumb', margin: 1, seed: 4 });
  // thick pink frosting slab with drips down the front
  const frost = top
    .clone()
    .union(c.rect(x, y + d, w, 2.2))
    .union(c.poly([
      [x + w, y + d],
      [x + w + d, y],
      [x + w + d, y + 2.2],
      [x + w, y + d + 2.2],
    ]))
    .union(c.capsule(x + 4, y + d + 2, x + 4, y + d + 4, 1.1))
    .union(c.capsule(x + 12, y + d + 2, x + 12, y + d + 5, 1.1));
  c.layer(frost, P.pink, { form: 'soft', bevel: 1.5, bias: 0.05, rim: true });
  c.scatter(top, { count: 14, colors: P.sprinkle, kind: 'sprinkle', margin: 1, seed: 6 });
  dots(c, [
    [x + 3, y + d - 1],
    [x + 4, y + d - 2],
  ]);
  return finish(c);
});

food('dirt_pudding', 'candy', 'Dirt Pudding Cup', () => {
  const c = chef(32, 34, 103);
  const g = glass(c, 14, 11, 31, 10, 8, 2.8, 13, P.pudding);
  const dirt = c.ellipse(14, 13, 9, 2.4).union(c.rect(5, 13, 18, 3).intersect(g.inner));
  c.layer(dirt, P.chip, { form: 'flat', bevel: 1, grain: 0.3, seed: 4 });
  c.scatter(dirt, { count: 8, colors: [P.chip[4]], kind: 'crumb', margin: 0, seed: 5 });
  c.layer(g.inner.clone().intersect(c.rect(0, 21, 32, 2.2)), P.vanilla, { form: 'cylY', shadow: false });
  c.line(6, 16, 6, 28, WHITE, g.body).line(7, 15, 7, 17, P.glass[4], g.body);
  mintLeaf(c, 8, 12, 2.2, 1.1, -35);
  // a two-tone gummy worm crawling out and flopping over the rim
  const path: Pt[] = [
    [11, 13],
    [12, 8.5],
    [16, 5.5],
    [21, 7],
    [24, 10.5],
    [25.5, 15.5],
    [27.5, 19.5],
  ];
  const worm = c.curve(path, 1.6);
  const tail = c.curve(path.slice(0, 4), 1.65).intersect(worm);
  c.layer(worm.clone().subtract(tail), P.gummyG, { form: 'puff', rim: true, reflect: true });
  c.layer(tail, P.creamsicle, { form: 'puff', rim: true, reflect: true });
  c.scatter(worm, { count: 7, colors: [WHITE], kind: 'dot', margin: 1, seed: 8 });
  return finish(c);
});

food('gummy_bears', 'candy', 'Gummy Bears', () => {
  const c = chef(32, 32, 105);
  const bear = (x: number, y: number, ramp: Ramp) => {
    const m = c.tidy(
      c
        .ellipse(x, y - 2.6, 4.4, 3.4)
        .union(c.circle(x - 3.1, y - 5.6, 1.9))
        .union(c.circle(x + 3.1, y - 5.6, 1.9))
        .union(c.ellipse(x, y + 3.8, 4, 4.6))
        .union(c.ellipse(x - 4.1, y + 2, 1.9, 1.6))
        .union(c.ellipse(x + 4.1, y + 2, 1.9, 1.6))
        .union(c.ellipse(x - 2.6, y + 8.1, 2.1, 1.6))
        .union(c.ellipse(x + 2.6, y + 8.1, 2.1, 1.6)),
    );
    c.layer(m, ramp, { form: 'puff', depth: 0.75, rim: true, reflect: true, bias: 0.05 });
    // candy shine and a tiny face
    c.px(x - 2.5, y - 4.5, WHITE).px(x - 3.5, y - 3.5, ramp[4]).px(x - 2.5, y + 1.5, ramp[4]);
    c.px(x - 1.5, y - 2.5, ramp[0]).px(x + 1.5, y - 2.5, ramp[0]);
    return m;
  };
  bear(22.5, 10.5, P.gummyG);
  bear(9.5, 11.5, P.gummyY);
  bear(16, 18.5, P.gummyR);
  return finish(c);
});

food('candy_bar', 'candy', 'Choco Bar', () => {
  const c = chef(32, 32, 107);
  // chocolate bar poking out of a torn wrapper, lying diagonally
  const bar = c.poly([
    [4, 13],
    [15, 4.5],
    [22, 12],
    [11, 20.5],
  ]);
  c.layer(bar, P.choco, { form: 'flat', bevel: 1.5, bias: 0.1 });
  for (const t of [0.33, 0.66]) {
    c.line(4 + 11 * t, 13 - 8.5 * t, 11 + 11 * t, 20.5 - 8.5 * t, P.choco[1], bar);
    c.line(5 + 11 * t, 13 - 8.5 * t, 12 + 11 * t, 20.5 - 8.5 * t, P.choco[4], bar);
  }
  c.line(8, 15, 18, 7, P.choco[1], bar);
  c.line(8, 16, 18, 8, P.choco[4], bar);
  // foil and wrapper
  const foil = c.poly([
    [13, 17.5],
    [20, 9.5],
    [23.5, 13],
    [16.5, 21],
  ]);
  c.layer(foil, P.foil, { form: 'flat', bevel: 1, grain: 0.25, seed: 3 });
  const wrap = c.poly([
    [15, 19.5],
    [21.5, 11],
    [29, 18.5],
    [22.5, 27.5],
  ]);
  c.layer(wrap, P.wrapBlue, { form: 'soft', bevel: 2, rim: true });
  c.layer(c.poly([
    [19, 20],
    [22.5, 16],
    [25.5, 19],
    [22, 23],
  ]), P.red, { form: 'flat', bevel: 1, clean: false });
  c.line(18, 22, 23, 16, P.wrapBlue[4], wrap);
  // crimped end
  for (let k = 0; k < 3; k++) c.px(24 + k, 25 - k, P.wrapBlue[1]);
  glint(c, 8, 12, 2, P.choco[4]);
  return finish(c);
});

food('creme_brulee', 'candy', 'Crème Brûlée', () => {
  const c = chef(32, 32, 109);
  const r = cyl(c, 16, 15, 26, 13, 12, 5);
  c.layer(r.body, P.white, { form: 'cylY', bias: 0.1 });
  flutes(c, r.body.clone().subtract(r.top), 5, 28, 2.5, P.white[1], P.white[4]);
  c.layer(r.top, P.white, { form: 'flat', bevel: 1, bias: 0.25, shadow: false });
  // glassy torched sugar
  const crust = c.ellipse(16, 15.2, 11, 4);
  c.layer(crust, P.brulee, { form: 'flat', bevel: 1.5, bias: 0.1, shadow: false });
  c.layer(c.ellipse(19.5, 16.2, 4, 1.6).union(c.ellipse(10, 14.8, 2.5, 1.2)), P.brulee, { form: 'none', bias: -0.3, shadow: false, clean: false });
  c.line(8, 15, 12, 16, P.brulee[1], crust).line(12, 16, 15, 15, P.brulee[1], crust);
  c.paint(c.ellipse(12.5, 13.8, 3.5, 0.8), P.brulee[4]);
  const berry = c.circle(20.5, 13, 2.3);
  c.layer(berry, P.raspberry, { form: 'puff', rim: true });
  c.scatter(berry, { count: 3, colors: [P.raspberry[4]], kind: 'dot', seed: 4 });
  mintLeaf(c, 24, 12, 2.4, 1.2, -30);
  glint(c, 8, 13, 2);
  dots(c, [[5, 22]]);
  return finish(c);
});

food('lollipop', 'candy', 'Swirl Lollipop', () => {
  const c = chef(28, 38, 111);
  c.layer(c.roundRect(12.5, 22, 3, 14, 1.3), P.white, { form: 'cylY' });
  const disc = c.circle(14, 13, 11);
  // rainbow candy swirl under one round shading
  const ramps = [P.pink, P.gummyY, P.sky, P.gummyG];
  c.layer(disc, P.pink, {
    form: 'puff',
    depth: 0.55,
    clean: false,
    pattern: {
      ramps,
      at: (x, y) => {
        const dx = x + 0.5 - 14;
        const dy = y + 0.5 - 13;
        const ph = Math.atan2(dy, dx) / (Math.PI * 2) + Math.hypot(dx, dy) / 10;
        return ((Math.floor(ph * 4) % 4) + 4) % 4;
      },
    },
  });
  glint(c, 7, 10, 3);
  c.sparkle(10, 6);
  return finish(c);
});

// =================================================================================================
// Fresh

food('onigiri', 'fresh', 'Salmon Onigiri', () => {
  const c = chef(32, 32, 8);
  const rice = c.blob([
    [16, 3.5],
    [22, 10],
    [27.5, 20],
    [26.5, 27.5],
    [16, 29],
    [5.5, 27.5],
    [4.5, 20],
    [10, 10],
  ]);
  c.layer(rice, P.rice, { form: 'puff', depth: 0.8 });
  c.scatter(rice, { count: 16, colors: [P.rice[1]], kind: 'dash', dir: 3, margin: 2, seed: 2 });
  // salmon flakes peeking out of the top
  const flake = c.blob([
    [12, 12.5],
    [14.5, 10],
    [18, 9.8],
    [20.5, 12],
    [19, 15],
    [13.5, 15],
  ]);
  c.layer(flake, P.salmon, { form: 'puff', rim: true, depth: 0.7 });
  c.line(14, 13, 17, 11, P.salmon[4], flake).line(16, 14, 19, 12, P.salmon[1], flake);
  const nori = c.roundRect(10, 18.5, 12, 11, 1).intersect(rice);
  c.layer(nori, P.nori, { form: 'flat', bevel: 1, rim: true });
  c.scatter(nori, { count: 5, colors: [P.nori[4]], kind: 'dash', dir: 1, margin: 1, seed: 6 });
  glint(c, 9, 14, 2);
  dots(c, [[14, 11]], P.salmon[4]);
  return finish(c);
});

food('apple', 'fresh', 'Red Apple', () => {
  const c = chef(32, 32, 3);
  const body = c.circle(11, 18.5, 9).union(c.circle(21, 18.5, 9)).union(c.ellipse(16, 21.5, 11, 8));
  c.layer(c.tidy(body.subtract(c.ellipse(16, 9.5, 3, 2))), P.apple, { form: 'puff', reflect: true });
  // dimple around the stem
  c.paint(c.ellipse(16.5, 11.5, 2.5, 1.2), P.apple[1]);
  c.line(16, 11, 17, 5, P.stem[1]);
  c.line(17, 11, 18, 5, P.stem[3]);
  const leaf = c.oval(22.5, 5.5, 4.5, 2.2, -25);
  c.layer(leaf, P.leaf, { form: 'puff' });
  c.line(19, 7, 25, 4, P.leaf[1], leaf);
  glint(c, 8, 15, 3);
  dots(c, [[8, 17]]);
  return finish(c);
});

food('maki', 'fresh', 'Maki Rolls', () => {
  const c = chef(32, 32, 121);
  const roll = (x: number, y: number, fill: Ramp, core: Ramp | null) => {
    const r = cyl(c, x, y, y + 7, 7, 7, 3.6);
    c.layer(r.body, P.nori, { form: 'cylY', bias: 0.1 });
    c.layer(r.top, P.nori, { form: 'flat', bevel: 1, bias: 0.3, shadow: false });
    const rice = c.ellipse(x, y, 6, 2.9);
    c.layer(rice, P.rice, { form: 'soft', bevel: 1, shadow: false });
    c.scatter(rice, { count: 6, colors: [P.rice[1]], kind: 'dash', dir: 0, margin: 1, seed: x * 5 });
    c.layer(c.ellipse(x, y + 0.2, 2.6, 1.4), fill, { form: 'soft', bevel: 1, shadow: false, clean: false });
    if (core) c.layer(c.ellipse(x + 1, y + 0.3, 1, 0.8), core, { form: 'none', bias: 0.1, shadow: false, clean: false });
    c.line(x - 5, y + 3.5, x - 5, y + 9, P.nori[4], r.body);
  };
  roll(10.5, 12.5, P.salmon, P.cucumber);
  roll(21.5, 17.5, P.cucumber, P.tamago);
  return finish(c);
});

food('nigiri', 'fresh', 'Nigiri Pair', () => {
  const c = chef(32, 32, 123);
  const riceBall = (x: number, y: number) => {
    const m = c.tidy(c.roundRect(x - 7.5, y - 2.5, 15, 7, 3.5));
    c.layer(m, P.rice, { form: 'puff', depth: 0.7 });
    c.scatter(m, { count: 6, colors: [P.rice[1]], kind: 'dash', dir: 0, margin: 1, seed: x * 3 });
    return m;
  };
  // salmon nigiri at the back
  riceBall(11, 15);
  const salmon = c.tidy(c.roundRect(3, 7.5, 16, 7.5, 3.5).union(c.ellipse(11, 14, 8, 2)));
  c.layer(salmon, P.salmon, { form: 'puff', depth: 0.6, rim: true });
  for (let k = 0; k < 4; k++) c.line(6 + k * 3.5, 14, 9 + k * 3.5, 8, P.salmon[4], salmon);
  glint(c, 5, 10, 2);
  // tamago nigiri in front with a nori belt
  riceBall(21, 24);
  const egg = c.roundRect(13.5, 16, 15, 7.5, 1.5);
  c.layer(egg, P.tamago, { form: 'soft', bevel: 1.5, rim: true });
  c.line(15, 18, 27, 18, P.tamago[4], egg);
  const belt = c.rect(19, 15.5, 4.5, 13).intersect(egg.clone().union(c.roundRect(13.5, 21.5, 15, 7, 3.5)));
  c.layer(belt, P.nori, { form: 'flat', bevel: 1, rim: true });
  return finish(c);
});

food('cut_apple', 'fresh', 'Apple Slices', () => {
  const c = chef(32, 32, 125);
  const shape = (s: number, dy: number) =>
    c.tidy(
      c
        .circle(11, 14 + dy, 7.5 * s)
        .union(c.circle(19, 14 + dy, 7.5 * s))
        .union(c.ellipse(15, 17.5 + dy, 9.5 * s, 7.5 * s))
        .subtract(c.ellipse(15, 6 + dy, 2.6, 1.8)),
    );
  // a halved apple: red skin wrapping a flat cut face
  const skin = shape(1, 0);
  c.layer(skin, P.apple, { form: 'puff', reflect: true });
  const face = shape(0.84, 1.2);
  c.layer(face, P.appleFlesh, { form: 'soft', bevel: 1.5, bias: 0.08, shadow: false });
  // star-shaped core with seeds
  const core = c.oval(15, 16.5, 2.6, 4.2, 0).union(c.oval(15, 16.5, 4.2, 1.6, 0));
  c.layer(core, P.appleFlesh, { form: 'none', bias: -0.3, shadow: false });
  c.px(14, 14, P.stem[1]).px(14, 15, P.stem[3]);
  c.px(16, 17, P.stem[1]).px(16, 18, P.stem[3]);
  c.line(15, 7, 16, 2, P.stem[1]);
  c.layer(c.oval(19, 3.5, 3.2, 1.5, -20), P.leaf, { form: 'puff' });
  // a wedge lying in front: pale top face, red skin along its curved back
  const wedge = c.poly([
    [16, 27.5],
    [24, 22],
    [29.5, 25.5],
    [22, 29.5],
  ]);
  c.layer(wedge, P.appleFlesh, { form: 'soft', bevel: 1, bias: 0.06 });
  c.layer(c.capsule(22.5, 29.2, 29.2, 25.4, 0.9), P.apple, { form: 'soft', bevel: 1, shadow: false });
  c.px(22, 26, P.stem[1]);
  glint(c, 5, 12, 2);
  return finish(c);
});

food('banana', 'fresh', 'Bananas', () => {
  const c = chef(32, 32, 127);
  const banana = (pts: Pt[], bias: number) => {
    const m = c.curve(pts, 3.2);
    c.layer(m, P.banana, { form: 'puff', depth: 0.8, rim: true, bias });
    const tip = pts[pts.length - 1];
    c.layer(c.circle(tip[0], tip[1], 1.2).intersect(m), P.stem, { form: 'none', shadow: false, clean: false });
    return m;
  };
  banana([
    [6, 8],
    [8, 17],
    [15, 23.5],
    [25, 25],
    [28.5, 23.5],
  ], -0.06);
  banana([
    [7, 7],
    [11, 14.5],
    [18.5, 18.5],
    [27, 18],
  ], 0);
  // shared stem
  c.layer(c.roundRect(4.5, 3.5, 4, 5.5, 1.2), P.stem, { form: 'soft', bevel: 1 });
  c.line(10, 13, 16, 17, P.banana[4]);
  c.line(9, 19, 14, 22.5, P.banana[4]);
  dots(c, [
    [20, 21],
    [22, 20],
  ], P.banana[1]);
  return finish(c);
});

food('strawberry', 'fresh', 'Strawberry', () => {
  const c = chef(32, 32, 129);
  const body = c.tidy(
    c.ellipse(16, 13, 11.5, 8).union(
      c.poly([
        [4.8, 14],
        [27.2, 14],
        [18.5, 29],
        [13.5, 29],
      ]),
    ),
  );
  c.layer(body, P.strawberry, { form: 'puff', reflect: true });
  // seeds sit in little dimples
  for (let y = 10; y < 28; y += 3)
    for (let x = 5 + ((y / 3) % 2) * 1.5; x < 28; x += 3.5) {
      const xx = Math.round(x);
      if (!body.get(xx, y) || !body.get(xx + 1, y + 1) || !body.get(xx - 1, y)) continue;
      c.px(xx, y, '#ffe9a0');
      c.px(xx, y + 1, P.strawberry[1]);
    }
  const cap = c.poly([
    [6, 7],
    [11, 8],
    [9, 4],
    [14, 6.5],
    [16, 2.5],
    [18, 6.5],
    [23, 4],
    [21, 8],
    [26, 7],
    [21, 10.5],
    [16, 9.5],
    [11, 10.5],
  ]);
  c.layer(cap, P.leaf, { form: 'soft', bevel: 1.2, rim: true });
  c.layer(c.roundRect(15, 0.5, 2.2, 4, 1), P.leaf, { form: 'soft', bevel: 1 });
  glint(c, 7, 15, 3);
  dots(c, [[8, 17]]);
  return finish(c, undefined, { nubs: false });
});

food('watermelon', 'fresh', 'Watermelon Slice', () => {
  const c = chef(32, 32, 131);
  // a wedge standing on its rind, with a sliver of thickness on the right
  const cx = 16;
  const cy = 6;
  const wedge = c.wedge(cx, cy, 14, 23, 38, 142);
  const back = c.wedge(cx + 1.5, cy - 0.5, 14, 23, 38, 142).subtract(wedge);
  c.layer(back, P.melon, { form: 'flat', bias: -0.3 });
  c.layer(wedge, P.rind, { form: 'soft', bevel: 1 });
  const white = c.wedge(cx, cy, 12.6, 21.4, 38, 142);
  c.layer(white, P.appleFlesh, { form: 'none', bias: 0.2, shadow: false });
  const flesh = c.wedge(cx, cy, 11.6, 20.2, 38, 142);
  c.layer(flesh, P.melon, { form: 'soft', bevel: 1.5, bias: 0.05, shadow: false });
  for (const [x, y] of [
    [16, 13],
    [12.5, 17],
    [19.5, 17],
    [9.5, 21],
    [16, 20],
    [22.5, 21],
  ] as Pt[]) {
    c.px(x, y, P.chip[0]);
    c.px(x, y + 1, P.chip[2]);
  }
  glint(c, 10, 16, 1, P.melon[4]);
  return finish(c);
});

food('club_sandwich', 'fresh', 'Club Sandwich', () => {
  const c = chef(32, 34, 133);
  const T: Pt = [3, 16];
  const BL: Pt = [11, 7];
  const BR: Pt = [29, 11];
  const H = 17;
  const face = c.poly([T, BR, [BR[0], BR[1] + H], [T[0], T[1] + H]]);
  const band = (y0: number, y1: number) =>
    c
      .poly([
        [T[0], T[1] + y0],
        [BR[0], BR[1] + y0],
        [BR[0], BR[1] + y1],
        [T[0], T[1] + y1],
      ])
      .intersect(face);
  const layers: [number, number, Ramp, number][] = [
    [0, 3, P.bread, 0.1],
    [3, 5, P.lettuce, 0],
    [5, 7, P.tomato, 0],
    [7, 9.5, P.bread, 0.05],
    [9.5, 11.5, P.ham, 0],
    [11.5, 13.5, P.cheese, 0.05],
    [13.5, 17, P.bread, 0],
  ];
  for (const [y0, y1, ramp, bias] of layers) c.layer(band(y0, y1), ramp, { form: 'flat', bevel: 1, bias, shadow: false });
  // lettuce frills and crust edges
  for (let x = T[0]; x < BR[0]; x += 3) {
    const y = T[1] + ((BR[1] - T[1]) * (x - T[0])) / (BR[0] - T[0]);
    c.px(x + 1, y + 5, P.lettuce[3]);
  }
  c.paint(lip(face, 1, 0), P.toast[2]);
  const top = c.poly([T, BL, BR]);
  c.layer(top, P.bread, { form: 'soft', bevel: 1.5, bias: 0.08 });
  c.paint(top.clone().subtract(top.erode()).intersect(c.poly([T, BL, BR, [BR[0], BR[1] - 3], [BL[0], BL[1] - 3]])), P.toast[2]);
  // toothpick with a frilly top
  c.layer(c.roundRect(15, 3, 1.6, 12, 0.7), P.popStick, { form: 'flat', bevel: 1, clean: false });
  const frill = c.ellipse(15.8, 3.5, 2.8, 2);
  c.layer(frill, P.red, { form: 'puff', clean: false });
  c.px(15, 2, P.red[4]);
  return finish(c);
});

food('ham', 'fresh', 'Sliced Ham', () => {
  const c = chef(32, 32, 135);
  const slice = (cx: number, cy: number, rx: number, ry: number, seed: number) => {
    const rand = prng(seed);
    const pts: Pt[] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const j = 1 + (rand() - 0.5) * 0.12;
      pts.push([cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j]);
    }
    const top = c.blob(pts);
    c.layer(top.shift(0, 1).subtract(top), P.ham, { form: 'none', bias: -0.45 });
    c.layer(top, P.fat, { form: 'soft', bevel: 1 });
    const meat = top.erode().erode();
    c.layer(meat, P.ham, { form: 'puff', depth: 0.25, shadow: false });
    // marbling
    for (let k = 0; k < 4; k++) {
      const x = cx - rx * 0.55 + rand() * rx * 1.1;
      const y = cy - ry * 0.4 + rand() * ry * 0.8;
      c.line(x - 1.5, y + 0.5, x + 1.5, y - 0.5, P.ham[4], meat);
    }
    c.scatter(meat, { count: 3, colors: [P.ham[1]], kind: 'dash', dir: 0, margin: 1, seed: seed + 1 });
    return top;
  };
  slice(17.5, 22, 12.5, 6.5, 3);
  slice(14.5, 14.5, 11.5, 6, 7);
  glint(c, 7, 12, 2);
  return finish(c);
});

// =================================================================================================
// Meals

food('drumstick', 'meals', 'Fried Drumstick', () => {
  const c = chef(32, 32, 14);
  // bone first, the crispy meat overlaps its root
  const bone = c.capsule(18.5, 18.5, 25, 25, 1.9).union(c.circle(27.3, 24.5, 2.3)).union(c.circle(24.5, 27.3, 2.3));
  c.layer(bone, P.bone, { form: 'puff' });
  // teardrop of meat: fat round end tapering into the bone
  const meat = c.empty();
  for (let t = 0; t <= 1.001; t += 0.05) {
    const x = 11.5 + (20 - 11.5) * t;
    const y = 11 + (20 - 11) * t;
    meat.union(c.circle(x, y, 9.2 - 6.2 * t ** 1.4));
  }
  const m = bumpy(c, meat, 3, 5, 0.9, 1.6);
  c.layer(m, P.fried, { form: 'puff', grain: 0.05, seed: 5 });
  c.scatter(m, { count: 18, colors: [P.fried[4]], kind: 'crumb', margin: 1, seed: 6 });
  c.scatter(m, { count: 10, colors: [P.fried[0]], kind: 'pore', margin: 2, seed: 16 });
  glint(c, 6, 9, 2);
  dots(c, [
    [9, 5],
    [4, 13],
  ]);
  return finish(c);
});

food('burger', 'meals', 'Cheeseburger', () => {
  const c = chef(32, 32, 4);
  c.layer(c.roundRect(5, 23, 22, 5.5, 2.6), P.bun, { form: 'soft', bevel: 2 });
  const patty = c.roundRect(3.5, 18.5, 25, 5.5, 2.6);
  c.layer(patty, P.beef, { form: 'soft', bevel: 2, grain: 0.2, rim: true, seed: 3 });
  c.scatter(patty, { count: 7, colors: [P.beef[4]], kind: 'dot', margin: 1, seed: 11 });
  const cheese = c.poly([
    [3.5, 17],
    [28.5, 17],
    [28.5, 19.5],
    [25.5, 19.5],
    [23.5, 23],
    [21.5, 19.5],
    [12, 19.5],
    [9.5, 22.5],
    [7.5, 19.5],
    [3.5, 19.5],
  ]);
  c.layer(cheese, P.cheese, { form: 'flat', bevel: 1, rim: true });
  c.layer(c.roundRect(4.5, 14.5, 23, 3.2, 1.5), P.tomato, { form: 'soft', bevel: 1, rim: true });
  const lettuce = c.poly([
    [2.5, 15.5],
    [5, 13.2],
    [7.5, 15.4],
    [10.5, 13.2],
    [13.5, 15.4],
    [16.5, 13.2],
    [19.5, 15.4],
    [22.5, 13.2],
    [25.5, 15.4],
    [29.5, 13.6],
    [29.5, 16.2],
    [26, 17.3],
    [23, 15.8],
    [20, 17.3],
    [16, 15.8],
    [12, 17.3],
    [9, 15.8],
    [6, 17.3],
    [2.5, 16.5],
  ]);
  c.layer(lettuce, P.lettuce, { form: 'soft', bevel: 1, rim: true });
  const top = c.ellipse(16, 14, 12.5, 10).intersect(c.rect(0, 0, 32, 15.2));
  c.layer(top, P.bun, { form: 'puff', rim: true });
  c.scatter(top, { count: 10, colors: ['#fff6dc'], kind: 'sesame', margin: 2, seed: 9 });
  glint(c, 8, 9, 2);
  dots(c, [[11, 6]]);
  return finish(c);
});

food('pizza', 'meals', 'Pepperoni Pizza', () => {
  const c = chef(32, 32, 2);
  // slice lies flat, crust along the top-left, tip pointing down-right
  const A: Pt = [2, 15];
  const B: Pt = [17, 2];
  const T: Pt = [29, 29];
  const side = c.poly([A, [A[0] + 0.5, A[1] + 2.5], [T[0] - 0.5, T[1] + 1.5], T]);
  c.layer(side, P.crust, { form: 'flat', bevel: 1, bias: -0.25 });
  const slice = c.poly([A, B, T]);
  c.layer(slice, P.pizzaCheese, { form: 'soft', bevel: 1.5 });
  // melted drips over the front edge
  c.layer(c.capsule(10.5, 20.5, 10.5, 23.5, 1.1).union(c.capsule(20, 26.8, 20, 29, 1)), P.pizzaCheese, { form: 'soft', bevel: 1, shadow: false });
  c.scatter(slice, { count: 6, colors: [P.pizzaCheese[4]], kind: 'crumb', margin: 2, seed: 4 });
  for (const [x, y, r] of [
    [9.5, 11.5, 2.7],
    [16.5, 9, 2.5],
    [15.5, 17, 2.8],
    [22, 22, 2.2],
    [9, 18, 1.8],
  ] as [number, number, number][]) {
    const pep = c.circle(x, y, r).intersect(slice);
    c.layer(pep, P.pepperoni, { form: 'puff', depth: 0.6, rim: true, rimColor: '#5a1014' });
    dots(c, [[Math.round(x - r * 0.45 - 0.5), Math.round(y - r * 0.45 - 0.5)]], P.pepperoni[4]);
    if (r > 2.4) c.px(Math.round(x + 0.5), Math.round(y + 0.3), P.pepperoni[3]);
  }
  c.scatter(slice, { count: 5, colors: ['#3d8f45'], kind: 'dot', margin: 2, seed: 5 });
  const crust = c.capsule(A[0] + 0.5, A[1] - 0.3, B[0] - 0.3, B[1] + 0.5, 2.15);
  c.layer(crust, P.crust, { form: 'puff', rim: true });
  c.scatter(crust, { count: 4, colors: [P.crust[1]], kind: 'dot', margin: 1, seed: 15 });
  glint(c, 5, 12, 2);
  return finish(c);
});

food('hotdog', 'meals', 'Hot Dog', () => {
  const c = chef(32, 32, 51);
  c.layer(c.capsule(6.5, 15, 25.5, 15, 4), P.bun, { form: 'puff', depth: 0.8 });
  const dog = c.capsule(3.5, 18, 28.5, 18, 3);
  c.layer(dog, P.sausage, { form: 'puff', reflect: true, rim: true });
  // mustard zigzag riding along the top of the sausage
  const zig: Pt[] = [];
  for (let x = 6; x <= 26; x += 2.5) zig.push([x, (x - 6) % 5 < 2.5 ? 15.8 : 18.2]);
  const mus = c.path(zig, 0.75).intersect(dog);
  c.paint(mus.shift(0, 1).subtract(mus).intersect(dog), P.sausage[1]);
  c.layer(mus, P.mustard, { form: 'none', bias: 0.12, shadow: false, clean: false });
  const front = c.capsule(6, 22, 26, 22, 4);
  c.layer(front, P.bun, { form: 'puff', depth: 0.8, rim: true });
  c.paint(lip(front, 0, 1).intersect(c.rect(0, 0, 32, 20.5)), P.bun[4]);
  glint(c, 5, 17, 1);
  dots(c, [
    [9, 13],
    [10, 13],
    [8, 20],
  ]);
  return finish(c);
});

food('steak', 'meals', 'T-Bone Steak', () => {
  const c = chef(32, 32, 53);
  const outline: Pt[] = [
    [3, 15],
    [5, 9.5],
    [11, 7],
    [18, 7.5],
    [25, 6.5],
    [29, 10.5],
    [28.5, 17.5],
    [24, 21.5],
    [15, 22.5],
    [7, 21],
  ];
  const side = c.blob(outline.map(([x, y]) => [x, y + 3] as Pt));
  c.layer(side, P.steak, { form: 'flat', bias: -0.38 });
  const top = c.blob(outline);
  c.layer(top, P.steak, { form: 'soft', bevel: 2, grain: 0.04, seed: 3 });
  // fat cap along the back-right edge, running down the side
  const fat = lip(top, -2, 2).intersect(c.rect(14, 0, 18, 20));
  c.layer(fat, P.fat, { form: 'soft', bevel: 1, shadow: false });
  c.layer(side.clone().subtract(top).intersect(c.rect(25, 0, 7, 32)), P.fat, { form: 'flat', bevel: 1, bias: -0.3, shadow: false });
  // grill marks
  const grill = c.empty();
  for (const x of [11, 17, 23, 29]) grill.union(c.capsule(x, 6, x - 9, 24, 0.55));
  grill.intersect(top.erode()).subtract(fat.dilate());
  c.paint(grill.shift(1, 0).subtract(grill).intersect(top).subtract(fat), P.steak[3]);
  c.paint(grill, P.steak[0]);
  // the T-bone
  const bone = c.capsule(12, 10.5, 12, 21, 1.1).union(c.capsule(6.5, 10, 17.5, 9.5, 1.2));
  c.layer(bone.intersect(top), P.bone, { form: 'soft', bevel: 1, rim: true });
  dots(c, [
    [20, 11],
    [21, 11],
    [7, 16],
  ]);
  return finish(c);
});

food('ramen', 'meals', 'Ramen Bowl', () => {
  const c = chef(32, 32, 55);
  const cy = 15.5;
  const bowl = c.ellipse(16, cy, 14.5, 13.5).intersect(c.rect(0, cy, 32, 16)).union(c.ellipse(16, cy, 14.5, 5));
  c.layer(bowl, P.bowlRed, { form: 'cylY', bias: 0.06 });
  // cream band with a wave pattern
  const band = c.ellipse(16, cy, 14.5, 13.5).intersect(c.rect(0, cy + 5, 32, 3));
  c.layer(band, P.bechamel, { form: 'cylY', shadow: false });
  for (let x = 3; x < 30; x += 3) c.line(x, cy + 6.5, x + 1, cy + 5.5, P.bowlRed[2], band);
  c.layer(c.ellipse(16, cy, 14.5, 5), P.bowlRed, { form: 'flat', bevel: 1, bias: 0.25, shadow: false });
  const soup = c.ellipse(16, cy + 0.4, 12.6, 3.8);
  c.layer(soup, P.broth, { form: 'flat', bevel: 1, bias: 0.1, shadow: false });
  // noodles in the front of the bowl
  for (const dy of [2, 3.4]) {
    const n: Pt[] = [];
    for (let x = 6; x <= 26; x += 2) n.push([x, cy + dy + ((x / 2) % 2 ? 0.5 : -0.5)]);
    c.paint(c.path(n, 0.45).intersect(soup), P.noodle[3]);
  }
  // nori sheet standing at the back
  c.layer(
    c.poly([
      [19, cy],
      [20, cy - 8.5],
      [25.5, cy - 7.5],
      [25, cy + 0.5],
    ]),
    P.nori,
    { form: 'flat', bevel: 1, rim: true },
  );
  // chashu, half egg and naruto
  const pork = c.ellipse(15.5, cy - 0.6, 4, 2.4);
  c.layer(pork, P.ham, { form: 'soft', bevel: 1, rim: true });
  c.paint(c.ring(15.5, cy - 0.6, 4, 2.4, 1).intersect(pork), P.steak[3]);
  const egg = c.ellipse(9, cy + 0.6, 3.6, 2.4);
  c.layer(egg, P.eggWhite, { form: 'soft', bevel: 1, rim: true });
  c.layer(c.ellipse(9.2, cy + 0.7, 2, 1.3), P.yolk, { form: 'soft', bevel: 1, shadow: false, clean: false });
  const nar = c.ellipse(21.5, cy + 1.6, 2.8, 1.9);
  c.layer(nar, P.eggWhite, { form: 'soft', bevel: 1, rim: true });
  c.px(21, cy + 1, P.pink[2]).px(22, cy + 1, P.pink[2]).px(22, cy + 2, P.pink[3]).px(20, cy + 2, P.pink[1]);
  // spring onion
  for (const [x, y] of [
    [12, cy + 2],
    [18, cy + 2.5],
    [25, cy + 1],
    [6, cy - 1],
    [13, cy - 2],
  ] as Pt[])
    c.px(x, y, P.lettuce[3]);
  // chopsticks resting across the rim
  c.layer(c.capsule(28.5, 2, 21, 13.5, 0.7), P.wood, { form: 'flat', bevel: 1, clean: false });
  c.layer(c.capsule(30.5, 3.5, 23.5, 14, 0.7), P.wood, { form: 'flat', bevel: 1, clean: false });
  glint(c, 3, cy + 5, 2);
  return finish(c, () => {
    steam(c, [
      [7, cy - 5],
      [5.5, cy - 7.5],
      [7.5, cy - 10],
      [6, cy - 13],
    ]);
    steam(c, [
      [12, cy - 5],
      [11, cy - 7.5],
      [13, cy - 10],
      [12, cy - 13],
    ]);
  });
});

food('taco', 'meals', 'Crunchy Taco', () => {
  const c = chef(32, 32, 57);
  // built in the taco's own frame (u along the fold, v down) and tilted a little: a half-moon
  // shell with a straight edge and the filling bursting out above it in an arc
  const deg = 12;
  const cx = 16;
  const cy = 17;
  const t = (deg * Math.PI) / 180;
  const toLocal = (x: number, y: number): Pt => {
    const dx = x - cx;
    const dy = y - cy;
    return [dx * Math.cos(t) + dy * Math.sin(t), -dx * Math.sin(t) + dy * Math.cos(t)];
  };
  const toScreen = (u: number, v: number): Pt => [cx + u * Math.cos(t) - v * Math.sin(t), cy + u * Math.sin(t) + v * Math.cos(t)];
  const region = (test: (u: number, v: number) => boolean) => c.empty().fill((x, y) => test(...toLocal(x, y)));
  const crest = (u: number) => -7.5 * Math.sqrt(Math.max(0, 1 - (u / 12.5) ** 2));
  // filling: a strip of meat, frilly lettuce on top, tomato and cheese scattered over it
  c.layer(region((u, v) => Math.abs(u) < 11.5 && v <= 1 && v >= crest(u) + 1.2), P.mince, { form: 'puff', grain: 0.1, seed: 2 });
  const lettuce = c.empty();
  for (let u = -11; u <= 11.1; u += 2.2) {
    const [x, y] = toScreen(u, crest(u) + 1.5 + ((Math.abs(u) * 5) % 2) * 0.5);
    lettuce.union(c.circle(x, y, 2.6));
  }
  c.layer(lettuce, P.lettuce, { form: 'puff', rim: true, bias: 0.05 });
  for (const u of [-8, -3.5, 1, 5.5, 9]) {
    const [x, y] = toScreen(u, crest(u) + 1);
    c.layer(c.rect(x - 1, y - 1, 2.2, 2), P.tomato, { form: 'soft', bevel: 1, rim: true, clean: false });
  }
  for (const u of [-6, -1.2, 3.4, 7.4]) {
    const [x, y] = toScreen(u, crest(u) + 0.4);
    c.layer(c.capsule(x - 1.4, y + 0.4, x + 1.4, y - 0.4, 0.6), P.cheese, { form: 'flat', bevel: 1, clean: false });
  }
  // the shell
  const shell = region((u, v) => v >= 0 && (u / 13.5) ** 2 + (v / 10.5) ** 2 <= 1);
  c.layer(shell, P.corn, { form: 'puff', depth: 0.45, rim: true });
  c.paint(lip(shell, 0, 1).intersect(shell.clone().subtract(shell.shift(0, -2))), P.corn[4]);
  c.scatter(shell, { count: 14, colors: [P.corn[1]], kind: 'dot', margin: 1, seed: 5 });
  const [gx, gy] = toScreen(-9, 3);
  glint(c, Math.round(gx), Math.round(gy), 2);
  return finish(c);
});

food('spaghetti', 'meals', 'Spaghetti & Meatballs', () => {
  const c = chef(32, 32, 59);
  plate(c, 16, 22.5, 15, 6.5);
  const mound = c.blob([
    [5, 21],
    [8, 15.5],
    [16, 13],
    [24, 15.5],
    [27, 21],
    [22, 25],
    [10, 25],
  ]);
  c.layer(mound, P.pasta, { form: 'puff', depth: 0.7 });
  // swirling strands
  const rand = prng(3);
  for (let k = 0; k < 12; k++) {
    const x = 7 + rand() * 18;
    const y = 16.5 + rand() * 7;
    c.layer(
      c
        .curve(
          [
            [x - 3, y + 1],
            [x - 1, y - 1],
            [x + 1.5, y + 0.5],
            [x + 3.5, y - 0.8],
          ],
          0.5,
        )
        .intersect(mound),
      P.pasta,
      { form: 'none', bias: k % 2 ? 0.34 : -0.24, shadow: false, clean: false },
    );
  }
  // a ladle of sauce with two meatballs
  const sauce = c.blob([
    [9.5, 17.5],
    [12.5, 14.5],
    [18, 14],
    [22, 16.5],
    [21, 20],
    [16, 21.5],
    [11, 20.5],
  ]);
  c.layer(sauce, P.tomato, { form: 'puff', depth: 0.45, rim: true, bias: 0.05 });
  c.scatter(sauce, { count: 3, colors: [P.tomato[4]], kind: 'dot', margin: 1, seed: 11 });
  for (const [x, y, r] of [
    [13, 16.5, 2.7],
    [18.5, 17.5, 2.8],
  ] as [number, number, number][]) {
    const m = c.circle(x, y, r);
    c.layer(m, P.meatball, { form: 'puff', rim: true, grain: 0.06, seed: x, bias: 0.14 });
    dots(c, [[Math.round(x - r * 0.5), Math.round(y - r * 0.5)]], P.meatball[4]);
  }
  mintLeaf(c, 16, 14, 2.4, 1.3, -20);
  c.scatter(sauce.clone().union(mound), { count: 4, colors: ['#fff6dc'], kind: 'dot', margin: 1, seed: 7 });
  // fork twirled into the pasta
  const fork = c.capsule(21, 16, 28.5, 3.5, 0.75);
  c.layer(fork, P.steel, { form: 'flat', bevel: 1, clean: false });
  c.layer(c.roundRect(19, 14.5, 3.5, 3, 0.8), P.steel, { form: 'flat', bevel: 1, clean: false });
  c.px(20, 17, P.steel[1]).px(21, 17, P.steel[1]);
  return finish(c);
});

food('lasagna', 'meals', 'Lasagna', () => {
  const c = chef(32, 32, 61);
  // a block: front face with layers, right side, bubbling cheese top
  const top = c.poly([
    [4, 12],
    [20, 8],
    [28.5, 12],
    [12.5, 16.5],
  ]);
  const front = c.poly([
    [4, 12],
    [12.5, 16.5],
    [12.5, 29],
    [4, 24.5],
  ]);
  const side = c.poly([
    [12.5, 16.5],
    [28.5, 12],
    [28.5, 24.5],
    [12.5, 29],
  ]);
  c.layer(side, P.pasta, { form: 'flat', bevel: 1, bias: 0.05 });
  c.layer(front, P.pasta, { form: 'flat', bevel: 1, bias: -0.2 });
  // horizontal layers on both cut faces
  const layers: [number, number, Ramp][] = [
    [1.5, 3.5, P.marinara],
    [4.5, 5.8, P.bechamel],
    [6.8, 8.8, P.marinara],
    [9.8, 11, P.bechamel],
  ];
  for (const [y0, y1, ramp] of layers) {
    const bandS = c
      .poly([
        [12.5, 16.5 + y0],
        [28.5, 12 + y0],
        [28.5, 12 + y1],
        [12.5, 16.5 + y1],
      ])
      .intersect(side);
    const bandF = c
      .poly([
        [4, 12 + y0],
        [12.5, 16.5 + y0],
        [12.5, 16.5 + y1],
        [4, 12 + y1],
      ])
      .intersect(front);
    c.layer(bandS, ramp, { form: 'none', bias: ramp === P.marinara ? 0 : 0.1, shadow: false, clean: false });
    c.layer(bandF, ramp, { form: 'none', bias: ramp === P.marinara ? -0.25 : -0.1, shadow: false, clean: false });
  }
  c.scatter(side, { count: 5, colors: [P.meatball[2]], kind: 'dot', margin: 1, seed: 4 });
  // golden cheese on top with a few browned bubbles
  c.layer(top, P.cheese, { form: 'soft', bevel: 1.5, bias: 0.08 });
  for (const [x, y] of [
    [10, 12],
    [15, 10.5],
    [21, 11],
    [17, 13.5],
  ] as Pt[]) {
    c.px(x, y, P.corn[1]).px(x + 1, y, P.corn[2]);
  }
  // cheese dripping over the edges
  c.layer(c.capsule(8, 14, 8, 17, 0.9).union(c.capsule(21, 14.5, 21, 17.5, 0.9)), P.cheese, { form: 'soft', bevel: 1, shadow: false });
  mintLeaf(c, 16.5, 11, 2.6, 1.3, 15);
  glint(c, 8, 12, 2);
  return finish(c);
});

food('kebab', 'meals', 'Kebab Skewer', () => {
  const c = chef(32, 32, 63);
  // skewer runs from bottom-left to top-right
  c.layer(c.capsule(2.5, 29.5, 29.5, 2.5, 0.8), P.wood, { form: 'flat', bevel: 1, clean: false });
  const pieces: [number, 'm' | 'p' | 'o' | 't' | 'r'][] = [
    [0.18, 'm'],
    [0.3, 'p'],
    [0.42, 't'],
    [0.54, 'm'],
    [0.66, 'o'],
    [0.78, 'r'],
    [0.88, 'm'],
  ];
  for (const [t, k] of pieces) {
    const x = 2.5 + 27 * t;
    const y = 29.5 - 27 * t;
    if (k === 'm') {
      const m = c.tidy(c.roundRect(x - 3.4, y - 3.2, 6.8, 6.4, 1.6).union(c.circle(x + 1, y - 2.5, 2)));
      c.layer(m, P.grill, { form: 'puff', rim: true, grain: 0.08, seed: t * 100 });
      c.line(x - 2, y + 1, x + 1, y - 2, P.grill[0], m);
      c.line(x - 1, y + 2, x + 2, y - 1, P.grill[3], m);
    } else if (k === 'p' || k === 'r') {
      const m = c.roundRect(x - 3, y - 3, 6, 6, 1.2);
      c.layer(m, k === 'p' ? P.pepper : P.red, { form: 'soft', bevel: 1.5, rim: true });
      dots(c, [[Math.round(x - 2), Math.round(y - 2)]], k === 'p' ? P.pepper[4] : P.red[4]);
    } else if (k === 'o') {
      const m = c.ellipse(x, y, 3, 3.4);
      c.layer(m, P.onion, { form: 'soft', bevel: 1, rim: true });
      c.paint(c.ring(x, y, 2, 2.4, 0.8).intersect(m), P.onion[1]);
    } else {
      const m = c.circle(x, y, 3.2);
      c.layer(m, P.tomato, { form: 'puff', rim: true, reflect: true });
      glint(c, Math.round(x - 1.5), Math.round(y - 1), 1);
    }
  }
  c.paint(c.circle(29.5, 2.5, 0.8), P.wood[3]);
  return finish(c);
});

food('double_burger', 'meals', 'Double Stack', () => {
  const c = chef(32, 36, 65);
  c.layer(c.roundRect(5, 28, 22, 5.5, 2.6), P.bun, { form: 'soft', bevel: 2 });
  const slab = (y: number, seed: number) => {
    const m = c.roundRect(4, y, 24, 5, 2.4);
    c.layer(m, P.beef, { form: 'soft', bevel: 2, grain: 0.18, rim: true, seed });
    c.scatter(m, { count: 5, colors: [P.beef[4]], kind: 'dot', margin: 1, seed: seed + 1 });
  };
  const cheeseAt = (y: number, drips: number[]) => {
    const pts: Pt[] = [
      [3.5, y],
      [28.5, y],
      [28.5, y + 2.2],
    ];
    for (const d of drips.slice().sort((a, b) => b - a)) pts.push([d + 2, y + 2.2], [d, y + 5], [d - 2, y + 2.2]);
    pts.push([3.5, y + 2.2]);
    c.layer(c.poly(pts), P.cheese, { form: 'flat', bevel: 1, rim: true });
  };
  slab(23.5, 3);
  cheeseAt(22, [10, 22]);
  slab(17.5, 7);
  cheeseAt(16, [15, 25]);
  // pickles and onion
  c.layer(c.roundRect(5, 14.5, 22, 2.4, 1.2), P.pepper, { form: 'soft', bevel: 1, rim: true });
  const top = c.ellipse(16, 15, 12.5, 11).intersect(c.rect(0, 0, 32, 15.6));
  c.layer(top, P.bun, { form: 'puff', rim: true });
  c.scatter(top, { count: 11, colors: ['#fff6dc'], kind: 'sesame', margin: 2, seed: 9 });
  glint(c, 8, 9, 2);
  dots(c, [[11, 6]]);
  return finish(c);
});

food('bento', 'meals', 'Bento Box', () => {
  const c = chef(32, 32, 161);
  c.layer(c.roundRect(2.5, 9, 27, 20, 2), P.lacquer, { form: 'flat', bevel: 1, bias: -0.2 });
  const topM = c.roundRect(2.5, 6, 27, 18, 2);
  c.layer(topM, P.red, { form: 'flat', bevel: 1 });
  const inner = c.roundRect(4, 7.5, 24, 15, 1);
  c.layer(inner, P.lacquer, { form: 'none', bias: -0.3 });
  // rice with an umeboshi and a sprinkle of sesame
  const rice = c.roundRect(4.5, 8, 11, 14, 1);
  c.layer(rice, P.rice, { form: 'soft', bevel: 1 });
  c.scatter(rice, { count: 9, colors: [P.rice[1]], kind: 'dash', dir: 0, margin: 1, seed: 3 });
  c.layer(c.circle(10, 14.5, 2.2), P.red, { form: 'puff', rim: true, reflect: true });
  dots(c, [[9, 13]], P.red[4]);
  // salmon, tamago and broccoli
  const sal = c.roundRect(16.5, 8, 11, 6.5, 1.5);
  c.layer(sal, P.salmon, { form: 'soft', bevel: 1, rim: true });
  for (let k = 0; k < 3; k++) c.line(18 + k * 3, 13.5, 20 + k * 3, 8.5, P.salmon[4], sal);
  const egg = c.roundRect(16.5, 15, 6, 7, 1);
  c.layer(egg, P.tamago, { form: 'soft', bevel: 1, rim: true });
  c.line(17, 18, 22, 18, P.tamago[1], egg);
  for (const [x, y] of [
    [24.5, 16.5],
    [26.5, 19],
    [24, 20.5],
  ] as Pt[]) {
    const m = c.circle(x, y, 1.9);
    c.layer(m, P.pepper, { form: 'puff', rim: true, clean: false });
  }
  glint(c, 5, 9, 2);
  return finish(c);
});

// =================================================================================================
// Frozen

food('bao', 'frozen', 'Steamed Bao', () => {
  const c = chef(32, 32, 41);
  // bamboo steamer: rim and dark inside first, the bun sits in it, then the front wall
  const st = cyl(c, 16, 20.5, 26, 14.5, 14, 4.4);
  const inside = c.ellipse(16, 20.8, 12.4, 3.2);
  const ring = st.top.clone().subtract(inside);
  c.layer(st.top, P.bamboo, { form: 'flat', bevel: 1, bias: 0.15 });
  c.layer(inside, P.bamboo, { form: 'none', bias: -0.55 });
  const bun = c.blob([
    [5, 21],
    [5.5, 14.5],
    [9.5, 8.5],
    [16, 6],
    [22.5, 8.5],
    [26.5, 14.5],
    [27, 21],
    [16, 24],
  ]);
  c.layer(bun, P.bao, { form: 'puff', depth: 0.8, bias: 0.04 });
  // pleats gathered into a twisted knot on top
  const cx = 16;
  const cy = 9.5;
  const pleats = c.empty();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    const pts: Pt[] = [];
    for (let t = 0; t <= 1.001; t += 0.2) {
      const r = 1.6 + t * 5;
      const aa = a + t * 0.9;
      pts.push([cx + Math.cos(aa) * r * 1.3, cy + Math.sin(aa) * r * 0.62]);
    }
    for (let i = 0; i + 1 < pts.length; i++) pleats.union(c.capsule(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 0.35));
  }
  pleats.intersect(bun);
  c.paint(pleats.shift(0, -1).subtract(pleats).intersect(bun), P.bao[4]);
  c.paint(pleats, P.bao[0]);
  c.layer(c.ellipse(cx, cy - 0.4, 2.1, 1.5), P.bao, { form: 'puff', shadow: false });
  c.layer(c.circle(cx, cy - 0.6, 1), P.pink, { form: 'none', bias: 0.1, shadow: false, clean: false });
  const wall = st.body.clone().subtract(st.top);
  c.layer(wall, P.bamboo, { form: 'cylY', bias: 0.08 });
  c.line(1, 25, 31, 25, P.bamboo[1], wall);
  c.line(1, 26, 31, 26, P.bamboo[4], wall);
  c.layer(ring.intersect(c.rect(0, 20.8, 32, 12)), P.bamboo, { form: 'flat', bevel: 1, bias: 0.15, shadow: false });
  glint(c, 8, 15, 2);
  return finish(c);
});

food('creamsicle', 'frozen', 'Orange Creamsicle', () => {
  const c = chef(24, 38, 91);
  popStick(c, 12, 26, 36);
  const bar = c.roundRect(3.5, 3, 17, 26, 6).union(c.roundRect(3.5, 14, 17, 15, 2));
  const bite = c.circle(19, 5, 4.6).union(c.circle(21.5, 11, 3.8));
  const pop = bar.clone().subtract(bite);
  c.layer(pop, P.creamsicle, { form: 'soft', bevel: 3.5 });
  // the bite exposes the white vanilla core inside the orange shell
  const cream = bite.dilate().dilate().dilate().intersect(pop).subtract(bar.clone().subtract(bar.erode()));
  c.layer(cream, P.whip, { form: 'soft', bevel: 1, bias: 0.1, shadow: false });
  c.paint(cream.dilate().intersect(pop).subtract(cream).subtract(bite.dilate()), P.creamsicle[1]);
  // frosty glare and a tiny drip
  c.line(6, 8, 6, 22, P.creamsicle[4], pop).line(7, 7, 7, 9, WHITE, pop);
  c.layer(c.capsule(16.5, 28, 16.5, 30.5, 1.2), P.creamsicle, { form: 'soft', bevel: 1 });
  c.scatter(pop.clone().subtract(cream.dilate().dilate()), { count: 5, colors: [P.creamsicle[4]], kind: 'dot', margin: 2, seed: 3 });
  return finish(c);
});

food('twin_pop', 'frozen', 'Grape Twin Pop', () => {
  const c = chef(28, 38, 93);
  popStick(c, 9, 27, 36, 3.6);
  popStick(c, 19, 27, 36, 3.6);
  const left = c.roundRect(2.5, 3, 12, 26, 5.5);
  const right = c.roundRect(13.5, 3, 12, 26, 5.5);
  c.layer(right, P.grape, { form: 'soft', bevel: 3.5, bias: -0.04 });
  c.layer(left, P.grape, { form: 'soft', bevel: 3.5, rim: true });
  // frost sparkle and glare
  c.line(5, 8, 5, 22, P.grape[4], left).line(16, 8, 16, 20, P.grape[4], right);
  c.px(6, 7, WHITE).px(17, 7, WHITE);
  c.scatter(left.clone().union(right), { count: 8, colors: [P.grape[4], WHITE], kind: 'dot', margin: 2, seed: 5 });
  return finish(c);
});

food('ice_cream', 'frozen', 'Ice Cream Cone', () => {
  const c = chef(28, 38, 95);
  const cone = c.poly([
    [5, 17],
    [23, 17],
    [14.5, 36],
    [13.5, 36],
  ]);
  c.layer(cone, P.wafer, { form: 'cylY' });
  const grid = c.empty();
  for (let k = -6; k < 10; k++) {
    grid.union(c.capsule(k * 3.4, 14, k * 3.4 + 16, 38, 0.35));
    grid.union(c.capsule(k * 3.4 + 16, 14, k * 3.4, 38, 0.35));
  }
  c.paint(grid.intersect(cone), P.wafer[1]);
  // vanilla scoop with a strawberry scoop on top
  const low = c.blob([
    [3.5, 17],
    [5, 12],
    [10, 9.5],
    [18, 9.5],
    [23, 12],
    [24.5, 17],
    [21, 19.5],
    [18, 18],
    [16, 20.5],
    [13, 18.5],
    [9, 20],
    [6.5, 18.5],
  ]);
  c.layer(low, P.vanilla, { form: 'puff', depth: 0.7, rim: true });
  const top = c.blob([
    [6, 11],
    [8, 5.5],
    [14, 3],
    [20, 5.5],
    [22, 11],
    [19, 13],
    [16.5, 12],
    [14, 14.5],
    [11.5, 12.5],
    [8.5, 13],
  ]);
  c.layer(top, P.pink, { form: 'puff', depth: 0.7, rim: true });
  c.scatter(top, { count: 7, colors: P.sprinkle, kind: 'sprinkle', margin: 1, seed: 7 });
  glint(c, 9, 7, 2);
  dots(c, [[7, 14]]);
  return finish(c);
});

food('mochi', 'frozen', 'Mochi Ice Cream', () => {
  const c = chef(32, 32, 171);
  // three soft dusted mochi on a little bamboo tray
  const tray = cyl(c, 16, 21.5, 26.5, 14.5, 13.5, 4);
  c.layer(tray.body, P.bamboo, { form: 'cylY', bias: 0.08 });
  c.layer(tray.top, P.bamboo, { form: 'flat', bevel: 1, bias: 0.1, shadow: false });
  const ball = (x: number, y: number, rx: number, ry: number, ramp: Ramp, seed: number) => {
    const m = c.ellipse(x, y, rx, ry).union(c.ellipse(x, y + ry * 0.45, rx * 1.05, ry * 0.6));
    c.layer(m, ramp, { form: 'puff', depth: 0.75, rim: true });
    c.scatter(m, { count: 4, colors: [WHITE], kind: 'dot', margin: 1, seed });
    dots(c, [[Math.round(x - rx * 0.5), Math.round(y - ry * 0.45)]]);
    return m;
  };
  ball(10, 14.5, 6.2, 5.2, P.pink, 1);
  ball(22, 14.5, 6.2, 5.2, P.matcha, 2);
  ball(16, 19, 6.6, 5.4, P.vanilla, 3);
  return finish(c);
});

food('ice_cream_sandwich', 'frozen', 'Ice Cream Sandwich', () => {
  const c = chef(32, 32, 173);
  const x = 3.5;
  const y = 8;
  const w = 19;
  const d = 7;
  const H = 10;
  const { front, side, top } = box(c, x, y, w, H, d, d);
  // chocolate wafers with a thick band of vanilla between them
  c.layer(front, P.choco, { form: 'flat', bevel: 1, bias: 0.1 });
  c.layer(side, P.choco, { form: 'flat', bevel: 1, bias: -0.15 });
  const bandF = c.rect(x, y + d + 2.5, w, 5).intersect(front);
  const bandS = c
    .poly([
      [x + w, y + d + 2.5],
      [x + w + d, y + 2.5],
      [x + w + d, y + 7.5],
      [x + w, y + d + 7.5],
    ])
    .intersect(side);
  c.layer(bandF, P.whip, { form: 'none', bias: 0.12, shadow: false });
  c.layer(bandS, P.whip, { form: 'none', bias: -0.05, shadow: false });
  // the cream bulges a little past the wafers
  c.layer(c.capsule(x + 3, y + d + 7.6, x + 7, y + d + 7.6, 0.8), P.whip, { form: 'soft', bevel: 1, shadow: false });
  c.layer(top, P.choco, { form: 'flat', bevel: 1, bias: 0.22 });
  // docked holes in neat rows
  for (let r = 0; r < 3; r++)
    for (let k = 0; k < 7; k++) {
      const px = x + 3 + k * 3 + (2 - r) * 2.2;
      const py = y + 1.6 + r * 2.2;
      if (!top.get(Math.round(px), Math.round(py)) || !top.get(Math.round(px) + 1, Math.round(py) + 1)) continue;
      c.px(px, py, P.choco[1]);
    }
  for (let k = 0; k < 6; k++) c.px(x + 2 + k * 3, y + d + 1, P.choco[1]);
  c.px(x + 1, y + d, WHITE).px(x + 2, y + d - 1, P.choco[4]);
  return finish(c);
});

// =================================================================================================
// Drinks

food('milk', 'drinks', 'Milk Carton', () => {
  const c = chef(32, 32, 1);
  // front face, shaded side face, gable roof and the sealed fin on top
  const { front, side } = box(c, 6.5, 10, 13, 16.5, 6.5, 3);
  c.layer(front, P.white, { form: 'flat', bevel: 1 });
  c.layer(side, P.white, { form: 'flat', bevel: 1, bias: -0.22 });
  const roofF = c.poly([
    [6.5, 13],
    [13, 6.5],
    [19.5, 13],
  ]);
  const roofS = c.poly([
    [13, 6.5],
    [19.5, 3.5],
    [26, 10],
    [19.5, 13],
  ]);
  c.layer(roofF, P.sky, { form: 'flat', bevel: 1, bias: 0.05 });
  c.layer(roofS, P.sky, { form: 'flat', bevel: 1, bias: -0.14 });
  c.layer(
    c.poly([
      [12, 6.2],
      [19, 3],
      [20.5, 4],
      [13.5, 7.4],
    ]),
    P.white,
    { form: 'flat', bevel: 1 },
  );
  // label: blue band with a milk drop
  c.layer(c.rect(6.5, 19, 13, 6.5), P.sky, { form: 'flat', bevel: 1 });
  c.layer(
    c.poly([
      [19.5, 19],
      [26, 16],
      [26, 22.5],
      [19.5, 25.5],
    ]),
    P.sky,
    { form: 'flat', bevel: 1, bias: -0.2 },
  );
  const drop = c.circle(13, 23, 1.8).union(
    c.poly([
      [11.4, 22.4],
      [13, 19.6],
      [14.6, 22.4],
    ]),
  );
  c.layer(drop, P.white, { form: 'soft', bevel: 1 });
  c.line(8, 15, 11, 15, P.sky[2]).line(8, 17, 17, 17, P.white[1]);
  return finish(c);
});

food('lemonade', 'drinks', 'Lemonade', () => {
  const c = chef(32, 34, 71);
  // striped straw behind the rim
  const straw = c.capsule(18.5, 16, 23, 3.2, 1.2);
  c.layer(straw, P.white, {
    form: 'cylY',
    clean: false,
    pattern: { ramps: [P.white, P.red], at: (_x, y) => (Math.floor(y / 2.5) % 2) },
  });
  const g = glass(c, 14, 11, 31, 9, 7.5, 2.6, 12.5, P.lemonade);
  // ice cubes and bubbles
  for (const [x, y] of [
    [10.5, 13.8],
    [16, 14.8],
  ] as Pt[]) {
    const ice = c.roundRect(x - 2.4, y - 2.2, 4.8, 4.4, 1).intersect(g.inner.clone().union(g.surface));
    c.layer(ice, P.glass, { form: 'flat', bevel: 1, bias: 0.15, rim: true });
    dots(c, [[Math.round(x - 1.5), Math.round(y - 1.5)]]);
  }
  c.scatter(g.inner.clone().intersect(c.rect(0, 19, 32, 12)), { count: 7, colors: [P.lemonade[4], WHITE], kind: 'dot', margin: 1, seed: 3 });
  // glare stripe
  c.line(7, 17, 7, 27, WHITE, g.body).line(8, 16, 8, 18, P.glass[4], g.body);
  citrusWheel(c, 22.5, 10.5, 5, P.lemon, P.lemonade);
  return finish(c);
});

food('green_tea', 'drinks', 'Matcha Boba', () => {
  const c = chef(32, 40, 73);
  // cup with a domed lid and a fat straw
  const cup = cyl(c, 16, 14, 35, 9.5, 7.5, 2.8);
  c.layer(cup.body, P.glass, { form: 'cylY', bias: 0.1 });
  const tea = cyl(c, 16, 16, 34, 8.5, 6.6, 2.2);
  c.layer(tea.body, P.tea, { form: 'cylY', bias: 0.08 });
  // milk swirl near the top and pearls at the bottom
  c.layer(c.ellipse(16, 18, 8.4, 1.6).intersect(tea.body), P.tea, { form: 'none', bias: 0.3, shadow: false, clean: false });
  for (const [x, y] of [
    [11.5, 31.5],
    [15, 32.5],
    [18.5, 31.8],
    [21, 30],
    [13, 29],
    [17, 29.5],
    [10.5, 27.5],
  ] as Pt[]) {
    const b = c.circle(x, y, 1.6).intersect(tea.body);
    c.layer(b, P.boba, { form: 'puff', shadow: false, clean: false });
    dots(c, [[Math.round(x - 1), Math.round(y - 1)]], P.boba[4]);
  }
  c.line(8, 19, 8, 30, WHITE, cup.body).line(9, 17, 9, 20, P.glass[4], cup.body);
  // label band
  const band = cup.body.clone().intersect(c.rect(0, 21.5, 32, 4.5));
  c.layer(band, P.bechamel, { form: 'cylY', shadow: false });
  c.layer(c.circle(16, 23.7, 1.6).intersect(band), P.tea, { form: 'soft', bevel: 1, shadow: false, clean: false });
  // lid
  c.layer(c.ellipse(16, 14, 10.5, 3), P.glass, { form: 'flat', bevel: 1, bias: 0.05 });
  const dome = c.ellipse(16, 13, 8, 5).intersect(c.rect(0, 0, 32, 13.5));
  c.layer(dome, P.glass, { form: 'puff', depth: 0.6, bias: 0.1 });
  // straw
  const straw = c.capsule(18, 11, 21.5, 2.6, 1.5);
  c.layer(straw, P.tea, { form: 'cylY', rim: true });
  c.line(9.5, 12, 11, 10, WHITE, dome);
  return finish(c);
});

food('orange_juice', 'drinks', 'Orange Juice', () => {
  const c = chef(32, 32, 75);
  const g = glass(c, 14, 10, 30, 10, 8.5, 3, 11.8, P.oj);
  c.scatter(g.inner.clone().intersect(c.rect(0, 17, 32, 12)), { count: 6, colors: [P.oj[4]], kind: 'dot', margin: 1, seed: 4 });
  c.line(6, 16, 6, 26, WHITE, g.body).line(7, 15, 7, 17, P.glass[4], g.body);
  citrusWheel(c, 23, 9, 5.5, P.orange, P.oj);
  return finish(c);
});

food('coffee', 'drinks', 'Hot Coffee', () => {
  const c = chef(32, 32, 77);
  const m = cyl(c, 14.5, 14, 28, 10.5, 9.5, 3.2);
  // handle
  const handle = c.ring(25, 20.5, 5, 5.2, 2.2);
  c.layer(handle, P.mug, { form: 'puff', depth: 0.6 });
  c.layer(m.body, P.mug, { form: 'cylY', bias: 0.05 });
  c.layer(m.body.clone().intersect(c.rect(0, 25.5, 32, 2)), P.mug, { form: 'cylY', bias: -0.2, shadow: false });
  c.layer(m.top, P.mug, { form: 'flat', bevel: 1, bias: 0.2, shadow: false });
  const cup = c.ellipse(14.5, 14.3, 9, 2.4);
  c.layer(cup, P.crema, { form: 'flat', bevel: 1, shadow: false });
  c.layer(c.ellipse(14.5, 14.5, 7.5, 1.7), P.coffee, { form: 'flat', bevel: 1, bias: 0.1, shadow: false });
  // latte heart
  c.px(13, 14, P.crema[4]).px(15, 14, P.crema[4]).px(14, 15, P.crema[4]);
  glint(c, 6, 20, 3);
  return finish(c, () => {
    steam(c, [
      [12, 11],
      [10.5, 8.5],
      [12.5, 6],
      [11, 3],
    ]);
    steam(c, [
      [17.5, 10.5],
      [16.5, 8],
      [18.5, 5.5],
      [17.5, 2.5],
    ]);
  });
});

food('soda', 'drinks', 'Cherry Soda', () => {
  const c = chef(24, 34, 79);
  const can = cyl(c, 12, 5, 30.5, 9, 9, 2.6);
  c.layer(can.body, P.can, { form: 'cylY', bias: 0.05 });
  // swoosh band
  const wave = c.empty();
  for (let x = 2; x <= 22; x++) {
    const y = 18 + Math.sin(x / 3.2) * 2;
    wave.union(c.rect(x, y, 1, 3));
  }
  c.layer(wave.intersect(can.body), P.white, { form: 'cylY', shadow: false });
  // silver shoulders and lid
  c.layer(can.body.clone().intersect(c.rect(0, 2, 24, 4.5)), P.steel, { form: 'cylY', shadow: false });
  c.layer(can.body.clone().intersect(c.rect(0, 29, 24, 6)), P.steel, { form: 'cylY', shadow: false });
  c.layer(can.top, P.steel, { form: 'flat', bevel: 1, bias: 0.1, shadow: false });
  c.layer(c.ellipse(12, 5.2, 6.5, 1.6), P.steel, { form: 'none', bias: -0.2, shadow: false });
  c.layer(c.roundRect(10, 3.8, 4.5, 2, 0.8), P.steel, { form: 'flat', bevel: 1, bias: 0.2, clean: false });
  // cherry badge
  c.layer(c.circle(10, 12.5, 1.9), P.red, { form: 'puff' });
  c.layer(c.circle(14, 13, 1.9), P.red, { form: 'puff' });
  c.line(10, 10.5, 12, 8.5, P.leaf[1]).line(14, 11, 12, 8.5, P.leaf[1]);
  c.line(5, 9, 5, 27, P.can[4], can.body).line(6, 9, 6, 14, WHITE, can.body);
  return finish(c);
});

food('juice_box', 'drinks', 'Apple Juice Box', () => {
  const c = chef(32, 34, 81);
  const { front, side, top } = box(c, 7, 9, 12, 19, 6, 3);
  c.layer(front, P.juiceBox, { form: 'flat', bevel: 1 });
  c.layer(side, P.juiceBox, { form: 'flat', bevel: 1, bias: -0.25 });
  c.layer(top, P.juiceBox, { form: 'flat', bevel: 1, bias: 0.2 });
  // label: an apple on a white panel
  c.layer(c.roundRect(8.5, 17, 9, 10, 1.5), P.white, { form: 'flat', bevel: 1 });
  const ap = c.circle(12, 22.5, 2.6).union(c.circle(14.2, 22.5, 2.6));
  c.layer(ap, P.apple, { form: 'puff' });
  c.line(13, 20, 14, 18.5, P.stem[1]);
  c.layer(c.oval(15.5, 18.8, 1.4, 0.8, -30), P.leaf, { form: 'soft', bevel: 1, clean: false });
  c.line(9, 14, 16, 14, P.juiceBox[4]);
  // bendy straw poking out of the top
  const straw = c.path([
    [20, 10],
    [20, 4],
    [22, 2],
    [25.5, 2],
  ], 0.9);
  c.layer(straw, P.white, { form: 'cylY', rim: true, clean: false });
  c.paint(c.rect(19, 5, 3, 1).intersect(straw), P.white[1]);
  return finish(c);
});

// =================================================================================================
// Pantry

food('mac_cheese', 'pantry', 'Mac & Cheese Box', () => {
  const c = chef(32, 32, 153);
  const { front, side, top } = box(c, 5, 5, 16, 21, 6, 4);
  c.layer(front, P.wrapBlue, { form: 'flat', bevel: 1 });
  c.layer(side, P.wrapBlue, { form: 'flat', bevel: 1, bias: -0.25 });
  c.layer(top, P.wrapBlue, { form: 'flat', bevel: 1, bias: 0.2 });
  // a bowl of elbows on the front
  c.layer(c.ellipse(13, 22, 6.5, 4.5), P.white, { form: 'soft', bevel: 1 });
  const mac = c.ellipse(13, 21.2, 5, 3.2);
  c.layer(mac, P.cheese, { form: 'puff', depth: 0.5 });
  for (const [x, y] of [
    [10, 20],
    [13, 19],
    [15.5, 21],
    [11.5, 22.5],
  ] as Pt[]) {
    c.px(x, y, P.cheese[4]).px(x + 1, y, P.cheese[3]).px(x + 1, y + 1, P.cheese[1]);
  }
  c.layer(c.roundRect(7, 11, 12, 4, 1.5), P.cheese, { form: 'soft', bevel: 1 });
  c.line(8, 13, 17, 13, P.wrapBlue[1]);
  c.line(23, 12, 25, 11, P.wrapBlue[4], side);
  return finish(c);
});

food('jam', 'pantry', 'Strawberry Jam', () => {
  const c = chef(32, 32, 155);
  const jar = cyl(c, 16, 11, 29, 10, 10, 3);
  c.layer(jar.body, P.jam, { form: 'cylY', bias: 0.05 });
  c.line(8, 13, 8, 27, P.jam[4], jar.body).line(9, 13, 9, 16, WHITE, jar.body);
  // label
  const label = jar.body.clone().intersect(c.rect(0, 17, 32, 8));
  c.layer(label, P.vanilla, { form: 'cylY', shadow: false });
  strawberry(c, 16, 20.5, 2.6);
  // gingham cloth cover tied with string
  const cloth = c.blob([
    [4.5, 12],
    [7, 6.5],
    [16, 4.5],
    [25, 6.5],
    [27.5, 12],
    [24, 13.5],
    [20, 12.5],
    [16, 14],
    [12, 12.5],
    [8, 13.5],
  ]);
  c.layer(cloth, P.white, {
    form: 'puff',
    depth: 0.6,
    rim: true,
    pattern: { ramps: [P.white, P.red, P.pink], at: (x, y) => ((Math.floor(x / 2) % 2) + (Math.floor(y / 2) % 2) === 1 ? 2 : Math.floor(x / 2) % 2 === 1 ? 1 : 0) },
  });
  c.layer(c.rect(6, 11, 20, 1.2), P.popStick, { form: 'none', clean: false });
  return finish(c);
});

food('noodle_cup', 'pantry', 'Cup Noodles', () => {
  const c = chef(32, 34, 157);
  // paper lid peeled back and standing up behind the rim
  const flap = c.ellipse(15, 7.5, 10, 6).intersect(c.rect(0, 0, 32, 9.5));
  c.layer(flap, P.foil, { form: 'flat', bevel: 1, bias: -0.05 });
  c.layer(c.ellipse(15, 6.2, 6.5, 3.4).intersect(flap), P.can, { form: 'soft', bevel: 1, shadow: false });
  c.layer(c.ellipse(15, 5.8, 3, 1.4).intersect(flap), P.white, { form: 'none', bias: 0.2, shadow: false, clean: false });
  const cup = cyl(c, 16, 10, 31, 11, 8.5, 3);
  c.layer(cup.body, P.foam, { form: 'cylY', bias: 0.1 });
  const band = cup.body.clone().intersect(c.rect(0, 16, 32, 7));
  c.layer(band, P.can, { form: 'cylY', shadow: false });
  c.layer(c.roundRect(11, 17.5, 10, 4, 1).intersect(band), P.white, { form: 'flat', bevel: 1, shadow: false });
  c.line(12.5, 19.5, 19.5, 19.5, P.can[2]);
  c.layer(cup.top, P.foam, { form: 'flat', bevel: 1, bias: 0.2, shadow: false });
  // curly noodles with a few toppings
  const noodles = c.ellipse(16, 10.4, 9.6, 2.3);
  c.layer(noodles, P.noodle, { form: 'flat', bevel: 1, shadow: false });
  for (let x = 8; x < 25; x += 2) c.px(x, 10 + (x % 4 ? 1 : 0), P.noodle[1]);
  c.px(11, 10, P.lettuce[3]).px(19, 11, P.lettuce[3]).px(15, 10, P.orange[3]).px(22, 10, P.meatball[3]).px(13, 11, P.meatball[3]);
  glint(c, 7, 13, 2);
  return finish(c);
});

food('honey', 'pantry', 'Honey Pot', () => {
  const c = chef(32, 34, 159);
  const pot = c.tidy(c.ellipse(16, 22, 12, 10).union(c.roundRect(8.5, 10, 15, 6, 2)));
  c.layer(pot, P.honey, { form: 'puff', reflect: true });
  // lid rim with honey dripping over
  const lip = c.roundRect(7, 9, 18, 4, 2);
  c.layer(lip, P.honey, { form: 'soft', bevel: 1.5, bias: 0.1, rim: true });
  const drips = c.capsule(10, 12, 10, 16, 1.2).union(c.capsule(18, 12, 18, 18.5, 1.3)).union(c.capsule(22.5, 12, 22.5, 14.5, 1.1));
  c.layer(drips, P.honey, { form: 'soft', bevel: 1, bias: 0.2, rim: true });
  // label
  const label = c.ellipse(16, 23, 7, 4.5);
  c.layer(label, P.vanilla, { form: 'soft', bevel: 1 });
  // honeycomb badge
  for (const [x, y] of [
    [14.2, 22],
    [17.8, 22],
    [16, 24.6],
  ] as Pt[]) {
    const hexM = c.poly([
      [x - 1.9, y],
      [x - 0.9, y - 1.6],
      [x + 0.9, y - 1.6],
      [x + 1.9, y],
      [x + 0.9, y + 1.6],
      [x - 0.9, y + 1.6],
    ]);
    c.layer(hexM, P.honey, { form: 'soft', bevel: 1, bias: 0.1, rim: true, rimColor: '#a8600e', clean: false });
  }
  // wooden dipper
  c.layer(c.capsule(21, 8, 27, 1.5, 1), P.wood, { form: 'flat', bevel: 1, clean: false });
  c.layer(c.roundRect(15, 5, 7, 5, 2), P.wood, { form: 'soft', bevel: 1.5, rim: true });
  c.line(15.5, 7, 21.5, 7, P.wood[1]);
  glint(c, 7, 19, 3);
  dots(c, [[8, 21]]);
  return finish(c);
});

food('ketchup', 'pantry', 'Tomato Ketchup', () => {
  const c = chef(24, 38, 175);
  // squeeze bottle: flip-top cap, shoulders and a label with a tomato
  const cap = c.roundRect(8, 2, 8, 6, 1.5).union(c.roundRect(10, 0.8, 4, 2, 0.8));
  c.layer(cap, P.white, { form: 'cylY' });
  c.layer(c.rect(7, 7, 10, 2), P.white, { form: 'cylY', bias: -0.15 });
  const body = c.tidy(c.roundRect(3.5, 12, 17, 24, 4).union(c.ellipse(12, 12.5, 7, 4.5)));
  c.layer(body, P.can, { form: 'cylY', bias: 0.05 });
  c.layer(c.roundRect(9.5, 8.5, 5, 3, 1), P.can, { form: 'cylY', bias: -0.1 });
  const label = body.clone().intersect(c.rect(0, 19, 24, 11));
  c.layer(label, P.vanilla, { form: 'cylY', shadow: false });
  const tom = c.circle(12, 24.5, 3.4);
  c.layer(tom, P.tomato, { form: 'puff', rim: true, reflect: true });
  c.layer(c.poly([
    [10, 21.5],
    [12, 20],
    [14, 21.5],
    [12, 22.5],
  ]), P.leaf, { form: 'flat', bevel: 1, clean: false });
  dots(c, [[10, 23]]);
  c.line(6, 14, 6, 33, P.can[4], body).line(7, 13, 7, 16, WHITE, body);
  return finish(c);
});

export function foodDefs(): FoodDef[] {
  return FOODS;
}

export { INK };
