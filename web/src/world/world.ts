// The forest scene: owns the renderer, camera rig, terrain, planting, sky, particles, critters,
// the animals and the garden, and exposes a small API for the UI.
import * as THREE from 'three';
import type { Placed, Sidekick } from '@shared/types.ts';
import { wind } from '../gfx/box.ts';
import { Actor, type ActorEnv, type Seat } from './actor.ts';
import { Critters } from './critters.ts';
import { buildFlora, planForest, type Flora, type ForestPlan } from './flora.ts';
import { Fx } from './fx.ts';
import { Garden } from './garden.ts';
import { GARDEN, walkable, type Collider } from './layout.ts';
import { hourFor, Sky, type SkyMode } from './sky.ts';
import { buildTerrain, type Terrain } from './terrain.ts';

export type Quality = 'low' | 'high';
export type Focus = 'home' | 'sidekick' | 'wardrobe' | 'garden';

export type WorldEvent =
  | { type: 'tapActor'; id: string }
  | { type: 'tapGround'; x: number; z: number }
  | { type: 'tapItem'; id: string }
  | { type: 'ghost'; x: number; z: number; ok: boolean }
  | { type: 'moved'; id: string; x: number; z: number }
  | { type: 'sound'; id: string; at?: THREE.Vector3 };

export interface WorldOpts { canvas: HTMLCanvasElement; quality: Quality }
interface CamRig { yaw: number; pitch: number; dist: number; target: THREE.Vector3 }
const rig = (): CamRig => ({ yaw: -0.3, pitch: 0.5, dist: 21, target: new THREE.Vector3(0, 1.3, 0) });

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.5, 400);
  readonly sky: Sky;
  readonly plan: ForestPlan;
  readonly terrain: Terrain;
  readonly flora: Flora;
  readonly fx: Fx;
  readonly critters: Critters;
  readonly garden: Garden;
  readonly quality: Quality;
  readonly actors = new Map<string, Actor>();
  activeId = '';
  /** the player's own framing of the forest, kept while other views borrow the camera */
  private home = rig();
  private cam = rig();
  private cur = rig();
  focus: Focus = 'home';
  /** fraction of the screen height hidden by a bottom sheet; the view shifts up to compensate */
  shift = 0;
  private shiftCur = 0;
  skyMode: SkyMode = 'clock';
  time = 0;
  frames = 0;
  paused = false;
  ghostRot = 0;
  private last = 0;
  private raf = 0;
  private skyT = 0;
  private listeners: ((e: WorldEvent) => void)[] = [];
  private ray = new THREE.Raycaster();
  private env: ActorEnv;
  private blockers: Collider[] = [];

  constructor(o: WorldOpts) {
    this.quality = o.quality;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio || 1, o.quality === 'high' ? 2 : 1.5));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;

    this.plan = planForest(o.quality);
    this.sky = new Sky(this.scene, o.quality === 'high' ? 2048 : 1024);
    this.terrain = buildTerrain(this.plan.shade);
    this.flora = buildFlora(this.plan);
    this.fx = new Fx(o.quality === 'high' ? 1800 : 900);
    const sound = (id: string, at?: THREE.Vector3) => this.emit({ type: 'sound', id, at });
    this.critters = new Critters(this.plan, this.fx, o.quality, sound);
    this.garden = new Garden(this.fx);
    this.scene.add(this.terrain.group, this.flora.group, this.garden.group, this.critters.group, this.fx.group);

    const natural: Seat[] = this.plan.seats.map((s) => ({ ...s, kind: 'sit' as const }));
    this.env = {
      fx: this.fx, camera: this.camera, sound,
      colliders: () => this.blockers,
      seats: () => [...natural, ...this.garden.seats],
      flowers: () => this.plan.flowers,
      chaseTarget: () => (this.sidekick ? this.critters.nearestButterfly(this.sidekick.pos) : null),
      isNight: () => this.sky.night > 0.6,
    };
    this.resize();
    this.applySky();
    this.input(o.canvas);
  }

  on(f: (e: WorldEvent) => void) { this.listeners.push(f); return () => { this.listeners = this.listeners.filter((x) => x !== f); }; }
  private emit(e: WorldEvent) { for (const f of this.listeners) f(e); }

  get sidekick(): Actor | undefined { return this.actors.get(this.activeId); }

  /** Make the set of animals in the forest match the save. `present` is false while the active one is on another device. */
  setSidekicks(list: Sidekick[], activeId: string, present = true) {
    const ids = new Set(list.map((s) => s.id));
    for (const [id, a] of this.actors) if (!ids.has(id)) { this.scene.remove(a.node); a.animal.dispose(); this.actors.delete(id); }
    list.forEach((sk, i) => {
      let a = this.actors.get(sk.id);
      if (!a) {
        a = new Actor(sk, this.env);
        const ang = i * 2.1 + 0.6, d = 2.2 + (i % 3);
        let x = GARDEN.x + Math.cos(ang) * d, z = GARDEN.z + 2.5 + Math.sin(ang) * d * 0.6;
        if (!walkable(x, z)) { x = 0; z = 3; }
        a.place(x, z, 0.3);
        this.scene.add(a.node);
        this.actors.set(sk.id, a);
      } else if (JSON.stringify(a.sk.look) !== JSON.stringify(sk.look) || JSON.stringify(a.sk.outfit) !== JSON.stringify(sk.outfit)) a.rebuild(sk);
      else a.sk = sk;
      a.companion = sk.id !== activeId;
    });
    this.activeId = activeId;
    const s = this.sidekick;
    if (s && !present && s.visible) { s.animal.rig.root.visible = false; s.visible = false; s.action = 'gone'; }
  }

  setGarden(items: Placed[], unlocked: boolean) { this.garden.sync(items, unlocked); }

  setFocus(f: Focus) {
    if (this.focus === 'home') this.saveHome();
    this.focus = f;
    for (const a of this.actors.values()) a.attentive = false;
    const s = this.sidekick;
    if (s) { s.attentive = f === 'sidekick' || f === 'wardrobe'; s.busy = f === 'wardrobe'; if (f === 'wardrobe') s.act('idle', 0); }
    if (f === 'home') Object.assign(this.cam, { yaw: this.home.yaw, pitch: this.home.pitch, dist: this.home.dist });
  }
  private saveHome() { this.home.yaw = this.cam.yaw; this.home.pitch = this.cam.pitch; this.home.dist = this.cam.dist; }

  /** Screen position (CSS px) of a world point, for anchoring speech bubbles. */
  screenOf(v: THREE.Vector3): { x: number; y: number; behind: boolean } {
    const p = v.clone().project(this.camera), c = this.renderer.domElement;
    return { x: (p.x * 0.5 + 0.5) * c.clientWidth, y: (-p.y * 0.5 + 0.5) * c.clientHeight, behind: p.z > 1 };
  }

  resize() {
    const c = this.renderer.domElement, w = c.clientWidth || innerWidth, h = c.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep a comfortable horizontal view in portrait by opening up the vertical FOV
    const hf = (30 * Math.PI) / 180;
    this.camera.fov = Math.min(48, Math.max(30, (2 * Math.atan(Math.tan(hf / 2) / Math.min(1, this.camera.aspect)) * 180) / Math.PI));
    this.camera.updateProjectionMatrix();
  }

  applySky() {
    this.sky.setHour(hourFor(this.skyMode));
    (this.terrain.water.uniforms.uLight.value as THREE.Color).copy(this.sky.ambient).multiplyScalar(1.15);
    (this.terrain.water.uniforms.uDeep.value as THREE.Color).set(this.sky.night > 0.5 ? 0x1c3a6a : 0x2f7fa8);
    this.fx.setLight(this.sky.ambient);
  }

  start() {
    const loop = (ms: number) => {
      this.raf = requestAnimationFrame(loop);
      const t = ms / 1000, dt = Math.min(0.05, this.last ? t - this.last : 0.016);
      this.last = t;
      if (!this.paused) this.step(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this.raf); }

  /** Advance the simulation; pass `draw = false` to fast-forward without rendering. */
  step(dt: number, draw = true) {
    this.time += dt;
    const t = this.time;
    wind.uTime.value = t;
    // gusts: strength breathes slowly so the whole meadow leans and relaxes
    const gust = 0.07 + 0.05 * Math.sin(t * 0.21) + 0.03 * Math.sin(t * 0.53 + 1.3);
    wind.uWind.value.z = gust;
    this.fx.windX = wind.uWind.value.x * gust * 9; this.fx.windZ = wind.uWind.value.y * gust * 9;
    this.terrain.water.uniforms.uTime.value = t;
    if ((this.skyT -= dt) <= 0) { this.skyT = 20; if (this.skyMode === 'clock') this.applySky(); }

    // animals steer around scenery, furniture and each other
    this.blockers = [...this.plan.colliders, ...this.garden.colliders];
    for (const a of this.actors.values()) if (a.visible && a.action !== 'walk') this.blockers.push({ x: a.pos.x, z: a.pos.z, r: 0.5 });
    for (const a of this.actors.values()) a.update(dt, t);
    // grass physics: each animal presses the plants around it; the press eases in and springs back out
    let pi = 0;
    for (const a of this.actors.values()) {
      if (pi >= 6) break;
      const target = a.visible ? (a.action === 'walk' ? 1 : a.action === 'sit' || a.action === 'sleep' || a.action === 'eat' ? 1.25 : 0.7) : 0;
      a.press += (target - a.press) * Math.min(1, dt * (target > a.press ? 10 : 3));
      wind.uPush.value[pi++].set(a.pos.x, a.pos.z, 0.95, a.press);
    }
    while (pi < 6) wind.uPush.value[pi++].set(0, 0, 0, 0);
    const spots = [...this.actors.values()].filter((a) => a.visible).map((a) => a.pos);
    this.critters.update(dt, t, spots, this.sky.night, wind.uWind.value.x, wind.uWind.value.y, gust);
    this.garden.update(dt, t, this.sky.night);
    this.fx.update(dt, t);

    // camera goal for the current focus
    const g = this.cam, s = this.sidekick;
    if (this.focus === 'home') {
      // follow the sidekick more closely on narrow screens, where the view is tighter
      const f = this.camera.aspect < 1 ? 0.8 : 0.45;
      g.target.set(s && s.visible ? s.pos.x * f : 0, 1.2, s && s.visible ? s.pos.z * f : 0);
    }
    else if (this.focus === 'garden') { g.target.set(GARDEN.x, 0.4, GARDEN.z); g.pitch = 0.92; g.dist = 21; g.yaw = 0; }
    else if (s) {
      const close = this.focus === 'wardrobe';
      g.target.set(s.pos.x, s.node.position.y + s.height * (close ? 0.5 : 0.62), s.pos.z);
      g.dist = close ? 6.6 : 8.2; g.pitch = close ? 0.3 : 0.26;
      if (close) g.yaw = s.yaw;
    }
    const k = 1 - Math.exp(-dt * 4.5), c = this.cur;
    c.yaw += (g.yaw - c.yaw) * k; c.pitch += (g.pitch - c.pitch) * k; c.dist += (g.dist - c.dist) * k; c.target.lerp(g.target, k);
    const cp = Math.cos(c.pitch);
    this.camera.position.set(c.target.x + Math.sin(c.yaw) * cp * c.dist, c.target.y + Math.sin(c.pitch) * c.dist, c.target.z + Math.cos(c.yaw) * cp * c.dist);
    this.camera.lookAt(c.target);
    this.shiftCur += (this.shift - this.shiftCur) * k;
    const el = this.renderer.domElement, w = el.clientWidth, h = el.clientHeight;
    if (Math.abs(this.shiftCur) > 0.002) this.camera.setViewOffset(w, h, 0, (this.shiftCur * h) / 2, w, h); else this.camera.clearViewOffset();

    this.sky.update(t, this.camera);
    if (!draw) return;
    this.renderer.render(this.scene, this.camera);
    this.frames++;
  }

  /** Jump the eased camera straight to its goal (used on load and for screenshots). */
  snapCamera(o?: Partial<Pick<CamRig, 'yaw' | 'pitch' | 'dist'>>) {
    Object.assign(this.cam, o);
    this.cur.yaw = this.cam.yaw; this.cur.pitch = this.cam.pitch; this.cur.dist = this.cam.dist; this.cur.target.copy(this.cam.target);
  }

  // ---------------------------------------------------------------- input

  private groundPoint(x: number, y: number): THREE.Vector3 | null {
    const c = this.renderer.domElement, r = c.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera);
    const o = this.ray.ray, t = -o.origin.y / o.direction.y;
    return t > 0 ? o.origin.clone().addScaledVector(o.direction, t) : null;
  }

  private input(el: HTMLCanvasElement) {
    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0, pinch = 0, dragId: string | null = null, downAt = 0;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0; downAt = performance.now(); dragId = null;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
      if (this.garden.editing && pts.size === 1 && !this.garden.ghostItem) {
        this.groundPoint(e.clientX, e.clientY);
        const id = this.garden.pick(this.ray);
        if (id && id === this.garden.selected) dragId = id;
      }
    });
    el.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch && this.focus === 'home') this.cam.dist = Math.max(9, Math.min(34, this.cam.dist * (pinch / d)));
        pinch = d;
        return;
      }
      if (this.garden.editing && (this.garden.ghostItem || dragId)) {
        const g = this.groundPoint(e.clientX, e.clientY);
        if (!g) return;
        if (this.garden.ghostItem) this.emit({ type: 'ghost', ...this.garden.moveGhost(g.x, g.z, this.ghostRot) });
        else if (dragId) { const l = Garden.toLocal(g.x, g.z); if (Garden.inside(l)) this.emit({ type: 'moved', id: dragId, x: l.x, z: l.z }); }
        return;
      }
      if (moved > 6 && (this.focus === 'home' || this.focus === 'sidekick')) {
        this.cam.yaw = Math.max(-1.05, Math.min(1.05, this.cam.yaw - dx * 0.005));
        if (this.focus === 'home') this.cam.pitch = Math.max(0.28, Math.min(0.95, this.cam.pitch + dy * 0.004));
      }
    });
    const up = (e: PointerEvent) => {
      const had = pts.delete(e.pointerId);
      if (!had || pts.size > 0) return;
      if (moved > 8 || performance.now() - downAt > 600) return;
      const g = this.groundPoint(e.clientX, e.clientY);
      if (this.garden.editing) {
        if (this.garden.ghostItem) { if (g) this.emit({ type: 'ghost', ...this.garden.moveGhost(g.x, g.z, this.ghostRot) }); return; }
        const id = this.garden.pick(this.ray);
        this.emit({ type: 'tapItem', id: id ?? '' });
        return;
      }
      // animals first: nearest one whose body the ray passes through
      let best: Actor | null = null, bd = 1e9;
      for (const a of this.actors.values()) {
        if (!a.visible) continue;
        const c = new THREE.Vector3(a.pos.x, a.node.position.y + a.height * 0.5, a.pos.z);
        const d = this.ray.ray.distanceToPoint(c), along = c.distanceTo(this.ray.ray.origin);
        if (d < a.height * 0.55 && along < bd) { bd = along; best = a; }
      }
      if (best) return this.emit({ type: 'tapActor', id: best.sk.id });
      if (g) this.emit({ type: 'tapGround', x: g.x, z: g.z });
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); });
    el.addEventListener('wheel', (e) => { if (this.focus === 'home') this.cam.dist = Math.max(9, Math.min(34, this.cam.dist * (1 + Math.sign(e.deltaY) * 0.08))); e.preventDefault(); }, { passive: false });
  }
}
