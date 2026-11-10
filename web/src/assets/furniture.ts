// Garden furniture, decorations and plants in pots: all blocky box models with painted pixel
// textures, built to the same scale and palette as the forest and the animals.
import { box, lean, place, type BoxSpec, type Painter, type Vec3 } from '../gfx/box.ts';
import { ramp, tone } from '../gfx/color.ts';
import { bark, bricks, cloth, dirt, flat, lamp, leaves, lvl, metal, R, rock, smooth, solid, wood, type Tint } from '../gfx/mats.ts';
import { hash } from '../gfx/noise.ts';
import { daisy, PAL, toadstool, tulip } from './nature.ts';

export type Anchor = { x: number; y: number; z: number; rot?: number };
export type ItemCat = 'seating' | 'tables' | 'lights' | 'plants' | 'decor' | 'play' | 'garden';

export interface ItemDef {
  id: string;
  name: string;
  cat: ItemCat;
  price: number;
  gems?: number;
  level?: number;
  blurb: string;
  build(): BoxSpec[];
  /** interaction anchors in px, model space; rot in degrees, 0 faces +z */
  sit?: Anchor[];
  sleep?: Anchor;
  eat?: Anchor;
  play?: Anchor;
  /** point light for the night glow */
  light?: { x: number; y: number; z: number; color: number; power: number };
  /** animals may walk through it (rugs, stepping stones, arches) */
  flatItem?: boolean;
}

const W = { oak: '#b87a41', dark: '#7b4b2c', light: '#dcab68', pale: '#ead3a4', red: '#b84a3b', white: '#f2ede2', blue: '#5f8fc9' };
const GOLD = '#f2b632';
const wx = (c: Tint, plank = 3, seed = 0) => wood(c, { axis: 'x', plank, seed });
const wy = (c: Tint, plank = 0, seed = 0) => wood(c, { axis: 'y', plank, seed });
const wz = (c: Tint, plank = 3, seed = 0) => wood(c, { axis: 'z', plank, seed });
const turn = (boxes: BoxSpec[], rot: Vec3, pivot: Vec3): BoxSpec[] => boxes.map((b) => ({ ...b, rot, pivot }));

const water = (c: Tint = '#58bfe0'): Painter => {
  const r = R(c);
  return (t) => {
    const d = (Math.floor(t.x) + Math.floor(t.z) * 2 + 200) % 7;
    return tone(r, (d === 0 ? 1.6 : d === 3 ? 0.6 : -0.2) + (t.face === 2 ? 0.3 : -0.8) + (hash(Math.floor(t.x), 0, Math.floor(t.z), 5) > 0.94 ? 2 : 0));
  };
};
const terracotta = (c: Tint = '#c9683f'): Painter => solid(c, { noise: 0.5, scale: 2 });
const pot = (x: number, z: number, w: number, h: number, c: Tint = '#c9683f'): BoxSpec[] => [
  box(x, 0, z, w - 1, h - 1, w - 1, terracotta(c), { skip: 'd' }), box(x, h - 2, z, w, 2, w, terracotta(c)), box(x, h - 0.6, z, w - 2, 1, w - 2, dirt('#5c3d2a'), { skip: 'd' }),
];
const wicker = (c: Tint = '#c99a55'): Painter => {
  const r = R(c);
  return (t) => tone(r, lvl(t, { noise: 0.2 }) + ((t.u + Math.floor(t.v / 2) * 2) % 4 < 2 ? 0.6 : -0.8) + (t.v % 2 ? 0 : -0.3));
};
const book = (c: Tint): Painter => {
  const r = R(c), page = R('#f6efdc');
  return (t) => (t.face === 4 || t.face === 0 ? tone(page, (t.v % 2 ? 0.3 : -0.6)) : tone(r, lvl(t, { noise: 0.2 }) + (t.face === 5 && (t.u === 1 || t.u === t.w - 2) ? 1.5 : 0)));
};

const items: ItemDef[] = [];
const add = (d: ItemDef) => items.push(d);

// ------------------------------------------------------------------ seating

add({
  id: 'bench', name: 'Wooden Bench', cat: 'seating', price: 120, blurb: 'Room for two and a snack.',
  sit: [{ x: -5, y: 7, z: 0.5 }, { x: 5, y: 7, z: 0.5 }],
  build: () => [
    box(0, 5, 0, 22, 2, 7, wx(W.oak, 3)),
    ...[-9, 9].flatMap((x) => [box(x, 0, 2.5, 2, 5, 2, wy(W.dark)), box(x, 0, -2.5, 2, 5, 2, wy(W.dark)), lean(box(x, 6, -3, 2, 9, 2, wy(W.dark)), -8, 0, 0),
      box(x * 1.11, 9, 0.5, 2, 1, 7, wz(W.oak, 0)), box(x * 1.11, 7, 3, 2, 2, 2, wy(W.dark))]),
    { ...box(0, 9, -3.9, 18, 2, 1, wx(W.oak, 0, 1)), rot: [-8, 0, 0] }, { ...box(0, 12, -4.3, 18, 2, 1, wx(W.oak, 0, 2)), rot: [-8, 0, 0] },
  ],
});

add({
  id: 'stool', name: 'Log Stool', cat: 'seating', price: 40, blurb: 'A stump with ambitions.',
  sit: [{ x: 0, y: 6, z: 0 }],
  build: () => {
    const b = bark(PAL.barkOak, { seed: 3, moss: PAL.moss, mossTo: 7 }), top = wood('#dcab68', { axis: 'y', rings: true });
    return [box(0, 0, 0, 8, 6, 8, (t) => (t.face === 2 ? top(t) : b(t)), { skip: 'd' }), ...place(toadstool(4, '#da4230', 0.6), 4.5, 0, 3)];
  },
});

add({
  id: 'chair', name: 'Heart Chair', cat: 'seating', price: 90, blurb: 'Hand-carved, slightly wonky.',
  sit: [{ x: 0, y: 7, z: 0.5 }],
  build: () => {
    const heart: Painter = (t) => {
      const x = Math.abs(t.bx - 4), y = t.by - 2.2;
      const inHeart = t.face >= 4 && ((y > 1 && y < 2.6 && x > 0.2 && x < 1.9) || (y <= 1 && y > -0.9 && x < y + 1.1));
      return inHeart ? -1 : wy(W.light, 2)(t);
    };
    return [
      box(0, 5, 0, 8, 2, 8, wx(W.light, 3)), ...[[-3, 3], [3, 3], [-3, -3], [3, -3]].map(([x, z]) => box(x, 0, z, 2, 5, 2, wy(W.oak))),
      ...[-3, 3].map((x) => box(x, 7, -3.4, 2, 9, 1.4, wy(W.oak))), box(0, 9, -3.4, 8, 6, 1, heart, { cut: true }),
    ];
  },
});

add({
  id: 'cushion', name: 'Floor Cushion', cat: 'seating', price: 60, blurb: 'Nap-rated.',
  sit: [{ x: 0, y: 4, z: 0 }], sleep: { x: 0, y: 4, z: 0, rot: 90 },
  build: () => [box(0, 0, 0, 11, 3, 11, cloth('#e7697f', { check: '#f6a0b0' }), { skip: 'd' }), box(0, 3, 0, 9, 1, 9, cloth('#e7697f', { check: '#f6a0b0' }), { skip: 'd' }), box(0, 4, 0, 1, 1, 1, flat('#fbf1e6'))],
});

add({
  id: 'hammock', name: 'Hammock', cat: 'seating', price: 320, level: 3, blurb: 'Productivity is cancelled.',
  sleep: { x: 0, y: 8, z: 0, rot: 90 },
  build: () => {
    const out: BoxSpec[] = [], c = cloth('#f3ead6', { stripe: '#3f9fa8', stripeEvery: 99 });
    const stripes: Painter = (t) => (Math.floor(t.z + 20) % 4 < 2 ? tone(R('#3f9fa8'), lvl(t, { noise: 0.2 })) : c(t));
    for (const s of [-1, 1]) {
      out.push(lean(box(s * 17, 0, 0, 3, 19, 3, wy(W.dark)), 0, 0, s * 9), box(s * 17, 0, 0, 6, 2, 6, rock(PAL.stone, { seed: 2, moss: PAL.moss }), { skip: 'd' }));
      out.push({ ...box(s * 14.8, 13, 0, 5, 1, 1, solid('#d9c7a0', { noise: 0 })), rot: [0, 0, -s * 38] });
    }
    for (let i = 0; i < 6; i++) {
      const x0 = -12.5 + i * 5, mid = x0, y = 6.5 + 6 * (mid / 13) ** 2, slope = (Math.atan((12 * mid) / 169) * 180) / Math.PI;
      out.push({ ...box(mid, y, 0, 5.6, 1, 10, stripes), rot: [0, 0, slope] });
    }
    return out;
  },
});

add({
  id: 'swing', name: 'Tree Swing', cat: 'play', price: 380, level: 4, blurb: 'Wheee. Again.',
  sit: [{ x: 0, y: 6, z: 0 }], play: { x: 0, y: 6, z: 0 },
  build: () => {
    const out: BoxSpec[] = [];
    for (const s of [-1, 1]) {
      out.push({ ...box(s * 10, 0, 5, 2, 26, 2, wy(W.dark)), rot: [-14, 0, 0], pivot: [s * 10, 0, 5] }, { ...box(s * 10, 0, -5, 2, 26, 2, wy(W.dark)), rot: [14, 0, 0], pivot: [s * 10, 0, -5] });
      out.push(box(s * 5, 6, 0, 1, 18, 1, solid('#d9c7a0', { noise: 0.2 })));
    }
    out.push(box(0, 24, 0, 24, 2, 2, wx(W.oak, 0)), box(0, 5, 0, 12, 1, 5, wx(W.red, 0)));
    return out;
  },
});

add({
  id: 'picnic', name: 'Picnic Blanket', cat: 'seating', price: 180, blurb: 'Basket included. Ants not included.',
  flatItem: true, sit: [{ x: -7, y: 1, z: 3, rot: 60 }, { x: 5, y: 1, z: 6, rot: -30 }], eat: { x: -1, y: 1, z: 1 },
  build: () => [
    box(0, 0, 0, 28, 1, 22, cloth('#e25555', { check: '#fbf1e6' }), { skip: 'd' }),
    box(8, 1, -4, 8, 5, 6, wicker()), box(8, 5.4, -4, 9, 1, 7, wicker('#b98445')), box(8, 6, -4, 7, 1, 5, cloth('#fbf1e6', { check: '#e25555' })),
    box(8, 6, -4, 1, 4, 1, wicker('#b98445')), box(8, 10, -4, 8, 1, 1, wicker('#b98445')),
    { ...box(10, 6, -4, 2, 2, 9, solid('#e0a85a', { noise: 0.8, scale: 1.4 })), rot: [-38, 20, 0] },
    box(-3, 1, 0, 5, 1, 5, smooth('#fbfbff')), ...place(FOODS_BUILD.sandwich(), -3, 2, 0), box(1.5, 1, 4, 2, 3, 2, smooth('#f26d6d')), box(1.5, 4, 4, 1, 1, 1, flat('#5aa83f')),
  ],
});

// ------------------------------------------------------------------ tables

add({
  id: 'table', name: 'Picnic Table', cat: 'tables', price: 200, blurb: 'Sturdy enough for group projects.',
  eat: { x: 0, y: 0, z: 11, rot: 180 },
  build: () => [
    box(0, 9, 0, 24, 2, 13, wx(W.oak, 3)),
    ...[-8, 8].flatMap((x) => [{ ...box(x, -1, 0, 2, 13, 2, wy(W.dark)), rot: [36, 0, 0] as Vec3 }, { ...box(x, -1, 0, 2, 13, 2, wy(W.dark)), rot: [-36, 0, 0] as Vec3 }]),
    box(0, 4.5, 0, 16, 1.4, 1.4, wx(W.dark, 0)),
    box(-7, 11, -2, 3, 3, 3, smooth('#7fb7e6')), ...place(daisy(3), -7, 13, -2), box(5, 11, 1, 5, 1, 5, smooth('#fbfbff')),
  ],
});

add({
  id: 'teatable', name: 'Tea Table', cat: 'tables', price: 260, level: 2, blurb: 'Two cups. One is for you.',
  eat: { x: 0, y: 0, z: 10, rot: 180 },
  build: () => {
    const china: Painter = (t) => (hash(Math.floor(t.x * 1.3 + 40), Math.floor(t.y * 1.3), Math.floor(t.z * 1.3 + 40), 8) > 0.74 ? tone(R('#3b6fc4'), 0.2) : tone(R('#f6f7ff'), lvl(t, { noise: 0.1 })));
    const tea: Painter = (t) => (t.face === 2 && t.u > 0 && t.u < t.w - 1 && t.v > 0 && t.v < t.h - 1 ? tone(R('#b5702e'), 0.5) : china(t));
    return [
      box(0, 6, 0, 13, 2, 13, wood(W.light, { axis: 'x', plank: 4 })), box(0, 2, 0, 4, 4, 4, wy(W.oak)), box(0, 0, 0, 8, 2, 8, wy(W.oak), { skip: 'd' }),
      box(0, 8, -1, 5, 4, 5, china), box(0, 12, -1, 3, 1, 3, china), box(0, 13, -1, 1, 1, 1, flat('#3b6fc4')),
      { ...box(3.6, 9.6, -1, 3, 1.4, 1.4, china), rot: [0, 0, 26] }, box(-3.2, 9, -1, 1, 3, 1.4, china),
      box(4, 8, 4, 3, 2, 3, tea), box(-4, 8, 3.5, 3, 2, 3, tea), box(-4, 8, -4.5, 4, 1, 4, china), box(-4, 9, -4.5, 2, 1, 2, smooth('#f4a7c0')),
    ];
  },
});

add({
  id: 'desk', name: 'Study Desk', cat: 'tables', price: 340, level: 2, blurb: 'Where the homework fears to be.',
  sit: [{ x: -2, y: 0, z: 9, rot: 180 }],
  light: { x: 7, y: 17, z: -2, color: 0xffd98a, power: 0.8 },
  build: () => {
    const drawer: Painter = (t) => {
      if (t.face !== 4) return wy(W.dark)(t);
      const edge = t.u === 0 || t.u === t.w - 1 || t.v === 0 || t.v === t.h - 1 || t.v === Math.floor(t.h / 2);
      if (Math.abs(t.u - t.w / 2 + 0.5) < 1 && (t.v === 1 || t.v === t.h - 2)) return tone(ramp(0xf2b632), 1);
      return tone(R(W.dark), edge ? -1.4 : 0.4);
    };
    return [
      box(0, 9, 0, 20, 2, 10, wx(W.oak, 3)), ...[[-8.5, 3.5], [-8.5, -3.5], [8.5, -3.5]].map(([x, z]) => box(x, 0, z, 2, 9, 2, wy(W.dark))), box(6, 2, 0, 7, 7, 9, drawer),
      box(-6, 11, -2, 6, 2, 4, book('#d8433f')), box(-6, 13, -2, 5, 1, 4, book('#3f78c9')), { ...box(-5.6, 14, -2, 5, 2, 4, book('#57a84a')), rot: [0, 14, 0] },
      { ...box(-0.5, 11, 1.5, 3, 1, 4, smooth('#fbf6ea')), rot: [0, 0, 10] }, { ...box(2.4, 11, 1.5, 3, 1, 4, smooth('#fbf6ea')), rot: [0, 0, -10] },
      box(1, 11, -3, 2, 3, 2, smooth('#6fd3b0')), box(0.6, 14, -3, 1, 2, 1, flat('#f6c531')), box(1.5, 14, -2.6, 1, 3, 1, flat('#e5484d')),
      box(7, 11, -2, 3, 1, 3, metal('#6b7280')), { ...box(7, 12, -2, 1, 5, 1, metal('#6b7280')), rot: [0, 0, 14] }, box(6, 16, -2, 4, 2, 4, smooth('#3fa37a')), box(6, 15.6, -2, 2, 1, 2, lamp('#ffe9a8'), { glow: true }),
    ];
  },
});

// ------------------------------------------------------------------ lights

add({
  id: 'lanternpost', name: 'Lantern Post', cat: 'lights', price: 150, blurb: 'Glows when the sun clocks off.',
  light: { x: 5, y: 13, z: 0, color: 0xffc66b, power: 1.4 },
  build: () => [
    box(0, 0, 0, 5, 2, 5, rock(PAL.stone, { seed: 4, moss: PAL.moss }), { skip: 'd' }), box(0, 2, 0, 2, 18, 2, wy(W.dark)), box(2.5, 18, 0, 8, 2, 2, wx(W.dark, 0)),
    { ...box(1.6, 15, 0, 1, 4, 1, wy(W.dark)), rot: [0, 0, -45] }, box(5, 16.4, 0, 1, 2, 1, metal('#4b4f5c')),
    box(5, 15.6, 0, 5, 1, 5, metal('#4b4f5c')), box(5, 11, 0, 3, 5, 3, lamp('#ffd27a'), { glow: true }), box(5, 10, 0, 5, 1, 5, metal('#4b4f5c')),
    ...[[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]].map(([x, z]) => box(5 + x * 1.2, 11, z * 1.2, 1, 5, 1, metal('#4b4f5c'))),
  ],
});

add({
  id: 'stonelantern', name: 'Stone Lantern', cat: 'lights', price: 280, level: 3, blurb: 'Mossy and wise.',
  light: { x: 0, y: 12, z: 0, color: 0xffe2a0, power: 1.2 },
  build: () => {
    const st = rock('#9a9ea8', { seed: 7, moss: PAL.moss });
    const win: Painter = (t) => (t.face !== 2 && t.face !== 3 && t.u > 0 && t.u < t.w - 1 && t.v > 0 && t.v < t.h - 1 ? -1 : st(t));
    return [
      box(0, 0, 0, 8, 2, 8, st, { skip: 'd' }), box(0, 2, 0, 4, 6, 4, st), box(0, 8, 0, 8, 1, 8, st), box(0, 9, 0, 6, 5, 6, win, { cut: true }),
      box(0, 9.5, 0, 4, 4, 4, lamp('#ffdf8a'), { glow: true }), box(0, 14, 0, 11, 2, 11, st), box(0, 16, 0, 7, 1, 7, st, { skip: 'd' }), box(0, 17, 0, 2, 2, 2, st, { skip: 'd' }),
    ];
  },
});

add({
  id: 'paperlantern', name: 'Festival Lantern', cat: 'lights', price: 210, blurb: 'Warm red glow, zero fire risk.',
  light: { x: 0, y: 12, z: 0, color: 0xff8a5a, power: 1.2 },
  build: () => {
    const rr = R('#e2463c');
    const paper: Painter = (t) => tone(rr, 1 - Math.abs((t.v + 0.5) / t.h - 0.5) * 2.4 + (t.u % 3 === 0 ? -0.8 : 0.3));
    return [
      box(0, 0, 0, 7, 1, 7, wy(W.dark), { skip: 'd' }), ...[-3, 3].map((x) => box(x, 1, 0, 1, 18, 1, wy(W.dark))), box(0, 18, 0, 8, 1, 2, wx(W.dark, 0)),
      box(0, 16, 0, 1, 2, 1, flat('#3a2a22')), box(0, 15, 0, 4, 1, 4, metal(GOLD)), box(0, 8, 0, 6, 7, 6, paper, { glow: true }), box(0, 9, 0, 7, 5, 7, paper, { glow: true }),
      box(0, 7, 0, 4, 1, 4, metal(GOLD)), box(0, 4, 0, 1, 3, 1, solid('#f2b632', { noise: 0.4 })), box(0, 3, 0, 2, 2, 2, solid('#e2463c', { noise: 0.6 })),
    ];
  },
});

add({
  id: 'campfire', name: 'Campfire', cat: 'lights', price: 240, level: 2, blurb: 'Marshmallows sold separately.',
  light: { x: 0, y: 6, z: 0, color: 0xff9a45, power: 2.2 },
  build: () => {
    const out: BoxSpec[] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, s = 3 + (i % 3);
      out.push({ ...box(Math.cos(a) * 8, -0.5, Math.sin(a) * 8, s, s - 0.5, s, rock(i % 2 ? '#8e93a2' : '#a39a8d', { seed: i })), rot: [0, i * 37, 0] });
    }
    const lg = bark(PAL.barkOak, { seed: 5, axis: 'x' });
    out.push({ ...box(0, 0, 0, 12, 3, 3, lg), rot: [0, 30, 12] }, { ...box(0, 0, 0, 12, 3, 3, lg), rot: [0, -40, -12] }, { ...box(0, 1.5, 0, 11, 3, 3, lg), rot: [0, 95, 10] });
    const f = (c: string) => lamp(c);
    out.push(box(0, 2, 0, 6, 4, 6, f('#f2622e'), { glow: true }), box(0.5, 5, -0.5, 4, 4, 4, f('#f99b2c'), { glow: true }), box(-0.5, 8, 0.5, 3, 3, 3, f('#fdd24a'), { glow: true }), box(0.5, 11, 0, 1, 2, 1, f('#fff0a0'), { glow: true }));
    return out;
  },
});

add({
  id: 'mushroomlamp', name: 'Mushroom Lamp', cat: 'lights', price: 190, blurb: 'Night-light, forest edition.',
  light: { x: 0, y: 9, z: 0, color: 0x8fe8ff, power: 1.1 },
  build: () => {
    const cr = R('#6fd8f2');
    const cap: Painter = (t) => (t.face === 3 ? tone(cr, 1.8) : hash(Math.floor(t.x / 2), Math.floor(t.y / 2), Math.floor(t.z / 2), 3) > 0.66 ? tone(R('#f4feff'), 1) : tone(cr, lvl(t, { noise: 0.4 }) - 0.3));
    return [box(0, 0, 0, 4, 7, 4, solid('#eef6f8', { noise: 0.3 }), { skip: 'd' }), box(0, 0, 0, 6, 2, 6, solid('#dfeef2', { noise: 0.3 }), { skip: 'd' }),
      box(0, 7, 0, 12, 3, 12, cap, { glow: true }), box(0, 10, 0, 9, 2, 9, cap, { glow: true, skip: 'd' }), box(0, 12, 0, 5, 1, 5, cap, { glow: true, skip: 'd' })];
  },
});

// ------------------------------------------------------------------ garden structures

add({
  id: 'fence', name: 'Picket Fence', cat: 'garden', price: 35, blurb: 'Keeps the tulips in line.',
  build: () => [
    ...[-7, 7].flatMap((x) => [box(x, 0, 0, 2, 10, 2, wy(W.white)), box(x, 10, 0, 1, 1, 1, wy(W.white))]),
    box(0, 6, 0, 14, 2, 1, wx(W.white, 0)), box(0, 2, 0, 14, 2, 1, wx(W.white, 0)),
    ...[-3.5, 0, 3.5].flatMap((x) => [box(x, 0.5, 0.8, 2, 8, 1, wy(W.white)), box(x, 8.5, 0.8, 1, 1, 1, wy(W.white))]),
  ],
});

add({
  id: 'arch', name: 'Rose Arch', cat: 'garden', price: 520, level: 5, blurb: 'A doorway to nowhere in particular.',
  flatItem: true,
  build: () => {
    const out: BoxSpec[] = [], w = wy(W.white), lf = leaves('#4f9e45', { seed: 6, bloom: '#f0597e', rate: 0.12 });
    for (const s of [-1, 1]) {
      for (const z of [-2.5, 2.5]) out.push(box(s * 10, 0, z, 1.6, 24, 1.6, w));
      for (let y = 3; y < 24; y += 5) out.push(box(s * 10, y, 0, 1, 1, 5, w));
      for (let i = 0; i < 9; i++) out.push(box(s * (10 + (hash(i, s, 0, 2) - 0.5) * 2), 1 + i * 2.6, (hash(i, s, 1, 2) - 0.5) * 6, 4, 4, 4, lf, { sway: 0.2 }));
    }
    for (const z of [-2.5, 2.5]) out.push(box(0, 24, z, 22, 1.6, 1.6, w), box(0, 26, z, 15, 1.6, 1.6, w), box(0, 27.6, z, 8, 1.4, 1.6, w));
    for (let i = 0; i < 11; i++) out.push(box(-10 + i * 2 + (hash(i, 3, 0, 2) - 0.5), 24 + Math.sin((i / 10) * Math.PI) * 4 + hash(i, 4, 0, 2) * 2, (hash(i, 5, 0, 2) - 0.5) * 6, 4, 4, 4, lf, { sway: 0.2 }));
    return out;
  },
});

add({
  id: 'signpost', name: 'Signpost', cat: 'garden', price: 80, blurb: 'Points at naps and snacks.',
  build: () => {
    const board = (dir: number): Painter => (t) => {
      const tip = dir > 0 ? t.w - 1 - t.u : t.u;
      if (t.face >= 4 && tip < Math.abs(t.v + 0.5 - t.h / 2) - 0.2) return -1;
      if (t.face === 4 && t.v === 1 && tip > 2 && t.u % 4 !== 3 && tip < t.w - 2) return tone(R(W.dark), -1.6);
      return wx(W.light, 0)(t);
    };
    return [box(0, 0, 0, 2, 18, 2, wy(W.dark)), box(0, 0, 0, 5, 1, 5, rock(PAL.stone, { seed: 2 }), { skip: 'd' }),
      { ...box(3, 12, 1, 12, 4, 1, board(1), { cut: true }), rot: [0, -12, 3] }, { ...box(-3, 7, 1, 11, 4, 1, board(-1), { cut: true }), rot: [0, 10, -4] }, box(0, 18, 0, 3, 1, 3, wy(W.dark))];
  },
});

add({
  id: 'mailbox', name: 'Mailbox', cat: 'garden', price: 110, blurb: 'Reminders arrive here first.',
  build: () => {
    const rr = R('#d8433f');
    const body: Painter = (t) => {
      if (t.face === 4) {
        const edge = t.u === 0 || t.u === t.w - 1 || t.v === 0 || t.v === t.h - 1;
        return edge ? tone(rr, -1.6) : t.u === t.w - 2 && t.v === 2 ? tone(ramp(0xf2b632), 1.4) : tone(rr, 0.3);
      }
      return tone(rr, lvl(t, { noise: 0.2 }));
    };
    return [box(0, 0, 0, 2, 9, 2, wy(W.dark)), box(0, 9, 0, 6, 5, 10, body), box(0, 14, 0, 4, 1, 10, body, { skip: 'd' }),
      box(3.5, 10, 2, 1, 5, 1, metal(GOLD)), box(3.5, 14, 0.8, 1, 2, 3, solid('#f26d4f', { noise: 0.2 })), { ...box(0, 10.5, 5.3, 4, 3, 1, smooth('#fbf6ea')), rot: [-20, 0, 0] }, box(0, 11.6, 5.9, 1, 1, 1, flat('#d8433f'))];
  },
});

add({
  id: 'well', name: 'Wishing Well', cat: 'garden', price: 480, level: 4, blurb: 'Accepts coins. Returns nothing.',
  build: () => {
    const br = bricks('#9aa0ab', { w: 5, h: 3, seed: 3 });
    return [
      box(0, 0, 5, 12, 7, 2, br), box(0, 0, -5, 12, 7, 2, br), box(5, 0, 0, 2, 7, 8, br), box(-5, 0, 0, 2, 7, 8, br), box(0, 4, 0, 8, 1, 8, water('#3f9fd0')),
      box(0, 7, 5, 13, 1, 3, rock('#a8adb8', { seed: 1, moss: PAL.moss })), box(0, 7, -5, 13, 1, 3, rock('#a8adb8', { seed: 2, moss: PAL.moss })),
      ...[-5.5, 5.5].map((x) => box(x, 7, 0, 2, 13, 2, wy(W.dark))), box(0, 16, 0, 11, 1, 1, wx(W.dark, 0)), box(0, 9, 0, 1, 7, 1, solid('#d9c7a0', { noise: 0.2 })),
      box(0, 6, 0, 4, 3, 4, wy(W.oak, 2)), box(0, 7, 0, 4.4, 1, 4.4, metal('#6b7280')),
      { ...box(0, 20, 4.4, 16, 1.6, 9, wx(W.red, 3)), rot: [38, 0, 0] }, { ...box(0, 20, -4.4, 16, 1.6, 9, wx(W.red, 3)), rot: [-38, 0, 0] }, box(0, 23.4, 0, 17, 1.4, 1.4, wx(W.dark, 0)),
    ];
  },
});

add({
  id: 'birdhouse', name: 'Birdhouse', cat: 'garden', price: 170, blurb: 'Small birds, big opinions.',
  build: () => {
    const wall: Painter = (t) => (t.face === 4 && Math.hypot(t.u + 0.5 - t.w / 2, t.v - 3) < 1.5 ? 0x2a1c18 : wy('#8fc4e6', 2)(t));
    return [box(0, 0, 0, 2, 18, 2, wy(W.dark)), box(0, 18, 0, 9, 1, 9, wx(W.oak, 3)), box(0, 19, 0, 6, 6, 6, wall), box(0, 20, 3.8, 1, 1, 2, wy(W.dark)),
      { ...box(-2.4, 25, 0, 6, 1.6, 9, wz(W.red, 3)), rot: [0, 0, 40] }, { ...box(2.4, 25, 0, 6, 1.6, 9, wz(W.red, 3)), rot: [0, 0, -40] }, box(0, 25, 0, 4, 2, 6, wall)];
  },
});

add({
  id: 'fountain', name: 'Mossy Fountain', cat: 'garden', price: 900, level: 6, blurb: 'The sound of not doing homework.',
  build: () => {
    const br = bricks('#a4a9b4', { w: 6, h: 3, seed: 5 }), st = rock('#a4a9b4', { seed: 4, moss: PAL.moss }), wt = water();
    const fall: Painter = (t) => tone(R('#8fdcf2'), (Math.floor(t.y) % 3 === 0 ? 1.6 : 0.2));
    return [
      box(0, 0, 9, 20, 5, 2, br), box(0, 0, -9, 20, 5, 2, br), box(9, 0, 0, 2, 5, 16, br), box(-9, 0, 0, 2, 5, 16, br),
      box(0, 5, 9, 21, 1, 3, st), box(0, 5, -9, 21, 1, 3, st), box(9, 5, 0, 3, 1, 16, st), box(-9, 5, 0, 3, 1, 16, st),
      box(0, 3, 0, 16, 1, 16, wt), box(0, 0, 0, 5, 12, 5, st), box(0, 12, 0, 11, 2, 11, st), box(0, 14, 0, 12, 1, 12, st), box(0, 14.4, 0, 9, 1, 9, wt, { skip: 'd' }),
      box(0, 14, 0, 2, 5, 2, st), box(0, 19, 0, 3, 1, 3, wt),
      ...[[6, 0, 1, 3], [-6, 0, 1, 3], [0, 6, 3, 1], [0, -6, 3, 1]].map(([x, z, w, d]) => box(x, 4, z, w, 10, d, fall, { glow: true })),
    ];
  },
});

add({
  id: 'stones', name: 'Stepping Stones', cat: 'garden', price: 45, blurb: 'A path, but make it hopscotch.',
  flatItem: true,
  build: () => [[-7, 2, 9, 7, 10], [3, -3, 8, 8, -15], [9, 5, 6, 6, 30]].map(([x, z, w, d, r], i) => ({ ...box(x, -0.4, z, w, 1.4, d, rock(i % 2 ? '#a39a8d' : '#959aa6', { seed: i, moss: PAL.moss })), rot: [0, r, 0] as Vec3 })),
});

add({
  id: 'birdbath', name: 'Bird Bath', cat: 'garden', price: 230, level: 2, blurb: 'A spa for sparrows.',
  build: () => {
    const st = rock('#b0b4be', { seed: 9, moss: PAL.moss });
    return [box(0, 0, 0, 7, 2, 7, st, { skip: 'd' }), box(0, 2, 0, 3, 8, 3, st), box(0, 10, 0, 6, 1, 6, st), box(0, 11, 0, 12, 2, 12, st), box(0, 12.4, 0, 9, 1, 9, water(), { skip: 'd' })];
  },
});

add({
  id: 'banner', name: 'Guild Banner', cat: 'decor', price: 260, level: 3, blurb: 'Your study crest, flying proudly.',
  build: () => {
    const br = R('#3f66c9'), gr = ramp(0xf2b632);
    const flag: Painter = (t) => {
      if (t.face >= 4) {
        if (t.v < 2 && (t.u + (t.v === 0 ? 0 : 1)) % 4 < 2 === (t.v === 0)) return -1;
        if (t.u === 0 || t.u === t.w - 1 || t.v === t.h - 1) return tone(gr, 0.8);
        const dx = Math.abs(t.u + 0.5 - t.w / 2), dy = Math.abs(t.v - t.h * 0.58);
        if (dx + dy < 2.4) return tone(gr, dx + dy < 1.2 ? 1.6 : 0.2);
        return tone(br, lvl(t, { noise: 0.3 }) + (t.u % 3 === 0 ? -0.5 : 0));
      }
      return tone(br, -1);
    };
    return [box(0, 0, 0, 2, 30, 2, wy(W.dark)), box(0, 0, 0, 5, 2, 5, rock(PAL.stone, { seed: 5 }), { skip: 'd' }), box(0, 30, 0, 3, 2, 3, metal(GOLD)), box(3.5, 27, 0, 9, 1.4, 1.4, wx(W.dark, 0)),
      box(4.5, 13, 0.4, 8, 14, 1, flag, { cut: true, sway: 0.15 })];
  },
});

// ------------------------------------------------------------------ potted plants

add({
  id: 'potflowers', name: 'Tulip Pot', cat: 'plants', price: 70, blurb: 'Low effort, high charm.',
  build: () => [...pot(0, 0, 7, 6), ...place(tulip(1, '#e9463f'), -1.5, 5, 0.5), ...place(tulip(2, '#f9cf45'), 1.5, 5, -0.5), ...place(tulip(3, '#f58fb0'), 0, 5, 1.6)],
});

add({
  id: 'cactus', name: 'Brave Cactus', cat: 'plants', price: 95, blurb: 'Hug at your own risk.',
  build: () => {
    const gr = R('#5aa85a');
    const c: Painter = (t) => tone(gr, lvl(t, { noise: 0.3 }) + (t.u % 2 ? -0.7 : 0.4) + (hash(t.u, t.v, t.face, 3) > 0.86 ? 2 : 0));
    return [...pot(0, 0, 7, 5, '#e8e0cf'), box(0, 4, 0, 4, 10, 4, c, { skip: 'd' }), box(0, 14, 0, 2, 1, 2, c, { skip: 'd' }),
      box(3.5, 7, 0, 3, 2, 2, c), box(4, 9, 0, 2, 4, 2, c, { skip: 'd' }), box(-3.5, 9, 0, 3, 2, 2, c), box(-4, 11, 0, 2, 3, 2, c, { skip: 'd' }),
      box(0, 15, 0, 3, 1, 3, smooth('#f58fb0')), box(0, 16, 0, 1, 1, 1, flat('#f6c531')), box(4, 13, 0, 2, 1, 2, smooth('#f58fb0'))];
  },
});

add({
  id: 'bonsai', name: 'Tiny Bonsai', cat: 'plants', price: 300, level: 4, blurb: 'Decades of patience, bought instantly.',
  build: () => {
    const china: Painter = (t) => (t.face !== 2 && (t.u + t.v) % 4 === 0 ? tone(R('#3b6fc4'), 0) : tone(R('#f6f7ff'), lvl(t, { noise: 0.1 })));
    const lf = leaves('#3f8f45', { seed: 9 }), bk = bark('#6a4630', { seed: 2 });
    const out: BoxSpec[] = [box(0, 0, 0, 12, 3, 8, china, { skip: 'd' }), box(0, 2.4, 0, 10, 1, 6, dirt('#5c3d2a'), { skip: 'd' }), box(0, 0, 0, 14, 1, 10, solid('#2f3a4a', { noise: 0.2 }), { skip: 'd' })];
    out.push(lean(box(-2, 3, 0, 3, 6, 3, bk), 0, 0, -22), { ...box(1, 8, 0, 2, 6, 2, bk), rot: [0, 0, -50], pivot: [0, 8, 0] }, { ...box(-1, 8, 0, 2, 5, 2, bk), rot: [0, 0, 35], pivot: [-1, 8, 0] });
    for (const [x, y, z, w, h] of [[5, 10, 0, 8, 4], [-4, 12, 1, 7, 4], [1, 14, -1, 6, 3], [6, 8, 2, 4, 3]] as const) out.push(box(x, y, z, w, h, w, lf, { sway: 0.15 }), box(x, y + h, z, w - 3, 2, w - 3, lf, { sway: 0.15, skip: 'd' }));
    return out;
  },
});

add({
  id: 'planter', name: 'Flower Planter', cat: 'plants', price: 140, blurb: 'A whole meadow, boxed.',
  build: () => [
    box(0, 1, 0, 18, 5, 7, wx(W.oak, 3)), box(0, 5.4, 0, 16, 1, 5, dirt('#5c3d2a'), { skip: 'd' }), ...[-7.5, 7.5].map((x) => box(x, 0, 0, 2, 2, 7, wy(W.dark))),
    ...place(daisy(1), -6, 6, 0), ...place(tulip(2, '#f58fb0'), -2, 6, 1), ...place(daisy(3, '#ffd9e6', '#f59a2f'), 2, 6, -0.5), ...place(tulip(4, '#a57be0'), 6, 6, 0.5),
  ],
});

add({
  id: 'pumpkin', name: 'Plump Pumpkin', cat: 'plants', price: 85, blurb: 'Round, orange, unbothered.',
  build: () => {
    const pr = R('#f08a2c');
    const p: Painter = (t) => tone(pr, lvl(t, { noise: 0.3 }) + ((t.face < 2 ? t.bz : t.bx) % 3 < 1 && t.face !== 2 ? -1.2 : 0.3));
    return [box(0, 0, 0, 10, 7, 10, p, { skip: 'd' }), box(0, 7, 0, 7, 1, 7, p, { skip: 'd' }), { ...box(0, 8, 0, 2, 3, 2, solid('#6a8a3a', { noise: 0.3 })), rot: [0, 0, 16] },
      { ...box(4, 7.4, 2, 5, 1, 4, solid('#5aa83f', { noise: 0.4 })), rot: [0, 30, -14] }, box(7, 0, 5, 5, 4, 5, p, { skip: 'd' }), box(7, 4, 5, 3, 1, 3, p, { skip: 'd' }), box(7, 5, 5, 1, 2, 1, solid('#6a8a3a', { noise: 0.3 }))];
  },
});

// ------------------------------------------------------------------ decor and play

add({
  id: 'ball', name: 'Bouncy Ball', cat: 'play', price: 50, blurb: 'Boing-certified.',
  play: { x: 0, y: 0, z: 0 },
  build: () => {
    const cs = [R('#e5484d'), R('#fbf6ea'), R('#4aa8f0'), R('#f6c531')];
    const p: Painter = (t) => tone(cs[(Math.floor((t.x + 20) / 2.5) + Math.floor((t.z + 20) / 2.5)) % 4], lvl(t, { noise: 0.15 }) + 0.2);
    return [box(0, 1, 0, 7, 5, 7, p), box(0, 0, 0, 5, 1, 5, p, { skip: 'u' }), box(0, 6, 0, 5, 1, 5, p, { skip: 'd' })];
  },
});

add({
  id: 'blocks', name: 'ABC Blocks', cat: 'play', price: 75, blurb: 'Stack them. Knock them. Repeat.',
  play: { x: 0, y: 0, z: 0 },
  build: () => {
    const glyphs: Record<string, string[]> = { A: ['.X.', 'X.X', 'XXX', 'X.X'], B: ['XX.', 'XXX', 'X.X', 'XXX'], C: ['XXX', 'X..', 'X..', 'XXX'] };
    const blk = (c: string, g: string): Painter => {
      const r = R(c), w = R('#fbf6ea');
      return (t) => {
        const edge = t.u === 0 || t.v === 0 || t.u === t.w - 1 || t.v === t.h - 1;
        if (edge) return tone(r, lvl(t, { noise: 0.1 }));
        const gx = t.u - 2, gy = t.h - 2 - t.v;
        const on = gx >= 0 && gx < 3 && gy >= 0 && gy < 4 && glyphs[g][gy][gx] === 'X';
        return on ? tone(r, -0.4) : tone(w, lvl(t, { noise: 0.1 }) * 0.5);
      };
    };
    return [box(-4, 0, 0, 7, 7, 7, blk('#e5484d', 'A')), { ...box(4, 0, 1, 7, 7, 7, blk('#4aa8f0', 'B')), rot: [0, 18, 0] }, { ...box(0, 7, 0, 7, 7, 7, blk('#57b356', 'C')), rot: [0, -12, 0] }];
  },
});

add({
  id: 'books', name: 'Book Tower', cat: 'decor', price: 65, blurb: 'Technically a to-read pile.',
  build: () => ['#d8433f', '#3f78c9', '#f2b632', '#57a84a', '#8d62d6'].map((c, i) => ({ ...box((i % 2) * 0.6 - 0.3, i * 2, 0, 8 - (i % 3), 2, 6, book(c)), rot: [0, (i * 23) % 40 - 20, 0] as Vec3 })),
});

add({
  id: 'easel', name: 'Quest Board', cat: 'decor', price: 160, blurb: 'Today\'s plan, in chalk.',
  build: () => {
    const bd = R('#3f6b57');
    const board: Painter = (t) => {
      if (t.face !== 4) return wy(W.oak)(t);
      const edge = t.u === 0 || t.v === 0 || t.u === t.w - 1 || t.v === t.h - 1;
      if (edge) return tone(R(W.oak), t.v === t.h - 1 ? 0.8 : -0.6);
      const row = t.h - 2 - t.v;
      if (row % 3 === 1 && t.u === 2) return row < 6 ? 0x9be36a : 0xfbf6ea;
      if (row % 3 === 1 && t.u > 3 && t.u < t.w - 2 - (row % 2)) return tone(R('#fbf6ea'), row < 6 ? -1.4 : 0.2);
      return tone(bd, lvl(t, { noise: 0.5, rim: 0, grad: 0 }));
    };
    return [{ ...box(0, 5, 0, 14, 13, 1, board), rot: [-12, 0, 0], pivot: [0, 5, 0] },
      { ...box(-5, 0, 1, 1.6, 20, 1.6, wy(W.dark)), rot: [-12, 0, -5], pivot: [-5, 0, 1] }, { ...box(5, 0, 1, 1.6, 20, 1.6, wy(W.dark)), rot: [-12, 0, 5], pivot: [5, 0, 1] },
      { ...box(0, 0, -5, 1.6, 18, 1.6, wy(W.dark)), rot: [18, 0, 0], pivot: [0, 0, -5] }, { ...box(0, 4.4, 1.6, 15, 1, 2, wx(W.oak, 0)), rot: [-12, 0, 0], pivot: [0, 5, 0] }];
  },
});

add({
  id: 'gnome', name: 'Garden Gnome', cat: 'decor', price: 130, blurb: 'Watches your tulips. Judges nothing.',
  build: () => [
    box(0, 0, 0, 6, 2, 5, smooth('#3a2f2a'), { skip: 'd' }), box(0, 2, 0, 6, 5, 5, smooth('#3f78c9')), box(0, 4, 2.6, 2, 1, 1, metal(GOLD)), box(0, 7, 0, 6, 4, 5, smooth('#f2c9a0')),
    box(0, 5, 2.4, 5, 4, 1, solid('#fbfbff', { noise: 0.6, scale: 1.3 })), box(0, 9, 2.8, 2, 1, 1, smooth('#f2a58a')), box(-1.5, 10, 2.6, 1, 1, 0.4, flat('#2b2026')), box(1.5, 10, 2.6, 1, 1, 0.4, flat('#2b2026')),
    box(0, 11, 0, 7, 2, 6, smooth('#d8433f')), box(0, 13, 0, 5, 3, 4, smooth('#d8433f'), { skip: 'd' }), { ...box(0.5, 16, 0, 3, 3, 3, smooth('#d8433f')), rot: [0, 0, -12] }, { ...box(1.6, 18.6, 0, 1, 2, 1, smooth('#d8433f')), rot: [0, 0, -30] },
  ],
});

add({
  id: 'chest', name: 'Treasure Chest', cat: 'decor', price: 400, level: 5, blurb: 'Full of finished-homework energy.',
  build: () => {
    const band = (base: Painter): Painter => (t) => ((t.face >= 4 || t.face === 2) && (t.u === 2 || t.u === t.w - 3) ? metal(GOLD)(t) : base(t));
    const coin: Painter = (t) => tone(ramp(0xf6c531, { step: 0.08 }), (hash(Math.floor(t.x), Math.floor(t.y * 2), Math.floor(t.z), 2) - 0.4) * 3.4);
    return [box(0, 0, 0, 14, 6, 9, band(wx(W.dark, 3))), box(0, 5.6, 0, 12, 2, 7, coin, { skip: 'd' }), box(3, 7, 1, 2, 2, 2, smooth('#e5484d')), box(-3, 7, -1, 2, 2, 2, smooth('#4aa8f0')),
      { ...box(0, 6, -4.5, 14, 5, 9, band(wx(W.oak, 3))), rot: [-62, 0, 0], pivot: [0, 6, -4.5] }, box(0, 3, 4.7, 2, 3, 1, metal(GOLD))];
  },
});

add({
  id: 'trophy', name: 'Gold Trophy', cat: 'decor', price: 0, gems: 25, blurb: 'For outstanding assignment-slaying.',
  build: () => [box(0, 0, 0, 8, 3, 8, bricks('#9aa0ab', { w: 4, h: 3 }), { skip: 'd' }), box(0, 3, 0, 6, 1, 6, rock('#b0b4be')), box(0, 4, 0, 4, 1, 4, metal(GOLD)), box(0, 5, 0, 2, 3, 2, metal(GOLD)),
    box(0, 8, 0, 6, 5, 6, metal(GOLD)), box(0, 13, 0, 7, 1, 7, metal(GOLD)), box(-4, 9, 0, 2, 3, 1, metal(GOLD)), box(4, 9, 0, 2, 3, 1, metal(GOLD)), box(0, 10, 3.1, 2, 2, 0.4, flat('#fff3b0'))],
});

add({
  id: 'globe', name: 'Desk Globe', cat: 'decor', price: 220, level: 3, blurb: 'Spin it. Point. Go there one day.',
  build: () => {
    const sea = R('#4a9be0'), land = R('#63b556');
    const g: Painter = (t) => (hash(Math.floor(t.x / 2.2 + 30), Math.floor(t.y / 2.2 + 30), Math.floor(t.z / 2.2 + 30), 11) > 0.56 ? tone(land, lvl(t, { noise: 0.4 })) : tone(sea, lvl(t, { noise: 0.2 })));
    return [box(0, 0, 0, 6, 1, 6, wy(W.dark), { skip: 'd' }), box(0, 1, 0, 2, 3, 2, metal(GOLD)), ...turn([box(0, 5, 0, 8, 6, 8, g), box(0, 4, 0, 6, 1, 6, g, { skip: 'u' }), box(0, 11, 0, 6, 1, 6, g, { skip: 'd' })], [0, 0, 18], [0, 8, 0]),
      { ...box(-5.2, 3.6, 0, 1, 10, 1, metal(GOLD)), rot: [0, 0, 18], pivot: [0, 8, 0] }];
  },
});

add({
  id: 'telescope', name: 'Star Telescope', cat: 'decor', price: 360, level: 5, blurb: 'For staring at deadlines from afar.',
  build: () => [
    ...[0, 120, 240].map((a) => ({ ...box(0, 0, 0, 1.4, 12, 1.4, wy(W.dark)), rot: [22, a, 0] as Vec3, pivot: [0, 11, 0] as Vec3 })), box(0, 10, 0, 3, 2, 3, metal('#6b7280')),
    ...turn([box(0, 11, 0, 4, 4, 12, metal('#b9c0cc')), box(0, 11.4, 7, 3, 3, 4, metal(GOLD)), box(0, 11, -7, 5, 5, 2, metal('#4b4f5c')), box(0, 12, 9.2, 1.6, 1.6, 1, flat('#2a3550'))], [-28, 30, 0], [0, 12, 0]),
  ],
});

add({
  id: 'rug', name: 'Woven Rug', cat: 'decor', price: 100, blurb: 'Ties the clearing together.',
  flatItem: true, sit: [{ x: 0, y: 1, z: 0 }], sleep: { x: 0, y: 1, z: 0, rot: 90 },
  build: () => {
    const a = R('#3f9fa8'), b = R('#fbf1e6'), c = R('#e2863a');
    const p: Painter = (t) => {
      const x = Math.floor(t.bx), z = Math.floor(t.bz), ex = Math.min(x, t.sx - 1 - x), ez = Math.min(z, t.sz - 1 - z);
      if (ex === 0 && z % 2 === 0) return -1;
      if (ex < 2 || ez < 1) return tone(c, 0.2);
      const d = (Math.abs(x - t.sx / 2) + Math.abs(z - t.sz / 2));
      return tone(Math.floor(d / 2) % 2 ? a : b, lvl(t, { noise: 0.3, rim: 0 }) * 0.6);
    };
    return [box(0, 0, 0, 24, 1, 16, p, { cut: true, skip: 'd' })];
  },
});

add({
  id: 'wheelbarrow', name: 'Flower Barrow', cat: 'plants', price: 250, level: 3, blurb: 'Retired from work, blooming nicely.',
  build: () => [
    ...turn([box(0, 4, 0, 10, 5, 14, wz(W.oak, 3)), box(0, 8.4, 0, 8, 1, 12, dirt('#5c3d2a'), { skip: 'd' }), box(-4, 5, -11, 1.4, 1.4, 9, wz(W.dark, 0)), box(4, 5, -11, 1.4, 1.4, 9, wz(W.dark, 0)),
      ...place(daisy(5), -2, 9, -3), ...place(tulip(6, '#f9cf45'), 2, 9, 1), ...place(daisy(7, '#ffd9e6', '#f59a2f'), 0, 9, 4), ...place(tulip(8), -2, 9, 3)], [-10, 0, 0], [0, 4, 0]),
    box(0, 0, 7, 2, 6, 6, wood(W.dark, { axis: 'x', rings: true })), box(-3, 0, -5, 1.4, 5, 1.4, wy(W.dark)), box(3, 0, -5, 1.4, 5, 1.4, wy(W.dark)),
  ],
});

add({
  id: 'scarecrow', name: 'Friendly Scarecrow', cat: 'decor', price: 290, level: 4, blurb: 'Scares nothing. Waves at everything.',
  build: () => {
    const sack = solid('#e6cf9a', { noise: 0.5, scale: 1.6 });
    const face: Painter = (t) => (t.face === 4 && ((Math.abs(Math.abs(t.u - 3.5) - 2) < 0.6 && t.v === 4) || (t.v === 2 && Math.abs(t.u - 3.5) < 2.2) || (t.v === 1 && Math.abs(Math.abs(t.u - 3.5) - 2) < 0.6 === false && Math.abs(t.u - 3.5) < 1.2)) ? 0x3a2a22 : sack(t));
    return [box(0, 0, 0, 2, 22, 2, wy(W.dark)), box(0, 14, 0, 22, 2, 2, wx(W.dark, 0)), box(0, 8, 0, 9, 8, 5, cloth('#d8433f', { check: '#a82f33' })),
      box(-7, 13, 0, 6, 3, 3, cloth('#d8433f', { check: '#a82f33' })), box(7, 13, 0, 6, 3, 3, cloth('#d8433f', { check: '#a82f33' })),
      box(-11, 13.4, 0, 3, 2, 2, solid('#e6c26a', { noise: 0.9, scale: 1.2 })), box(11, 13.4, 0, 3, 2, 2, solid('#e6c26a', { noise: 0.9, scale: 1.2 })),
      box(0, 16, 0, 8, 7, 7, face), box(0, 22.4, 0, 14, 1, 13, solid('#d9b25a', { noise: 0.6 })), box(0, 23, 0, 7, 3, 7, solid('#d9b25a', { noise: 0.6 }), { skip: 'd' }), box(0, 23, 0, 7.6, 1, 7.6, cloth('#3f78c9'), { skip: 'ud' })];
  },
});

export const FURNITURE: ItemDef[] = items;
export const ITEM: Record<string, ItemDef> = Object.fromEntries(items.map((i) => [i.id, i]));

// ------------------------------------------------------------------ food

export interface FoodDef {
  id: string;
  name: string;
  price: number;
  /** how much hunger it restores and how happy it makes them, 0..100 */
  fill: number;
  joy: number;
  /** species that go wild for it */
  loved: string[];
  build(): BoxSpec[];
}

const bread = solid('#e0a85a', { noise: 0.7, scale: 1.5 });

/** Builders are declared as functions so furniture above can reference them before FOODS is assembled. */
function foodBuilders() {
  return {
    apple: (): BoxSpec[] => [box(0, 0, 0, 5, 4, 5, smooth('#e5484d')), box(0, 4, 0, 3, 1, 3, smooth('#e5484d'), { skip: 'd' }), box(0, 5, 0, 1, 2, 1, flat('#6a4630')), { ...box(1.4, 6, 0, 2, 1, 1, smooth('#5aa83f')), rot: [0, 0, 20] }, box(-1, 3, 2.3, 1, 1, 0.4, flat('#ffb3a8'))],
    berries: (): BoxSpec[] => [box(0, 0, 0, 7, 2, 7, smooth('#fbf6ea')), box(0, 2, 0, 8, 1, 8, smooth('#f0e6d0')), ...[[-1.5, -1, '#5a6fd8'], [1.5, 0.5, '#d8456a'], [0, 1.6, '#5a6fd8'], [-1, 1, '#d8456a'], [1.4, -1.6, '#8a4fc0']].map(([x, z, c], i) => box(x as number, 3 + (i % 2), z as number, 2, 2, 2, smooth(c as string)))],
    carrot: (): BoxSpec[] => turn([box(0, 0, 0, 2, 3, 2, smooth('#f08a2c')), box(0, 3, 0, 3, 3, 3, smooth('#f08a2c')), box(0, 6, 0, 3, 1, 3, smooth('#e07a22')), box(-0.8, 7, 0, 1, 3, 1, smooth('#5aa83f')), box(0.8, 7, 0.4, 1, 4, 1, smooth('#69b84a')), box(0, 7, -0.8, 1, 2, 1, smooth('#4c9f3c'))], [0, 0, -24], [0, 0, 0]),
    acorn: (): BoxSpec[] => [box(0, 0, 0, 2, 1, 2, smooth('#b9783f')), box(0, 1, 0, 4, 3, 4, smooth('#c98a4a')), box(0, 4, 0, 5, 2, 5, solid('#7a4a2b', { noise: 0.9, scale: 1.2 })), box(0, 6, 0, 1, 1, 1, flat('#5a3a22'))],
    cookie: (): BoxSpec[] => [{ ...box(0, 0, 0, 6, 2, 6, (t) => (hash(Math.floor(t.x + 9), Math.floor(t.y), Math.floor(t.z + 9), 4) > 0.78 ? 0x5a3422 : bread(t))), rot: [0, 0, 0] }, box(0, 2, 0, 4, 0.6, 4, (t) => (hash(Math.floor(t.x + 9), 7, Math.floor(t.z + 9), 4) > 0.6 ? 0x5a3422 : bread(t)), { skip: 'd' })],
    donut: (): BoxSpec[] => {
      const ic = R('#f58fb0'), sp = [0xfbf6ea, 0x6fd3b0, 0xf6c531, 0x7281ea];
      const icing: Painter = (t) => (Math.hypot(t.bx - t.sx / 2, t.bz - t.sz / 2) < 1.2 ? -1 : hash(Math.floor(t.x + 9), Math.floor(t.y), Math.floor(t.z + 9), 6) > 0.8 ? sp[Math.floor(hash(Math.floor(t.x), 1, Math.floor(t.z), 2) * 4)] : tone(ic, lvl(t, { noise: 0.2 })));
      const dough: Painter = (t) => (Math.hypot(t.bx - t.sx / 2, t.bz - t.sz / 2) < 1.2 ? -1 : bread(t));
      return [box(0, 0, 0, 7, 2, 7, dough, { cut: true }), box(0, 2, 0, 7, 1, 7, icing, { cut: true }), box(0, 2.6, 0, 5, 1, 5, icing, { cut: true })];
    },
    sandwich: (): BoxSpec[] => [box(0, 0, 0, 6, 1, 6, bread), box(0, 1, 0, 7, 1, 7, smooth('#69b84a', { noise: 0.8, scale: 1.2 })), box(0, 2, 0, 6, 1, 6, smooth('#f6c531')), box(0, 2.6, 0, 6, 1, 6, smooth('#e5604d')), box(0, 3.4, 0, 6, 1.4, 6, bread)],
    onigiri: (): BoxSpec[] => [box(0, 0, 0, 7, 3, 4, smooth('#fbfbf6')), box(0, 3, 0, 5, 2, 4, smooth('#fbfbf6'), { skip: 'd' }), box(0, 5, 0, 3, 1, 4, smooth('#fbfbf6'), { skip: 'd' }), box(0, 0, 0.3, 4, 3, 4, solid('#24382c', { noise: 0.3 }), { skip: 'd' })],
    dango: (): BoxSpec[] => [...['#f6a6c1', '#fbfbf6', '#9bd27a'].map((c, i) => box(0, 2 + i * 3.4, 0, 4, 3, 4, smooth(c))), box(0, 0, 0, 1, 14, 1, flat('#d9b98a'))],
    cake: (): BoxSpec[] => [box(0, 0, 0, 7, 2, 6, smooth('#f6e3b8')), box(0, 2, 0, 7, 1, 6, smooth('#f58fb0')), box(0, 3, 0, 7, 2, 6, smooth('#f6e3b8')), box(0, 5, 0, 7, 1, 6, smooth('#fffaf2')), box(1, 6, 0, 2, 2, 2, smooth('#e5484d')), box(1, 8, 0, 1, 1, 1, flat('#5aa83f'))],
    pancakes: (): BoxSpec[] => [box(0, 0, 0, 9, 1, 9, smooth('#fbfbff')), ...[0, 1, 2].map((i) => box((i % 2) * 0.6 - 0.3, 1 + i * 2, 0, 7, 2, 7, bread)), box(0, 7, 0, 5, 1, 5, smooth('#c9772a')), box(2.6, 4, 2.6, 1, 4, 1, smooth('#c9772a')), box(0, 8, 0, 2, 1, 2, smooth('#fbe68a'))],
    ramen: (): BoxSpec[] => {
      const bowl: Painter = (t) => (t.face !== 2 && t.v === t.h - 2 ? tone(R('#d8433f'), 0) : tone(R('#fbfbff'), lvl(t, { noise: 0.1 })));
      return [box(0, 0, 0, 5, 1, 5, bowl), box(0, 1, 0, 8, 3, 8, bowl), box(0, 4, 0, 9, 1, 9, bowl), box(0, 4.4, 0, 7, 1, 7, smooth('#e8b45a', { noise: 0.9, scale: 1.2 }), { skip: 'd' }),
        box(-1.6, 5, 1, 3, 1, 3, smooth('#fbfbf6')), box(-1.6, 5.4, 1, 1, 1, 1, flat('#f6c531')), box(2, 5, -1, 2, 1, 3, smooth('#e58a8a')), box(1, 5, 2, 3, 1, 1, smooth('#4f9e45')),
        { ...box(2.6, 5, 0, 0.8, 0.8, 9, flat('#b9783f')), rot: [18, 20, 0] }, { ...box(3.4, 5, 0, 0.8, 0.8, 9, flat('#b9783f')), rot: [18, 28, 0] }];
    },
    boba: (): BoxSpec[] => {
      const cup: Painter = (t) => (t.face !== 2 && t.by < 2.2 && hash(t.u, t.v, t.face, 3) > 0.45 ? 0x3a2a22 : tone(R('#e8c9a0'), lvl(t, { noise: 0.2 })));
      return [box(0, 0, 0, 4, 7, 4, cup), box(0, 7, 0, 5, 1, 5, smooth('#f58fb0')), { ...box(0.6, 7, 0, 1, 5, 1, smooth('#6fd3b0')), rot: [0, 0, -10] }];
    },
    honey: (): BoxSpec[] => [box(0, 0, 0, 5, 5, 5, smooth('#f2a62a')), box(0, 5, 0, 6, 1, 6, wy(W.dark)), box(0, 6, 0, 2, 1, 2, wy(W.dark)), box(0, 2, 2.6, 3, 2, 0.4, smooth('#fbf6ea')), box(2.4, 4, 2.4, 1, 3, 1, smooth('#f6c531'))],
  };
}
const FOODS_BUILD = foodBuilders();

const food = (id: keyof typeof FOODS_BUILD, name: string, price: number, fill: number, joy: number, loved: string[]): FoodDef => ({ id, name, price, fill, joy, loved, build: FOODS_BUILD[id] });
export const FOODS: FoodDef[] = [
  food('apple', 'Crisp Apple', 8, 18, 6, ['bear', 'dog']), food('berries', 'Berry Bowl', 12, 20, 10, ['bear', 'redpanda', 'owl']),
  food('carrot', 'Crunchy Carrot', 8, 18, 8, ['bunny', 'parrot']), food('acorn', 'Roasted Acorn', 6, 12, 6, ['owl', 'raccoon', 'parrot']),
  food('cookie', 'Choc-chip Cookie', 14, 14, 16, ['raccoon', 'fox']), food('donut', 'Sprinkle Donut', 20, 20, 22, ['raccoon', 'axolotl']),
  food('sandwich', 'Stacked Sandwich', 24, 38, 12, ['fox', 'bear', 'dog', 'shark']), food('onigiri', 'Onigiri', 18, 30, 12, ['cat', 'frog', 'shark', 'goldfish']),
  food('dango', 'Three-colour Dango', 22, 22, 22, ['redpanda', 'frog']), food('cake', 'Strawberry Cake', 40, 34, 34, ['bunny', 'axolotl']),
  food('pancakes', 'Maple Pancakes', 36, 44, 24, ['bear', 'fox']), food('ramen', 'Cosy Ramen', 48, 60, 26, ['cat', 'raccoon']),
  food('boba', 'Bubble Tea', 30, 16, 36, ['axolotl', 'bunny', 'cat']), food('honey', 'Honey Pot', 26, 26, 24, ['bear', 'dog']),
];
export const FOOD: Record<string, FoodDef> = Object.fromEntries(FOODS.map((f) => [f.id, f]));
