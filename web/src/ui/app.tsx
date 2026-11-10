// App shell: HUD, dock, speech bubble, overlays, and the wiring between forest, game rules, sound and server.
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fmtMinutes } from '@shared/planner.ts';
import { FOOD } from '../assets/furniture.ts';
import { buildProp } from '../gfx/box.ts';
import { sound } from '../core/audio.ts';
import * as brain from '../core/brain.ts';
import { xpFor } from '../core/data.ts';
import * as net from '../core/net.ts';
import { focusDone, onGame, openTasks, pat, rev, S, sidekick, upkeep } from '../core/store.ts';
import { walkable } from '../world/layout.ts';
import type { World } from '../world/world.ts';
import { faceIcon } from './icons3d.ts';
import { actor, away, Bar, Btn, ctx, focus, gardenMode, hush, Ico, Modal, modal, open, panel, say, speech, toast, toasts } from './kit.tsx';
import { ChatPanel, QuestsPanel, TasksPanel } from './panels.tsx';
import { BagPanel, FriendsPanel, GardenBar, Onboarding, SettingsPanel, ShopPanel, WardrobePanel } from './panels2.tsx';
import { iconUrl } from './pix.ts';
import { spriteSize, spriteUrl } from './woodkit.ts';
import { started, Title } from './title.tsx';
import { foodSpriteMesh } from './foodArt.ts';

const U = (n: number) => `calc(var(--u) * ${n})`;

// ---------------------------------------------------------------- pixel confetti over the UI

interface Bit { x: number; y: number; vx: number; vy: number; life: number; c: string; s: number }
const bits: Bit[] = [];
export function burst(x: number, y: number, colors: string[], n = 18) {
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 160; bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 140, life: 0.7 + Math.random() * 0.5, c: colors[i % colors.length], s: Math.random() < 0.3 ? 2 : 1 }); }
}
function FxLayer() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!, g = c.getContext('2d')!;
    let raf = 0, last = performance.now();
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - last) / 1000), u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 3;
      last = t;
      // the canvas is one art pixel per cell, scaled up by CSS, so particles stay on the pixel grid
      const w = Math.ceil(innerWidth / u), h = Math.ceil(innerHeight / u);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      if (!bits.length) { g.clearRect(0, 0, w, h); return; }
      g.clearRect(0, 0, w, h);
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i];
        b.life -= dt; b.vy += 520 * dt; b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.life <= 0) { bits.splice(i, 1); continue; }
        g.fillStyle = b.c;
        g.fillRect(Math.round(b.x / u), Math.round(b.y / u), b.s, b.s);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} class="fxlayer" />;
}

// ---------------------------------------------------------------- pieces

/** Forest friends chatting among themselves: a small bubble above whoever is talking. */
const chatter = signal<{ id: string; text: string } | null>(null);
function Chatter() {
  const ref = useRef<HTMLDivElement>(null), c = chatter.value;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cur = chatter.value, w = ctx.world, el = ref.current;
      if (!cur || !w || !el) return;
      const a = w.actors.get(cur.id);
      if (!a || !a.visible) { el.style.visibility = 'hidden'; return; }
      const p = w.screenOf(a.headWorld());
      el.style.visibility = p.behind ? 'hidden' : 'visible';
      el.style.left = `${Math.round(Math.max(90, Math.min(innerWidth - 90, p.x)))}px`; el.style.top = `${Math.round(p.y - 10)}px`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!c || panel.value || gardenMode.value) return null;
  return <div ref={ref} class="say fr bubblef" style={{ maxWidth: '220px', fontSize: '15px', opacity: 0.95, zIndex: 1 }}>{c.text}</div>;
}

function Bubble() {
  const ref = useRef<HTMLDivElement>(null), sp = speech.value, sk = sidekick();
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const a = actor(), w = ctx.world, el = ref.current;
      if (!a || !w || !el) return;
      const p = w.screenOf(a.headWorld());
      const half = el.offsetWidth / 2 + 6, x = Math.max(half, Math.min(innerWidth - half, p.x)), y = Math.max(el.offsetHeight + 70, p.y - 14);
      el.style.left = `${Math.round(x)}px`; el.style.top = `${Math.round(y)}px`;
      el.classList.toggle('side', Math.abs(x - p.x) > 20 || p.behind);
      el.style.visibility = p.behind ? 'hidden' : 'visible';
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!sp || !sk || panel.value || gardenMode.value) return null;
  return <div ref={ref} class="say fr bubblef" onClick={() => { hush(); open('chat'); }}><span class="name">{sk.name}</span>{sp.shown}</div>;
}

function Hud() {
  rev.value; // eslint-disable-line @typescript-eslint/no-unused-expressions
  const sk = sidekick(), p = S.progress;
  if (!sk) return null;
  return (
    <div class="hud">
      <div class="who fr dark sm" onClick={() => open('friends')}>
        <img class="face" src={faceIcon(sk)} alt="" />
        <div><b>{sk.name}</b><span class="num small">Lv {p.level}</span><Bar v={p.xp} max={xpFor(p.level)} /></div>
      </div>
      <Wallet coins={p.coins} gems={p.gems} streak={p.streakDays} />
    </div>
  );
}

/** A number that rolls up or down to its new value instead of jumping. */
function Rolling({ n }: { n: number }) {
  const [shown, setShown] = useState(n), from = useRef(n);
  useEffect(() => {
    const a = from.current, t0 = performance.now(), dur = Math.min(900, 250 + Math.abs(n - a) * 8);
    let raf = 0;
    const step = (t: number) => { const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3; setShown(Math.round(a + (n - a) * e)); if (k < 1) raf = requestAnimationFrame(step); else from.current = n; };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = n; };
  }, [n]);
  return <>{shown.toLocaleString()}</>;
}

/** The money display: a leather wallet for coins, a velvet pouch for gems and a candle for the streak. */
function Wallet({ coins, gems, streak }: { coins: number; gems: number; streak: number }) {
  const [bump, setBump] = useState(0), last = useRef(coins);
  useEffect(() => { if (coins > last.current) setBump((b) => b + 1); last.current = coins; }, [coins]);
  const w = spriteSize('wallet'), pz = spriteSize('pouch'), cz = spriteSize('candle');
  return (
    <div class="wallet-hud">
      <button id="coins" key={bump} class="wallet" style={{ width: w.w, height: w.h, backgroundImage: `url(${spriteUrl('wallet')})` }} onClick={() => open('shop')} aria-label={`${coins} coins. Open the market`}>
        <span class="wnum"><Rolling n={coins} /></span>
      </button>
      <div class="wsmall">
        <button class="pouch" style={{ width: pz.w, height: pz.h, backgroundImage: `url(${spriteUrl('pouch')})` }} onClick={() => open('shop')} aria-label={`${gems} gems`}><span class="wtag"><Rolling n={gems} /></span></button>
        <button class="candle" style={{ width: cz.w, height: cz.h, backgroundImage: `url(${spriteUrl('candle')})` }} onClick={() => open('quests')} aria-label={`${streak}-day streak`}><span class="wtag">{streak}</span></button>
        <button class="link-dot" title={net.link.value === 'online' ? 'Synced' : 'Offline'} onClick={() => open('settings')}><Ico n={net.link.value === 'online' ? 'cloud' : 'device'} s /></button>
      </div>
    </div>
  );
}

function Dock() {
  rev.value; // eslint-disable-line @typescript-eslint/no-unused-expressions
  const dueSoon = openTasks().filter((t) => t.due != null && t.due < Date.now() + 86400000).length;
  const claimable = [...S.quests.daily, ...S.quests.weekly].filter((q) => !q.claimed && q.n > 0).length;
  const item = (id: 'tasks' | 'chat' | 'quests' | 'shop' | 'bag', icon: string, label: string, badge = 0) => (
    <button key={id} class={`tok ${panel.value === id ? 'on' : ''}`} aria-label={label} onClick={() => { sound.play('ui_tap'); open(panel.value === id ? null : id); }}>
      <span class="disc"><img src={iconUrl(icon)} alt="" /></span><span class="lab">{label}</span>{badge > 0 && <i class="badge">{badge}</i>}
    </button>
  );
  return <nav class="dock" style={{ ['--tok' as string]: `url(${spriteUrl('token')})` }}>{item('tasks', 'tasks', 'Tasks', dueSoon)}{item('chat', 'chat', 'Talk')}{item('quests', 'quests', 'Quests', claimable)}{item('shop', 'shop', 'Market')}{item('bag', 'bag', 'Bag')}</nav>;
}

function FocusChip() {
  const f = focus.value, [, tick] = useState(0);
  useEffect(() => {
    if (!f) return;
    const t = setInterval(() => {
      tick((n) => n + 1);
      if (Date.now() >= f.end) finish(true);
    }, 500);
    return () => clearInterval(t);
  }, [f]);
  if (!f) return null;
  const left = Math.max(0, Math.ceil((f.end - Date.now()) / 1000));
  return (
    <div class="banner fr dark sm"><Ico n="timer" s /><span class="num">{String(Math.floor(left / 60)).padStart(2, '0')}:{String(left % 60).padStart(2, '0')}</span>
      <Btn small k="berry" onClick={() => finish(false)}>Stop</Btn></div>
  );
}
function finish(completed: boolean) {
  const f = focus.value;
  if (!f) return;
  focus.value = null;
  const a = actor();
  if (a) { a.busy = false; a.act('idle', 0); }
  const mins = completed ? f.minutes : Math.floor((f.minutes * 60000 - Math.max(0, f.end - Date.now())) / 60000);
  if (mins >= 1) focusDone(mins);
  if (completed) {
    sound.play('timer_done');
    say(brain.focusEnd(f.minutes));
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('Focus session done', { body: `${f.minutes} minutes finished. Time for a stretch.`, icon: '/icon-192.png' });
  } else if (mins >= 1) say({ text: `${mins} minute${mins > 1 ? 's' : ''} still counts. Nice.`, emote: 'nod' });
}

function AwayBanner() {
  const sk = sidekick(), host = net.presence.value.devices.find((d) => d.id === net.presence.value.host);
  if (!away.value || !sk) return null;
  return <div class="banner fr dark sm" style={{ top: U(36) }}><Ico n="device" s /><span>{sk.name} is on your {host?.name.toLowerCase() ?? 'other device'}</span><Btn small k="leaf" onClick={() => net.summon()}>Call back</Btn></div>;
}

export function App() {
  rev.value; // eslint-disable-line @typescript-eslint/no-unused-expressions
  const p = panel.value;
  if (!started.value) return <><Title /><Toasts /><FxLayer /></>;
  if (!S.owner.onboarded) return <><Onboarding /><Toasts /><FxLayer /></>;
  return (
    <>
      {!gardenMode.value && <Hud />}
      <Chatter />
      <Bubble />
      <FocusChip />
      <AwayBanner />
      {gardenMode.value ? <GardenBar /> : !p && <Dock />}
      {p === 'tasks' && <TasksPanel />}{p === 'chat' && <ChatPanel />}{p === 'quests' && <QuestsPanel />}{p === 'shop' && <ShopPanel />}
      {p === 'bag' && <BagPanel />}{p === 'wardrobe' && <WardrobePanel />}{p === 'friends' && <FriendsPanel />}{p === 'settings' && <SettingsPanel />}
      {modal.value}
      <Toasts />
      <FxLayer />
    </>
  );
}

const Toasts = () => <div class="toasts">{toasts.value.map((t) => <div key={t.id} class="toast fr dark sm">{t.icon && <Ico n={t.icon} s />}<span>{t.text}</span></div>)}</div>;

// ---------------------------------------------------------------- wiring

const chipPos = () => { const r = document.getElementById('coins')?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.bottom } : { x: innerWidth - 60, y: 40 }; };

/** Connect the world, the store, the server and the sound manager. Called once at start-up. */
let pats = 0;
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

export function wire(world: World) {
  ctx.world = world;
  const foodProps = new Map<string, ReturnType<typeof buildProp>>();
  const syncWorld = () => {
    if (!S.owner.onboarded) return;
    world.setSidekicks(S.sidekicks, S.active, !away.value);
    world.setGarden(S.garden.items, S.garden.unlocked);
    const a = world.sidekick;
    if (a) { a.hunger = S.pet.hunger; a.joy = S.pet.joy; }
  };
  rev.subscribe(syncWorld);

  world.on((e) => {
    if (e.type === 'sound') {
      const d = e.at ? e.at.distanceTo(world.camera.position) : 10;
      sound.play(e.id, { volume: Math.max(0.15, Math.min(1, 9 / d)) * (e.id.startsWith('step') ? 0.5 : 0.9), gap: e.id.startsWith('step') ? 90 : 60 });
    } else if (e.type === 'tapActor' && !gardenMode.value) {
      const a = world.actors.get(e.id);
      if (!a) return;
      a.pet();
      if (e.id === S.active) { pat(); pats++; if (!speech.value) say(pats % 6 === 0 ? brain.react('pets') : Math.random() < 0.6 ? brain.pat() : '', 2.5); }
      else { const sk2 = S.sidekicks.find((x) => x.id === e.id); if (sk2) { chatter.value = { id: e.id, text: pick(['Hi!', 'Hehe, that tickles.', `I'm ${sk2.name}!`, 'Pat accepted.', '♥']) }; setTimeout(() => { chatter.value = null; }, 2200); } }
    } else if (e.type === 'tapGround' && !gardenMode.value && !panel.value) {
      const a = actor();
      if (a && !a.busy && walkable(e.x, e.z)) { a.goTo(e.x, e.z); world.fx.burst('sparkle', e.x, 0.15, e.z, 3); }
    }
  });

  onGame((e) => {
    const c = chipPos();
    if (e.type === 'toast') toast(e.text, e.icon);
    if (e.type === 'reward') {
      if (e.coins) { sound.play('reward_coin'); burst(c.x, c.y + 30, ['#f2b632', '#ffe08a', '#c98a1e'], Math.min(26, 8 + e.coins / 4)); }
      if (e.xp) sound.play('reward_xp', { volume: 0.6 });
      toast(`+${e.coins} coins${e.xp ? `  +${e.xp} xp` : ''}${e.gems ? `  +${e.gems} gems` : ''}`, 'coin');
      const a = actor();
      if (a && e.coins >= 20) { const h = a.headWorld(); world.fx.burst('coins', h.x, h.y - 0.4, h.z, 8); }
    }
    if (e.type === 'levelup') {
      sound.play('reward_levelup');
      burst(innerWidth / 2, innerHeight / 3, ['#ff6f91', '#ffe066', '#7fd6ff', '#9be36a', '#c39bff'], 60);
      const a = actor();
      if (a) { a.emote('cheer'); const h = a.headWorld(); world.fx.burst('confetti', h.x, h.y, h.z, 40); }
      modal.value = <Modal title={`Level ${e.level}!`} icon="star"><p class="center">You and {sidekick()?.name} reached level {e.level}.</p><p class="center small mute">A bonus of coins and gems is in your bag, and new things have opened in the market.</p></Modal>;
    }
    if (e.type === 'garden') toast('The garden plot is yours. Open Bag, then Garden.', 'garden');
    if (e.type === 'questDone') { sound.play('reward_quest', { volume: 0.7 }); toast('Quest complete. Claim it in Quests.', 'quests'); }
    if (e.type === 'taskDone') { sound.play('reward_unlock', { volume: 0.7 }); say(brain.celebrate(e.task)); const a = actor(); if (a) { const h = a.headWorld(); world.fx.burst('stars', h.x, h.y, h.z, 12); } }
    if (e.type === 'fed') {
      const a = actor(), f = FOOD[e.food];
      if (!a || !f) return;
      // the pixel-art sprite where there is one (it reads better at hand size), else the 3D model
      const sprite = f.sprite ? foodSpriteMesh(f.sprite) : null;
      let held: Parameters<typeof a.feed>[0] | null = sprite;
      if (!held && f.build) { let prop = foodProps.get(e.food); if (!prop) { prop = buildProp(f.build()); foodProps.set(e.food, prop); } held = prop; }
      if (!held) return;
      sound.play('pickup_item');
      a.feed(held, e.loved, () => say(brain.yum(e.loved), 3));
    }
  });

  // presence: the sidekick lives on exactly one device at a time
  const settle = () => {
    const { host, devices } = net.presence.value, me = net.deviceId();
    const elsewhere = !!host && host !== me && devices.some((d) => d.id === host && d.online);
    if (elsewhere === away.value) return;
    const a = world.sidekick;
    away.value = elsewhere;
    if (elsewhere) { hush(); a?.teleport(true); } else if (a) { a.teleport(false, () => say({ text: "I'm back. What did I miss?", emote: 'wave' })); }
  };
  net.presence.subscribe(settle);
  net.onServer((m) => {
    if (m.t === 'notify') { sound.play('notify_reminder'); toast(`${m.title}: ${m.body}`, 'bell'); if (!away.value) say({ text: m.body, emote: 'surprised' }); }
  });

  // ambience follows the sky
  const amb = () => {
    const n = world.sky.night;
    void sound.loop('amb_birds', n < 0.5, 0.7); void sound.loop('amb_night', n >= 0.5, 0.7); void sound.loop('amb_wind', true, 0.35); void sound.loop('amb_stream', true, 0.22);
    void sound.loop('amb_fire', S.garden.items.some((i) => i.item === 'campfire'), 0.4);
  };
  setInterval(amb, 15000);
  setTimeout(amb, 400);

  // upkeep, reminders while the app is open, and the occasional unprompted remark
  let lastChat = Date.now();
  setInterval(() => {
    upkeep();
    const now = Date.now();
    for (const r of S.reminders) if (!r.fired && r.at <= now && net.link.value !== 'online') { r.fired = true; sound.play('notify_reminder'); toast(r.text, 'bell'); say({ text: r.text, emote: 'surprised' }); }
    if (S.owner.onboarded && !panel.value && !speech.value && !focus.value && !away.value && !gardenMode.value && now - lastChat > 95000 && !document.hidden) {
      lastChat = now;
      const r = Math.random();
      void r;
      say(brain.ambient(), 4.5);
    }
  }, 20000);

  // OAuth round trip: the server sends the browser back with ?integration=...&status=...
  const q = new URLSearchParams(location.search);
  if (q.has('integration')) {
    const okay = q.get('status') === 'ok';
    history.replaceState(null, '', location.pathname);
    setTimeout(() => {
      toast(okay ? `${q.get('integration') === 'google' ? 'Google Classroom' : 'Microsoft Teams'} connected` : `Could not connect (${q.get('reason') ?? 'unknown'})`, 'cloud');
      if (okay) net.syncNow().then((r) => toast(`${r.added} assignments imported`, 'tasks')).catch(() => undefined);
    }, 2500);
  }
  if (q.get('plus')) { history.replaceState(null, '', location.pathname); setTimeout(() => toast(q.get('plus') === 'success' ? 'Welcome to Sidekick Plus' : 'Checkout cancelled', 'star'), 1500); }

  // companions chat among themselves now and then
  setInterval(() => {
    if (document.hidden || panel.value || gardenMode.value || chatter.value || S.sidekicks.length < 2) return;
    const others = S.sidekicks.filter((x) => x.id !== S.active);
    if (Math.random() < 0.55) return;
    const a = pick(others), b = pick(S.sidekicks.filter((x) => x.id !== a.id));
    const [l1, l2] = brain.banter(a.name, b.name, sidekick()?.name ?? '');
    chatter.value = { id: a.id, text: l1 };
    world.actors.get(a.id)?.emote('wave');
    setTimeout(() => { chatter.value = { id: b.id, text: l2 }; world.actors.get(b.id)?.emote('laugh'); }, 2600);
    setTimeout(() => { chatter.value = null; }, 5400);
  }, 26000);
  // the sidekick comments on what you open, sometimes
  panel.subscribe((p) => {
    if (!p || away.value || Math.random() > 0.4) return;
    const kind = ({ shop: 'shop', tasks: 'tasks', quests: 'quests', bag: 'bag', wardrobe: 'wardrobe' } as Record<string, 'shop' | 'tasks' | 'quests' | 'bag' | 'wardrobe'>)[p];
    if (kind) setTimeout(() => { if (!speech.value) say(brain.react(kind), 2.2); }, 300);
  });
  // a warm welcome after a long time away
  try {
    const last = Number(localStorage.getItem('sidekick.lastSeen') || 0);
    if (last && Date.now() - last > 8 * 3600000) setTimeout(() => say(brain.react('lonely'), 5), 9000);
    setInterval(() => localStorage.setItem('sidekick.lastSeen', String(Date.now())), 30000);
    localStorage.setItem('sidekick.lastSeen', String(Date.now()));
  } catch { /* storage blocked */ }

  syncWorld();
  upkeep();
  // greet once the player is in
  let greeted = false;
  const hello = () => { if (!greeted && started.value && S.owner.onboarded && world.sidekick) { greeted = true; setTimeout(() => say(brain.greeting(), 7), 1400); } };
  rev.subscribe(hello);
  started.subscribe(hello);
  void fmtMinutes; void iconUrl;
}
