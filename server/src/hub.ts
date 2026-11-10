// Live side of an account: which devices are online, which one hosts the sidekick, and
// fan-out of state / presence / teleport / notify messages over WebSocket.
import { WebSocket } from 'ws';
import { z } from 'zod';
import type { DeviceInfo, SaveState, WsClientMsg, WsServerMsg } from '../../shared/src/index.ts';
import type { Db, DeviceRow } from './db.ts';

const clientMsg = z.object({ t: z.enum(['summon', 'release', 'ping']) });

interface Conn {
  ws: WebSocket;
  device: DeviceRow;
  alive: boolean;
}

export class Hub {
  readonly #db: Db;
  readonly #now: () => number;
  /** account id -> open connections */
  readonly #accounts = new Map<string, Set<Conn>>();
  readonly #conns = new Map<WebSocket, Conn>();
  /** device id -> last time it did anything (connected, sent a message, made an API call) */
  readonly #active = new Map<string, number>();

  constructor(db: Db, now: () => number) {
    this.#db = db;
    this.#now = now;
  }

  /** Record activity for "most recently active device". */
  seen(deviceId: string): void {
    this.#active.set(deviceId, this.#now());
  }

  isOnline(accountId: string, deviceId: string): boolean {
    for (const c of this.#accounts.get(accountId) ?? []) if (c.device.id === deviceId) return true;
    return false;
  }

  onlineDevices(accountId: string): string[] {
    return [...new Set([...(this.#accounts.get(accountId) ?? [])].map((c) => c.device.id))];
  }

  connect(ws: WebSocket, device: DeviceRow): void {
    const conn: Conn = { ws, device, alive: true };
    let set = this.#accounts.get(device.accountId);
    if (!set) this.#accounts.set(device.accountId, (set = new Set()));
    const hostBefore = this.#db.host(device.accountId);
    const hostWasOnline = hostBefore != null && this.isOnline(device.accountId, hostBefore);
    set.add(conn);
    this.#conns.set(ws, conn);
    this.seen(device.id);
    this.#db.touchDevice(device.id, this.#now());

    // The sidekick needs a live device to be on: take it when nobody has it, or when the
    // device that has it is offline.
    const takeOver = hostBefore == null || (hostBefore !== device.id && !hostWasOnline);
    if (takeOver) this.#db.setHost(device.accountId, device.id);
    this.#broadcast(device.accountId, this.presence(device.accountId));
    if (takeOver && hostBefore != null) {
      // it really moved here from another (offline) device, which cannot play its half
      this.#broadcast(device.accountId, { t: 'teleport', from: null, to: device.id, at: this.#now() });
    }
  }

  disconnect(ws: WebSocket): void {
    const conn = this.#conns.get(ws);
    if (!conn) return;
    this.#conns.delete(ws);
    const { accountId } = conn.device;
    const set = this.#accounts.get(accountId);
    set?.delete(conn);
    if (set && set.size === 0) this.#accounts.delete(accountId);
    this.#db.touchDevice(conn.device.id, this.#now());
    // the host stays where it is: `host` may name an offline device until someone connects or summons
    this.#broadcast(accountId, this.presence(accountId));
  }

  handle(ws: WebSocket, raw: string): void {
    const conn = this.#conns.get(ws);
    if (!conn) return;
    let msg: WsClientMsg;
    try {
      msg = clientMsg.parse(JSON.parse(raw));
    } catch {
      return; // not ours; ignore rather than drop the connection
    }
    const { device } = conn;
    this.seen(device.id);
    if (msg.t === 'summon') this.#summon(device);
    else if (msg.t === 'release') this.#release(device);
  }

  #summon(device: DeviceRow): void {
    const { accountId } = device;
    const previous = this.#db.host(accountId);
    if (previous !== device.id) {
      this.#db.setHost(accountId, device.id);
      const from = previous != null && this.isOnline(accountId, previous) ? previous : null;
      this.#broadcast(accountId, { t: 'teleport', from, to: device.id, at: this.#now() });
    }
    this.#broadcast(accountId, this.presence(accountId));
  }

  #release(device: DeviceRow): void {
    const { accountId } = device;
    if (this.#db.host(accountId) !== device.id) return;
    const others = this.onlineDevices(accountId).filter((id) => id !== device.id);
    if (!others.length) return; // nowhere to go: it waits here for the next device
    others.sort((a, b) => (this.#active.get(b) ?? 0) - (this.#active.get(a) ?? 0));
    const target = others[0];
    this.#db.setHost(accountId, target);
    this.#broadcast(accountId, { t: 'teleport', from: device.id, to: target, at: this.#now() });
    this.#broadcast(accountId, this.presence(accountId));
  }

  presence(accountId: string): WsServerMsg {
    const online = new Set(this.onlineDevices(accountId));
    const devices: DeviceInfo[] = this.#db
      .devices(accountId)
      .map((d) => ({ id: d.id, name: d.name, kind: d.kind, online: online.has(d.id) }));
    return { t: 'presence', devices, host: this.#db.host(accountId) };
  }

  sendState(accountId: string, state: SaveState, exceptDevice?: string): void {
    this.#broadcast(accountId, { t: 'state', state }, exceptDevice);
  }

  notify(accountId: string, n: { title: string; body: string; taskId?: string }): void {
    this.#broadcast(accountId, n.taskId ? { t: 'notify', title: n.title, body: n.body, taskId: n.taskId } : { t: 'notify', title: n.title, body: n.body });
  }

  #broadcast(accountId: string, msg: WsServerMsg, exceptDevice?: string): void {
    const set = this.#accounts.get(accountId);
    if (!set?.size) return;
    const data = JSON.stringify(msg);
    for (const c of set) {
      if (exceptDevice && c.device.id === exceptDevice) continue;
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
    }
  }

  /** Protocol-level ping; connections that missed the previous one are dropped. */
  heartbeat(): void {
    for (const conn of this.#conns.values()) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      try {
        conn.ws.ping();
      } catch {
        conn.ws.terminate();
      }
    }
  }

  pong(ws: WebSocket): void {
    const conn = this.#conns.get(ws);
    if (conn) conn.alive = true;
  }

  closeAll(): void {
    for (const conn of [...this.#conns.values()]) conn.ws.terminate();
  }
}
