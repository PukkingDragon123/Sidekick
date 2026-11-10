// An animal in the world: steering, autonomous behaviour and fully procedural animation
// (layered sines and eased poses on the rig's bones, plus swapped eye/mouth frames).
import * as THREE from 'three';
import type { Emote } from '@shared/api.ts';
import type { Sidekick } from '@shared/types.ts';
import { buildAnimal, type Animal, type EyeFrame, type MouthFrame } from '../assets/animals.ts';
import { PX, type Prop, propMesh } from '../gfx/box.ts';
import type { Fx } from './fx.ts';
import { groundY as forestGround, pondD, walkable as forestWalkable, type Collider } from './layout.ts';

export type Action = 'idle' | 'walk' | 'sit' | 'sleep' | 'eat' | 'wave' | 'cheer' | 'dance' | 'think' | 'pose' | 'sniff' | 'laugh' | 'sad' | 'surprised' | 'nod' | 'love' | 'study' | 'gone';

export interface Seat { x: number; y: number; z: number; rot: number; kind?: 'sit' | 'sleep' | 'eat' | 'play' | 'study'; taken?: Actor | null }

export interface ActorEnv {
  fx: Fx;
  colliders(): Collider[];
  seats(): Seat[];
  flowers(): { x: number; z: number }[];
  /** something to chase: a butterfly's position, if any */
  chaseTarget(): THREE.Vector3 | null;
  isNight(): boolean;
  /** audio hooks */
  sound(id: string, at?: THREE.Vector3): void;
  camera: THREE.Camera;
  /** overrides for places that are not the forest (the desktop overlay) */
  ground?(x: number, z: number): number;
  canWalk?(x: number, z: number): boolean;
}

const D = Math.PI / 180;
const BONES = ['hips', 'body', 'head', 'earL', 'earR', 'armL', 'armR', 'legL', 'legR', 'tail', 'tail2', 'cape'] as const;
type Bone = (typeof BONES)[number];
const HOPPERS = new Set(['bunny', 'frog']);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const TALK: MouthFrame[] = ['open1', 'open2', 'neutral', 'open1', 'smile'];

export class Actor {
  animal!: Animal;
  private groundY = (x: number, z: number) => (this.env.ground ? this.env.ground(x, z) : forestGround(x, z));
  private walkable = (x: number, z: number) => (this.env.canWalk ? this.env.canWalk(x, z) : forestWalkable(x, z));
  readonly node = new THREE.Group();
  readonly pos = new THREE.Vector3();
  yaw = 0;
  action: Action = 'idle';
  private actionT = 0;
  private actionLen = 0;
  /** behaviours queued by the UI take priority over wandering */
  busy = false;
  private target: THREE.Vector3 | null = null;
  private onArrive: (() => void) | null = null;
  private stuck = 0;
  private seat: Seat | null = null;
  private phase = 0;
  private speed = 0;
  private idleT = rand(1, 3);
  private cur: Record<string, [number, number, number]> = {};
  private tgt: Record<string, [number, number, number]> = {};
  private lift = 0; private liftT = 0; private squash = 1; private sink = 0; private sinkT = 0;
  private blinkT = rand(1, 4); private blink = 0;
  private earT = rand(2, 6); private earKick = [0, 0];
  private look = 0; private lookT = 0; private lookUp = 0;
  private eyes: EyeFrame | null = null; private eyesT = 0;
  private mouth: MouthFrame | null = null;
  speaking = false;
  /** face the camera while the player is talking to them */
  attentive = false;
  private held: THREE.Object3D | null = null;
  private stepSide = 1;
  private emoteT = 0;
  private fxT = 0;
  energy = 80; joy = 80; hunger = 30;
  companion = false;
  visible = true;

  constructor(public sk: Sidekick, private env: ActorEnv) {
    this.rebuild();
  }

  /** (Re)build the model after a look or outfit change. */
  rebuild(sk: Sidekick = this.sk) {
    this.sk = sk;
    if (this.animal) { this.node.remove(this.animal.rig.root); this.animal.dispose(); }
    this.animal = buildAnimal(sk.look, sk.outfit);
    this.node.add(this.animal.rig.root);
    for (const b of BONES) { this.cur[b] = [0, 0, 0]; this.tgt[b] = [0, 0, 0]; }
    this.held = null;
  }

  get height() { return this.animal.rig.height; }
  headWorld(out = new THREE.Vector3()) { return out.set(this.pos.x, this.node.position.y + this.height + 0.25, this.pos.z); }

  place(x: number, z: number, yaw = 0) { this.pos.set(x, this.groundY(x, z), z); this.yaw = yaw; this.node.position.copy(this.pos); this.node.rotation.y = yaw; }

  // ---------------------------------------------------------------- commands

  goTo(x: number, z: number, then?: () => void, run = false) {
    this.leaveSeat();
    this.target = new THREE.Vector3(x, 0, z);
    this.onArrive = then ?? null;
    this.speed = (run ? 3.4 : 1.9) * (HOPPERS.has(this.sk.look.species) ? 1.1 : 1);
    this.set('walk', 99);
    this.stuck = 0;
  }

  /** Play a one-off action for a while, then return to idling. */
  act(a: Action, seconds = 2.4) {
    if (a !== 'sit' && a !== 'sleep' && a !== 'eat' && a !== 'study') this.leaveSeat();
    this.target = null;
    this.set(a, seconds);
  }

  emote(e: Emote) {
    const h = this.headWorld();
    const fx = this.env.fx;
    this.emoteT = 2.2;
    switch (e) {
      case 'happy': this.face('happy', 'smile', 2); fx.burst('sparkle', h.x, h.y, h.z, 5); this.liftT = 0.35; break;
      case 'cheer': this.act('cheer', 2.2); fx.burst('stars', h.x, h.y, h.z, 10); break;
      case 'think': this.act('think', 2.6); fx.burst('dots', h.x, h.y + 0.2, h.z, 1); break;
      case 'laugh': this.act('laugh', 1.8); break;
      case 'sad': this.act('sad', 2.6); break;
      case 'surprised': this.act('surprised', 1.4); fx.burst('bang', h.x, h.y + 0.2, h.z, 1); break;
      case 'sleepy': this.face('half', 'o', 2.5); fx.burst('zzz', h.x + 0.3, h.y, h.z, 2); break;
      case 'love': this.act('love', 2.4); fx.burst('hearts', h.x, h.y, h.z, 6); break;
      case 'dance': this.act('dance', 4); break;
      case 'pose': this.act('pose', 3); break;
      case 'wave': this.act('wave', 2.2); break;
      case 'nod': this.act('nod', 1.4); break;
    }
  }

  face(eyes: EyeFrame | null, mouth: MouthFrame | null, seconds: number) { this.eyes = eyes; this.mouth = mouth; this.eyesT = seconds; }

  /** Being petted: a happy squish and hearts. */
  pet() {
    const h = this.headWorld();
    this.face('happy', 'smile', 1.6); this.squash = 0.86; this.joy = Math.min(100, this.joy + 4);
    this.env.fx.burst('hearts', h.x, h.y, h.z, 3);
    this.env.sound('pet_happy', this.pos);
  }

  /** Eat a food model: hold it, munch, crumbs, then a happy wiggle. */
  feed(food: Prop, loved: boolean, done?: () => void) {
    this.leaveSeat(true);
    this.target = null;
    const m = propMesh(food);
    m.scale.setScalar(0.8);
    m.position.set(0, -0.1, 0.12);
    this.animal.rig.bones.handR.add(m);
    this.held = m;
    this.set('eat', 3.4);
    this.after = () => {
      if (this.held) { this.held.parent?.remove(this.held); this.held = null; }
      const h = this.headWorld();
      if (loved) { this.emote('love'); this.env.fx.burst('hearts', h.x, h.y, h.z, 6); } else this.emote('happy');
      done?.();
    };
  }
  private after: (() => void) | null = null;

  /** Dissolve into pixels that spiral upward (the device hop), or re-form from them. */
  teleport(out: boolean, done?: () => void) {
    const s = this.animal.rig.samples, fx = this.env.fx, m = this.node.matrixWorld, v = new THREE.Vector3();
    this.node.updateMatrixWorld(true);
    const top = this.pos.y + this.height + 2.6, n = Math.min(520, s.length / 4), step = Math.max(1, Math.floor(s.length / 4 / n));
    for (let i = 0; i < s.length / 4; i += step) {
      v.set(s[i * 4] * PX, s[i * 4 + 1] * PX, s[i * 4 + 2] * PX).applyMatrix4(m);
      const delay = out ? (v.y - this.pos.y) * 0.16 + Math.random() * 0.12 : Math.random() * 0.25;
      if (out) fx.emit({ x: v.x, y: v.y, z: v.z, vx: rand(-0.6, 0.6), vy: rand(0.2, 1), vz: rand(-0.6, 0.6), life: 1.25, frame: 17, size: 0.085, color: s[i * 4 + 3], tx: this.pos.x, ty: top, tz: this.pos.z, pull: 9, swirl: 7, delay, fadeOut: 0.15, add: false });
      else fx.emit({ x: this.pos.x + rand(-0.2, 0.2), y: top + rand(-0.2, 0.2), z: this.pos.z + rand(-0.2, 0.2), vx: rand(-2.5, 2.5), vy: rand(-0.5, 1.5), vz: rand(-2.5, 2.5), life: 1.0, frame: 17, size: 0.085, color: s[i * 4 + 3], tx: v.x, ty: v.y, tz: v.z, pull: 16, swirl: 3, delay, fadeOut: 0.08 });
    }
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      fx.emit({ x: this.pos.x + Math.cos(a) * 0.9, y: (out ? this.pos.y + 0.1 : top), z: this.pos.z + Math.sin(a) * 0.9, vy: out ? rand(1.4, 2.6) : rand(-2.4, -1.2), life: rand(0.7, 1.2), frame: 5, frames: 3, fps: 9, size: rand(0.3, 0.5), color: [0x9be8ff, 0xfff6c0, 0xd6b3ff][i % 3], add: true, tx: this.pos.x, ty: out ? top : this.pos.y + 0.6, tz: this.pos.z, pull: 2, swirl: 5, delay: Math.random() * 0.5 });
    }
    this.env.sound(out ? 'tp_out' : 'tp_in', this.pos);
    if (out) {
      this.face('wide', 'o', 0.5);
      setTimeout(() => { this.animal.rig.root.visible = false; this.visible = false; this.set('gone', 1e9); done?.(); }, 420);
    } else {
      this.animal.rig.root.visible = false;
      setTimeout(() => {
        this.animal.rig.root.visible = true; this.visible = true; this.squash = 0.6; this.set('idle', 0); this.face('happy', 'smile', 1.4);
        fx.burst('sparkle', this.pos.x, this.pos.y + 0.8, this.pos.z, 10);
        this.env.sound('tp_shimmer', this.pos);
        done?.();
      }, 900);
    }
  }

  // ---------------------------------------------------------------- internals

  private set(a: Action, len: number) { this.action = a; this.actionT = 0; this.actionLen = len; }

  private leaveSeat(keep = false) {
    if (this.seat && !keep) { this.seat.taken = null; this.seat = null; }
  }

  private takeSeat(s: Seat, a: Action, len: number) {
    s.taken = this;
    this.seat = s;
    this.pos.set(s.x, 0, s.z);
    this.yaw = s.rot;
    this.set(a, len);
  }

  /** Decide what to do next when left alone. */
  private think() {
    const env = this.env, night = env.isNight();
    const free = (k: Seat['kind']) => env.seats().filter((s) => !s.taken && (s.kind ?? 'sit') === k);
    const walkTo = (s: Seat, a: Action, len: number) => {
      const fx = s.x + Math.sin(s.rot) * 0.9, fz = s.z + Math.cos(s.rot) * 0.9;
      const [ax, az] = this.walkable(fx, fz) ? [fx, fz] : [s.x, s.z];
      this.goTo(ax, az, () => { if (!s.taken) this.takeSeat(s, a, len); });
    };
    const r = Math.random();
    if ((this.energy < 30 || (night && r < 0.5))) {
      const beds = free('sleep');
      if (beds.length) return walkTo(beds[Math.floor(Math.random() * beds.length)], 'sleep', rand(18, 40));
      return this.set('sleep', rand(14, 30));
    }
    if (r < 0.34) return this.wander();
    if (r < 0.5) {
      const seats = free('sit');
      if (seats.length) return walkTo(seats[Math.floor(Math.random() * seats.length)], 'sit', rand(7, 15));
      return this.set('sit', rand(5, 10));
    }
    if (r < 0.62) {
      const f = env.flowers().filter((p) => this.walkable(p.x, p.z));
      if (f.length) { const p = f[Math.floor(Math.random() * f.length)]; return this.goTo(p.x + rand(-0.6, 0.6), p.z + rand(0.3, 0.8), () => this.set('sniff', 3)); }
    }
    if (r < 0.7) {
      const c = env.chaseTarget();
      if (c && this.walkable(c.x, c.z)) return this.goTo(c.x, c.z, () => this.emote('surprised'), true);
    }
    if (r < 0.78) {
      const toys = free('play');
      if (toys.length) { const s = toys[Math.floor(Math.random() * toys.length)]; return this.goTo(s.x + rand(-0.8, 0.8), s.z + 0.9, () => this.set('cheer', 2.4)); }
    }
    if (r < 0.86 && !this.env.canWalk) { // sit by the water
      for (let i = 0; i < 12; i++) { const a = rand(0, 6.28), x = 7.2 + Math.cos(a) * 5.2, z = 3.4 + Math.sin(a) * 4.0; if (this.walkable(x, z) && pondD(x, z) < 1.45) return this.goTo(x, z, () => { this.yaw = Math.atan2(7.2 - x, 3.4 - z); this.set('sit', rand(6, 12)); }); }
    }
    if (r < 0.92) return this.set('dance', 3.5);
    if (r < 0.96) return this.set('wave', 2);
    this.wander();
  }

  private wander() {
    for (let i = 0; i < 14; i++) {
      const a = rand(0, 6.28), d = rand(1.5, 6.5), x = this.pos.x * 0.4 + Math.cos(a) * d, z = this.pos.z * 0.4 + Math.sin(a) * d;
      if (this.walkable(x, z) && !this.env.colliders().some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.5)) return this.goTo(x, z);
    }
  }

  private rot(b: Bone, x = 0, y = 0, z = 0) { const t = this.tgt[b]; t[0] = x; t[1] = y; t[2] = z; }

  update(dt: number, t: number) {
    if (this.action === 'gone') return;
    const A = this.animal, g = A.geo, sp = this.sk.look.species;
    this.actionT += dt;
    this.emoteT -= dt;

    // ---- movement
    let moving = false;
    if (this.action === 'walk' && this.target) {
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.18) {
        this.target = null; this.set('idle', 0); this.idleT = rand(0.6, 2);
        const cb = this.onArrive; this.onArrive = null; cb?.();
      } else {
        let vx = (dx / d) * this.speed, vz = (dz / d) * this.speed;
        for (const c of this.env.colliders()) {
          const ox = this.pos.x - c.x, oz = this.pos.z - c.z, od = Math.hypot(ox, oz), lim = c.r + 0.55;
          if (od < lim && od > 0.001 && Math.hypot(this.target.x - c.x, this.target.z - c.z) > c.r) {
            const push = ((lim - od) / lim) * this.speed * 2.2;
            // slide around the obstacle rather than just bouncing off it
            vx += (ox / od) * push + (-oz / od) * push * 0.6; vz += (oz / od) * push + (ox / od) * push * 0.6;
          }
        }
        const nx = this.pos.x + vx * dt, nz = this.pos.z + vz * dt;
        if (this.walkable(nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
        else if (this.walkable(nx, this.pos.z)) this.pos.x = nx;
        else if (this.walkable(this.pos.x, nz)) this.pos.z = nz;
        else this.stuck += dt * 3;
        this.stuck += dt * 0.12;
        if (this.stuck > 1.6) { this.target = null; this.onArrive = null; this.set('idle', 0); }
        const want = Math.atan2(vx, vz);
        let dy = want - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += dy * Math.min(1, dt * 9);
        moving = true;
      }
    }

    // ---- idle brain
    if (this.action !== 'walk' && this.actionLen && this.actionT > this.actionLen) {
      const cb = this.after; this.after = null;
      this.leaveSeat();
      this.set('idle', 0); this.idleT = rand(1.5, 4);
      cb?.();
    }
    if (this.action === 'idle' && !this.busy && !this.attentive) {
      this.idleT -= dt;
      if (this.idleT <= 0) { this.idleT = rand(3, 7); this.think(); }
    }
    this.energy = Math.max(0, Math.min(100, this.energy + (this.action === 'sleep' ? 2.2 : -0.12) * dt));

    // ---- pose
    for (const b of BONES) this.rot(b);
    const hop = HOPPERS.has(sp), ph = this.phase;
    let hipsY = 0, lean = 0, eyes: EyeFrame = 'open', mouth: MouthFrame = A.defaultMouth, liftTo = 0;
    const breathe = Math.sin(t * 2.1 + this.phase) * 0.012;
    const wag = Math.sin(t * (this.joy > 60 ? 7 : 3.4) + 1);
    this.rot('tail', 0, wag * (this.joy > 60 ? 22 : 10), 0);
    this.rot('tail2', 0, wag * 12, 0);
    this.rot('head', Math.sin(t * 1.7) * 2, this.look, Math.sin(t * 0.9) * 2);
    this.rot('armL', Math.sin(t * 1.9) * 4, 0, 0); this.rot('armR', -Math.sin(t * 1.9) * 4, 0, 0);
    this.rot('cape', 4 + Math.sin(t * 2.3) * 3, 0, 0);
    const sitPose = (deep = 1) => {
      hipsY = this.seat ? 0 : -(g.legH - 1.4) * PX * deep;
      this.rot('legL', -82, 0, 6); this.rot('legR', -82, 0, -6);
      this.rot('armL', -18, 0, 10); this.rot('armR', -18, 0, -10);
      this.rot('tail', -20, wag * 14, 0);
    };

    switch (this.action) {
      case 'walk': {
        this.phase += dt * this.speed * (hop ? 3.1 : 5.4);
        if (hop) {
          const k = Math.max(0, Math.sin(this.phase));
          liftTo = k * 0.42; lean = 10;
          this.rot('legL', -30 + k * 60, 0, 0); this.rot('legR', -30 + k * 60, 0, 0);
          this.rot('armL', 30 - k * 50, 0, 8); this.rot('armR', 30 - k * 50, 0, -8);
          this.rot('earL', -k * 16, 0, 0); this.rot('earR', -k * 16, 0, 0);
          if (Math.sin(ph) > 0 && Math.sin(this.phase) <= 0) this.footfall();
        } else {
          const s = Math.sin(this.phase), run = this.speed > 3 ? 1.35 : 1;
          this.rot('legL', s * 40 * run, 0, 0); this.rot('legR', -s * 40 * run, 0, 0);
          this.rot('armL', -s * 32 * run, 0, 7); this.rot('armR', s * 32 * run, 0, -7);
          this.rot('body', 0, s * 5, 0); this.rot('head', 2, this.look * 0.4 - s * 4, s * 2);
          this.rot('cape', 16 * run + Math.abs(s) * 8, 0, 0);
          liftTo = Math.abs(Math.cos(this.phase)) * 0.07 * run; lean = 6 * run;
          if (Math.sign(Math.sin(ph)) !== Math.sign(s)) this.footfall();
        }
        break;
      }
      case 'sit': sitPose(); break;
      case 'study': sitPose(); this.rot('head', 14, Math.sin(t * 0.5) * 8, 0); this.rot('armR', -60, -20, -10); this.rot('armL', -50, 20, 10); eyes = 'half'; break;
      case 'sleep': {
        sitPose(1.1); lean = 12;
        this.rot('head', 26 + Math.sin(t * 1.1) * 3, 0, 10); this.rot('earL', 8, 0, 14); this.rot('earR', 8, 0, -14);
        this.rot('tail', -10, 30, 0); this.rot('tail2', 0, 40, 0);
        eyes = 'closed'; mouth = 'neutral';
        if ((this.fxT -= dt) <= 0) { this.fxT = 2.6; const h = this.headWorld(); this.env.fx.burst('zzz', h.x + 0.3, h.y - 0.3, h.z, 3); }
        break;
      }
      case 'eat': {
        if (!this.seat) sitPose(0.8);
        const chew = Math.sin(t * 13);
        this.rot('armR', -118 + chew * 5, -26, -18); this.rot('head', 8 + chew * 3, 0, 0);
        eyes = 'happy'; mouth = chew > 0 ? 'chew1' : 'chew2';
        if ((this.fxT -= dt) <= 0) { this.fxT = 0.45; const h = this.headWorld(); this.env.fx.burst('crumbs', h.x + Math.sin(this.yaw) * 0.45, h.y - 0.75, h.z + Math.cos(this.yaw) * 0.45, 2); this.env.sound('eat_crunch', this.pos); }
        break;
      }
      case 'wave': this.rot('armR', 0, 0, -150 + Math.sin(t * 11) * 22); this.rot('head', 0, this.look, -8); eyes = 'happy'; mouth = 'open1'; break;
      case 'cheer': {
        const k = Math.abs(Math.sin(this.actionT * 5.5));
        liftTo = k * 0.5; this.rot('armL', 0, 0, 155); this.rot('armR', 0, 0, -155); this.rot('legL', k * 20, 0, 8); this.rot('legR', k * 20, 0, -8);
        this.rot('earL', -k * 14, 0, 0); this.rot('earR', -k * 14, 0, 0);
        eyes = 'happy'; mouth = 'open2';
        break;
      }
      case 'dance': {
        const s = Math.sin(this.actionT * 7), c = Math.cos(this.actionT * 7);
        this.rot('body', 0, s * 12, s * 9); this.rot('head', 0, -s * 10, -s * 10); this.rot('armL', -40 - c * 50, 0, 30); this.rot('armR', -40 + c * 50, 0, -30);
        this.rot('legL', Math.max(0, s) * 26, 0, 0); this.rot('legR', Math.max(0, -s) * 26, 0, 0);
        liftTo = Math.abs(s) * 0.12; eyes = 'happy'; mouth = 'grin';
        if ((this.fxT -= dt) <= 0) { this.fxT = 0.8; const h = this.headWorld(); this.env.fx.burst('notes', h.x, h.y, h.z, 2); }
        break;
      }
      case 'think': this.rot('armR', -104, -34, -16); this.rot('head', -8, 14, 10); eyes = 'half'; mouth = 'neutral'; break;
      case 'pose': {
        // a dramatic stance: leaning back, one arm thrown across the face, the other swept behind
        lean = -14; this.rot('body', 0, -24, 6); this.rot('head', -6, 34, -8);
        this.rot('armR', -128, -52, -30); this.rot('armL', 34, 0, 46); this.rot('legL', 0, 0, 16); this.rot('legR', 0, 0, -10); this.rot('cape', 34, 0, 0);
        eyes = this.actionT < 0.4 ? 'closed' : 'angry'; mouth = 'neutral';
        if ((this.fxT -= dt) <= 0) { this.fxT = 0.5; const h = this.headWorld(); this.env.fx.burst('sparkle', h.x, h.y - 0.4, h.z, 4); }
        break;
      }
      case 'sniff': lean = 26; this.rot('head', 18 + Math.sin(t * 9) * 3, 0, 0); this.rot('armL', 20, 0, 10); this.rot('armR', 20, 0, -10); eyes = 'happy';
        if ((this.fxT -= dt) <= 0) { this.fxT = 1.2; const h = this.headWorld(); this.env.fx.burst('hearts', h.x, h.y, h.z, 1); } break;
      case 'laugh': { const s = Math.sin(this.actionT * 22); this.rot('body', s * 3, 0, 0); this.rot('head', -10 + s * 4, 0, 0); this.rot('armL', -30, 0, 20); this.rot('armR', -30, 0, -20); eyes = 'happy'; mouth = 'open2'; liftTo = Math.max(0, s) * 0.04; break; }
      case 'sad': this.rot('head', 22, 0, 0); this.rot('earL', 10, 0, 22); this.rot('earR', 10, 0, -22); this.rot('tail', -30, 0, 0); eyes = 'sad'; mouth = 'frown'; break;
      case 'surprised': liftTo = this.actionT < 0.25 ? 0.3 : 0; this.rot('armL', 0, 0, 70); this.rot('armR', 0, 0, -70); this.rot('earL', -20, 0, 0); this.rot('earR', -20, 0, 0); eyes = 'wide'; mouth = 'o'; break;
      case 'nod': this.rot('head', Math.max(0, Math.sin(this.actionT * 12)) * 22, this.look, 0); eyes = 'happy'; break;
      case 'love': { const s = Math.sin(this.actionT * 6); this.rot('body', 0, 0, s * 6); this.rot('armL', -60, 30, 20); this.rot('armR', -60, -30, -20); eyes = 'heart'; mouth = 'smile'; liftTo = Math.abs(s) * 0.06; break; }
      default: {
        // idle: glance around now and then
        if ((this.lookT -= dt) <= 0) { this.lookT = rand(1.8, 4.5); this.look = Math.random() < 0.35 ? 0 : rand(-32, 32); this.lookUp = rand(-6, 8); }
        if (this.hunger > 75) { this.rot('armL', -40, 30, 10); this.rot('armR', -40, -30, -10); eyes = 'sad'; }
      }
    }

    // look at the camera while being spoken to
    if (this.attentive && this.action !== 'walk' && this.action !== 'sleep') {
      const c = this.env.camera.position;
      let dy = Math.atan2(c.x - this.pos.x, c.z - this.pos.z) - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      if (Math.abs(dy) > 0.9 && !this.seat) this.yaw += dy * Math.min(1, dt * 5);
      this.tgt.head[1] = Math.max(-50, Math.min(50, dy / D)); this.tgt.head[0] += -10;
    } else if (this.action === 'idle') this.tgt.head[0] += -this.lookUp;

    // ears flick on their own
    if ((this.earT -= dt) <= 0) { this.earT = rand(2.5, 7); this.earKick[Math.random() < 0.5 ? 0 : 1] = 1; }
    for (let i = 0; i < 2; i++) { const k = this.earKick[i]; if (k > 0) { this.tgt[i ? 'earR' : 'earL'][2] += Math.sin(k * Math.PI * 2) * 16 * (i ? -1 : 1); this.earKick[i] = Math.max(0, k - dt * 5); } }

    // ease every bone towards its target on top of the model's rest pose
    const k = 1 - Math.exp(-dt * 14), rest = A.rest;
    for (const b of BONES) {
      const c = this.cur[b], g2 = this.tgt[b], bone = A.rig.bones[b];
      if (!bone) continue;
      c[0] += (g2[0] - c[0]) * k; c[1] += (g2[1] - c[1]) * k; c[2] += (g2[2] - c[2]) * k;
      const r = rest[b] ?? [0, 0, 0];
      bone.rotation.set((c[0] + r[0]) * D, (c[1] + r[1]) * D, (c[2] + r[2]) * D);
    }

    // body: lift, lean, squash-and-stretch and sitting height
    if (this.liftT > 0) { this.liftT -= dt; liftTo += Math.sin((this.liftT / 0.35) * Math.PI) * 0.25; }
    this.lift += (liftTo - this.lift) * Math.min(1, dt * 22);
    this.sinkT += (hipsY - this.sinkT) * Math.min(1, dt * 10);
    this.sink += (lean - this.sink) * Math.min(1, dt * 8);
    this.squash += (1 - this.squash) * Math.min(1, dt * 9);
    const root = A.rig.root, sq = this.squash + breathe;
    root.scale.set(1 + (1 - sq) * 0.6, sq, 1 + (1 - sq) * 0.6);
    root.rotation.x = this.sink * D;
    const seatY = this.seat ? this.seat.y - g.legH * PX + 0.02 : this.groundY(this.pos.x, this.pos.z);
    this.pos.y = seatY;
    this.node.position.set(this.pos.x, seatY + this.lift + this.sinkT, this.pos.z);
    this.node.rotation.y = this.yaw;
    void moving;

    // ---- face
    if ((this.blinkT -= dt) <= 0) { this.blinkT = rand(2.2, 6); this.blink = 0.13; }
    this.blink -= dt;
    if (this.eyesT > 0) { this.eyesT -= dt; if (this.eyes) eyes = this.eyes; if (this.mouth) mouth = this.mouth; }
    else if (this.energy < 25 && eyes === 'open') eyes = 'half';
    if (this.blink > 0 && (eyes === 'open' || eyes === 'half')) eyes = this.blink > 0.09 || this.blink < 0.04 ? 'half' : 'closed';
    if (this.speaking && this.action !== 'eat') mouth = TALK[Math.abs(Math.floor(t * 11 + Math.sin(t * 3.7) * 2)) % TALK.length];
    A.setEyes(eyes); A.setMouth(mouth);
  }

  private footfall() {
    this.stepSide = -this.stepSide;
    const sx = Math.cos(this.yaw) * 0.14 * this.stepSide, sz = -Math.sin(this.yaw) * 0.14 * this.stepSide;
    if (Math.random() < 0.7) this.env.fx.burst('dust', this.pos.x + sx, this.pos.y, this.pos.z + sz, 1);
    this.env.sound('step_grass', this.pos);
  }
}
