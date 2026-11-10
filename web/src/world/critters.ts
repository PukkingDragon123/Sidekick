// Small life: butterflies drifting between flower drifts, bees, birds that hop and scatter,
// koi under the pond surface, ladybirds on the log, and the ambient particle emitters.
import * as THREE from 'three';
import { box, buildRig, type BoneSpec, type Painter, type Rig } from '../gfx/box.ts';
import { ramp, tone } from '../gfx/color.ts';
import { smooth, solid } from '../gfx/mats.ts';
import type { Fx } from './fx.ts';
import { SPR } from './fx.ts';
import type { ForestPlan } from './flora.ts';
import { groundY, POND, WATER_Y } from './layout.ts';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

function flyer(body: BoneSpec['boxes'], wing: (side: number) => BoneSpec['boxes'], wy: number): Rig {
  return buildRig([
    { name: 'root', pivot: [0, 0, 0], boxes: body },
    { name: 'wingL', parent: 'root', pivot: [-0.5, wy, 0], boxes: wing(-1) },
    { name: 'wingR', parent: 'root', pivot: [0.5, wy, 0], boxes: wing(1) },
  ]);
}

function butterfly(c: string): Rig {
  const r = ramp(c);
  // bright wings with a darker trailing edge and a pale spot, like a painted pixel sprite folded in two
  const w: Painter = (t) => {
    const edge = t.bz < 1 || (t.bx < 1 && t.x < 0) || (t.bx > t.sx - 1 && t.x > 0);
    const spot = Math.abs(t.bx - t.sx / 2) < 0.8 && Math.abs(t.bz - t.sz / 2) < 0.8;
    return tone(r, edge ? -1.6 : spot ? 2.2 : 0.4 + (t.face === 2 ? 0.5 : -0.6));
  };
  return flyer([box(0, 0, 0, 1, 1, 4, solid('#4a3a34', { noise: 0 }))], (s) => [box(s * 3, 0.4, 0.8, 5, 0.5, 4, w), box(s * 2.5, 0.4, -1.8, 4, 0.5, 3, w)], 0.5);
}
function bee(): Rig {
  const stripes: Painter = (t) => (Math.floor(t.bz) % 2 ? 0x2b2026 : 0xf6c531);
  return flyer([box(0, 0, 0, 2, 2, 3, stripes), box(0, 0.4, 1.8, 1, 1, 1, solid('#2b2026', { noise: 0 }))], (s) => [box(s * 1.5, 1.6, 0, 2, 0.4, 2, smooth('#eef8ff'))], 1.8);
}
function bird(c: string, chest: string): Rig {
  const b = smooth(c, { noise: 0.6, scale: 1.5 }), ch = ramp(chest);
  const body: Painter = (t) => (t.face === 4 || (t.face === 3) || (t.face < 2 && t.bz > t.sz - 2 && t.by < 2) ? tone(ch, t.face === 3 ? -1 : 0.3) : b(t));
  return flyer([
    box(0, 2, 0, 4, 4, 5, body), box(0, 5, 2, 3, 3, 3, b), box(0, 6, 3.8, 1, 1, 1, smooth('#f2a531')), box(-1, 6.6, 3.4, 0.6, 0.8, 0.4, solid('#17131c', { noise: 0 })), box(1, 6.6, 3.4, 0.6, 0.8, 0.4, solid('#17131c', { noise: 0 })),
    { ...box(0, 3, -3.4, 2, 1, 3, b), rot: [20, 0, 0] }, box(-1, 0, 0.5, 1, 2, 1, smooth('#f2a531')), box(1, 0, 0.5, 1, 2, 1, smooth('#f2a531')),
  ], (s) => [box(s * 2.3, 2.6, -0.2, 1, 3, 4, b)], 5.4);
}
function koi(c: string): Rig {
  const base = ramp(c), w = ramp('#fbf6ea');
  const p: Painter = (t) => ((Math.floor(t.z + 30) + Math.floor(t.x + 30)) % 3 === 0 ? tone(w, 0) : tone(base, t.face === 2 ? 0.6 : -0.4));
  return buildRig([{ name: 'root', pivot: [0, 0, 0], boxes: [box(0, 0, 0, 2, 2, 5, p), box(0, 0.4, 3, 1.4, 1.2, 1, p)] }, { name: 'tail', parent: 'root', pivot: [0, 1, -2.5], boxes: [box(0, 0, -3.6, 1, 2, 3, p)] }]);
}

interface Flyer { rig: Rig; pos: THREE.Vector3; vel: THREE.Vector3; goal: THREE.Vector3; t: number; flap: number; kind: 'butterfly' | 'bee' }
interface Bird { rig: Rig; pos: THREE.Vector3; home: THREE.Vector3; state: 'perch' | 'flee' | 'away' | 'return'; t: number; from: THREE.Vector3; to: THREE.Vector3; yaw: number; hop: number }

export class Critters {
  readonly group = new THREE.Group();
  private flyers: Flyer[] = [];
  private birds: Bird[] = [];
  private fish: { rig: Rig; a: number; r: number; speed: number }[] = [];
  private bugs: { mesh: THREE.Object3D; a: number }[] = [];
  private acc = { leaf: 0, mote: 0, fly: 0, gust: 0 };

  constructor(private plan: ForestPlan, private fx: Fx, quality: 'low' | 'high', private sound: (id: string, at?: THREE.Vector3) => void) {
    const cols = ['#f08a2c', '#5aa9e6', '#f6d04a', '#f58fb0', '#c39bff', '#fbfbf6'];
    const nFly = quality === 'high' ? 7 : 4;
    for (let i = 0; i < nFly + 3; i++) {
      const isBee = i >= nFly;
      const rig = isBee ? bee() : butterfly(cols[i % cols.length]);
      const f = pick(plan.flowers);
      const pos = new THREE.Vector3(f.x + rand(-1, 1), rand(0.8, 1.6), f.z + rand(-1, 1));
      rig.root.traverse((o) => { o.castShadow = false; });
      this.group.add(rig.root);
      this.flyers.push({ rig, pos, vel: new THREE.Vector3(), goal: pos.clone(), t: rand(0, 3), flap: rand(0, 6), kind: isBee ? 'bee' : 'butterfly' });
    }
    const looks: [string, string][] = [['#8a5a3c', '#e2604a'], ['#4f8fd6', '#fbf6ea'], ['#f2c84a', '#fbe9a8']];
    plan.perches.slice(0, quality === 'high' ? 4 : 2).forEach((p, i) => {
      const rig = bird(...looks[i % looks.length]);
      this.group.add(rig.root);
      this.birds.push({ rig, pos: p.clone(), home: p.clone(), state: 'perch', t: rand(1, 4), from: p.clone(), to: p.clone(), yaw: rand(0, 6.28), hop: 0 });
    });
    for (let i = 0; i < 3; i++) {
      const rig = koi(['#f2792e', '#f2a531', '#e5484d'][i]);
      rig.root.traverse((o) => { o.castShadow = false; });
      this.group.add(rig.root);
      this.fish.push({ rig, a: rand(0, 6.28), r: rand(0.35, 0.68), speed: rand(0.25, 0.45) * (i % 2 ? 1 : -1) });
    }
    // ladybirds strolling along the fallen log
    for (let i = 0; i < 2; i++) {
      const dots: Painter = (t) => (t.face === 2 && (Math.floor(t.bx) + Math.floor(t.bz)) % 2 === 0 ? 0x1c1418 : 0xe2463c);
      const rig = buildRig([{ name: 'root', pivot: [0, 0, 0], boxes: [box(0, 0, 0, 2, 1, 2, dots), box(0, 0, 1.3, 1, 1, 1, solid('#1c1418', { noise: 0 }))] }]);
      this.group.add(rig.root);
      this.bugs.push({ mesh: rig.root, a: i * 3 });
    }
  }

  /** The nearest butterfly, for animals that feel like chasing one. */
  nearestButterfly(p: THREE.Vector3): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, bd = 9;
    for (const f of this.flyers) { const d = f.pos.distanceTo(p); if (f.kind === 'butterfly' && d < bd) { bd = d; best = f.pos; } }
    return best;
  }

  update(dt: number, t: number, animals: THREE.Vector3[], night: number, windX: number, windZ: number, gust: number) {
    const day = night < 0.5;
    for (const f of this.flyers) {
      f.rig.root.visible = day;
      if (!day) continue;
      f.t -= dt;
      const scared = animals.find((a) => a.distanceTo(f.pos) < 1.3);
      if (f.t <= 0 || scared) {
        const fl = pick(this.plan.flowers);
        f.goal.set(fl.x + rand(-1.4, 1.4), rand(0.7, f.kind === 'bee' ? 1.2 : 2.3), fl.z + rand(-1.4, 1.4));
        if (scared) f.goal.set(f.pos.x + (f.pos.x - scared.x) * 3, 2.6, f.pos.z + (f.pos.z - scared.z) * 3);
        f.t = rand(2.5, 6);
      }
      const sp = f.kind === 'bee' ? 2.2 : 1.3;
      f.vel.lerp(f.goal.clone().sub(f.pos).clampLength(0, sp), Math.min(1, dt * 2));
      f.pos.addScaledVector(f.vel, dt);
      f.flap += dt * (f.kind === 'bee' ? 60 : 16);
      const bob = f.kind === 'bee' ? Math.sin(t * 9 + f.flap) * 0.04 : Math.sin(f.flap) * 0.09;
      f.rig.root.position.set(f.pos.x, Math.max(groundY(f.pos.x, f.pos.z) + 0.4, f.pos.y) + bob, f.pos.z);
      if (f.vel.lengthSq() > 0.01) f.rig.root.rotation.y = Math.atan2(f.vel.x, f.vel.z);
      const w = f.kind === 'bee' ? Math.sin(f.flap) * 0.5 : Math.abs(Math.sin(f.flap)) * 1.25 - 0.2;
      f.rig.bones.wingL.rotation.z = -w; f.rig.bones.wingR.rotation.z = w;
    }

    for (const b of this.birds) {
      b.t -= dt;
      const near = animals.some((a) => a.distanceTo(b.pos) < 1.9);
      if (b.state === 'perch') {
        if (near) {
          b.state = 'flee'; b.t = 1.6; b.from.copy(b.pos);
          const a = Math.atan2(b.pos.z, b.pos.x) + rand(-0.5, 0.5);
          b.to.set(Math.cos(a) * 15, 6.5, Math.sin(a) * 15);
          this.sound('bird_flap', b.pos);
        } else if (b.t <= 0) { b.t = rand(1.2, 4); b.yaw += rand(-1.4, 1.4); b.hop = 0.25; if (Math.random() < 0.3 && day) this.sound('bird_chirp', b.pos); }
        b.hop = Math.max(0, b.hop - dt);
        b.rig.root.position.set(b.pos.x, b.pos.y + Math.sin((b.hop / 0.25) * Math.PI) * 0.14, b.pos.z);
        b.rig.bones.wingL.rotation.z = b.rig.bones.wingR.rotation.z = 0;
      } else if (b.state === 'flee' || b.state === 'return') {
        const len = b.state === 'flee' ? 1.6 : 2.2, k = 1 - Math.max(0, b.t) / len, e = k * k * (3 - 2 * k);
        b.pos.lerpVectors(b.from, b.to, e); b.pos.y += Math.sin(k * Math.PI) * 1.6;
        b.yaw = Math.atan2(b.to.x - b.from.x, b.to.z - b.from.z);
        const w = Math.sin(t * 28) * 1.1;
        b.rig.bones.wingL.rotation.z = -w - 0.3; b.rig.bones.wingR.rotation.z = w + 0.3;
        b.rig.root.position.copy(b.pos);
        if (b.t <= 0) { if (b.state === 'flee') { b.state = 'away'; b.t = rand(6, 14); } else { b.state = 'perch'; b.t = 2; b.pos.copy(b.home); } }
      } else if (b.t <= 0 && !animals.some((a) => a.distanceTo(b.home) < 2.5)) { b.state = 'return'; b.t = 2.2; b.from.copy(b.pos); b.to.copy(b.home); }
      b.rig.root.rotation.y = b.yaw;
      b.rig.root.visible = b.state !== 'away';
    }

    for (const f of this.fish) {
      f.a += f.speed * dt;
      const x = POND.x + Math.cos(f.a) * POND.rx * f.r, z = POND.z + Math.sin(f.a) * POND.rz * f.r;
      f.rig.root.position.set(x, WATER_Y - 0.3, z);
      f.rig.root.rotation.y = Math.atan2(-Math.sin(f.a) * POND.rx * Math.sign(f.speed), Math.cos(f.a) * POND.rz * Math.sign(f.speed));
      f.rig.bones.tail.rotation.y = Math.sin(t * 6 + f.a) * 0.6;
    }
    this.bugs.forEach((b, i) => {
      b.a += dt * 0.12 * (i ? -1 : 1);
      const u = Math.sin(b.a) * 0.9;
      b.mesh.position.set(3.4 + u * Math.cos(0.25) + 0.1, 0.66, -7.0 + u * Math.sin(0.25) * -1 + (i ? 0.12 : -0.1));
      b.mesh.rotation.y = -0.25 + (Math.cos(b.a) * (i ? -1 : 1) > 0 ? Math.PI / 2 : -Math.PI / 2);
    });

    // ---- ambient particles
    const fx = this.fx, a = this.acc;
    if ((a.leaf -= dt) <= 0 && this.plan.leafSources.length) {
      a.leaf = rand(0.18, 0.5) / (0.6 + gust * 3);
      const s = pick(this.plan.leafSources), ang = rand(0, 6.28), d = Math.sqrt(Math.random()) * s.r, pink = s.color === 0xf7b3c8;
      fx.emit({ x: s.x + Math.cos(ang) * d, y: s.y + rand(-0.8, 0.6), z: s.z + Math.sin(ang) * d, vy: -0.25, life: rand(6, 9), frame: pink ? SPR.petal : SPR.leaf1, frames: pink ? 1 : 3, fps: 3.5, size: rand(0.34, 0.48), color: s.color, gravity: 0.32, drag: 0.7, wind: 0.9, flutter: 0.7, land: true, fadeOut: 1.2 });
    }
    if (day && (a.mote -= dt) <= 0) {
      a.mote = 0.16;
      fx.emit({ x: rand(-9, 9), y: rand(0.4, 3.4), z: rand(-8, 7), vy: rand(0.03, 0.14), life: rand(4, 7), frame: SPR.mote, size: rand(0.3, 0.5), color: 0xfff3c4, wind: 0.25, flutter: 0.15, add: true, fadeIn: 1.2, fadeOut: 1.4 });
    }
    if (night > 0.4 && (a.fly -= dt) <= 0) {
      a.fly = 0.14;
      const x = rand(-11, 11), z = rand(-10, 9);
      fx.emit({ x, y: groundY(x, z) + rand(0.35, 2.4), z, vx: rand(-0.2, 0.2), vy: rand(-0.05, 0.12), vz: rand(-0.2, 0.2), life: rand(2.6, 4.6), frame: SPR.glow, size: rand(0.16, 0.27), color: 0xc8f060, flutter: 0.35, add: true, fadeIn: 0.9, fadeOut: 1.1 });
    }
    if (gust > 0.115 && (a.gust -= dt) <= 0) {
      a.gust = rand(0.15, 0.4);
      fx.emit({ x: rand(-11, 6), y: rand(0.5, 2.6), z: rand(-8, 7), vx: windX * 5.5, vz: windZ * 5.5, life: 0.9, frame: SPR.streak, size: rand(0.6, 1.1), color: 0xffffff, fadeIn: 0.25, fadeOut: 0.5 });
    }
  }
}
