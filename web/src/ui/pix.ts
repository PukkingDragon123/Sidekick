// Pixel-art UI kit. Frames are painted pixel by pixel at 1x and used as nine-slice border images;
// icons are hand-drawn 12x12 sprites. Everything shares the forest's palette.
export const PAL: Record<string, string> = {
  K: '#2b1d14', k: '#4a3222',
  N: '#b87a41', n: '#d99a5b', D: '#8a562f', d: '#6e4326',
  P: '#f6e7c3', p: '#fff6dc', Q: '#e2c99a', q: '#cdb07f',
  G: '#5cab3a', g: '#8fd24e', H: '#3d8c3c', h: '#2f6f33',
  R: '#d8433f', r: '#f0766a', S: '#a0a6b4', s: '#7a8090',
  Y: '#f2b632', y: '#ffe08a', Z: '#c98a1e',
  B: '#5aa9e6', b: '#a8d8ff', C: '#3f7fc0',
  W: '#fffdf5', w: '#e2dac6', V: '#8d62d6', v: '#b99cf0',
  T: '#26332b', t: '#3a4b40', U: '#162019', O: '#f58fb0',
};

const rgba = (hex: string): [number, number, number, number] => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, hex.length > 7 ? parseInt(hex.slice(7, 9), 16) : 255];
};

function toUrl(w: number, h: number, paint: (x: number, y: number) => string | null): string {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!, img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const col = paint(x, y);
    if (!col) continue;
    const [r, g, b, a] = rgba(col), k = (y * w + x) * 4;
    img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

export interface FrameSpec {
  ink: string; fill: string; hi?: string; lo?: string;
  /** thick bottom edge that makes the piece look like a physical slab */
  base?: string; baseH?: number;
  nails?: string;
  /** pushed in: no slab, shifted down by its height */
  pressed?: boolean;
  /** recessed well instead of a raised slab */
  inset?: boolean;
  r?: number;
}

/** Paint a 16x16 nine-slice frame. */
export function frame(o: FrameSpec): string {
  const s = 16, r = o.r ?? 2, bh = o.base ? (o.baseH ?? 2) : 0, off = o.pressed ? bh : 0;
  const inside = (x: number, y: number) => {
    const yy = y - off;
    if (x < 0 || yy < 0 || x >= s || yy >= s - off || y >= s) return false;
    const cx = Math.min(x, s - 1 - x), cy = Math.min(yy, s - 1 - off - yy);
    return cx + cy >= r;
  };
  return toUrl(s, s, (x, y) => {
    if (!inside(x, y)) return null;
    if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) return o.ink;
    const yy = y - off, bottom = s - 2 - off, slab = !o.pressed && bh > 0;
    if (slab && yy > bottom - bh) return o.base!;
    const lastRow = slab ? bottom - bh : bottom;
    if (o.nails && (x === 3 || x === s - 4) && (yy === 3 || yy === lastRow - 2)) return o.nails;
    const hi = o.inset ? o.lo : o.hi, lo = o.inset ? o.hi : o.lo;
    if (yy === 1 || x === 1) return hi ?? o.fill;
    if (yy === lastRow || x === s - 2) return lo ?? o.fill;
    return o.fill;
  });
}

/** Small repeating texture tiles laid over panels: wood grain and paper flecks. */
function grain(): string {
  const rows = ['................', '..kkkk..........', '..........kkk...', '................', '.....kkkkk......', '................', '............kk..', 'kk..............'];
  return toUrl(16, 8, (x, y) => (rows[y][x] === 'k' ? '#6e432638' : null));
}
function flecks(): string {
  return toUrl(16, 16, (x, y) => ((x * 7 + y * 13) % 29 === 0 ? '#cdb07f66' : (x * 5 + y * 3) % 37 === 0 ? '#fff6dc99' : null));
}

const ICON_ART: Record<string, string[]> = {
  tasks: ['............', '.KKKKKKKKK..', 'KpPPPPPPPQK.', 'KpGPKKKKPQK.', 'KpPPPPPPPQK.', 'KpGPKKKKPQK.', 'KpPPPPPPPQK.', 'KpRPKKKPPQK.', 'KpPPPPPPPQK.', 'KQQQQQQQQqK.', '.KKKKKKKKK..', '............'],
  chat: ['............', '.KKKKKKKKKK.', 'KWWWWWWWWWWK', 'KWWWWWWWWWWK', 'KWKKWKKWKKWK', 'KWWWWWWWWWWK', 'KWWWWWWWWWwK', '.KKKWWKKKKK.', '...KWK......', '...KK.......', '............', '............'],
  quests: ['............', '..KK........', '..KRRRRKK...', '..KRrRRRRK..', '..KRRRRRRK..', '..KRRRRRK...', '..KRRKKK....', '..KK........', '..KK........', '..KK........', '.KKKK.......', '............'],
  shop: ['............', '...KKKKKK...', '..K......K..', '.KKKKKKKKKK.', '.KnNNNNNNDK.', '.KnNKKKKNDK.', '.KnNKYYKNDK.', '.KnNKYYKNDK.', '.KnNKKKKNDK.', '.KDDDDDDDdK.', '..KKKKKKKK..', '............'],
  bag: ['............', '....KKKK....', '...K....K...', '..KKKKKKKK..', '.KGGGGGGGHK.', '.KGgGGGGGHK.', '.KGKKKKKKHK.', '.KGKyYYYKHK.', '.KGKYYYYKHK.', '.KHKKKKKKhK.', '..KKKKKKKK..', '............'],
  shirt: ['............', '..KKK..KKK..', '.KBBBKKBBBK.', 'KBBbBBBBBBBK', 'KBBKBBBBKBBK', '.KKKBBBBKKK.', '...KBBBBK...', '...KBBBBK...', '...KBBBCK...', '...KCCCCK...', '....KKKK....', '............'],
  garden: ['............', '.....KK.....', '..KK.KGK.KK.', '.KGgKKGKKgGK', '.KGGGKGKGGGK', '..KKGGGGGKK.', '....KGGK....', '..KKKKKKKK..', '..KNNNNNDK..', '...KNNNDK...', '...KKKKKK...', '............'],
  paw: ['............', '...KK..KK...', '..KDDKKDDK..', '.KKDDKKDDKK.', 'KDDKKKKKKDDK', 'KDDKDDDDKDDK', '.KKDDDDDDKK.', '..KDDDDDDK..', '..KDDDDDDK..', '...KDDDDK...', '....KKKK....', '............'],
  gear: ['............', '....KKKK....', '.KK.KSSK.KK.', '.KSKKSSKKSK.', '..KSSSSSSK..', 'KKSSKKKKSSKK', 'KSSSK..KSSSK', 'KKSSKKKKSSKK', '..KSSSSSSK..', '.KSKKSSKKSK.', '.KK.KSSK.KK.', '....KKKK....'],
  bell: ['............', '.....KK.....', '....KYYK....', '...KYyYYK...', '...KYyYYK...', '..KYyYYYYK..', '..KYYYYYYK..', '.KYYYYYYYZK.', '.KKKKKKKKKK.', '....KYYK....', '.....KK.....', '............'],
  coin: ['............', '...KKKKKK...', '..KyyyyYYK..', '.KyYYYYYYZK.', '.KyYYKKYYZK.', '.KyYYKKYYZK.', '.KYYYKKYYZK.', '.KYYYYYYZZK.', '..KYZZZZZK..', '...KKKKKK...', '............', '............'],
  gem: ['............', '............', '..KKKKKKKK..', '.KbbBBBBBCK.', 'KbBbBBBBCBCK', '.KBBbBBCBCK.', '..KBBbCBCK..', '...KBBCCK...', '....KBCK....', '.....KK.....', '............', '............'],
  flame: ['............', '.....K......', '....KRK.....', '....KRRK....', '...KRRRK.K..', '..KRRYRRKRK.', '..KRYYYRRRK.', '.KRRYyYYRRK.', '.KRYYyyYYRK.', '.KRRYyyYRRK.', '..KKRRRRKK..', '....KKKK....'],
  heart: ['............', '..KK....KK..', '.KRRK..KRRK.', 'KRrRRKKRRRRK', 'KRrRRRRRRRRK', 'KRRRRRRRRRRK', '.KRRRRRRRRK.', '..KRRRRRRK..', '...KRRRRK...', '....KRRK....', '.....KK.....', '............'],
  star: ['.....KK.....', '....KYYK....', '....KYyK....', 'KKKKYyYYKKKK', 'KYYYyYYYYYZK', '.KYYYYYYYZK.', '..KYYYYYZK..', '..KYYYYYYK..', '.KYYZKKZYYK.', '.KYZK..KZYK.', '.KKK....KKK.', '............'],
  clock: ['............', '...KKKKKK...', '..KWWWWWWK..', '.KWWWKWWWWK.', '.KWWWKWWWWK.', '.KWWWKKKWWK.', '.KWWWWWWWWK.', '.KWWWWWWWwK.', '..KWWWWwwK..', '...KKKKKK...', '............', '............'],
  check: ['............', '............', '.........KK.', '........KGGK', '.......KGGK.', '.KK...KGGK..', 'KGGK.KGGK...', '.KGGKGGK....', '..KGGGK.....', '...KGK......', '....K.......', '............'],
  plus: ['............', '....KKKK....', '....KWWK....', '....KWWK....', '.KKKKWWKKKK.', '.KWWWWWWWWK.', '.KWWWWWWWWK.', '.KKKKWWKKKK.', '....KWWK....', '....KWWK....', '....KKKK....', '............'],
  close: ['............', '.KK......KK.', 'KWWK....KWWK', '.KWWK..KWWK.', '..KWWKKWWK..', '...KWWWWK...', '...KWWWWK...', '..KWWKKWWK..', '.KWWK..KWWK.', 'KWWK....KWWK', '.KK......KK.', '............'],
  lock: ['............', '....KKKK....', '...KSSSSK...', '..KSK..KSK..', '..KSK..KSK..', '.KKKKKKKKKK.', '.KYYYYYYYZK.', '.KYYYKKYYZK.', '.KYYYKKYYZK.', '.KYYYYYYYZK.', '.KKKKKKKKKK.', '............'],
  cloud: ['............', '............', '....KKKK....', '...KWWWWKK..', '.KKWWWWWWWK.', 'KWWWWWWWWWWK', 'KWWWWWWWWWWK', 'KWWWWWWWWWwK', '.KKKKKKKKKK.', '............', '............', '............'],
  board: ['............', 'KKKKKKKKKKKK', 'KNNNNNNNNNNK', 'KNHHHHHHHHNK', 'KNHWWHHHHHNK', 'KNHHHHWWWHNK', 'KNHWWWHHHHNK', 'KNHHHHHHHHNK', 'KNNNNNNNNNNK', 'KKKKKKKKKKKK', '..KK....KK..', '..KK....KK..'],
  people: ['............', '....KKKK....', '...KVVVVK...', '...KVvVVK...', '....KKKK....', '..KKVVVVKK..', '.KVVvVVVVVK.', '.KVVVVVVVVK.', '.KVVVVVVVVK.', '.KKKKKKKKKK.', '............', '............'],
  calendar: ['............', '..K......K..', '.KKKKKKKKKK.', '.KRRRRRRRRK.', '.KRRRRRRRRK.', '.KWWWWWWWWK.', '.KWKWKWKWWK.', '.KWWWWWWWWK.', '.KWKWKWKWWK.', '.KWWWWWWWwK.', '.KKKKKKKKKK.', '............'],
  timer: ['............', '.KKKKKKKKKK.', '.KNNNNNNNNK.', '..KWYYYYWK..', '...KWYYWK...', '....KWYK....', '....KWWK....', '...KWWYWK...', '..KWYYYYWK..', '.KNNNNNNNNK.', '.KKKKKKKKKK.', '............'],
  spark: ['.....K......', '....KYK.....', '....KYK..K..', '..KKYyYKKYK.', '.KYYyWyYYK..', '..KKYyYKK...', '....KYK.....', '.K..KYK.....', 'KYK..K......', '.K..........', '............', '............'],
  copy: ['............', '...KKKKKKK..', '...KWWWWWK..', '.KKKKKKKWK..', '.KWWWWWKWK..', '.KWKKKWKWK..', '.KWWWWWKWK..', '.KWKKKWKKK..', '.KWWWWWK....', '.KKKKKKK....', '............', '............'],
  pin: ['............', '......KKK...', '.....KRRRK..', '....KRrRRK..', '....KRRRRK..', '...KKRRRK...', '..KSSKKK....', '.KSSK.......', 'KSSK........', '.KK.........', '............', '............'],
  trash: ['............', '....KKKK....', '.KKKKKKKKKK.', '.KSSSSSSSSK.', '.KKKKKKKKKK.', '..KSSSSSSK..', '..KSKSKSSK..', '..KSKSKSSK..', '..KSKSKSSK..', '..KSSSSSSK..', '..KKKKKKKK..', '............'],
  rotate: ['............', '....KKKK.K..', '..KKWWWWKWK.', '.KWWKKKKWWK.', '.KWK...KWWK.', 'KWK....KKKK.', 'KWK.........', 'KWK......KK.', '.KWK....KWK.', '.KWWKKKKWWK.', '..KKWWWWKK..', '....KKKK....'],
  tree: ['............', '.....KK.....', '....KGGK....', '...KGgGGK...', '..KGgGGGGK..', '.KGGGGGGGHK.', '.KGGGGGGHHK.', '..KKKDDKKK..', '....KDDK....', '....KDDK....', '....KKKK....', '............'],
  bolt: ['............', '......KKK...', '.....KYYK...', '....KYYK....', '...KYYK.....', '..KYYYKKK...', '..KKKYYYK...', '....KYYK....', '...KYYK.....', '...KYK......', '...KK.......', '............'],
  apple: ['............', '......KK....', '.....KGK....', '...KKKKKK...', '..KRRRRRRK..', '.KRrRRRRRRK.', '.KRrRRRRRRK.', '.KRRRRRRRRK.', '.KRRRRRRRRK.', '..KRRRRRRK..', '...KKKKKK...', '............'],
  arrow: ['............', '......KK....', '......KWK...', '.KKKKKKWWK..', '.KWWWWWWWWK.', '.KWWWWWWWWK.', '.KKKKKKWWK..', '......KWK...', '......KK....', '............', '............', '............'],
  sun: ['.....KK.....', '.K...KYK..K.', '..K..KK..K..', '....KKKK....', '...KYYYYK...', 'KK.KYyYYK.KK', 'KYKKYYYYKKYK', 'KK.KYYYYK.KK', '....KKKK....', '..K..KK..K..', '.K...KYK..K.', '.....KK.....'],
  sound: ['............', '......KK....', '.....KWK.K..', '.KKKKWWK..K.', '.KWWWWWK.KK.', '.KWWWWWK..K.', '.KWWWWWK.KK.', '.KKKKWWK..K.', '.....KWK.K..', '......KK....', '............', '............'],
  device: ['............', '.KKKKKKKKKK.', '.KBBBBBBBBK.', '.KBbBBBBBBK.', '.KBBBBBBBBK.', '.KBBBBBBBCK.', '.KKKKKKKKKK.', '....KSSK....', '..KKKKKKKK..', '............', '............', '............'],
};
export type IconName = keyof typeof ICON_ART;
const iconUrls = new Map<string, string>();
export function iconUrl(name: string): string {
  let u = iconUrls.get(name);
  if (!u) {
    const art = ICON_ART[name] ?? ICON_ART.star;
    u = toUrl(12, 12, (x, y) => PAL[art[y][x]] ?? null);
    iconUrls.set(name, u);
  }
  return u;
}

const btn = (hi: string, fill: string, lo: string, base: string) => ({ up: frame({ ink: PAL.K, fill, hi, lo, base, baseH: 2 }), down: frame({ ink: PAL.K, fill: lo, hi: lo, lo, base, baseH: 2, pressed: true }) });

/** Build every frame once and expose them as CSS variables. */
export function installSkin() {
  const f: Record<string, string> = {
    wood: frame({ ink: PAL.K, fill: PAL.N, hi: PAL.n, lo: PAL.D, base: PAL.d, baseH: 1, nails: PAL.y }),
    paper: frame({ ink: PAL.K, fill: PAL.P, hi: PAL.p, lo: PAL.Q, base: PAL.q, baseH: 1 }),
    slot: frame({ ink: PAL.k, fill: PAL.Q, hi: PAL.P, lo: PAL.q, inset: true, r: 1 }),
    slotOn: frame({ ink: PAL.K, fill: PAL.p, hi: PAL.W, lo: PAL.y, r: 1 }),
    dark: frame({ ink: PAL.U, fill: '#26332be6', hi: '#3a4b40e6', lo: '#1c2620e6' }),
    bubble: frame({ ink: PAL.K, fill: PAL.W, hi: PAL.W, lo: PAL.w, base: PAL.w, baseH: 1, r: 3 }),
    field: frame({ ink: PAL.k, fill: PAL.W, hi: PAL.w, lo: PAL.W, r: 1 }),
    grain: grain(), flecks: flecks(),
  };
  const b = { wood: btn(PAL.n, PAL.N, PAL.D, PAL.d), leaf: btn(PAL.g, PAL.G, PAL.H, PAL.h), berry: btn(PAL.r, PAL.R, '#a82f33', '#7d2028'), gold: btn(PAL.y, PAL.Y, PAL.Z, '#96640f'), sky: btn(PAL.b, PAL.B, PAL.C, '#2c5d94'), paper: btn(PAL.p, PAL.P, PAL.Q, PAL.q) };
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(f)) root.setProperty(`--f-${k}`, `url(${v})`);
  for (const [k, v] of Object.entries(b)) { root.setProperty(`--b-${k}`, `url(${v.up})`); root.setProperty(`--b-${k}-down`, `url(${v.down})`); }
  const fit = () => root.setProperty('--u', (innerWidth < 380 ? 2 : innerWidth >= 1700 ? 4 : 3) + 'px');
  fit();
  addEventListener('resize', fit);
}
