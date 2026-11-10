// The garden plot: placed furniture and decorations, the seats/beds/toys they offer the animals,
// their night-time lights, and the edit mode for moving things around.
import * as THREE from 'three';
import type { Placed } from '@shared/types.ts';
import { box, buildProp, propMesh, type BoxSpec, type Prop } from '../gfx/box.ts';
import { rock, wood } from '../gfx/mats.ts';
import { rng } from '../gfx/noise.ts';
import { ITEM, type ItemDef } from '../assets/furniture.ts';
import { PAL } from '../assets/nature.ts';
import type { Seat } from './actor.ts';
import type { Fx } from './fx.ts';
import { SPR } from './fx.ts';
import { GARDEN, type Collider } from './layout.ts';

const cache = new Map<string, Prop>();
export function itemProp(id: string): Prop {
  let p = cache.get(id);
  if (!p) { p = buildProp(ITEM[id].build()); cache.set(id, p); }
  return p;
}

interface Live { placed: Placed; def: ItemDef; mesh: THREE.Mesh; light?: THREE.PointLight; halo?: THREE.Sprite }

function haloTexture(): THREE.DataTexture {
  const n = 16, d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x - 7.5, y - 7.5) / 8, v = Math.max(0, 1 - r);
    const q = Math.floor(v * v * 5) / 5; // stepped falloff: a pixel-art glow, not a smooth blur
    const k = (y * n + x) * 4; d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = q * 255;
  }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}

export class Garden {
  readonly group = new THREE.Group();
  private live = new Map<string, Live>();
  private border: THREE.Mesh | null = null;
  private halo = haloTexture();
  seats: Seat[] = [];
  colliders: Collider[] = [];
  unlocked = false;
  // edit mode
  editing = false;
  selected: string | null = null;
  private ghost: THREE.Mesh | null = null;
  private ghostId: string | null = null;
  private ring: THREE.Mesh;
  private fireT = 0;

  constructor(private fx: Fx) {
    const g = new THREE.RingGeometry(0.75, 0.9, 20);
    g.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xfff3a0, transparent: true, opacity: 0.9, depthTest: false, fog: false }));
    this.ring.renderOrder = 9; this.ring.visible = false;
    this.group.add(this.ring);
  }

  static toWorld(p: { x: number; z: number }) { return { x: GARDEN.x + p.x, z: GARDEN.z + p.z }; }
  static toLocal(x: number, z: number) { return { x: Math.round((x - GARDEN.x) * 2) / 2, z: Math.round((z - GARDEN.z) * 2) / 2 }; }
  static inside(l: { x: number; z: number }) { return Math.abs(l.x) <= GARDEN.hw - 0.5 && Math.abs(l.z) <= GARDEN.hd - 0.5; }

  /** Bring the scene in line with the saved garden. */
  sync(items: Placed[], unlocked: boolean) {
    if (unlocked !== this.unlocked || !this.border) { this.unlocked = unlocked; this.buildBorder(); }
    const keep = new Set(items.map((i) => i.id));
    for (const [id, l] of this.live) if (!keep.has(id)) { this.drop(l); this.live.delete(id); }
    for (const p of items) {
      const def = ITEM[p.item];
      if (!def) continue;
      let l = this.live.get(p.id);
      if (!l) {
        const mesh = propMesh(itemProp(p.item));
        mesh.userData.placedId = p.id;
        this.group.add(mesh);
        l = { placed: p, def, mesh };
        if (def.light) {
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.halo, color: def.light.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
          s.scale.setScalar(2.6 * def.light.power);
          this.group.add(s); l.halo = s;
          if ([...this.live.values()].filter((x) => x.light).length < 4) { l.light = new THREE.PointLight(def.light.color, 0, 9, 1.6); this.group.add(l.light); }
        }
        this.live.set(p.id, l);
      }
      l.placed = p;
      this.pose(l);
    }
    this.reindex();
  }

  private pose(l: Live) {
    const w = Garden.toWorld(l.placed), yaw = (l.placed.rot * Math.PI) / 2;
    l.mesh.position.set(w.x, 0, w.z); l.mesh.rotation.y = yaw;
    if (l.def.light) {
      const p = new THREE.Vector3(l.def.light.x / 16, l.def.light.y / 16, l.def.light.z / 16).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(l.mesh.position);
      l.halo?.position.copy(p); l.light?.position.copy(p);
    }
  }

  private drop(l: Live) { this.group.remove(l.mesh); if (l.light) this.group.remove(l.light); if (l.halo) { this.group.remove(l.halo); l.halo.material.dispose(); } }

  private reindex() {
    const taken = new Map(this.seats.filter((s) => s.taken).map((s) => [`${s.x.toFixed(2)},${s.z.toFixed(2)}`, s.taken!]));
    this.seats = []; this.colliders = [];
    const up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3();
    for (const l of this.live.values()) {
      const yaw = (l.placed.rot * Math.PI) / 2, w = Garden.toWorld(l.placed), prop = itemProp(l.placed.item);
      const add = (a: { x: number; y: number; z: number; rot?: number }, kind: Seat['kind']) => {
        v.set(a.x / 16, 0, a.z / 16).applyAxisAngle(up, yaw);
        const s: Seat = { x: w.x + v.x, y: a.y / 16, z: w.z + v.z, rot: yaw + ((a.rot ?? 0) * Math.PI) / 180, kind };
        s.taken = taken.get(`${s.x.toFixed(2)},${s.z.toFixed(2)}`) ?? null;
        this.seats.push(s);
      };
      l.def.sit?.forEach((a) => add(a, l.def.id === 'desk' ? 'study' : 'sit'));
      if (l.def.sleep) add(l.def.sleep, 'sleep');
      if (l.def.eat) add(l.def.eat, 'eat');
      if (l.def.play) add(l.def.play, 'play');
      if (!l.def.flatItem) this.colliders.push({ x: w.x, z: w.z, r: Math.min(1.5, Math.max(0.35, prop.radius * 0.8)) });
    }
  }

  /** A low stone edging once the plot is unlocked, or a little "plot for sale" stake before that. */
  private buildBorder() {
    if (this.border) { this.group.remove(this.border); this.border.geometry.dispose(); }
    const r = rng(77), b: BoxSpec[] = [];
    if (this.unlocked) {
      const hw = GARDEN.hw * 16, hd = GARDEN.hd * 16;
      const stone = (x: number, z: number) => { const s = r.int(3, 5); b.push({ ...box(x + r.range(-1, 1), -0.8, z + r.range(-1, 1), s + 1, s - 1, s, rock(r.chance(0.5) ? PAL.stone : '#a39a8d', { seed: r.int(0, 99), moss: PAL.moss })), rot: [0, r.range(0, 90), 0] }); };
      for (let x = -hw; x <= hw; x += 6) { stone(x, -hd); if (Math.abs(x) > 14) stone(x, hd); }
      for (let z = -hd + 6; z < hd; z += 6) { stone(-hw, z); stone(hw, z); }
    } else {
      const w = wood('#b87a41', { axis: 'y', plank: 0 });
      b.push(box(0, 0, 0, 2, 12, 2, w), { ...box(0, 7, 1.2, 12, 6, 1, wood('#dcab68', { axis: 'x', plank: 3 })), rot: [0, 0, -4] });
    }
    this.border = propMesh(buildProp(b));
    this.border.position.set(GARDEN.x + (this.unlocked ? 0 : 3.6), 0, GARDEN.z + (this.unlocked ? 0 : 2.8));
    this.group.add(this.border);
  }

  // ---------------------------------------------------------------- edit mode

  /** Show a translucent copy of an item following the pointer until it is placed. */
  beginGhost(itemId: string) {
    this.endGhost();
    const m = propMesh(itemProp(itemId));
    m.material = (m.material as THREE.Material[]).map((x) => { const c = x.clone(); c.transparent = true; c.opacity = 0.7; return c; });
    m.castShadow = false;
    this.ghost = m; this.ghostId = itemId;
    this.group.add(m);
    m.position.set(GARDEN.x, 0, GARDEN.z);
  }
  endGhost() { if (this.ghost) { this.group.remove(this.ghost); (this.ghost.material as THREE.Material[]).forEach((m) => m.dispose()); } this.ghost = null; this.ghostId = null; }
  get ghostItem() { return this.ghostId; }
  moveGhost(x: number, z: number, rot: number): { x: number; z: number; ok: boolean } {
    const l = Garden.toLocal(x, z), ok = Garden.inside(l) && this.unlocked;
    const w = Garden.toWorld({ x: Math.max(-GARDEN.hw + 0.5, Math.min(GARDEN.hw - 0.5, l.x)), z: Math.max(-GARDEN.hd + 0.5, Math.min(GARDEN.hd - 0.5, l.z)) });
    if (this.ghost) { this.ghost.position.set(w.x, 0.02, w.z); this.ghost.rotation.y = (rot * Math.PI) / 2; }
    this.ring.visible = true; this.ring.position.set(w.x, 0.06, w.z);
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0xbdf58a : 0xff7a6a);
    return { ...Garden.toLocal(w.x, w.z), ok };
  }
  select(id: string | null) {
    this.selected = id;
    const l = id ? this.live.get(id) : null;
    this.ring.visible = !!l;
    if (l) { this.ring.position.set(l.mesh.position.x, 0.06, l.mesh.position.z); (this.ring.material as THREE.MeshBasicMaterial).color.setHex(0xfff3a0); const s = Math.max(0.8, itemProp(l.placed.item).radius * 1.15); this.ring.scale.set(s, 1, s); }
    else this.ring.scale.set(1, 1, 1);
  }
  /** The placed item under a ray, if any. */
  pick(ray: THREE.Raycaster): string | null {
    const hits = ray.intersectObjects([...this.live.values()].map((l) => l.mesh), false);
    return hits.length ? (hits[0].object.userData.placedId as string) : null;
  }

  update(dt: number, t: number, night: number) {
    const glow = 0.25 + night * 0.75;
    for (const l of this.live.values()) {
      if (!l.def.light) continue;
      const fire = l.def.id === 'campfire', flick = fire ? 0.82 + Math.sin(t * 13 + l.mesh.position.x) * 0.1 + Math.sin(t * 7.3) * 0.08 : 1;
      if (l.light) l.light.intensity = l.def.light.power * 9 * night * flick;
      if (l.halo) (l.halo.material as THREE.SpriteMaterial).opacity = (fire ? 0.55 : 0.4) * glow * flick;
    }
    if ((this.fireT -= dt) <= 0) {
      this.fireT = 0.12;
      for (const l of this.live.values()) {
        if (l.def.id !== 'campfire') continue;
        const p = l.mesh.position, R = (a: number, b: number) => a + Math.random() * (b - a);
        this.fx.emit({ x: p.x + R(-0.15, 0.15), y: 0.35, z: p.z + R(-0.15, 0.15), vy: R(0.8, 1.4), life: R(0.5, 0.9), frame: SPR.flame1, frames: 2, fps: 9, size: R(0.35, 0.55), color: Math.random() < 0.5 ? 0xffb347 : 0xff7a2e, add: true, fadeOut: 0.4, flutter: 0.2 });
        if (Math.random() < 0.3) this.fx.emit({ x: p.x, y: 0.7, z: p.z, vx: R(-0.3, 0.3), vy: R(1, 1.8), vz: R(-0.3, 0.3), life: R(1, 1.8), frame: SPR.mote, size: 0.3, color: 0xffd27a, add: true, wind: 0.5, flutter: 0.4 });
      }
    }
  }
}
