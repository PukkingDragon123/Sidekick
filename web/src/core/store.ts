// App state and game rules: the save, rewards, quests, shop, pet needs, garden and tasks.
// The save lives in localStorage and is mirrored to the server when one is reachable (see net.ts).
import { signal } from '@preact/signals';
import { touch } from '@shared/merge.ts';
import { buildPlan, estimateMinutes } from '@shared/planner.ts';
import { SPECIES_INFO } from '@shared/species.ts';
import { isoWeek, localDate, uid, type Look, type OutfitSlot, type Placed, type SaveState, type Section, type SpeciesId, type Task } from '@shared/types.ts';
import { FOOD, ITEM } from '../assets/furniture.ts';
import { AD_REWARD, ADS_PER_DAY, dailySet, demoTasks, GARDEN_LEVEL, newSave, newSidekick, OUTFIT, QUEST, weeklySet, xpFor, type QuestKind } from './data.ts';

const KEY = 'sidekick.save.v1';

function load(): SaveState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...newSave(), ...(JSON.parse(raw) as SaveState) };
  } catch { /* private mode or corrupt save: start fresh */ }
  return newSave();
}

export let S: SaveState = load();
/** Bumped on every change; components read it to re-render. */
export const rev = signal(0);

export type GameEvent =
  | { type: 'reward'; coins: number; xp: number; gems: number; why: string }
  | { type: 'levelup'; level: number }
  | { type: 'garden' }
  | { type: 'questDone'; id: string }
  | { type: 'taskDone'; task: Task; early: boolean }
  | { type: 'fed'; food: string; loved: boolean }
  | { type: 'toast'; text: string; icon?: string }
  | { type: 'bought'; what: string };
const subs = new Set<(e: GameEvent) => void>();
export const onGame = (f: (e: GameEvent) => void) => { subs.add(f); return () => subs.delete(f); };
const fire = (e: GameEvent) => subs.forEach((f) => f(e));
export const toast = (text: string, icon?: string) => fire({ type: 'toast', text, icon });

let dirty: (() => void) | null = null;
/** net.ts registers here to be told when there is something to upload. */
export const onDirty = (f: () => void) => { dirty = f; };

function commit(...sections: Section[]) {
  if (sections.length) touch(S, ...sections);
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* storage full or blocked: keep running in memory */ }
  rev.value++;
  dirty?.();
}

/** Replace the save with a merged copy from the server. */
export function adopt(next: SaveState) {
  S = next;
  rewardExternal();
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* see commit */ }
  rev.value++;
}

export const sidekick = () => S.sidekicks.find((s) => s.id === S.active) ?? S.sidekicks[0];
export const today = (now = Date.now()) => localDate(now, S.settings.tz);
export const openTasks = () => S.tasks.filter((t) => !t.done && !t.deleted);

// ---------------------------------------------------------------- time-based upkeep

/** Roll quests over at midnight/Monday and let the pet's needs drift. Safe to call often. */
export function upkeep(now = Date.now()) {
  const day = today(now), week = isoWeek(day);
  const changed: Section[] = [];
  if (S.quests.day !== day) {
    S.quests.day = day; S.quests.daily = dailySet(day).map((id) => ({ id, n: 0, claimed: false }));
    changed.push('quests');
    if (S.owner.onboarded) bump('open', 1);
  }
  if (S.quests.week !== week) { S.quests.week = week; S.quests.weekly = weeklySet(week).map((id) => ({ id, n: 0, claimed: false })); changed.push('quests'); }
  if (S.progress.adsDay !== day) { S.progress.adsDay = day; S.progress.adsToday = 0; changed.push('progress'); }
  const mins = (now - S.pet.at) / 60000;
  if (mins >= 5) {
    S.pet.hunger = Math.min(100, S.pet.hunger + mins / 9);
    S.pet.joy = Math.max(10, S.pet.joy - mins / 22);
    S.pet.at = now;
    changed.push('pet');
  }
  if (changed.length) commit(...new Set(changed));
}

// ---------------------------------------------------------------- rewards and quests

function bump(kind: QuestKind, n: number) {
  let hit = false;
  for (const p of [...S.quests.daily, ...S.quests.weekly]) {
    const d = QUEST[p.id];
    if (!d || d.kind !== kind || p.claimed || p.n >= d.goal) continue;
    p.n = Math.min(d.goal, p.n + n); hit = true;
    if (p.n >= d.goal) fire({ type: 'questDone', id: p.id });
  }
  return hit;
}
export function track(kind: QuestKind, n = 1) { if (bump(kind, n)) commit('quests'); }

export function grant(coins: number, xp: number, gems: number, why: string) {
  const p = S.progress;
  p.coins += coins; p.gems += gems; p.xp += xp;
  fire({ type: 'reward', coins, xp, gems, why });
  while (p.xp >= xpFor(p.level)) {
    p.xp -= xpFor(p.level); p.level++;
    p.coins += 40 + p.level * 10; p.gems += 2;
    fire({ type: 'levelup', level: p.level });
    if (p.level >= GARDEN_LEVEL && !S.garden.unlocked) { S.garden.unlocked = true; touch(S, 'garden'); fire({ type: 'garden' }); }
  }
  commit('progress');
}

export function claim(id: string) {
  const p = [...S.quests.daily, ...S.quests.weekly].find((x) => x.id === id), d = QUEST[id];
  if (!p || !d || p.claimed || p.n < d.goal) return;
  p.claimed = true;
  touch(S, 'quests');
  grant(d.coins, d.xp, d.gems ?? 0, d.text);
}

// ---------------------------------------------------------------- tasks

const stamp = (t: Task) => { t.updatedAt = Math.max(Date.now(), t.updatedAt + 1); };

export function addTask(t: Partial<Task> & { title: string }): Task {
  const now = Date.now();
  const task: Task = { id: uid(), source: 'manual', done: false, createdAt: now, updatedAt: now, ...t };
  S.tasks.push(task);
  S.plan = null; touch(S, 'plan');
  commit();
  return task;
}

export function patchTask(id: string, patch: Partial<Task>) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch); stamp(t);
  commit();
}

export function removeTask(id: string) { patchTask(id, { deleted: true }); }

function payOut(t: Task) {
  const est = estimateMinutes({ ...t, steps: undefined });
  const early = t.due != null && (t.doneAt ?? Date.now()) < t.due - 20 * 3600000;
  const coins = Math.round((12 + Math.min(48, est / 2.5)) * (early ? 1.4 : 1)), xp = Math.round(18 + est / 3);
  t.rewarded = true; stamp(t);
  const p = S.progress, day = today();
  p.tasksDone++;
  if (p.streakLast !== day) {
    const y = localDate(Date.now() - 86400000, S.settings.tz);
    p.streakDays = p.streakLast === y ? p.streakDays + 1 : 1;
    p.streakLast = day;
  }
  S.pet.joy = Math.min(100, S.pet.joy + 8); touch(S, 'pet');
  bump('complete', 1); if (early) bump('early', 1);
  touch(S, 'quests');
  fire({ type: 'taskDone', task: t, early });
  grant(coins, xp, 0, t.title);
}

export function setDone(id: string, done: boolean) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t || t.done === done) return;
  t.done = done; t.doneAt = done ? Date.now() : undefined; stamp(t);
  if (S.plan) { S.plan.items = S.plan.items.filter((i) => i.taskId !== id || !done); touch(S, 'plan'); }
  if (done && !t.rewarded) payOut(t); else commit();
}

/** Work handed in outside the app (seen via Classroom/Teams) still earns its reward, once. */
function rewardExternal() {
  const cutoff = Date.now() - 3 * 86400000;
  for (const t of S.tasks) if (t.done && !t.rewarded && !t.deleted && (t.doneAt ?? t.updatedAt) > cutoff && t.source !== 'manual') payOut(t);
}

export function toggleStep(id: string, i: number) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t?.steps?.[i]) return;
  t.steps[i].done = !t.steps[i].done; stamp(t);
  if (t.steps[i].done) { bump('steps', 1); touch(S, 'quests'); }
  commit();
}

/** Make sure there is a plan to show; the local planner fills in until the AI one arrives. */
export function ensurePlan(force = false) {
  const open = openTasks();
  const stale = !S.plan || S.plan.items.some((i) => !open.find((t) => t.id === i.taskId)) || (S.plan.source === 'local' && Date.now() - S.plan.generatedAt > 2 * 3600000) || open.some((t) => !S.plan!.items.find((i) => i.taskId === t.id));
  if (!stale && !force) return S.plan!;
  S.plan = buildPlan(S.tasks, Date.now());
  commit('plan');
  return S.plan;
}

export function addReminder(at: number, text: string, taskId?: string) {
  S.reminders.push({ id: uid(), at, text, taskId, createdAt: Date.now() });
  commit('reminders');
}

// ---------------------------------------------------------------- shop, bag, pet

const pay = (coins: number, gems = 0): boolean => {
  if (S.progress.coins < coins || S.progress.gems < gems) { toast(gems ? 'Not enough gems yet.' : 'Not enough coins yet.', 'coin'); return false; }
  S.progress.coins -= coins; S.progress.gems -= gems;
  return true;
};

export function buyFood(id: string) {
  const f = FOOD[id];
  if (!f || !pay(f.price)) return false;
  S.inventory[id] = (S.inventory[id] ?? 0) + 1;
  fire({ type: 'bought', what: f.name });
  commit('progress', 'inventory');
  return true;
}

export function buyItem(id: string) {
  const d = ITEM[id];
  if (!d || (d.level && S.progress.level < d.level) || !pay(d.price, d.gems ?? 0)) return false;
  S.inventory[id] = (S.inventory[id] ?? 0) + 1;
  fire({ type: 'bought', what: d.name });
  commit('progress', 'inventory');
  return true;
}

export function buyOutfit(id: string) {
  const d = OUTFIT[id];
  if (!d || S.wardrobe.includes(id) || (d.level && S.progress.level < d.level) || (d.plus && !S.premium.plus) || !pay(d.price, d.gems ?? 0)) return false;
  S.wardrobe.push(id);
  fire({ type: 'bought', what: id });
  commit('progress', 'wardrobe');
  return true;
}

/** Whether a species can be unlocked right now, and a short reason if not. */
export function unlockStatus(sp: SpeciesId): { owned: boolean; can: boolean; label: string } {
  const owned = S.sidekicks.some((s) => s.look.species === sp), u = SPECIES_INFO[sp].unlock, p = S.progress;
  if (owned) return { owned, can: false, label: 'In your forest' };
  switch (u.kind) {
    case 'starter': return { owned, can: p.level >= 3, label: p.level >= 3 ? 'Invite for free' : 'Reach level 3' };
    case 'coins': return { owned, can: p.coins >= u.n, label: `${u.n} coins` };
    case 'gems': return { owned, can: p.gems >= u.n, label: `${u.n} gems` };
    case 'level': return { owned, can: p.level >= u.n, label: `Reach level ${u.n}` };
    case 'tasks': return { owned, can: p.tasksDone >= u.n, label: `Finish ${u.n} tasks (${Math.min(p.tasksDone, u.n)}/${u.n})` };
    case 'streak': return { owned, can: p.streakDays >= u.n, label: `${u.n}-day streak (${Math.min(p.streakDays, u.n)}/${u.n})` };
  }
}

export function unlockSpecies(sp: SpeciesId) {
  const st = unlockStatus(sp), u = SPECIES_INFO[sp].unlock;
  if (st.owned || !st.can) return false;
  if (u.kind === 'coins') S.progress.coins -= u.n;
  if (u.kind === 'gems') S.progress.gems -= u.n;
  const nk = newSidekick(sp);
  S.sidekicks.push(nk);
  for (const id of Object.values(nk.outfit)) if (id && !S.wardrobe.includes(id)) S.wardrobe.push(id);
  fire({ type: 'bought', what: SPECIES_INFO[sp].label });
  commit('progress', 'sidekicks', 'wardrobe');
  return true;
}

export function feed(id: string): boolean {
  const f = FOOD[id], sk = sidekick();
  if (!f || !sk || !(S.inventory[id] > 0)) return false;
  S.inventory[id]--;
  const loved = f.loved.includes(sk.look.species);
  S.pet.hunger = Math.max(0, S.pet.hunger - f.fill);
  S.pet.joy = Math.min(100, S.pet.joy + f.joy * (loved ? 1.5 : 1));
  S.progress.fed++;
  bump('feed', 1);
  fire({ type: 'fed', food: id, loved });
  commit('inventory', 'pet', 'progress', 'quests');
  return true;
}

export function pat() {
  S.pet.joy = Math.min(100, S.pet.joy + 2);
  bump('pet', 1);
  commit('pet', 'quests');
}

export function focusDone(minutes: number) {
  S.progress.focusMin += minutes;
  bump('focus', minutes); touch(S, 'quests');
  grant(Math.round(minutes * 1.6), Math.round(minutes * 1.4), 0, `${minutes} minutes of focus`);
}

export function adWatched() {
  if (S.progress.adsToday >= ADS_PER_DAY) return false;
  S.progress.adsToday++;
  grant(AD_REWARD, 0, 0, 'Thanks for watching');
  return true;
}

// ---------------------------------------------------------------- garden

export function placeItem(item: string, x: number, z: number, rot: number): Placed | null {
  if (!(S.inventory[item] > 0) || !S.garden.unlocked) return null;
  S.inventory[item]--;
  const p: Placed = { id: uid(), item, x, z, rot };
  S.garden.items.push(p);
  bump('decorate', 1);
  commit('garden', 'inventory', 'quests');
  return p;
}
export function movePlaced(id: string, patch: Partial<Placed>) {
  const p = S.garden.items.find((i) => i.id === id);
  if (!p) return;
  Object.assign(p, patch);
  commit('garden');
}
export function storePlaced(id: string) {
  const i = S.garden.items.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [p] = S.garden.items.splice(i, 1);
  S.inventory[p.item] = (S.inventory[p.item] ?? 0) + 1;
  commit('garden', 'inventory');
}

// ---------------------------------------------------------------- sidekick

export function setActive(id: string) { if (S.sidekicks.some((s) => s.id === id)) { S.active = id; commit('active'); } }
export function setLook(patch: Partial<Look>) { const s = sidekick(); if (s) { s.look = { ...s.look, ...patch }; commit('sidekicks'); } }
export function setOutfit(slot: OutfitSlot, id: string | undefined) {
  const s = sidekick();
  if (!s) return;
  s.outfit = { ...s.outfit };
  if (id) s.outfit[slot] = id; else delete s.outfit[slot];
  commit('sidekicks');
}
export function rename(name: string) { const s = sidekick(); if (s && name.trim()) { s.name = name.trim().slice(0, 16); commit('sidekicks'); } }
export function setSettings(patch: Partial<SaveState['settings']>) { S.settings = { ...S.settings, ...patch }; commit('settings'); }
export function setOwner(name: string) { S.owner.name = name.trim().slice(0, 24); commit('owner'); }

export function pushChat(role: 'user' | 'sidekick', text: string) {
  S.chat.push({ id: uid(), role, text, at: Date.now() });
  if (S.chat.length > 60) S.chat = S.chat.slice(-60);
  if (role === 'user') bump('chat', 1);
  commit('chat', 'quests');
}

/** First run: pick a starter and (optionally) load the sample week. */
export function begin(species: SpeciesId, sidekickName: string, ownerName: string, demo: boolean) {
  const sk = newSidekick(species, sidekickName);
  S.sidekicks = [sk]; S.active = sk.id;
  for (const id of Object.values(sk.outfit)) if (id && !S.wardrobe.includes(id)) S.wardrobe.push(id);
  S.owner = { name: ownerName.trim().slice(0, 24), onboarded: true };
  if (demo && !S.tasks.length) S.tasks.push(...demoTasks());
  S.plan = null;
  commit('owner', 'sidekicks', 'active', 'plan', 'wardrobe');
}

export function resetSave() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
  S = newSave();
  rev.value++;
}
