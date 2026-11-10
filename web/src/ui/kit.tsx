// Shared UI pieces and UI-only state (which panel is open, what the sidekick is saying, timers).
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import type { Emote } from '@shared/api.ts';
import { sound } from '../core/audio.ts';
import type { Line } from '../core/brain.ts';
import { sidekick } from '../core/store.ts';
import type { World } from '../world/world.ts';
import { iconUrl } from './pix.ts';

export type Panel = null | 'tasks' | 'chat' | 'quests' | 'shop' | 'bag' | 'wardrobe' | 'friends' | 'settings';
export const panel = signal<Panel>(null);
export const speech = signal<{ shown: string; full: string } | null>(null);
export const focus = signal<{ end: number; minutes: number; taskId?: string } | null>(null);
export const modal = signal<ComponentChildren | null>(null);
export const gardenMode = signal(false);
/** true while the active sidekick is on another device */
export const away = signal(false);
export const toasts = signal<{ id: number; text: string; icon?: string }[]>([]);

export const ctx: { world: World | null } = { world: null };
export const actor = () => (away.value ? undefined : ctx.world?.sidekick);

let tid = 0;
export function toast(text: string, icon?: string) {
  const id = ++tid;
  toasts.value = [...toasts.value.slice(-2), { id, text, icon }];
  setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id); }, 3100);
}

export function open(p: Panel) {
  sound.play(p ? 'ui_open' : 'ui_close');
  panel.value = p;
  const w = ctx.world;
  if (!w) return;
  w.setFocus(p === 'chat' ? 'sidekick' : p === 'wardrobe' ? 'wardrobe' : 'home');
  const wide = innerWidth >= 900 && innerWidth > innerHeight;
  w.shift = !p || wide ? 0 : p === 'chat' || p === 'wardrobe' ? 0.56 : 0.34;
}

let sayTimer = 0, hideTimer = 0;
/** Make the sidekick say a line: typed out letter by letter with voice blips and an emote. */
export function say(line: Line | string, hold = 5.5) {
  const l: Line = typeof line === 'string' ? { text: line } : line;
  const a = actor(), sk = sidekick();
  clearInterval(sayTimer); clearTimeout(hideTimer);
  if (!a || !sk) return;
  if (l.emote) a.emote(l.emote as Emote);
  let i = 0;
  a.speaking = true;
  speech.value = { shown: '', full: l.text };
  sayTimer = window.setInterval(() => {
    i = Math.min(l.text.length, i + 2);
    speech.value = { shown: l.text.slice(0, i), full: l.text };
    const ch = l.text[i - 1];
    if (ch && /[a-z0-9]/i.test(ch)) sound.blip(sk.look.species, ch);
    if (i >= l.text.length) {
      clearInterval(sayTimer);
      a.speaking = false;
      hideTimer = window.setTimeout(() => { speech.value = null; }, hold * 1000 + l.text.length * 28);
    }
  }, 42);
}
export function hush() { clearInterval(sayTimer); clearTimeout(hideTimer); speech.value = null; const a = actor(); if (a) a.speaking = false; }

export const Ico = ({ n, s }: { n: string; s?: boolean }) => <img class={`ico${s ? ' s' : ''}`} src={iconUrl(n)} alt="" draggable={false} />;

export function Btn(p: { k?: string; icon?: string; onClick?: () => void; cls?: string; disabled?: boolean; children?: ComponentChildren; snd?: string; title?: string; small?: boolean }) {
  return (
    <button class={`btn ${p.k ?? ''} ${p.cls ?? ''} ${p.small ? 'tiny' : ''}`} disabled={p.disabled} title={p.title} aria-label={p.title}
      onClick={(e) => { e.stopPropagation(); sound.play(p.snd ?? 'ui_tap'); p.onClick?.(); }}>
      {p.icon && <Ico n={p.icon} s={p.small} />}{p.children != null && <span>{p.children}</span>}
    </button>
  );
}

export function Sheet(p: { title: string; icon: string; size?: 'tall' | 'short'; children: ComponentChildren; head?: ComponentChildren; onClose?: () => void }) {
  return (
    <section class={`sheet fr wood grain ${p.size ?? ''}`}>
      <header>
        <Ico n={p.icon} />
        <h2>{p.title}</h2>
        {p.head}
        <Btn k="berry" cls="sq" icon="close" title="Close" snd="ui_close" onClick={p.onClose ?? (() => open(null))} />
      </header>
      {p.children}
    </section>
  );
}

export const Paper = (p: { children: ComponentChildren; cls?: string }) => <div class={`body fr paper flecks ${p.cls ?? ''}`}>{p.children}</div>;
export const Bar = ({ v, max, cls }: { v: number; max: number; cls?: string }) => <div class={`bar ${cls ?? ''}`}><i style={{ width: `${Math.max(0, Math.min(100, (v / max) * 100))}%` }} /></div>;

export function Tabs<T extends string>(p: { value: T; set: (v: T) => void; items: [T, string][] }) {
  return (
    <div class="tabs">
      {p.items.map(([id, label]) => <Btn key={id} k={p.value === id ? 'gold' : 'pap'} cls={p.value === id ? 'down' : ''} snd="ui_tab" onClick={() => p.set(id)}>{label}</Btn>)}
    </div>
  );
}

export const Price = ({ coins, gems }: { coins?: number; gems?: number }) => (
  <span class="price">{gems ? <><img src={iconUrl('gem')} alt="gems" />{gems}</> : coins ? <><img src={iconUrl('coin')} alt="coins" />{coins}</> : 'Free'}</span>
);
/** A wallet-style counter that always shows its number, even at zero. */
export const Count = ({ icon, n }: { icon: string; n: number }) => <span class="price"><img src={iconUrl(icon)} alt={icon} />{n}</span>;

export function Modal(p: { title: string; icon?: string; children: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <div class="veil" onClick={() => { modal.value = null; }}>
      <div class="modal fr wood grain" onClick={(e) => e.stopPropagation()}>
        <header class="row" style={{ marginBottom: 'calc(var(--u) * 2)' }}>{p.icon && <Ico n={p.icon} />}<h2 class="grow" style={{ margin: 0, fontSize: 'calc(var(--u) * 7)' }}>{p.title}</h2></header>
        <div class="body fr paper flecks">{p.children}</div>
        <div class="row" style={{ marginTop: 'calc(var(--u) * 2)', justifyContent: 'flex-end' }}>{p.actions ?? <Btn k="leaf" onClick={() => { modal.value = null; }}>Okay</Btn>}</div>
      </div>
    </div>
  );
}
