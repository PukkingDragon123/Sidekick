// Inventory icons are small renders of the real 3D models (the way block games draw their items),
// finished with an ink outline so they sit comfortably next to the hand-drawn pixel UI.
import * as THREE from 'three';
import { SPECIES_INFO } from '@shared/species.ts';
import type { Look, Outfit, Sidekick, SpeciesId } from '@shared/types.ts';
import { buildAnimal } from '../assets/animals.ts';
import { FOOD, ITEM } from '../assets/furniture.ts';
import { buildProp, propMesh } from '../gfx/box.ts';
import { itemProp } from '../world/garden.ts';

const S = 96;
let R: THREE.WebGLRenderer | null = null, scene: THREE.Scene, cam: THREE.OrthographicCamera;
const cache = new Map<string, string>();

function setup() {
  const c = document.createElement('canvas');
  R = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
  R.setSize(S, S, false);
  R.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb4b8d6, 1.55));
  const d = new THREE.DirectionalLight(0xfff2dc, 1.7);
  d.position.set(-4, 7, 6);
  scene.add(d);
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
}

function shoot(obj: THREE.Object3D, yaw: number, pitch: number, crop?: THREE.Box3): string {
  if (!R) setup();
  scene.add(obj);
  obj.updateMatrixWorld(true);
  const b = crop ?? new THREE.Box3().setFromObject(obj), c = b.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  cam.position.copy(c).addScaledVector(dir, 60);
  cam.lookAt(c);
  cam.updateMatrixWorld();
  const pb = new THREE.Box3();
  for (let i = 0; i < 8; i++) pb.expandByPoint(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(cam.matrixWorldInverse));
  const half = Math.max(pb.max.x - pb.min.x, pb.max.y - pb.min.y) / 2 * 1.1 + 0.02, mx = (pb.max.x + pb.min.x) / 2, my = (pb.max.y + pb.min.y) / 2;
  cam.left = mx - half; cam.right = mx + half; cam.top = my + half; cam.bottom = my - half;
  cam.updateProjectionMatrix();
  R!.render(scene, cam);
  scene.remove(obj);

  const out = document.createElement('canvas');
  out.width = out.height = S;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(R!.domElement, 0, 0);
  const img = ctx.getImageData(0, 0, S, S), d = img.data, solid = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) solid[i] = d[i * 4 + 3] > 110 ? 1 : 0;
  // two-pixel ink outline around the silhouette
  for (let pass = 0; pass < 2; pass++) {
    const grow: number[] = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (solid[i]) continue;
      if ((x > 0 && solid[i - 1]) || (x < S - 1 && solid[i + 1]) || (y > 0 && solid[i - S]) || (y < S - 1 && solid[i + S])) grow.push(i);
    }
    for (const i of grow) { solid[i] = 1; d[i * 4] = 0x2b; d[i * 4 + 1] = 0x1d; d[i * 4 + 2] = 0x14; d[i * 4 + 3] = 255; }
  }
  ctx.putImageData(img, 0, 0);
  return out.toDataURL();
}

const memo = (key: string, make: () => string): string => {
  let u = cache.get(key);
  if (!u) { try { u = make(); } catch { u = ''; } cache.set(key, u); }
  return u;
};

export const itemIcon = (id: string) => memo('i:' + id, () => (ITEM[id] ? shoot(propMesh(itemProp(id)), 0.6, 0.55) : ''));
export const foodIcon = (id: string) => memo('f:' + id, () => (FOOD[id] ? shoot(propMesh(buildProp(FOOD[id].build())), 0.6, 0.6) : ''));

const lookKey = (l: Look) => [l.species, l.fur, l.fur2, l.accent, l.eye, l.eyeStyle, l.pattern, l.ears, l.tail, l.build, l.blush].join('|');

function animalShot(look: Look, outfit: Outfit, part: 'face' | 'full' | 'top'): string {
  const a = buildAnimal(look, outfit), root = a.rig.root;
  root.updateMatrixWorld(true);
  const full = new THREE.Box3().setFromObject(root), g = a.geo, px = 1 / 16;
  let crop: THREE.Box3 | undefined;
  if (part === 'face') crop = new THREE.Box3(new THREE.Vector3(-g.hw / 2 * px - 0.1, (g.neck - 0.5) * px, -0.4), new THREE.Vector3(g.hw / 2 * px + 0.1, full.max.y, 0.6));
  if (part === 'top') crop = new THREE.Box3(new THREE.Vector3(full.min.x, (g.neck - 2) * px, full.min.z), full.max.clone());
  const url = shoot(root, part === 'face' ? 0.32 : 0.5, part === 'face' ? 0.12 : 0.22, crop);
  a.dispose();
  return url;
}

export const faceIcon = (sk: Pick<Sidekick, 'look' | 'outfit'>) => memo('p:' + lookKey(sk.look) + JSON.stringify(sk.outfit), () => animalShot(sk.look, sk.outfit, 'face'));
export const speciesIcon = (sp: SpeciesId) => memo('s:' + sp, () => animalShot({ species: sp, ...SPECIES_INFO[sp].look }, {}, 'full'));
/** An outfit piece shown on the player's own animal. */
export const outfitIcon = (id: string, slot: string, look: Look) => memo('o:' + id + lookKey(look), () => animalShot(look, { [slot]: id }, slot === 'head' || slot === 'face' ? 'top' : 'full'));
