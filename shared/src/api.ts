// HTTP + WebSocket contract between the clients (web, desktop pet) and the server.
// All JSON. Authenticated routes take `Authorization: Bearer <device token>`.
import type { ChatMsg, DeviceInfo, DeviceKind, Plan, SaveState } from './types.ts';

/** GET /api/health (public). Which optional capabilities this server has configured. */
export interface Health {
  ok: true;
  version: string;
  ai: boolean;
  google: boolean;
  microsoft: boolean;
  push: boolean;
  billing: boolean;
}

/** POST /api/auth/register (public): creates a new account with this device in it. */
export interface RegisterReq {
  deviceName: string;
  kind: DeviceKind;
}
export interface AuthRes {
  accountId: string;
  deviceId: string;
  token: string;
}

/** POST /api/auth/pair-code: short-lived code another device types in to join this account. */
export interface PairCodeRes {
  code: string;
  expiresAt: number;
}

/** POST /api/auth/link (public): join an existing account with a pair code. */
export interface LinkReq {
  code: string;
  deviceName: string;
  kind: DeviceKind;
}

/** GET /api/state -> the account's save, or null if nothing has been stored yet. */
export interface StateRes {
  state: SaveState | null;
}
/** PUT /api/state: the server merges with mergeState(serverCopy, incoming) and returns the result. */
export interface PutStateReq {
  state: SaveState;
}

export type Provider = 'google' | 'microsoft' | 'ics';

export interface IntegrationInfo {
  id: string;
  provider: Provider;
  /** account e-mail, or the feed label for ICS */
  label: string;
  lastSync?: number;
  error?: string;
}
/** GET /api/integrations */
export interface IntegrationsRes {
  /** whether the server has OAuth client credentials for each provider */
  configured: { google: boolean; microsoft: boolean };
  items: IntegrationInfo[];
}
/** GET /api/integrations/:provider/start?return=<app url> -> consent URL to open */
export interface OAuthStartRes {
  url: string;
}
/** POST /api/integrations/ics */
export interface AddIcsReq {
  url: string;
  label?: string;
}
/** POST /api/integrations/sync: pull every connected source now. DELETE /api/integrations/:id disconnects. */
export interface SyncRes {
  added: number;
  updated: number;
  errors: { provider: Provider; message: string }[];
  state: SaveState;
}

export type Emote = 'happy' | 'cheer' | 'think' | 'laugh' | 'sad' | 'surprised' | 'sleepy' | 'love' | 'dance' | 'pose' | 'wave' | 'nod';

/** POST /api/ai/chat -> text/event-stream of ChatEvent, one JSON object per `data:` line. */
export interface ChatReq {
  text: string;
  now: number;
  tz: string;
}
export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'emote'; emote: Emote }
  /** sent when a tool changed tasks, reminders or the plan */
  | { type: 'state'; state: SaveState }
  | { type: 'done'; message: ChatMsg }
  | { type: 'error'; message: string; code?: 'no_ai' | 'limit' | 'failed' };

/** POST /api/ai/plan: rank the open tasks and recommend the fastest route through each. */
export interface PlanReq {
  now: number;
  tz: string;
}
export interface PlanRes {
  plan: Plan;
  state: SaveState;
}

/** GET /api/push/key ; POST /api/push/subscribe {subscription} ; POST /api/push/test */
export interface PushKeyRes {
  publicKey: string | null;
}
export interface PushSubscribeReq {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
}

/** POST /api/billing/checkout -> hosted checkout URL for Sidekick Plus. */
export interface CheckoutRes {
  url: string;
}

export interface ApiError {
  error: string;
  code?: string;
}

/** WebSocket at /ws?token=<device token>. */
export type WsServerMsg =
  | { t: 'state'; state: SaveState }
  /** `host` is the device the sidekick currently lives on (may be offline) */
  | { t: 'presence'; devices: DeviceInfo[]; host: string | null }
  /** the sidekick is jumping devices: `from` plays the dissolve, `to` plays the arrival */
  | { t: 'teleport'; from: string | null; to: string; at: number }
  | { t: 'notify'; title: string; body: string; taskId?: string };

export type WsClientMsg =
  | { t: 'summon' } // bring the sidekick to this device
  | { t: 'release' } // this device is closing: send the sidekick to the most recently active other device
  | { t: 'ping' };
