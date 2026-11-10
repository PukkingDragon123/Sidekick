// The shape of the forest diorama: where the clearing, pond, paths and hills are.
// Everything else (terrain, planting, navigation, water shader) reads from these functions.
import { fbm } from '../gfx/noise.ts';

/** World is N x N blocks centred on the origin; +z is towards the default camera. */
export const N = 48;
export const HALF = N / 2;
export const SEED = 20261110;

export const POND = { x: 7.2, z: 3.4, rx: 4.1, rz: 3.0 };
/** Placeable garden plot (centre and half extents, blocks). */
export const GARDEN = { x: -2.6, z: 0.4, hw: 5.2, hd: 4.2 };
export const WATER_Y = -0.34;

/** < 1 inside the pond. */
export function pondD(x: number, z: number): number {
  const dx = (x - POND.x) / POND.rx, dz = (z - POND.z) / POND.rz;
  const a = Math.atan2(dz, dx);
  return Math.hypot(dx, dz) + 0.08 * Math.sin(a * 3 + 1.3) + 0.05 * Math.sin(a * 7 + 0.4);
}

const PATHS: [number, number][][] = [
  [[-24, 9.5], [-17, 7.5], [-11.5, 4.6], [-8.6, 5.6], [-4, 6.4], [0.5, 7.4], [3.6, 10.5], [7.5, 15], [9, 24]],
];

/** Distance in blocks to the nearest path centre line. */
export function pathD(x: number, z: number): number {
  let best = 99;
  for (const p of PATHS) {
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1];
      const vx = bx - ax, vz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
      const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
      if (d < best) best = d;
    }
  }
  return best;
}

/** 1 in the open clearing, falling to 0 under the trees. */
export function clearing(x: number, z: number): number {
  const r = Math.hypot(x * 0.92 + 0.6, z - 0.4) + (fbm(x / 6, 1, z / 6, SEED) - 0.5) * 3;
  return Math.max(0, Math.min(1, (10.2 - r) / 2.4));
}

export const inGarden = (x: number, z: number, pad = 0) =>
  Math.abs(x - GARDEN.x) < GARDEN.hw - pad && Math.abs(z - GARDEN.z) < GARDEN.hd - pad;

const hCache = new Int8Array(N * N).fill(-99);

/** Terrain height in whole blocks for a cell. */
export function cellH(i: number, j: number): number {
  if (i < 0 || j < 0 || i >= N || j >= N) return 3;
  const k = j * N + i;
  if (hCache[k] !== -99) return hCache[k];
  const x = i + 0.5 - HALF, z = j + 0.5 - HALF;
  let h = 0;
  if (pondD(x, z) < 0.9) h = -1;
  else {
    const r = Math.hypot(x * 0.94, z) + (fbm(x / 7, 5, z / 7, SEED) - 0.5) * 7;
    if (r > 13.8) h = 1;
    if (r > 18.2) h = 2;
    if (r > 22) h = 3;
    // the path stays walkable where it leaves the clearing
    if (pathD(x, z) < 1.3 && h > 0) h = Math.max(0, h - 1);
  }
  return (hCache[k] = h);
}

/** Ground height in blocks at a world position. */
export function groundY(x: number, z: number): number {
  return Math.max(cellH(Math.floor(x + HALF), Math.floor(z + HALF)), -1);
}

export interface Collider { x: number; z: number; r: number }

/** Is this a spot an animal can stand on (open, dry, level ground)? */
export function walkable(x: number, z: number): boolean {
  return Math.hypot(x, z) < 12.5 && groundY(x, z) === 0 && pondD(x, z) > 1.12;
}
