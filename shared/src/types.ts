// Core data model shared by the web app, the desktop pet and the server.

export const SPECIES = ['fox', 'cat', 'bunny', 'raccoon', 'frog', 'owl', 'bear', 'redpanda', 'capybara', 'axolotl'] as const;
export type SpeciesId = (typeof SPECIES)[number];

export type EyeStyle = 'round' | 'sparkle' | 'sleepy' | 'sharp' | 'dot';
export type Pattern = 'plain' | 'socks' | 'stripes' | 'spots' | 'mask' | 'patch';
export type OutfitSlot = 'head' | 'face' | 'neck' | 'body' | 'back';

/** Appearance of one animal. Colours are #rrggbb. */
export interface Look {
  species: SpeciesId;
  fur: string;
  fur2: string;
  accent: string;
  eye: string;
  eyeStyle: EyeStyle;
  pattern: Pattern;
  /** 'auto' = species default, otherwise an ear/tail shape id from the web catalog. */
  ears: string;
  tail: string;
  /** -1 slim … 1 chubby */
  build: number;
  blush: boolean;
}

export type Outfit = Partial<Record<OutfitSlot, string>>;

export interface Sidekick {
  id: string;
  name: string;
  look: Look;
  outfit: Outfit;
}

export type TaskSource = 'manual' | 'google' | 'microsoft' | 'ics';
export type TaskKind = 'assignment' | 'quiz' | 'reading' | 'project' | 'exam' | 'essay' | 'problems' | 'other';

export interface TaskStep {
  text: string;
  done: boolean;
}

export interface Task {
  /** `${source}:${externalId}` for imported work, random id for manual tasks. */
  id: string;
  source: TaskSource;
  externalId?: string;
  title: string;
  course?: string;
  description?: string;
  /** epoch ms */
  due?: number;
  url?: string;
  points?: number;
  kind?: TaskKind;
  /** estimated minutes of work */
  estMin?: number;
  done: boolean;
  doneAt?: number;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  notes?: string;
  steps?: TaskStep[];
  /** reward already granted for completing it */
  rewarded?: boolean;
  /** tombstone so deletions survive a merge */
  deleted?: boolean;
}

export interface PlanItem {
  taskId: string;
  rank: number;
  /** one-line reason this is where it sits in the order */
  why: string;
  /** the fastest sensible way through it, as short concrete steps */
  approach: string[];
  estMin: number;
  /** ready-to-paste prompts the student can give an AI tutor for this task */
  prompts: string[];
}

export interface Plan {
  generatedAt: number;
  summary: string;
  items: PlanItem[];
  source: 'ai' | 'local';
}

export interface Reminder {
  id: string;
  at: number;
  text: string;
  taskId?: string;
  fired?: boolean;
  createdAt: number;
}

export interface Placed {
  id: string;
  item: string;
  /** garden-local position in blocks, and rotation in quarter turns */
  x: number;
  z: number;
  rot: number;
}

export interface QuestProgress {
  id: string;
  n: number;
  claimed: boolean;
}

export interface QuestState {
  /** local date YYYY-MM-DD the daily set belongs to */
  day: string;
  daily: QuestProgress[];
  /** ISO week YYYY-Www */
  week: string;
  weekly: QuestProgress[];
}

export interface ChatMsg {
  id: string;
  role: 'user' | 'sidekick';
  text: string;
  at: number;
}

export interface Settings {
  sfx: number;
  ambience: number;
  voice: boolean;
  notifyDueSoon: boolean;
  notifyDaily: boolean;
  /** local HH:MM for the daily briefing push */
  dailyAt: string;
  quality: 'auto' | 'low' | 'high';
  reduceMotion: boolean;
  /** IANA zone, used by the server for reminders and the AI for "today" */
  tz: string;
  /** hop to the desktop automatically whenever the desktop app is open */
  desktopAuto: boolean;
}

export interface Progress {
  coins: number;
  gems: number;
  xp: number;
  level: number;
  streakDays: number;
  /** local date of the last day that counted towards the streak */
  streakLast: string;
  tasksDone: number;
  focusMin: number;
  fed: number;
  adsToday: number;
  adsDay: string;
}

export interface PetNeeds {
  hunger: number;
  joy: number;
  energy: number;
  /** epoch ms the needs were last decayed */
  at: number;
}

export interface Premium {
  plus: boolean;
  until?: number;
}

/** Sections that sync as a unit, last write wins. Tasks merge per item instead. */
export const SECTIONS = [
  'owner', 'sidekicks', 'active', 'progress', 'inventory', 'wardrobe', 'garden',
  'quests', 'reminders', 'plan', 'settings', 'pet', 'chat',
] as const;
export type Section = (typeof SECTIONS)[number];

export interface SaveState {
  v: 1;
  owner: { name: string; onboarded: boolean };
  sidekicks: Sidekick[];
  /** id of the sidekick that talks, teleports and reacts */
  active: string;
  progress: Progress;
  /** itemId -> count (food and unplaced furniture) */
  inventory: Record<string, number>;
  /** owned outfit piece ids */
  wardrobe: string[];
  garden: { unlocked: boolean; items: Placed[] };
  quests: QuestState;
  tasks: Task[];
  reminders: Reminder[];
  plan: Plan | null;
  settings: Settings;
  pet: PetNeeds;
  chat: ChatMsg[];
  /** server-authoritative: the server overwrites this on every merge */
  premium: Premium;
  /** epoch ms each section was last written */
  stamps: Partial<Record<Section, number>>;
}

export type DeviceKind = 'mobile' | 'tablet' | 'desktop' | 'web';

export interface DeviceInfo {
  id: string;
  name: string;
  kind: DeviceKind;
  online: boolean;
}

export const uid = (): string =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Local calendar date YYYY-MM-DD for an instant in an IANA zone. */
export function localDate(ms: number, tz?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** ISO-8601 week label, e.g. 2026-W46, for a local date string. */
export function isoWeek(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
