// Client for the Sidekick server: device identity, save sync, presence/teleport, AI and integrations.
// Every call degrades gracefully: with no server the app keeps working from the local save.
import { signal } from '@preact/signals';
import type { AuthRes, ChatEvent, CheckoutRes, Health, IntegrationsRes, OAuthStartRes, PairCodeRes, PlanRes, PushKeyRes, StateRes, SyncRes, WsClientMsg, WsServerMsg } from '@shared/api.ts';
import { mergeState } from '@shared/merge.ts';
import type { DeviceInfo, DeviceKind, SaveState } from '@shared/types.ts';
import { adopt, onDirty, S } from './store.ts';

const BASE = (import.meta.env.VITE_SERVER as string | undefined) ?? '';
const AUTH = 'sidekick.auth.v1';

export const health = signal<Health | null>(null);
export const link = signal<'offline' | 'connecting' | 'online'>('offline');
export const presence = signal<{ devices: DeviceInfo[]; host: string | null }>({ devices: [], host: null });
export const lastSync = signal(0);

let auth: AuthRes | null = null;
try { auth = JSON.parse(localStorage.getItem(AUTH) ?? 'null'); } catch { auth = null; }
export const deviceId = () => auth?.deviceId ?? '';

export function deviceKind(): DeviceKind {
  if (new URLSearchParams(location.search).has('desktop') || /Electron/i.test(navigator.userAgent)) return 'desktop';
  const touch = navigator.maxTouchPoints > 1;
  if (/iPad/.test(navigator.userAgent) || (touch && /Macintosh/.test(navigator.userAgent)) || (touch && Math.min(screen.width, screen.height) >= 700)) return 'tablet';
  if (touch || /Mobi|Android|iPhone/.test(navigator.userAgent)) return 'mobile';
  return 'web';
}
const deviceName = () => ({ desktop: 'Desktop', tablet: 'Tablet', mobile: 'Phone', web: 'Browser' })[deviceKind()];

async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (auth) headers.Authorization = `Bearer ${auth.token}`;
  if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(init.json); }
  const r = await fetch(BASE + path, { ...init, headers });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string; code?: string };
    throw Object.assign(new Error(e.error ?? `Request failed (${r.status})`), { status: r.status, code: e.code });
  }
  return (await r.json()) as T;
}

type Handler = (m: WsServerMsg) => void;
const handlers = new Set<Handler>();
export const onServer = (f: Handler) => { handlers.add(f); return () => handlers.delete(f); };

let ws: WebSocket | null = null, pushTimer = 0, retry = 0, pushing = false, again = false;

async function push() {
  if (!auth || link.value !== 'online') return;
  if (pushing) { again = true; return; }
  pushing = true;
  try {
    const r = await api<StateRes>('/api/state', { method: 'PUT', json: { state: S } });
    if (r.state) { adopt(mergeState(r.state, S)); lastSync.value = Date.now(); }
  } catch { /* stays queued locally; the next change or reconnect retries */ }
  pushing = false;
  if (again) { again = false; void push(); }
}

function socket() {
  if (!auth) return;
  const u = new URL((BASE || location.origin) + '/ws');
  u.protocol = u.protocol.replace('http', 'ws');
  u.searchParams.set('token', auth.token);
  ws = new WebSocket(u);
  ws.onopen = () => { for (const m of queue.splice(0)) ws?.send(JSON.stringify(m)); };
  ws.onmessage = (e) => {
    let m: WsServerMsg;
    try { m = JSON.parse(String(e.data)) as WsServerMsg; } catch { return; }
    if (m.t === 'state') { adopt(mergeState(m.state, S)); lastSync.value = Date.now(); }
    if (m.t === 'presence') presence.value = { devices: m.devices, host: m.host };
    handlers.forEach((h) => h(m));
  };
  ws.onclose = () => { ws = null; if (link.value === 'online') { link.value = 'connecting'; setTimeout(connect, 2500); } };
}

const queue: WsClientMsg[] = [];
/** Send over the live channel; anything sent while it is still opening goes out as soon as it is up. */
export function send(m: WsClientMsg) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(m));
  else if (m.t !== 'ping' && queue.length < 8) queue.push(m);
}
/** Ask the server to bring the sidekick to this device. */
export const summon = () => send({ t: 'summon' });

/** Find the server, register this device if needed, merge saves and open the live channel. */
export async function connect(): Promise<void> {
  // the standalone build has no server: everything runs from the local save
  if (import.meta.env.VITE_OFFLINE === '1') return;
  if (link.value === 'online' && ws) return;
  link.value = 'connecting';
  try {
    health.value = await api<Health>('/api/health');
    if (!auth) {
      auth = await api<AuthRes>('/api/auth/register', { method: 'POST', json: { deviceName: deviceName(), kind: deviceKind() } });
      localStorage.setItem(AUTH, JSON.stringify(auth));
    }
    let remote: StateRes;
    try { remote = await api<StateRes>('/api/state'); }
    catch (e) {
      // the server no longer knows this device (fresh database): register again once
      if ((e as { status?: number }).status === 401) { auth = null; localStorage.removeItem(AUTH); return connect(); }
      throw e;
    }
    link.value = 'online'; retry = 0;
    if (remote.state) adopt(mergeState(remote.state, S));
    lastSync.value = Date.now();
    socket();
    void push();
  } catch {
    link.value = 'offline';
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 4000 * retry);
  }
}

onDirty(() => { clearTimeout(pushTimer); pushTimer = window.setTimeout(push, 1200); });

// ---------------------------------------------------------------- pairing

export const pairCode = () => api<PairCodeRes>('/api/auth/pair-code', { method: 'POST' });
/** Join another device's account with its code; this device's local save is merged in. */
export async function joinWith(code: string) {
  const mine = S;
  auth = await api<AuthRes>('/api/auth/link', { method: 'POST', json: { code: code.trim().toUpperCase(), deviceName: deviceName(), kind: deviceKind() } });
  localStorage.setItem(AUTH, JSON.stringify(auth));
  ws?.close(); ws = null; link.value = 'offline';
  const remote = await api<StateRes>('/api/state');
  // the account being joined wins; a brand-new local save has nothing worth keeping
  if (remote.state) adopt(mine.owner.onboarded && !remote.state.owner.onboarded ? mergeState(remote.state, mine) : remote.state);
  await connect();
}

// ---------------------------------------------------------------- AI

/** Stream a chat turn. Resolves false if the server could not answer (caller falls back to the offline brain). */
export async function chat(text: string, on: (e: ChatEvent) => void): Promise<boolean> {
  if (link.value !== 'online' || !health.value?.ai || !auth) return false;
  try {
    const r = await fetch(BASE + '/api/ai/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ text, now: Date.now(), tz: S.settings.tz }),
    });
    if (!r.ok || !r.body) return false;
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '', ok = true;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data:'));
        buf = buf.slice(i + 2);
        if (!line) continue;
        const ev = JSON.parse(line.slice(5).trim()) as ChatEvent;
        if (ev.type === 'state') adopt(mergeState(ev.state, S));
        if (ev.type === 'error') ok = false;
        on(ev);
      }
    }
    return ok;
  } catch { return false; }
}

export async function aiPlan(): Promise<boolean> {
  if (link.value !== 'online' || !auth) return false;
  try {
    const r = await api<PlanRes>('/api/ai/plan', { method: 'POST', json: { now: Date.now(), tz: S.settings.tz } });
    adopt(mergeState(r.state, S));
    return r.plan.source === 'ai';
  } catch { return false; }
}

// ---------------------------------------------------------------- integrations, push, billing

export const integrations = () => api<IntegrationsRes>('/api/integrations');
export async function startOAuth(provider: 'google' | 'microsoft') {
  const r = await api<OAuthStartRes>(`/api/integrations/${provider}/start?return=${encodeURIComponent(location.origin + location.pathname)}`);
  location.href = r.url;
}
export const addIcs = (url: string, label?: string) => api<{ ok: true }>('/api/integrations/ics', { method: 'POST', json: { url, label } });
export const disconnect = (id: string) => api<{ ok: true }>(`/api/integrations/${id}`, { method: 'DELETE' });
export async function syncNow(): Promise<SyncRes> {
  const r = await api<SyncRes>('/api/integrations/sync', { method: 'POST' });
  adopt(mergeState(r.state, S));
  return r;
}

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
/** Ask for notification permission and register this device for web push. */
export async function enablePush(): Promise<'ok' | 'denied' | 'unsupported' | 'no-server'> {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  if (link.value !== 'online') return 'no-server';
  const { publicKey } = await api<PushKeyRes>('/api/push/key');
  if (!publicKey) return 'no-server';
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) }));
  await api('/api/push/subscribe', { method: 'POST', json: { subscription: sub.toJSON() } });
  return 'ok';
}
export const testPush = () => api('/api/push/test', { method: 'POST' });
export async function checkout() { const r = await api<CheckoutRes>('/api/billing/checkout', { method: 'POST' }); location.href = r.url; }

export type { SaveState };
