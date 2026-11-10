// Desktop companion: the same sidekick, rendered alone on a transparent always-on-top strip along the
// bottom of the screen. It strolls, naps, and pops up with the next sensible thing to do. Opening the
// desktop app pulls it out of the forest in a swirl of pixels; closing it sends it home again.
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/silkscreen/400.css';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import * as THREE from 'three';
import { sound } from '../core/audio.ts';
import * as brain from '../core/brain.ts';
import * as net from '../core/net.ts';
import { focusDone, openTasks, rev, S, sidekick, upkeep } from '../core/store.ts';
import { away, Btn, ctx, Ico, say, speech } from '../ui/kit.tsx';
import { installSkin } from '../ui/pix.ts';
import { CSS } from '../ui/style.ts';
import { Actor, type ActorEnv } from '../world/actor.ts';
import { Fx } from '../world/fx.ts';
import type { World } from '../world/world.ts';

interface Bridge { setInteractive(on: boolean): void; openApp(): void; quit(): void }
const bridge: Bridge = (window as unknown as { sidekickDesktop?: Bridge }).sidekickDesktop ?? { setInteractive() {}, openApp() { window.open('/', '_blank'); }, quit() { window.close(); } };

document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS + 'html,body{background:transparent!important}' }));
installSkin();

const PPB = 76; // screen pixels per block: the sidekick stands about 115 px tall
const FLOOR = 30; // px between the bottom of the window and the ground line
const canvas = document.getElementById('world') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0xaab0d0, 1.5));
const sun = new THREE.DirectionalLight(0xfff2dc, 1.8);
sun.position.set(-3, 8, 6);
scene.add(sun);
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const fx = new Fx(700);
scene.add(fx.group);
// a stepped blob shadow keeps the pet grounded on whatever is behind the window
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 }));
shadow.rotation.x = -Math.PI / 2;
scene.add(shadow);

let half = 10;
function fit() {
  renderer.setSize(innerWidth, innerHeight, false);
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%' });
  half = innerWidth / PPB / 2;
  const h = innerHeight / PPB, floor = FLOOR / PPB;
  cam.left = -half; cam.right = half; cam.bottom = -floor; cam.top = h - floor;
  // look slightly down at the ground line, which sits FLOOR px above the bottom edge of the window
  cam.position.set(0, 30 * Math.sin(0.1), 30 * Math.cos(0.1)); cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
}
fit();
addEventListener('resize', fit);

const env: ActorEnv = {
  fx, camera: cam, colliders: () => [], seats: () => [], flowers: () => [], chaseTarget: () => null,
  isNight: () => { const h = new Date().getHours(); return h >= 22 || h < 6; },
  sound: (id) => { if (!id.startsWith('step')) sound.play(id, { volume: 0.6 }); },
  ground: () => 0,
  canWalk: (x, z) => Math.abs(x) < half - 0.9 && Math.abs(z) < 0.6,
};

let pet: Actor | null = null;
function ensurePet() {
  const sk = sidekick();
  if (!sk) return;
  if (!pet) {
    pet = new Actor(sk, env);
    pet.place(half * 0.5, 0, -0.4);
    scene.add(pet.node);
    ctx.world = { get sidekick() { return pet ?? undefined; } } as unknown as World;
  } else if (JSON.stringify(pet.sk.look) !== JSON.stringify(sk.look) || JSON.stringify(pet.sk.outfit) !== JSON.stringify(sk.outfit) || pet.sk.id !== sk.id) pet.rebuild(sk);
}

const headPx = () => {
  if (!pet) return { x: innerWidth / 2, y: innerHeight - 160 };
  const p = pet.headWorld().project(cam);
  return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight };
};

let drag: { dx: number; moved: number } | null = null, roam = 8;
let last = performance.now();
function frame(t: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  if (pet) {
    // every so often, cross the whole desktop instead of pottering in one spot
    if (!pet.busy && pet.action === 'idle' && (roam -= dt) <= 0 && !away.value) { roam = 14 + Math.random() * 20; pet.goTo((Math.random() * 2 - 1) * (half - 1.5), 0); }
    pet.update(dt, t / 1000);
    shadow.position.set(pet.pos.x, 0.01, pet.pos.z);
    shadow.visible = pet.visible;
  }
  fx.update(dt, t / 1000);
  renderer.render(scene, cam);
}
requestAnimationFrame(frame);

function Pet() {
  rev.value; // eslint-disable-line @typescript-eslint/no-unused-expressions
  const [menu, setMenu] = useState(false), [code, setCode] = useState(''), [focusEnd, setFocusEnd] = useState(0), [, tick] = useState(0);
  const bubble = useRef<HTMLDivElement>(null), menuEl = useRef<HTMLDivElement>(null);
  const sp = speech.value, sk = sidekick();

  // keep the bubble and the menu glued above the pet's head
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const p = headPx();
      for (const el of [bubble.current, menuEl.current]) if (el) {
        const w = el.offsetWidth / 2 + 8;
        el.style.left = `${Math.round(Math.max(w, Math.min(innerWidth - w, p.x)))}px`;
        el.style.top = `${Math.round(Math.max(el.offsetHeight + 8, p.y - 12))}px`;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // the window ignores the mouse except over the pet or its UI, so the desktop underneath stays usable
  useEffect(() => {
    const over = (e: MouseEvent) => {
      if (drag) return true;
      if ((e.target as HTMLElement).closest?.('.say, .petmenu, .petbar')) return true;
      if (!pet || !pet.visible) return false;
      const h = headPx(), tall = pet.height * PPB;
      return Math.abs(e.clientX - h.x) < 60 && e.clientY > h.y - 10 && e.clientY < h.y + tall + 30;
    };
    const move = (e: MouseEvent) => {
      bridge.setInteractive(over(e));
      if (drag && pet) { drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY); pet.pos.x = Math.max(-half + 1, Math.min(half - 1, (e.clientX - innerWidth / 2) / PPB + drag.dx)); }
    };
    const down = (e: MouseEvent) => {
      if (!pet || !pet.visible || (e.target as HTMLElement).closest?.('.say, .petmenu, .petbar') || !over(e)) return;
      drag = { dx: pet.pos.x - (e.clientX - innerWidth / 2) / PPB, moved: 0 };
      pet.busy = true; pet.act('surprised', 60);
    };
    const up = () => {
      if (!drag || !pet) return;
      const tapped = drag.moved < 6;
      drag = null; pet.busy = false; pet.act('idle', 0);
      if (tapped) { sound.play('ui_open'); pet.pet(); setMenu((m) => !m); } else { sound.play('pet_land'); fx.burst('dust', pet.pos.x, 0.05, pet.pos.z, 5); }
    };
    addEventListener('mousemove', move); addEventListener('mousedown', down); addEventListener('mouseup', up);
    return () => { removeEventListener('mousemove', move); removeEventListener('mousedown', down); removeEventListener('mouseup', up); };
  }, []);

  useEffect(() => {
    if (!focusEnd) return;
    const t = setInterval(() => {
      tick((n) => n + 1);
      if (Date.now() >= focusEnd) { setFocusEnd(0); focusDone(25); sound.play('timer_done'); if (pet) { pet.busy = false; pet.act('idle', 0); } say(brain.focusEnd(25)); }
    }, 500);
    return () => clearInterval(t);
  }, [focusEnd]);

  const left = Math.max(0, Math.ceil((focusEnd - Date.now()) / 1000));
  return (
    <>
      {sp && sk && !away.value && <div ref={bubble} class="say fr bubblef" onClick={() => { setMenu(true); }}><span class="name">{sk.name}</span>{sp.shown}</div>}
      {menu && sk && !away.value && (
        <div ref={menuEl} class="petmenu say fr wood grain" style={{ cursor: 'default', minWidth: 'calc(var(--u) * 70)' }}>
          <div class="row wrap">
            <Btn small k="leaf" icon="spark" onClick={() => { setMenu(false); say(brain.nudge()); }}>What next?</Btn>
            <Btn small k="gold" icon="timer" disabled={!!focusEnd} onClick={() => { setMenu(false); setFocusEnd(Date.now() + 25 * 60000); sound.play('timer_start'); if (pet) { pet.busy = true; pet.act('study', 1500); } say(brain.focusStart(25)); }}>Focus 25</Btn>
            <Btn small k="sky" icon="tasks" onClick={() => { setMenu(false); bridge.openApp(); }}>Open tasks</Btn>
            <Btn small k="pap" icon="tree" onClick={() => { setMenu(false); net.send({ t: 'release' }); }}>Back to the forest</Btn>
            <Btn small k="berry" cls="sq" icon="close" title="Quit Sidekick" onClick={() => { net.send({ t: 'release' }); setTimeout(() => bridge.quit(), 900); }} />
          </div>
        </div>
      )}
      {focusEnd > 0 && <div class="petbar banner fr dark sm" style={{ top: 'auto', bottom: 'calc(var(--u) * 2)' }}><Ico n="timer" s /><span class="num">{String(Math.floor(left / 60)).padStart(2, '0')}:{String(left % 60).padStart(2, '0')}</span></div>}
      {!S.owner.onboarded && (
        <div class="petbar fr wood grain" style={{ position: 'absolute', left: '50%', bottom: 'calc(var(--u) * 6)', transform: 'translateX(-50%)' }}>
          <b>Link this computer to your Sidekick</b>
          <p class="small" style={{ margin: 'calc(var(--u) * 1.5) 0' }}>On your phone or tablet open Bag, Settings, Devices and tap “Link another device”.</p>
          <div class="row"><input class="inp fr field" placeholder="Code" maxLength={8} value={code} onInput={(e) => setCode(e.currentTarget.value.toUpperCase())} />
            <Btn k="leaf" disabled={code.length < 6} onClick={() => net.joinWith(code).then(() => net.summon()).catch((e: Error) => say(e.message))}>Link</Btn>
            <Btn k="berry" cls="sq" icon="close" title="Quit" onClick={() => bridge.quit()} /></div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- wiring

sound.sfxVol = S.settings.sfx * 0.7; sound.voiceOn = S.settings.voice;
void sound.init();
rev.subscribe(ensurePet);
ensurePet();
render(<Pet />, document.getElementById('ui')!);

// the sidekick lives on one device at a time: show it here only while this computer is its host
let shown = true;
function settle() {
  const { host, devices } = net.presence.value, me = net.deviceId();
  const here = !host || host === me || !devices.some((d) => d.id === host && d.online);
  away.value = !here;
  if (!pet || here === shown) return;
  shown = here;
  if (here) pet.teleport(false, () => say({ text: `${S.owner.name ? S.owner.name + ', ' : ''}I'm on your desktop now. ${brain.nudge().text}`, emote: 'wave' }, 7));
  else { speech.value = null; pet.teleport(true); }
}
net.presence.subscribe(settle);
net.onServer((m) => { if (m.t === 'notify') { sound.play('notify_reminder'); say({ text: m.body, emote: 'surprised' }, 8); } });
void net.connect().then(() => {
  // arriving: until the server confirms this computer is the host, stay hidden so the hop can play
  if (net.link.value === 'online' && S.settings.desktopAuto && pet) {
    const elsewhere = net.presence.value.host && net.presence.value.host !== net.deviceId();
    if (elsewhere) { pet.animal.rig.root.visible = false; pet.visible = false; pet.action = 'gone'; shown = false; }
    net.summon();
  } else if (pet) setTimeout(() => say(brain.greeting(), 7), 1200);
});
addEventListener('beforeunload', () => net.send({ t: 'release' }));

// unprompted, useful nudges: when something is due soon, and now and then otherwise
let lastNudge = Date.now();
setInterval(() => {
  upkeep();
  if (!pet || away.value || speech.value) return;
  const now = Date.now(), urgent = openTasks().find((t) => t.due != null && t.due - now < 2 * 3600000 && t.due > now);
  if (now - lastNudge > (urgent ? 10 : 25) * 60000) { lastNudge = now; say(urgent ? { text: `"${urgent.title}" is due soon. Want to knock it out now?`, emote: 'surprised' } : Math.random() < 0.6 ? brain.nudge() : brain.idle(), 7); }
}, 30000);

(window as unknown as { __ready: boolean }).__ready = true;
