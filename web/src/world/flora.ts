// Planting: decides where every tree, bush, flower patch, mushroom ring and grass clump goes,
// then draws each variety as one instanced mesh.
import * as THREE from 'three';
import { buildProp, propInstances, type BoxSpec, type Prop } from '../gfx/box.ts';
import { rng, type Rng } from '../gfx/noise.ts';
import * as F from '../assets/nature.ts';
import { clearing, groundY, HALF, inGarden, pathD, pondD, SEED, WATER_Y, type Collider } from './layout.ts';

interface Spot { x: number; y: number; z: number; yaw: number; s: number; tint?: number }
export interface LeafSource { x: number; y: number; z: number; r: number; color: number }

export interface ForestPlan {
  lists: Map<string, Spot[]>;
  colliders: Collider[];
  shade: Collider[];
  leafSources: LeafSource[];
  /** places an animal might wander to: flower patches, the shore, logs */
  flowers: { x: number; z: number }[];
  perches: THREE.Vector3[];
  seats: { x: number; y: number; z: number; rot: number }[];
}

const KINDS: Record<string, () => BoxSpec[]> = {
  oak1: () => F.oak(31), oak2: () => F.oak(32, { leaf: '#3f8f45' }), oak3: () => F.oak(41, { leaf: '#5aa63c' }),
  birch1: () => F.birch(33), birch2: () => F.birch(43), pine1: () => F.pine(34), pine2: () => F.pine(44),
  blossom: () => F.blossomTree(35), maple: () => F.oak(36, { leaf: '#ee8a2e' }), sapling: () => F.sapling(30),
  bush: () => F.bush(20), bushBerry: () => F.bush(21, '#3f8f45', '#e0465a'), bushFlower: () => F.bush(22, '#58a83e', '#fff2f7'),
  rock1: () => F.boulder(23), rock2: () => F.boulder(24, '#a39a8d'), pebbles: () => F.pebbles(25),
  log: () => F.fallenLog(26), stump: () => F.stump(27),
  toadstool: () => F.toadstool(14), toadstoolBig: () => F.toadstool(15, '#da4230', 1.6), bolete: () => F.bolete(16),
  chanterelle: () => F.chanterelles(17), glow: () => F.glowshroom(18), purple: () => F.toadstool(19, '#9a6fe0'),
  daisy: () => F.daisy(6), daisyPink: () => F.daisy(7, '#ffd9e6', '#f59a2f'), tulipRed: () => F.tulip(8), tulipYellow: () => F.tulip(9, '#f9cf45'),
  tulipPink: () => F.tulip(10, '#f58fb0'), bluebell: () => F.bluebell(10), lavender: () => F.lavender(11), poppy: () => F.poppy(12), sunflower: () => F.sunflower(13),
  clover: () => F.clover(5), fern: () => F.fern(4),
  grassA: () => F.grassClump(1), grassB: () => F.grassClump(2), grassTall: () => F.grassClump(3, true),
  reeds: () => F.reeds(29), lily: () => F.lilyPad(28), lotus: () => F.lilyPad(28, true),
};
const NO_SHADOW = new Set(['grassA', 'grassB', 'grassTall', 'clover', 'fern', 'pebbles', 'lily', 'lotus']);
const LEAF_COLOR: Record<string, number> = { oak1: 0x5aa63c, oak2: 0x4c9b3b, oak3: 0x6cb845, birch1: 0xb5d94f, birch2: 0xb5d94f, blossom: 0xf7b3c8, maple: 0xf09a3a };

export function planForest(quality: 'low' | 'high'): ForestPlan {
  const r = rng(SEED);
  const lists = new Map<string, Spot[]>();
  const put = (kind: string, x: number, z: number, s = 1, yaw = r.int(0, 3) * (Math.PI / 2) + r.range(-0.12, 0.12), y = groundY(x, z), tint?: number) => {
    if (!lists.has(kind)) lists.set(kind, []);
    lists.get(kind)!.push({ x, y, z, yaw, s, tint });
  };
  const colliders: Collider[] = [], shade: Collider[] = [], leafSources: LeafSource[] = [], trunks: Collider[] = [];
  const flowers: { x: number; z: number }[] = [], perches: THREE.Vector3[] = [], seats: ForestPlan['seats'] = [];
  const dry = (x: number, z: number, pond = 1.25, path = 1.0) => pondD(x, z) > pond && pathD(x, z) > path && Math.abs(x) < HALF - 1 && Math.abs(z) < HALF - 1;
  const nearTrunk = (x: number, z: number, d: number) => trunks.some((t) => Math.hypot(t.x - x, t.z - z) < d);

  const tree = (kind: string, x: number, z: number, s: number) => {
    put(kind, x, z, s);
    trunks.push({ x, z, r: 0.5 * s });
    const cr = (kind.startsWith('pine') ? 1.5 : kind.startsWith('birch') ? 1.5 : kind === 'blossom' ? 2.1 : 2.4) * s;
    shade.push({ x: x + 0.5, z: z - 0.3, r: cr * 1.15 });
    if (Math.hypot(x, z) < 13.5) colliders.push({ x, z, r: 0.55 * s });
    if (LEAF_COLOR[kind] && Math.hypot(x, z) < 16) leafSources.push({ x, y: groundY(x, z) + 4.2 * s, z, r: cr, color: LEAF_COLOR[kind] });
  };

  // feature trees around the clearing, then the forest proper on a jittered grid
  tree('oak1', -8.8, -6.4, 1.4); tree('blossom', 4.6, -7.4, 1.2); tree('birch1', -10.4, 2.6, 1.15); tree('oak3', 10.8, -3.2, 1.25); tree('maple', -4.2, -9.6, 1.1); tree('oak2', 14.6, 6.4, 1.25); tree('birch2', -14.2, 7.2, 1.15);
  for (let gz = -23; gz < 23; gz += 3) for (let gx = -23; gx < 23; gx += 3) {
    const x = gx + r.range(0.2, 2.6), z = gz + r.range(0.2, 2.6);
    if (clearing(x, z) > 0.04 || !dry(x, z, 1.5, 1.6) || nearTrunk(x, z, 2.6) || r.chance(0.08)) continue;
    // keep the wedge between the camera and the clearing free of tall trees
    if (z > 7 && Math.abs(x) < (z - 7) * 1.25 + 9) continue;
    const far = Math.hypot(x, z) > 16.5, k = r();
    const kind = far ? (k < 0.5 ? r.pick(['pine1', 'pine2']) : k < 0.85 ? r.pick(['oak1', 'oak2', 'oak3']) : 'birch1')
      : (k < 0.44 ? r.pick(['oak1', 'oak2', 'oak3']) : k < 0.66 ? r.pick(['birch1', 'birch2']) : k < 0.8 ? 'pine1' : k < 0.88 ? 'maple' : k < 0.94 ? 'blossom' : 'sapling');
    tree(kind, x, z, (far ? r.range(1.1, 1.45) : r.range(0.9, 1.25)) * (kind === 'sapling' ? 1 : 1));
  }

  // fallen log, stumps
  put('log', 3.4, -7.0, 1.15, -0.25); colliders.push({ x: 3.4, z: -7.0, r: 0.95 }, { x: 2.5, z: -6.8, r: 0.7 }, { x: 4.3, z: -7.2, r: 0.7 });
  seats.push({ x: 2.6, y: 0.66, z: -6.75, rot: 0 }); perches.push(new THREE.Vector3(4.6, 0.68, -7.3));
  for (const [x, z] of [[-10.6, -1.4], [9.2, -6.4]] as const) { put('stump', x, z, 1.1); colliders.push({ x, z, r: 0.5 }); seats.push({ x, y: 0.48, z, rot: Math.atan2(-x, -z) }); perches.push(new THREE.Vector3(x, 0.5, z)); }

  for (let i = 0; i < 90; i++) {
    const a = r.range(0, Math.PI * 2), d = r.range(8.2, 22), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (clearing(x, z) > 0.7 || !dry(x, z, 1.3, 1.15) || nearTrunk(x, z, 1.1)) continue;
    put(r() < 0.55 ? 'bush' : r() < 0.5 ? 'bushBerry' : 'bushFlower', x, z, r.range(0.8, 1.35));
    if (d < 13) colliders.push({ x, z, r: 0.55 });
  }
  for (let i = 0; i < 44; i++) {
    const a = r.range(0, Math.PI * 2), d = r.range(7.5, 22), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!dry(x, z, 1.2, 1.1) || nearTrunk(x, z, 0.9) || inGarden(x, z, -0.6)) continue;
    put(r.chance(0.5) ? 'rock1' : 'rock2', x, z, r.range(0.7, 1.3), r.range(0, 6.28));
    if (d < 13) { colliders.push({ x, z, r: 0.6 }); perches.push(new THREE.Vector3(x, groundY(x, z) + 0.55, z)); }
  }
  // stones and reeds along the shore, pads on the water
  for (let i = 0; i < 26; i++) {
    const a = r.range(0, Math.PI * 2);
    const at = (k: number): [number, number] => [7.2 + Math.cos(a) * 4.1 * k, 3.4 + Math.sin(a) * 3.0 * k];
    const kind = i % 4;
    if (kind === 0) { const [x, z] = at(1.2); if (pathD(x, z) > 1.2 && pondD(x, z) > 1.1) put('rock2', x, z, r.range(0.45, 0.75), r.range(0, 6.28)); }
    else if (kind === 1) { const [x, z] = at(1.02); put('reeds', x, z, r.range(1.1, 1.6), r.range(0, 6.28), -0.72); }
    else if (kind === 2 && i < 18) { const [x, z] = at(r.range(0.2, 0.72)); put(i % 8 === 2 ? 'lotus' : 'lily', x, z, r.range(0.8, 1.15), r.range(0, 6.28), WATER_Y + 0.015); }
    else { const [x, z] = at(1.22); if (pondD(x, z) > 1.12) put('pebbles', x, z, 1, r.range(0, 6.28)); }
  }
  for (let i = 0; i < 46; i++) {
    const x = r.range(-20, 20), z = r.range(-20, 20);
    if (dry(x, z, 1.15, 0.2)) put('pebbles', x, z, r.range(0.7, 1.2), r.range(0, 6.28));
  }

  // mushrooms cluster in the shade near trunks; one fairy ring in the open
  for (let i = 0; i < 26; i++) {
    const t = r.pick(trunks.filter((t) => Math.hypot(t.x, t.z) < 17));
    const a = r.range(0, Math.PI * 2), d = r.range(0.9, 1.7), cx = t.x + Math.cos(a) * d, cz = t.z + Math.sin(a) * d;
    if (!dry(cx, cz, 1.2, 0.9) || groundY(cx, cz) < 0) continue;
    const kind = r.pick(['toadstool', 'toadstool', 'bolete', 'chanterelle', 'glow', 'purple', 'toadstoolBig']);
    for (let k = 0, n = kind === 'toadstoolBig' ? 1 : r.int(2, 4); k < n; k++) put(kind, cx + r.range(-0.55, 0.55), cz + r.range(-0.55, 0.55), r.range(0.75, 1.25), r.range(0, 6.28));
  }
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; put(i % 3 ? 'toadstool' : 'purple', 0.6 + Math.cos(a) * 1.25, -6.3 + Math.sin(a) * 1.25, r.range(0.7, 1), a); }

  // flowers grow in drifts of one kind
  const drift = (kind: string, cx: number, cz: number, n: number, rad: number) => {
    flowers.push({ x: cx, z: cz });
    for (let i = 0; i < n; i++) {
      const a = r.range(0, Math.PI * 2), d = Math.sqrt(r()) * rad, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (dry(x, z, 1.18, 0.95) && groundY(x, z) >= 0 && !nearTrunk(x, z, 0.7) && !inGarden(x, z, 0.4)) put(kind, x, z, r.range(0.85, 1.3), r.range(0, 6.28));
    }
  };
  const driftKinds = ['daisy', 'tulipRed', 'bluebell', 'lavender', 'poppy', 'daisyPink', 'tulipYellow', 'tulipPink'];
  const fixed: [string, number, number][] = [['daisy', -7.4, -2.6], ['tulipRed', 3.6, 5.6], ['lavender', -8.2, 6.6], ['poppy', 1.4, -4.6], ['bluebell', -5.6, -6.2], ['tulipPink', 3.4, -3.6], ['daisyPink', 9.6, -0.6], ['tulipYellow', -3.8, 8.6], ['lavender', 10.6, 6.6], ['daisy', 5.2, 8.4]];
  for (const [k, x, z] of fixed) drift(k, x, z, quality === 'high' ? 14 : 8, 1.7);
  for (let i = 0; i < 16; i++) {
    const a = r.range(0, Math.PI * 2), d = r.range(9.5, 17);
    drift(r.pick(driftKinds), Math.cos(a) * d, Math.sin(a) * d, quality === 'high' ? 9 : 5, 1.5);
  }
  for (const [x, z] of [[-6.6, -4.2], [-7.6, -4.9], [-5.9, -5.0]] as const) put('sunflower', x, z, r.range(1, 1.2), r.range(-0.4, 0.4));

  for (let i = 0; i < 70; i++) {
    const t = r.pick(trunks), a = r.range(0, Math.PI * 2), d = r.range(0.8, 2.2), x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
    if (dry(x, z, 1.2, 1) && clearing(x, z) < 0.6) put('fern', x, z, r.range(0.9, 1.5), r.range(0, 6.28));
  }
  for (let i = 0; i < 60; i++) {
    const x = r.range(-13, 13), z = r.range(-13, 13);
    if (dry(x, z, 1.2, 1) && groundY(x, z) >= 0) put('clover', x, z, r.range(0.8, 1.2), r.range(0, 6.28));
  }

  // grass: lush in the clearing, thinner on the forest floor, kept short on the garden lawn
  const want = quality === 'high' ? 6400 : 2200;
  for (let i = 0, placed = 0; i < want * 4 && placed < want; i++) {
    const x = r.range(-20.5, 20.5), z = r.range(-20.5, 20.5);
    if (pondD(x, z) < 1.17 || pathD(x, z) < 0.92) continue;
    const open = clearing(x, z), lawn = inGarden(x, z, 0.3);
    if (r() > (lawn ? 0.5 : 0.3 + open * 0.7)) continue;
    const edge = open > 0.15 && open < 0.75 || (pondD(x, z) < 1.5);
    const kind = lawn ? 'grassA' : edge && r.chance(0.45) ? 'grassTall' : r.chance(0.5) ? 'grassA' : 'grassB';
    // per-clump tint: sunlit yellow-greens to deep shade greens
    const t = r();
    put(kind, x, z, lawn ? r.range(0.6, 0.8) : r.range(0.85, 1.45), r.range(0, 6.28), groundY(x, z), t < 0.2 ? 0xd8f08c : t < 0.5 ? 0xffffff : t < 0.8 ? 0xc6e6a0 : 0x9fcf9a);
    placed++;
  }
  return { lists, colliders, shade, leafSources, flowers, perches, seats };
}

export interface Flora { group: THREE.Group; props: Map<string, Prop>; dispose(): void }

export function buildFlora(plan: ForestPlan): Flora {
  const group = new THREE.Group(), props = new Map<string, Prop>();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  for (const [kind, spots] of plan.lists) {
    const prop = buildProp(KINDS[kind]());
    props.set(kind, prop);
    const mesh = propInstances(prop, spots.length, !NO_SHADOW.has(kind));
    spots.forEach((s, i) => {
      q.setFromAxisAngle(up, s.yaw);
      m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.s, s.s, s.s));
      mesh.setMatrixAt(i, m);
      if (s.tint !== undefined) mesh.setColorAt(i, c.setHex(s.tint));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.name = kind;
    group.add(mesh);
  }
  return { group, props, dispose() { for (const p of props.values()) { p.geo.dispose(); p.tex.dispose(); p.mats.forEach((x) => x.dispose()); } } };
}

export type { Rng };
