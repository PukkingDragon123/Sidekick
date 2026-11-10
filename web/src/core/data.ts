// Game data: shop prices, quests, levels, colour palettes and the starting save.
import type { Look, OutfitSlot, SaveState, Sidekick, SpeciesId } from '@shared/types.ts';
import { isoWeek, localDate, uid } from '@shared/types.ts';
import { SPECIES_INFO } from '@shared/species.ts';

export interface OutfitOffer { id: string; slot: OutfitSlot; price: number; gems?: number; level?: number; plus?: boolean }
const o = (id: string, slot: OutfitSlot, price: number, x: Partial<OutfitOffer> = {}): OutfitOffer => ({ id, slot, price, ...x });

export const OUTFITS: OutfitOffer[] = [
  o('hoodie_red', 'body', 180), o('hoodie_mint', 'body', 180), o('hoodie_ink', 'body', 260, { level: 3 }),
  o('blazer_navy', 'body', 240), o('blazer_wine', 'body', 320, { level: 4 }),
  o('sweater_bee', 'body', 150), o('sweater_berry', 'body', 150), o('overalls', 'body', 200),
  o('tunic', 'body', 280, { level: 2 }), o('varsity_red', 'body', 300, { level: 3 }), o('varsity_teal', 'body', 300, { level: 3 }),
  o('cloak_violet', 'body', 420, { level: 5 }), o('cloak_moss', 'body', 420, { level: 5 }),
  o('haori_wave', 'body', 460, { level: 6 }), o('haori_sakura', 'body', 0, { gems: 30 }),
  o('drama_magenta', 'body', 0, { gems: 45 }), o('drama_azure', 'body', 0, { gems: 45, plus: true }),
  o('beanie_sky', 'head', 90), o('beanie_plum', 'head', 90), o('cap_red', 'head', 110), o('cap_back', 'head', 130),
  o('bow', 'head', 70), o('sprout', 'head', 60), o('beret', 'head', 140), o('headband', 'head', 120, { level: 2 }),
  o('straw', 'head', 160), o('flowercrown', 'head', 200, { level: 2 }), o('phones_pink', 'head', 240, { level: 3 }), o('phones_lime', 'head', 240, { level: 3 }),
  o('tophat', 'head', 300, { level: 4 }), o('wizard', 'head', 380, { level: 5 }), o('yuzu', 'head', 0, { gems: 15 }),
  o('gradcap', 'head', 0, { gems: 20 }), o('crown', 'head', 0, { gems: 60, plus: true }),
  o('glasses_round', 'face', 100), o('glasses_gold', 'face', 160, { level: 2 }), o('shades', 'face', 220, { level: 3 }), o('shades_heart', 'face', 0, { gems: 18 }),
  o('scarf_red', 'neck', 90), o('scarf_teal', 'neck', 90), o('bandana', 'neck', 80), o('bowtie', 'neck', 110), o('bell', 'neck', 120), o('chain', 'neck', 260, { level: 4 }),
  o('pack_red', 'back', 170), o('pack_leaf', 'back', 170), o('quiver', 'back', 240, { level: 3 }), o('cape_hero', 'back', 340, { level: 4 }), o('cape_night', 'back', 0, { gems: 28 }), o('wings', 'back', 0, { gems: 40, plus: true }),
];
export const OUTFIT: Record<string, OutfitOffer> = Object.fromEntries(OUTFITS.map((x) => [x.id, x]));

export type QuestKind = 'complete' | 'focus' | 'feed' | 'plan' | 'chat' | 'early' | 'pet' | 'decorate' | 'steps' | 'open';
export interface QuestDef { id: string; text: string; kind: QuestKind; goal: number; coins: number; xp: number; gems?: number }
const q = (id: string, text: string, kind: QuestKind, goal: number, coins: number, xp: number, gems?: number): QuestDef => ({ id, text, kind, goal, coins, xp, gems });

export const DAILY: QuestDef[] = [
  q('d_done1', 'Finish 1 assignment', 'complete', 1, 30, 20), q('d_done2', 'Finish 2 assignments', 'complete', 2, 55, 35),
  q('d_focus25', 'Focus for 25 minutes', 'focus', 25, 40, 30), q('d_focus50', 'Focus for 50 minutes', 'focus', 50, 70, 50),
  q('d_feed', 'Share a snack with your sidekick', 'feed', 1, 15, 10), q('d_plan', 'Make a plan for today', 'plan', 1, 20, 15),
  q('d_chat', 'Ask your sidekick for advice', 'chat', 1, 15, 10), q('d_pet', 'Give 3 head pats', 'pet', 3, 10, 8),
  q('d_steps', 'Tick off 3 steps', 'steps', 3, 25, 18), q('d_early', 'Finish something a day early', 'early', 1, 45, 30),
];
export const WEEKLY: QuestDef[] = [
  q('w_done8', 'Finish 8 assignments', 'complete', 8, 220, 150, 3), q('w_focus', 'Focus for 3 hours', 'focus', 180, 260, 170, 4),
  q('w_early', 'Finish 3 things early', 'early', 3, 200, 120, 3), q('w_open', 'Check in on 5 days', 'open', 5, 150, 90, 2),
  q('w_garden', 'Place 3 things in the garden', 'decorate', 3, 120, 70, 1), q('w_plan', 'Plan your day 4 times', 'plan', 4, 140, 90, 2),
];
export const QUEST: Record<string, QuestDef> = Object.fromEntries([...DAILY, ...WEEKLY].map((x) => [x.id, x]));

function pickN<T>(pool: T[], n: number, seedStr: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  const a = pool.slice(), out: T[] = [];
  while (out.length < n && a.length) { h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; out.push(a.splice(h % a.length, 1)[0]); }
  return out;
}
/** Today's three dailies and this week's three weeklies are the same on every device. */
export const dailySet = (day: string) => pickN(DAILY, 3, day).map((d) => d.id);
export const weeklySet = (week: string) => pickN(WEEKLY, 3, week).map((d) => d.id);

/** XP needed to go from `level` to the next. */
export const xpFor = (level: number) => 80 + level * 45;
export const GARDEN_LEVEL = 2;
export const AD_REWARD = 30;
export const ADS_PER_DAY = 3;

export const FUR_COLORS = ['#e8792e', '#c9562c', '#8a5a3c', '#b08a5e', '#f6ecdf', '#ffffff', '#8f8fa8', '#7e8794', '#3a3f4c', '#f6a6c1', '#f0d27a', '#6cc05a', '#5fb7c9', '#9b7653', '#c7a3e8', '#f2b0a0'];
export const ACCENT_COLORS = ['#4a2b22', '#2f3440', '#3a2420', '#5f4330', '#fff3e0', '#f29bb0', '#e0527e', '#3d8a45', '#4c4a63', '#c9a27c', '#f2b632', '#5a78c8'];
export const EYE_COLORS = ['#f2a81d', '#7bd88f', '#59c2e8', '#e0567c', '#9a5a2e', '#8d62d6', '#f6c445', '#3fb8a8', '#e5704a', '#6f7fe8'];

export function newSidekick(species: SpeciesId, name?: string): Sidekick {
  const info = SPECIES_INFO[species];
  return { id: uid(), name: name || info.defaultName, look: { species, ...info.look } as Look, outfit: { ...info.outfit } };
}

export function newSave(now = Date.now(), tz = Intl.DateTimeFormat().resolvedOptions().timeZone): SaveState {
  const day = localDate(now, tz), week = isoWeek(day);
  return {
    v: 1,
    owner: { name: '', onboarded: false },
    sidekicks: [], active: '',
    progress: { coins: 120, gems: 5, xp: 0, level: 1, streakDays: 0, streakLast: '', tasksDone: 0, focusMin: 0, fed: 0, adsToday: 0, adsDay: day },
    inventory: { apple: 3, cookie: 2, onigiri: 1, stool: 1, potflowers: 1 },
    wardrobe: [],
    garden: { unlocked: false, items: [] },
    quests: { day, daily: dailySet(day).map((id) => ({ id, n: 0, claimed: false })), week, weekly: weeklySet(week).map((id) => ({ id, n: 0, claimed: false })) },
    tasks: [], reminders: [], plan: null,
    settings: { sfx: 0.8, ambience: 0.6, voice: true, notifyDueSoon: true, notifyDaily: true, dailyAt: '07:30', quality: 'auto', reduceMotion: false, tz, desktopAuto: true },
    pet: { hunger: 30, joy: 80, energy: 80, at: now },
    chat: [],
    premium: { plus: false },
    stamps: {},
  };
}

/** A believable week of schoolwork so the app can be explored before anything is connected. */
export function demoTasks(now = Date.now()) {
  const H = 3600000, D = 86400000;
  const t = (title: string, course: string, due: number, kind: string, estMin: number, description: string, points = 20) =>
    ({ id: uid(), source: 'manual' as const, title, course, due: now + due, kind: kind as never, estMin, description, points, done: false, createdAt: now, updatedAt: now });
  return [
    t('Algebra worksheet 4.2: quadratic equations', 'Mathematics', 5 * H, 'problems', 35, 'Questions 1 to 18. Show your working for the odd-numbered ones.', 20),
    t('Read chapter 7 of "The Giver"', 'English', 20 * H, 'reading', 30, 'Read chapter 7 and write three sentences on how Jonas feels at the ceremony.', 10),
    t('Lab report: plant cell osmosis', 'Science', 2 * D + 3 * H, 'essay', 80, 'Introduction, method, results table, graph and conclusion. Use the template from class.', 50),
    t('Vocabulary quiz unit 5', 'English', 3 * D, 'quiz', 25, 'Twenty words from unit 5. Spelling and meaning.', 20),
    t('History project: the Sukhothai Kingdom', 'Social Studies', 6 * D, 'project', 150, 'Poster or slides, five minutes to present. Work in pairs.', 100),
    t('Discussion post: favourite renewable energy', 'Science', -6 * H, 'assignment', 12, 'One paragraph and one reply to a classmate.', 5),
  ];
}
