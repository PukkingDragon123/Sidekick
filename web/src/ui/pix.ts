import { hasSprite, spriteURL } from '../tbme/sprites.js';
import goofy from '../tbme/fonts/TBMEGoofy-Regular.woff2?url';
import { woodCss } from './woodkit.ts';
import { TITLE_CSS } from './title.tsx';
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
/** Icons come from The Bear Must Eat's sprite library where it has a match; the rest are our own. */
const TBME_ICON: Record<string, string> = {
  tasks: 'clipboard', chat: 'speech', quests: 'map', shop: 'shop', bag: 'briefcase', shirt: 'tophat', garden: 'flower', paw: 'sticker_paw',
  gear: 'gear', bell: 'bell', coin: 'coin', flame: 'campfire', heart: 'heart', star: 'star', clock: 'clock', check: 'check', plus: 'plus',
  close: 'cross', lock: 'lock', board: 'grade', people: 'idbadge', calendar: 'calendar', timer: 'hourglass', spark: 'sparkle', copy: 'paperclip',
  pin: 'pushpin', trash: 'trash', rotate: 'rotate_right', tree: 'tree', bolt: 'bolt', apple: 'berry', arrow: 'arrow_right', sun: 'sun',
  sound: 'speaker_on', cloud: 'save', device: 'camera', gem: 'crown',
};
export function iconUrl(name: string): string {
  let u = iconUrls.get(name);
  if (!u) {
    const tb = TBME_ICON[name];
    const dk = Math.max(1, Math.min(3, Math.round(window.devicePixelRatio || 1)));
    if (tb && hasSprite(tb)) u = spriteURL(tb, 2 * dk);
    else {
      const art = ICON_ART[name] ?? ICON_ART.star;
      u = toUrl(12, 12, (x, y) => PAL[art[y][x]] ?? null);
    }
    iconUrls.set(name, u!);
  }
  return u!;
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
    tail: toUrl(7, 4, (x, y) => { const a = ['KWWWWWK', '.KWWWK.', '..KWK..', '...K...'][y][x]; return a === '.' ? null : PAL[a]; }),
  };
  const b = { wood: btn(PAL.n, PAL.N, PAL.D, PAL.d), leaf: btn(PAL.g, PAL.G, PAL.H, PAL.h), berry: btn(PAL.r, PAL.R, '#a82f33', '#7d2028'), gold: btn(PAL.y, PAL.Y, PAL.Z, '#96640f'), sky: btn(PAL.b, PAL.B, PAL.C, '#2c5d94'), paper: btn(PAL.p, PAL.P, PAL.Q, PAL.q) };
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(f)) root.setProperty(`--f-${k}`, `url(${v})`);
  for (const [k, v] of Object.entries(b)) { root.setProperty(`--b-${k}`, `url(${v.up})`); root.setProperty(`--b-${k}-down`, `url(${v.down})`); }
  // the handcrafted wood kit and the game font sit on top of the base styles
  const st = document.createElement('style');
  st.id = 'woodkit';
  st.textContent = `@font-face{font-family:'TBME Goofy';src:url(${goofy}) format('woff2');font-display:block}` + woodCss() + EXTRA + TITLE_CSS;
  document.head.appendChild(st);
  const fit = () => root.setProperty('--u', (innerWidth < 380 ? 2 : innerWidth >= 1700 ? 4 : 3) + 'px');
  fit();
  addEventListener('resize', fit);
}

/** Type and layout adjustments for the wood kit (loaded after the base stylesheet). */
const EXTRA = `
body{font-family:'TBME Goofy','Pixelify Sans',system-ui,sans-serif;font-size:18px;line-height:1.25;-webkit-font-smoothing:none}
.num,.price,.badge,.cell .cnt{font-family:'TBME Goofy',monospace !important}
.small{font-size:15px}.ttl{font-size:18px}.meta{font-size:15px}
.sheet>header h2{font-size:30px;color:#ffe9b0;text-shadow:0 2px 0 #3b2212,0 4px 0 #24150d;letter-spacing:1px}
h3{font-size:18px;color:#6e4326}
.btn{font-size:17px;text-shadow:0 2px 0 #0006}
img.ico{width:32px;height:32px;image-rendering:pixelated}img.ico.s{width:22px;height:22px}
.logo{font-family:'TBME Goofy';font-size:68px;letter-spacing:2px}
.dock{gap:6px;align-items:flex-end;padding:0 6px}
.tok{position:relative;display:flex;flex-direction:column;align-items:center;background:none;border:0;padding:0;cursor:pointer;color:#3b2212;width:78px}
.tok .disc{width:68px;height:68px;background:var(--tok) 0 0/100% 100%;image-rendering:pixelated;display:grid;place-items:center;filter:drop-shadow(0 4px 0 #24150d88);transition:transform .12s steps(3)}
.tok .disc img{width:44px;height:44px;image-rendering:pixelated;filter:drop-shadow(0 2px 0 #3b2212)}
.tok:hover .disc{transform:translateY(-3px) rotate(-3deg)}
.tok:active .disc,.tok.on .disc{transform:translateY(3px) scale(.96)}
.tok .lab{margin-top:-8px;padding:1px 8px 2px;background:#f6e7c3;border:2px solid #24150d;box-shadow:0 2px 0 #b5935c;font-size:15px;line-height:1.1;transform:rotate(-2deg);white-space:nowrap}
.tok:nth-child(even) .lab{transform:rotate(2deg)}
.tok .badge{top:-4px;right:2px}
.wallet-hud{display:flex;align-items:flex-start;gap:2px;pointer-events:auto}
.wallet-hud button{border:0;padding:0;background:transparent no-repeat 0 0/100% 100%;image-rendering:pixelated;cursor:pointer;position:relative;filter:drop-shadow(0 3px 0 #24150d66)}
.wallet{animation:walletBump .45s steps(5)}
.wnum{position:absolute;left:0;right:0;bottom:12px;text-align:center;font-family:'TBME Goofy';font-size:24px;color:#ffe08a;text-shadow:0 2px 0 #4a2112,2px 0 0 #2a120a,-2px 0 0 #2a120a,0 -2px 0 #2a120a,0 3px 0 #2a120a;letter-spacing:1px}
.wsmall{display:flex;flex-direction:column;align-items:center;gap:2px;margin-left:-6px}
.wsmall .candle{margin-top:-4px}
.wtag{position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);min-width:26px;padding:0 5px;background:#f6e7c3;border:2px solid #24150d;box-shadow:0 2px 0 #b5935c;font-family:'TBME Goofy';font-size:15px;line-height:17px;color:#3b2212;white-space:nowrap}
.link-dot{width:28px;height:28px;display:grid;place-items:center;margin-top:6px}
.link-dot img.ico.s{width:20px;height:20px}
@keyframes walletBump{40%{transform:translateY(-6px) rotate(-3deg)}70%{transform:translateY(2px) rotate(1deg)}}
@media (max-width:420px){.wallet-hud{transform:scale(.86);transform-origin:top right}}

`;
