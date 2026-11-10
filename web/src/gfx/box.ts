// Cuboid model builder in the Blockbench tradition: every model is a set of boxes measured in
// pixels (16 px = 1 block) and every face gets its own pixel texture at one texel per pixel,
// painted procedurally by a Painter that sees the texel's position in model space.
import * as THREE from 'three';

export const PX = 1 / 16;
export type Vec3 = [number, number, number];

/** Face order: 0 +x (east), 1 -x (west), 2 +y (up), 3 -y (down), 4 +z (south, the front), 5 -z (north). */
export interface Texel {
  /** texel centre in model space, px */
  x: number; y: number; z: number;
  /** position inside the box measured from its min corner, px */
  bx: number; by: number; bz: number;
  sx: number; sy: number; sz: number;
  /** face-local pixel coordinates (v grows upwards) and face size */
  u: number; v: number; w: number; h: number;
  face: number;
  tag: string;
}

/** Returns 0xRRGGBB, or a negative number for a see-through texel (only honoured on `cut` boxes). */
export type Painter = (t: Texel) => number;

export interface BoxSpec {
  /** min corner and size in px, model space */
  at: Vec3;
  size: Vec3;
  mat: Painter;
  /** degrees, rotated about `pivot` (default: the box centre) */
  rot?: Vec3;
  pivot?: Vec3;
  /** grow the geometry without adding texels, like a clothing layer */
  inflate?: number;
  /** unlit: lantern glass, glowing caps */
  glow?: boolean;
  /** alpha-tested and double sided */
  cut?: boolean;
  /** wind weight at the top of the model (0 = rigid) */
  sway?: number;
  tag?: string;
  /** faces to leave out, any of e w u d s n */
  skip?: string;
}

/** A box centred on x/z and resting on y. */
export function box(x: number, y: number, z: number, w: number, h: number, d: number, mat: Painter, o: Partial<BoxSpec> = {}): BoxSpec {
  return { at: [x - w / 2, y, z - d / 2], size: [w, h, d], mat, ...o };
}

/** Rotate a box about the centre of its bottom face (handy for stems, roots, legs). */
export function lean(b: BoxSpec, rx: number, ry: number, rz: number): BoxSpec {
  return { ...b, rot: [rx, ry, rz], pivot: [b.at[0] + b.size[0] / 2, b.at[1], b.at[2] + b.size[2] / 2] };
}

/** Mirror boxes across the x = 0 plane. */
export function mirror(boxes: BoxSpec[]): BoxSpec[] {
  return boxes.map((b) => ({
    ...b,
    at: [-(b.at[0] + b.size[0]), b.at[1], b.at[2]] as Vec3,
    rot: b.rot ? ([b.rot[0], -b.rot[1], -b.rot[2]] as Vec3) : undefined,
    pivot: b.pivot ? ([-b.pivot[0], b.pivot[1], b.pivot[2]] as Vec3) : undefined,
  }));
}

/** Move/rotate a group of boxes as one (rotation about the y axis only, in quarter turns or free degrees). */
export function place(boxes: BoxSpec[], dx: number, dy: number, dz: number): BoxSpec[] {
  return boxes.map((b) => ({
    ...b,
    at: [b.at[0] + dx, b.at[1] + dy, b.at[2] + dz] as Vec3,
    pivot: b.pivot ? ([b.pivot[0] + dx, b.pivot[1] + dy, b.pivot[2] + dz] as Vec3) : undefined,
  }));
}

interface FaceDef { key: string; n: Vec3; o: Vec3; u: Vec3; v: Vec3 }
const FACES: FaceDef[] = [
  { key: 'e', n: [1, 0, 0], o: [1, 0, 1], u: [0, 0, -1], v: [0, 1, 0] },
  { key: 'w', n: [-1, 0, 0], o: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { key: 'u', n: [0, 1, 0], o: [0, 1, 1], u: [1, 0, 0], v: [0, 0, -1] },
  { key: 'd', n: [0, -1, 0], o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { key: 's', n: [0, 0, 1], o: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { key: 'n', n: [0, 0, -1], o: [1, 0, 0], u: [-1, 0, 0], v: [0, 1, 0] },
];

const RAD = Math.PI / 180;

function boxMatrix(b: BoxSpec): THREE.Matrix4 | null {
  if (!b.rot || (!b.rot[0] && !b.rot[1] && !b.rot[2])) return null;
  const p = b.pivot ?? [b.at[0] + b.size[0] / 2, b.at[1] + b.size[1] / 2, b.at[2] + b.size[2] / 2];
  const m = new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]);
  m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(b.rot[0] * RAD, b.rot[1] * RAD, b.rot[2] * RAD, 'ZYX')));
  m.multiply(new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2]));
  return m;
}

export interface Part { boxes: BoxSpec[]; origin?: Vec3 }

export interface Assembled {
  geos: THREE.BufferGeometry[];
  tex: THREE.DataTexture;
  /** x,y,z (model px) and 0xRRGGBB for a spread of texels, for dissolve effects */
  samples: Float32Array;
  /** model bounds in world units */
  min: THREE.Vector3;
  max: THREE.Vector3;
}

interface Job { part: number; b: BoxSpec; f: FaceDef; fi: number; M: THREE.Matrix4 | null; tw: number; th: number; x: number; y: number }

const axisLen = (a: Vec3, s: Vec3) => Math.abs(a[0]) * s[0] + Math.abs(a[1]) * s[1] + Math.abs(a[2]) * s[2];

export function assemble(parts: Part[], o: { swayH?: number; sampleEvery?: number } = {}): Assembled {
  const jobs: Job[] = [];
  parts.forEach((p, part) => {
    for (const b of p.boxes) {
      const M = boxMatrix(b);
      FACES.forEach((f, fi) => {
        if (b.skip && b.skip.includes(f.key)) return;
        const tw = Math.max(1, Math.round(axisLen(f.u, b.size)));
        const th = Math.max(1, Math.round(axisLen(f.v, b.size)));
        jobs.push({ part, b, f, fi, M, tw, th, x: 0, y: 0 });
      });
    }
  });

  // shelf-pack the faces, each with a 1 px gutter that repeats its edge texels
  let area = 0, maxW = 0;
  for (const j of jobs) { area += (j.tw + 2) * (j.th + 2); maxW = Math.max(maxW, j.tw + 2); }
  const W = Math.max(16, maxW, Math.ceil(Math.sqrt(area) * 1.12));
  const order = jobs.slice().sort((a, b) => b.th - a.th);
  let cx = 0, cy = 0, rowH = 0;
  for (const j of order) {
    if (cx + j.tw + 2 > W) { cx = 0; cy += rowH; rowH = 0; }
    j.x = cx; j.y = cy; cx += j.tw + 2; rowH = Math.max(rowH, j.th + 2);
  }
  const H = Math.max(1, cy + rowH);
  const data = new Uint8Array(W * H * 4);

  const acc = parts.map(() => ({ pos: [] as number[], nor: [] as number[], uv: [] as number[], sw: [] as number[], idx: [[], [], []] as number[][] }));
  const samples: number[] = [];
  const every = o.sampleEvery ?? 3;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let top = 0;
  const v = new THREE.Vector3();
  // first pass over geometry extents so sway weights can be normalised by model height
  for (const j of jobs) {
    const { b } = j;
    for (let k = 0; k < 8; k++) {
      v.set(b.at[0] + (k & 1 ? b.size[0] : 0), b.at[1] + (k & 2 ? b.size[1] : 0), b.at[2] + (k & 4 ? b.size[2] : 0));
      if (j.M) v.applyMatrix4(j.M);
      top = Math.max(top, v.y);
    }
  }
  const swayH = o.swayH ?? Math.max(1, top);

  const t: Texel = { x: 0, y: 0, z: 0, bx: 0, by: 0, bz: 0, sx: 0, sy: 0, sz: 0, u: 0, v: 0, w: 0, h: 0, face: 0, tag: '' };
  const n = new THREE.Vector3();
  let texelCount = 0;

  for (const j of jobs) {
    const { b, f, M, tw, th } = j;
    const [ax, ay, az] = b.at, [sx, sy, sz] = b.size;
    const lu = axisLen(f.u, b.size), lv = axisLen(f.v, b.size);
    const ox = ax + f.o[0] * sx, oy = ay + f.o[1] * sy, oz = az + f.o[2] * sz;

    // ---- paint
    t.sx = sx; t.sy = sy; t.sz = sz; t.w = tw; t.h = th; t.face = j.fi; t.tag = b.tag ?? '';
    for (let jj = 0; jj < th; jj++) {
      for (let ii = 0; ii < tw; ii++) {
        const fu = ((ii + 0.5) / tw) * lu, fv = ((jj + 0.5) / th) * lv;
        const px = ox + f.u[0] * fu + f.v[0] * fv, py = oy + f.u[1] * fu + f.v[1] * fv, pz = oz + f.u[2] * fu + f.v[2] * fv;
        t.bx = px - ax; t.by = py - ay; t.bz = pz - az; t.u = ii; t.v = jj;
        if (M) { v.set(px, py, pz).applyMatrix4(M); t.x = v.x; t.y = v.y; t.z = v.z; } else { t.x = px; t.y = py; t.z = pz; }
        const c = b.mat(t);
        const k = ((j.y + 1 + jj) * W + j.x + 1 + ii) * 4;
        if (c < 0) { data[k + 3] = 0; continue; }
        data[k] = (c >> 16) & 255; data[k + 1] = (c >> 8) & 255; data[k + 2] = c & 255; data[k + 3] = 255;
        if (texelCount++ % every === 0 && !b.cut) samples.push(t.x, t.y, t.z, c);
      }
    }
    // gutter
    for (let gy = j.y; gy < j.y + th + 2; gy++) {
      for (let gx = j.x; gx < j.x + tw + 2; gx++) {
        const sxp = Math.min(j.x + tw, Math.max(j.x + 1, gx)), syp = Math.min(j.y + th, Math.max(j.y + 1, gy));
        if (sxp === gx && syp === gy) continue;
        const d = (gy * W + gx) * 4, s = (syp * W + sxp) * 4;
        data[d] = data[s]; data[d + 1] = data[s + 1]; data[d + 2] = data[s + 2]; data[d + 3] = data[s + 3];
      }
    }

    // ---- geometry
    const inf = b.inflate ?? 0;
    const a = acc[j.part];
    const org = parts[j.part].origin ?? [0, 0, 0];
    const gx0 = ax - inf + f.o[0] * (sx + inf * 2), gy0 = ay - inf + f.o[1] * (sy + inf * 2), gz0 = az - inf + f.o[2] * (sz + inf * 2);
    const gu = lu + inf * 2, gv = lv + inf * 2;
    n.set(f.n[0], f.n[1], f.n[2]);
    if (M) n.transformDirection(M);
    const base = a.pos.length / 3;
    const e = 0.02;
    const u0 = (j.x + 1 + e) / W, u1 = (j.x + 1 + tw - e) / W, v0 = (j.y + 1 + e) / H, v1 = (j.y + 1 + th - e) / H;
    const corners: [number, number, number, number][] = [[0, 0, u0, v0], [1, 0, u1, v0], [1, 1, u1, v1], [0, 1, u0, v1]];
    for (const [ca, cb, cu, cv] of corners) {
      v.set(gx0 + f.u[0] * gu * ca + f.v[0] * gv * cb, gy0 + f.u[1] * gu * ca + f.v[1] * gv * cb, gz0 + f.u[2] * gu * ca + f.v[2] * gv * cb);
      if (M) v.applyMatrix4(M);
      const sway = b.sway ? b.sway * Math.pow(Math.max(0, Math.min(1, v.y / swayH)), 1.4) : 0;
      const wx = (v.x - org[0]) * PX, wy = (v.y - org[1]) * PX, wz = (v.z - org[2]) * PX;
      a.pos.push(wx, wy, wz); a.nor.push(n.x, n.y, n.z); a.uv.push(cu, cv); a.sw.push(sway);
      min.min(v.clone().multiplyScalar(PX)); max.max(v.clone().multiplyScalar(PX));
    }
    a.idx[b.cut ? 2 : b.glow ? 1 : 0].push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  const geos = acc.map((a) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(a.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(a.sw, 1));
    const all: number[] = [];
    a.idx.forEach((ix, m) => {
      if (ix.length) g.addGroup(all.length, ix.length, m);
      for (const i of ix) all.push(i);
    });
    g.setIndex(all);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  });
  return { geos, tex, samples: new Float32Array(samples), min, max };
}

// ---------------------------------------------------------------- materials

export const wind = {
  uTime: { value: 0 },
  /** xy = direction, z = strength in blocks */
  uWind: { value: new THREE.Vector3(0.8, 0.6, 0.09) },
};

const WIND_PARS = /* glsl */ `
attribute float aSway;
uniform float uTime;
uniform vec3 uWind;
`;
const WIND_MAIN = /* glsl */ `
#ifdef USE_INSTANCING
  vec3 swBase = instanceMatrix[3].xyz; mat3 swM = mat3(instanceMatrix);
#else
  vec3 swBase = modelMatrix[3].xyz; mat3 swM = mat3(modelMatrix);
#endif
float swPh = dot(swBase.xz, vec2(0.37, 0.29)) + position.y * 0.6;
float swG = sin(uTime * 1.35 + swPh) * 0.55 + sin(uTime * 2.8 + swPh * 2.1) * 0.22 + sin(uTime * 0.43 + swPh * 0.33) * 0.5;
vec3 swOff = vec3(uWind.x * swG, -0.25 * abs(swG), uWind.y * swG) * (uWind.z * aSway);
transformed += (transpose(swM) * swOff) / dot(swM[0], swM[0]);
`;

function patchWind(m: THREE.Material) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.uTime;
    sh.uniforms.uWind = wind.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + WIND_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_MAIN);
  };
  m.customProgramCacheKey = () => 'wind';
}

export interface MatSet { mats: THREE.Material[]; depth?: THREE.Material }

/** Materials for an assembled model, indexed lit / glow / cutout to match its geometry groups. */
export function makeMaterials(tex: THREE.Texture, o: { wind?: boolean } = {}): MatSet {
  const lit = new THREE.MeshLambertMaterial({ map: tex });
  const glow = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const cut = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
  let depth: THREE.Material | undefined;
  if (o.wind) {
    patchWind(lit); patchWind(cut);
    depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 });
    patchWind(depth);
  }
  return { mats: [lit, glow, cut], depth };
}

// ---------------------------------------------------------------- rigs and props

export interface BoneSpec { name: string; parent?: string; pivot: Vec3; boxes: BoxSpec[] }

export interface Rig {
  root: THREE.Group;
  bones: Record<string, THREE.Group>;
  tex: THREE.DataTexture;
  mats: THREE.Material[];
  samples: Float32Array;
  height: number;
  dispose(): void;
}

/** Build an animatable model: one group per bone, positioned at its pivot. */
export function buildRig(bones: BoneSpec[]): Rig {
  const asm = assemble(bones.map((b) => ({ boxes: b.boxes, origin: b.pivot })));
  const { mats } = makeMaterials(asm.tex);
  const root = new THREE.Group();
  const map: Record<string, THREE.Group> = {};
  bones.forEach((b, i) => {
    const g = new THREE.Group();
    g.name = b.name;
    if (asm.geos[i].index && asm.geos[i].index!.count) {
      const mesh = new THREE.Mesh(asm.geos[i], mats);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    map[b.name] = g;
  });
  for (const b of bones) {
    const parent = b.parent ? bones.find((x) => x.name === b.parent) : undefined;
    const pp = parent ? parent.pivot : [0, 0, 0];
    map[b.name].position.set((b.pivot[0] - pp[0]) * PX, (b.pivot[1] - pp[1]) * PX, (b.pivot[2] - pp[2]) * PX);
    (parent ? map[parent.name] : root).add(map[b.name]);
  }
  return {
    root, bones: map, tex: asm.tex, mats, samples: asm.samples, height: asm.max.y,
    dispose() { asm.geos.forEach((g) => g.dispose()); asm.tex.dispose(); mats.forEach((m) => m.dispose()); },
  };
}

export interface Prop {
  geo: THREE.BufferGeometry;
  tex: THREE.DataTexture;
  mats: THREE.Material[];
  depth?: THREE.Material;
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** footprint radius in blocks, for collision and shadow blobs */
  radius: number;
}

/** Build a rigid model as a single geometry (for instancing or one-off placement). */
export function buildProp(boxes: BoxSpec[], o: { wind?: boolean; swayH?: number } = {}): Prop {
  const asm = assemble([{ boxes }], { swayH: o.swayH });
  const windy = o.wind ?? boxes.some((b) => b.sway);
  const { mats, depth } = makeMaterials(asm.tex, { wind: windy });
  const radius = Math.max(Math.abs(asm.min.x), Math.abs(asm.max.x), Math.abs(asm.min.z), Math.abs(asm.max.z));
  return { geo: asm.geos[0], tex: asm.tex, mats, depth, min: asm.min, max: asm.max, radius };
}

export function propMesh(p: Prop): THREE.Mesh {
  const m = new THREE.Mesh(p.geo, p.mats);
  m.castShadow = true;
  m.receiveShadow = true;
  if (p.depth) m.customDepthMaterial = p.depth;
  return m;
}

export function propInstances(p: Prop, count: number, shadows = true): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(p.geo, p.mats, count);
  m.castShadow = shadows;
  m.receiveShadow = true;
  if (p.depth) m.customDepthMaterial = p.depth;
  return m;
}
