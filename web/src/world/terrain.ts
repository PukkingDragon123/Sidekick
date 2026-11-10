// Blocky stepped terrain with one continuous, non-repeating painted top texture: grass with sunny
// and shaded patches, a trampled dirt path, the pond bed and shore, and contact shading at every step.
import * as THREE from 'three';
import { box, buildProp, propMesh, type BoxSpec, type Painter } from '../gfx/box.ts';
import { ramp, tone } from '../gfx/color.ts';
import { fbm, hash } from '../gfx/noise.ts';
import { PAL } from '../assets/nature.ts';
import { cellH, clearing, HALF, inGarden, N, pathD, POND, pondD, SEED, WATER_Y, type Collider } from './layout.ts';

const S = N * 16;

function paintTop(shade: Collider[]): THREE.DataTexture {
  const grass = ramp(PAL.grass, { n: 9, step: 0.05 }), soil = ramp('#6f5134', { n: 7 }), path = ramp(PAL.path, { n: 7 });
  const sand = ramp(PAL.sand, { n: 7 }), bed = ramp('#7d8a6a', { n: 7 });

  // canopy shade, splatted at 4 cells per block then sampled per texel
  const G = N * 4, sg = new Float32Array(G * G);
  for (const o of shade) {
    const r = o.r, x0 = Math.floor((o.x - r + HALF) * 4), x1 = Math.ceil((o.x + r + HALF) * 4), z0 = Math.floor((o.z - r + HALF) * 4), z1 = Math.ceil((o.z + r + HALF) * 4);
    for (let j = Math.max(0, z0); j < Math.min(G, z1); j++) for (let i = Math.max(0, x0); i < Math.min(G, x1); i++) {
      const d = Math.hypot((i + 0.5) / 4 - HALF - o.x, (j + 0.5) / 4 - HALF - o.z) / r;
      if (d < 1) sg[j * G + i] = Math.max(sg[j * G + i], 1 - d * d);
    }
  }

  const data = new Uint8Array(S * S * 4);
  for (let pz = 0; pz < S; pz++) {
    const z = (pz + 0.5) / 16 - HALF, cj = pz >> 4, v = pz & 15;
    for (let px = 0; px < S; px++) {
      const x = (px + 0.5) / 16 - HALF, ci = px >> 4, u = px & 15;
      const h = cellH(ci, cj);
      let L = (fbm(px / 26, 2, pz / 26, SEED) - 0.5) * 2.6 + (fbm(px / 5, 4, pz / 5, SEED) - 0.5) * 1.7;
      const tick = hash(px, 9, pz >> 1, SEED);
      if (tick > 0.85) L += 0.9; else if (tick < 0.09) L -= 0.8;
      const open = clearing(x, z);
      L += (open - 0.5) * 1.0 - sg[(pz >> 2) * G + (px >> 2)] * 1.5;
      // contact shadow under higher neighbours, bright lip above lower ones
      const hn = cellH(ci, cj - 1), hs = cellH(ci, cj + 1), hw = cellH(ci - 1, cj), he = cellH(ci + 1, cj);
      if (hn > h && v < 4) L -= (4 - v) * 0.45;
      if (hs > h && v > 11) L -= (v - 11) * 0.45;
      if (hw > h && u < 4) L -= (4 - u) * 0.45;
      if (he > h && u > 11) L -= (u - 11) * 0.45;
      if ((hn < h && v === 0) || (hs < h && v === 15) || (hw < h && u === 0) || (he < h && u === 15)) L += 0.8;

      let c: number;
      const pd = pondD(x, z);
      const wob = (fbm(px / 5, 7, pz / 5, SEED) - 0.5);
      if (pd < 1.0) c = tone(bed, L * 0.5 - (1 - pd) * 3.2 - 0.5);
      else if (pd < 1.16 + wob * 0.1) c = tone(sand, L * 0.6 + (pd - 1.08) * 6 - 0.4 + (hash(px >> 1, 3, pz >> 1, SEED) > 0.9 ? -1.6 : 0));
      else {
        const p = pathD(x, z) + wob * 0.55;
        const dith = hash(px, 5, pz, SEED);
        if (p < 0.78 || (p < 1.02 && dith < (1.02 - p) / 0.24)) {
          const pe = hash(px >> 1, 6, pz >> 1, SEED);
          c = tone(path, L * 0.7 + (pe > 0.94 ? 1.4 : pe < 0.05 ? -1.3 : 0) - (p > 0.6 ? 0.5 : 0));
        } else if (open < 0.3 && fbm(px / 9, 6, pz / 9, SEED) > 0.6 + open && dith > 0.25) {
          c = tone(soil, L * 0.8 + (dith > 0.9 ? 1.2 : 0));
        } else {
          if (inGarden(x, z, 0.2)) L += (Math.floor((x + z) * 0.8 + 40) % 2 ? 0.45 : 0.05);
          if (p < 1.3) L -= 0.5;
          c = tone(grass, L);
        }
      }
      const k = (pz * S + px) * 4;
      data[k] = (c >> 16) & 255; data[k + 1] = (c >> 8) & 255; data[k + 2] = c & 255; data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function sidePainter(): Painter {
  const grass = ramp(PAL.grassDeep, { n: 7 }), soil = ramp(PAL.dirt, { n: 7 }), stone = ramp('#8a8f9c', { n: 7 }), wet = ramp('#6d7f72', { n: 7 });
  return (t) => {
    const col = Math.floor(t.face < 2 ? t.z : t.x), fromTop = t.sy - t.by;
    const fringe = 2 + Math.floor(hash(col, 1, t.face, SEED) * 3.4);
    let L = (fbm(t.x / 3.2, t.y / 3.2, t.z / 3.2, SEED) - 0.5) * 2 + (t.by < 3 ? -(3 - t.by) * 0.45 : 0) + (t.face === 0 || t.face === 4 ? 0.2 : -0.3);
    if (t.y < WATER_Y * 16 + 1) return tone(wet, L - 0.6);
    if (fromTop <= fringe) return tone(grass, L * 0.5 + 0.9 - fromTop * 0.45);
    if (fromTop <= fringe + 1) L -= 1.1;
    const pe = hash(Math.floor(t.x / 2), Math.floor(t.y / 2), Math.floor(t.z / 2), SEED + 2);
    if (pe > 0.9) return tone(stone, L * 0.6 + 0.3);
    if (Math.floor(t.y + hash(col >> 2, 2, 0, SEED) * 3) % 6 === 0) L -= 0.7;
    return tone(soil, L);
  };
}

const WATER_VS = /* glsl */ `
varying vec2 vW;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FS = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam; uniform vec3 uLight;
uniform vec4 uPond;
varying vec2 vW;
#include <fog_pars_fragment>
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 q = (floor(vW * 16.0) + 0.5) / 16.0;
  vec2 d = (q - uPond.xy) / uPond.zw;
  float a = atan(d.y, d.x);
  float pd = length(d) + 0.08 * sin(a * 3.0 + 1.3) + 0.05 * sin(a * 7.0 + 0.4);
  if (pd > 1.04) discard;
  float n = sin(q.x * 3.1 + uTime * 0.7) * sin(q.y * 4.3 - uTime * 0.5) + 0.5 * sin((q.x + q.y) * 6.0 + uTime * 1.1);
  float band = floor((n * 0.4 + 0.5) * 4.0) / 4.0;
  vec3 col = mix(uDeep, uShallow, clamp(smoothstep(0.25, 1.0, pd) * 0.75 + band * 0.3, 0.0, 1.0));
  float foam = step(0.94 + 0.025 * sin(uTime * 1.4 + a * 9.0), pd);
  col = mix(col, uFoam, foam * 0.85);
  float sp = step(0.988, h21(q * 16.0 + floor(uTime * 2.5) * 7.0)) * (1.0 - foam);
  col = col * uLight + sp * uFoam * 0.7;
  gl_FragColor = vec4(col, 0.72 + foam * 0.25 + sp * 0.2);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export interface Terrain {
  group: THREE.Group;
  water: THREE.ShaderMaterial;
  dispose(): void;
}

export function buildTerrain(shade: Collider[]): Terrain {
  const group = new THREE.Group();

  // top faces: one quad per cell, all sampling the single painted texture
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const y = cellH(i, j), x0 = i - HALF, z0 = j - HALF, b = pos.length / 3;
    pos.push(x0, y, z0, x0, y, z0 + 1, x0 + 1, y, z0 + 1, x0 + 1, y, z0);
    uv.push(i / N, j / N, i / N, (j + 1) / N, (i + 1) / N, (j + 1) / N, (i + 1) / N, j / N);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const topTex = paintTop(shade);
  const top = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: topTex }));
  top.receiveShadow = true;
  top.name = 'ground';
  group.add(top);

  // exposed sides: a column box per stepped cell, hidden faces dropped
  const sides: BoxSpec[] = [], sp = sidePainter();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const h = cellH(i, j);
    const nb: [number, string][] = [[cellH(i + 1, j), 'e'], [cellH(i - 1, j), 'w'], [cellH(i, j + 1), 's'], [cellH(i, j - 1), 'n']];
    const low = Math.min(...nb.map((n) => n[0]));
    if (low >= h) continue;
    const skip = 'ud' + nb.filter((n) => n[0] >= h).map((n) => n[1]).join('');
    sides.push({ at: [(i - HALF) * 16, low * 16, (j - HALF) * 16], size: [16, (h - low) * 16, 16], mat: sp, skip });
  }
  const sideProp = buildProp(sides, { wind: false });
  const sideMesh = propMesh(sideProp);
  sideMesh.castShadow = false;
  group.add(sideMesh);

  // pond surface
  const water = new THREE.ShaderMaterial({
    vertexShader: WATER_VS, fragmentShader: WATER_FS, transparent: true, fog: true, depthWrite: false,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uDeep: { value: new THREE.Color('#2f7fa8') }, uShallow: { value: new THREE.Color('#7fd6e6') }, uFoam: { value: new THREE.Color('#f4ffff') },
      uLight: { value: new THREE.Color(1, 1, 1) }, uPond: { value: new THREE.Vector4(POND.x, POND.z, POND.rx, POND.rz) },
    }]),
  });
  const wm = new THREE.Mesh(new THREE.PlaneGeometry(POND.rx * 2.4, POND.rz * 2.4), water);
  wm.rotation.x = -Math.PI / 2;
  wm.position.set(POND.x, WATER_Y, POND.z);
  wm.renderOrder = 2;
  group.add(wm);

  return {
    group, water,
    dispose() { geo.dispose(); topTex.dispose(); sideProp.geo.dispose(); sideProp.tex.dispose(); water.dispose(); },
  };
}
