// Contact sheet: lays assets out the way the reference sheets do (3/4 view, dark flat backdrop,
// offset drop shadows) so renders can be compared against the references side by side.
import * as THREE from 'three';
import { buildProp, propMesh, type BoxSpec } from './gfx/box.ts';

export interface SheetItem { name: string; obj: THREE.Object3D }

const q = new URLSearchParams(location.search);
const setName = q.get('set') ?? 'nature';
const BG: Record<string, number> = { furniture: 0x35161b, food: 0x35161b, default: 0x2e3a4b };

const prop = (name: string, boxes: BoxSpec[]): SheetItem => ({ name, obj: propMesh(buildProp(boxes)) });

async function load(): Promise<SheetItem[]> {
  if (setName === 'nature' || setName === 'trees' || setName === 'plants') {
    const N = await import('./assets/nature.ts');
    const plants = [
      prop('grass', N.grassClump(1)), prop('grass2', N.grassClump(2)), prop('tall', N.grassClump(3, true)), prop('fern', N.fern(4)),
      prop('clover', N.clover(5)), prop('daisy', N.daisy(6)), prop('daisy2', N.daisy(7, '#ffd9e6', '#f59a2f')), prop('tulip', N.tulip(8)),
      prop('tulip2', N.tulip(9, '#f9cf45')), prop('bluebell', N.bluebell(10)), prop('lavender', N.lavender(11)), prop('poppy', N.poppy(12)),
      prop('sunflower', N.sunflower(13)), prop('toadstool', N.toadstool(14)), prop('toadstool2', N.toadstool(15, '#da4230', 1.6)),
      prop('bolete', N.bolete(16)), prop('chanterelle', N.chanterelles(17)), prop('glow', N.glowshroom(18)), prop('purple', N.toadstool(19, '#9a6fe0')),
      prop('bush', N.bush(20)), prop('berrybush', N.bush(21, '#3f8f45', '#e0465a')), prop('flowerbush', N.bush(22, '#58a83e', '#fff2f7')),
      prop('rock', N.boulder(23)), prop('rock2', N.boulder(24, '#a39a8d')), prop('pebbles', N.pebbles(25)),
      prop('log', N.fallenLog(26)), prop('stump', N.stump(27)), prop('lily', N.lilyPad(28, true)), prop('reeds', N.reeds(29)), prop('sapling', N.sapling(30)),
    ];
    const trees = [prop('oak', N.oak(31)), prop('oak2', N.oak(32, { leaf: '#3f8f45' })), prop('birch', N.birch(33)), prop('pine', N.pine(34)), prop('blossom', N.blossomTree(35)), prop('maple', N.oak(36, { leaf: '#ee8a2e' }))];
    return setName === 'trees' ? trees : setName === 'plants' ? plants : [...plants, ...trees];
  }
  const m = await import('./sheets.ts');
  return m.sheet(setName, q);
}

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Number(q.get('dpr') ?? 1));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG[setName] ?? BG.default);
scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0c8, 1.25));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.9);
scene.add(sun, sun.target);

load().then((items) => {
  // flow layout in rows
  const gap = Number(q.get('gap') ?? 0.7), rowW = Number(q.get('row') ?? 22);
  let x = 0, z = 0, rowD = 0;
  const bounds = new THREE.Box3();
  for (const it of items) {
    const b = new THREE.Box3().setFromObject(it.obj);
    const w = b.max.x - b.min.x, d = b.max.z - b.min.z;
    if (x + w > rowW && x > 0) { x = 0; z += rowD + gap; rowD = 0; }
    it.obj.position.x += x - b.min.x;
    it.obj.position.z += z - b.min.z;
    x += w + gap; rowD = Math.max(rowD, d);
    scene.add(it.obj);
    bounds.expandByObject(it.obj);
  }
  const c = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.32 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const yaw = (Number(q.get('yaw') ?? 35) * Math.PI) / 180, pitch = (Number(q.get('pitch') ?? 32) * Math.PI) / 180;
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  cam.position.copy(c).addScaledVector(dir, 120);
  cam.lookAt(c);
  cam.updateMatrixWorld();
  // fit the frustum to the projected bounds
  const inv = cam.matrixWorldInverse, pb = new THREE.Box3();
  for (let i = 0; i < 8; i++) pb.expandByPoint(new THREE.Vector3(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z).applyMatrix4(inv));
  const pad = Number(q.get('pad') ?? 0.8), aspect = innerWidth / innerHeight;
  let hw = (pb.max.x - pb.min.x) / 2 + pad, hh = (pb.max.y - pb.min.y) / 2 + pad;
  if (hw / hh > aspect) hh = hw / aspect; else hw = hh * aspect;
  const mx = (pb.max.x + pb.min.x) / 2, my = (pb.max.y + pb.min.y) / 2;
  cam.left = mx - hw; cam.right = mx + hw; cam.top = my + hh; cam.bottom = my - hh;
  cam.updateProjectionMatrix();

  sun.position.set(c.x - 14, 30, c.z + 22);
  sun.target.position.copy(c);
  sun.castShadow = true;
  const s = Math.max(size.x, size.z) * 0.75 + 8;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 120 });
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;

  let frames = 0;
  const loop = () => {
    renderer.render(scene, cam);
    if (++frames === 3) (window as unknown as { __ready: boolean }).__ready = true;
    if (frames < 6) requestAnimationFrame(loop);
  };
  loop();
});
