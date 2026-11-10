// The shared data-model helpers that the server leans on: the merge and the offline planner.
import { describe, expect, test } from 'vitest';
import {
  SECTIONS, buildPlan, dueLabel, estimateMinutes, guessKind, isoWeek, localDate, mergeState, mergeTasks, rankTasks, touch,
  type SaveState, type Task,
} from '../../shared/src/index.ts';
import { DAY, HOUR, MIN, T0, makeState, makeTask } from './helpers.ts';

describe('mergeTasks', () => {
  const t = (id: string, updatedAt: number, over: Partial<Task> = {}): Task => makeTask({ id, title: id, updatedAt, ...over });

  test('the newer copy of each task wins, in either direction; tasks only one side has are kept', () => {
    const a = [t('one', 100, { notes: 'a-old' }), t('two', 300, { notes: 'a-new' }), t('onlyA', 50)];
    const b = [t('one', 200, { notes: 'b-new' }), t('two', 250, { notes: 'b-old' }), t('onlyB', 60)];
    const merged = Object.fromEntries(mergeTasks(a, b, 1000).map((x) => [x.id, x.notes]));
    expect(merged).toEqual({ one: 'b-new', two: 'a-new', onlyA: undefined, onlyB: undefined });
    expect(mergeTasks(b, a, 1000).map((x) => x.id).sort()).toEqual(['one', 'onlyA', 'onlyB', 'two']);
  });

  test('on a tie the first argument (the base copy) is kept', () => {
    const [kept] = mergeTasks([t('x', 100, { notes: 'base' })], [t('x', 100, { notes: 'incoming' })], 1000);
    expect(kept.notes).toBe('base');
  });

  test('a deletion beats an older edit, an edit after the deletion brings the task back', () => {
    const live = t('x', 100);
    const tombstone = t('x', 200, { deleted: true });
    expect(mergeTasks([live], [tombstone], 1000)[0].deleted).toBe(true);
    expect(mergeTasks([tombstone], [live], 1000)[0].deleted).toBe(true);
    expect(mergeTasks([tombstone], [t('x', 300, { notes: 'revived' })], 1000)[0]).toMatchObject({ notes: 'revived' });
  });

  test('tombstones are dropped after thirty days, live tasks never', () => {
    const now = T0;
    const tasks = [t('recent', now - 29 * DAY, { deleted: true }), t('old', now - 31 * DAY, { deleted: true }), t('ancient-but-alive', now - 400 * DAY)];
    expect(mergeTasks(tasks, [], now).map((x) => x.id)).toEqual(['recent', 'ancient-but-alive']);
  });

  test('inputs are not mutated', () => {
    const a = [t('x', 100)];
    const b = [t('x', 200)];
    const snapshot = JSON.stringify([a, b]);
    mergeTasks(a, b, 1000);
    expect(JSON.stringify([a, b])).toBe(snapshot);
  });
});

describe('mergeState', () => {
  test('each section goes to whichever copy stamped it later; unstamped incoming sections lose', () => {
    const base = makeState({ stamps: { settings: 100, owner: 500, pet: 300 } });
    const incoming = makeState({
      owner: { name: 'Stale', onboarded: true },
      settings: { ...base.settings, dailyAt: '06:00' },
      pet: { hunger: 1, joy: 1, energy: 1, at: 1 },
      inventory: { cake: 9 },
      stamps: { settings: 200, owner: 400, pet: 300 },
    });
    const out = mergeState(base, incoming, T0);
    expect(out.settings.dailyAt).toBe('06:00');
    expect(out.owner.name).toBe('Mina');
    // a tie keeps the base copy
    expect(out.pet).toEqual(base.pet);
    // incoming never stamped its inventory, so it does not replace the base's
    expect(out.inventory).toEqual({ apple: 2 });
    expect(out.stamps).toEqual({ settings: 200, owner: 500, pet: 300 });
  });

  test('premium always comes from the base copy, whatever the stamps say', () => {
    const base = makeState({ premium: { plus: false } });
    const incoming = makeState({ premium: { plus: true, until: T0 + DAY }, stamps: Object.fromEntries(SECTIONS.map((s) => [s, T0])) });
    expect(mergeState(base, incoming, T0).premium).toEqual({ plus: false });
    expect(SECTIONS).not.toContain('premium');
    expect(SECTIONS).not.toContain('tasks');
  });

  test('tasks merge per task regardless of section stamps', () => {
    const base = makeState({ tasks: [makeTask({ id: 'a', title: 'Imported on the server', updatedAt: 500 })] });
    const incoming = makeState({ tasks: [makeTask({ id: 'b', title: 'Typed on the phone', updatedAt: 400 })] });
    expect(mergeState(base, incoming, T0).tasks.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  test('the result is a new object and neither input changes', () => {
    const base = makeState({ stamps: { owner: 1 } });
    const incoming = makeState({ owner: { name: 'New', onboarded: true }, stamps: { owner: 2 } });
    const before = JSON.stringify([base, incoming]);
    const out = mergeState(base, incoming, T0);
    expect(out).not.toBe(base);
    expect(out.stamps).not.toBe(base.stamps);
    expect(JSON.stringify([base, incoming])).toBe(before);
    expect(out.owner.name).toBe('New');
  });

  test('merging is idempotent and converges whichever side goes first', () => {
    const one = makeState({ owner: { name: 'One', onboarded: true }, tasks: [makeTask({ id: 'a', title: 'A', updatedAt: 10 })], stamps: { owner: 10, pet: 5 } });
    const two = makeState({ pet: { hunger: 5, joy: 5, energy: 5, at: 9 }, tasks: [makeTask({ id: 'a', title: 'A2', updatedAt: 20 }), makeTask({ id: 'b', title: 'B', updatedAt: 5 })], stamps: { owner: 3, pet: 9 } });
    const ab = mergeState(one, two, T0);
    const ba = mergeState(two, one, T0);
    const view = (s: SaveState) => ({ owner: s.owner, pet: s.pet, tasks: [...s.tasks].sort((x, y) => x.id.localeCompare(y.id)), stamps: s.stamps });
    expect(view(ab)).toEqual(view(ba));
    expect(view(mergeState(ab, two, T0))).toEqual(view(ab));
  });

  test('touch stamps a section with a time that always moves forward', () => {
    const state = makeState({ stamps: { chat: Date.now() + 60_000 } });
    const ahead = state.stamps.chat as number;
    expect(touch(state, 'chat', 'plan')).toBe(state);
    expect(state.stamps.chat).toBe(ahead + 1);
    expect(state.stamps.plan).toBeGreaterThan(0);
  });
});

describe('buildPlan', () => {
  const now = T0;
  const tasks: Task[] = [
    makeTask({ id: 'essay', title: 'Essay on rivers', due: now + 20 * HOUR }),
    makeTask({ id: 'form', title: 'Sign the trip form', due: now + 5 * HOUR }),
    makeTask({ id: 'late', title: 'Map worksheet', due: now - 30 * HOUR }),
    makeTask({ id: 'pinned', title: 'Read chapter 4', due: now + 6 * DAY, pinned: true }),
    makeTask({ id: 'someday', title: 'Tidy binder' }),
    makeTask({ id: 'done', title: 'Finished already', done: true, due: now + HOUR }),
    makeTask({ id: 'deleted', title: 'Gone', deleted: true, due: now + HOUR }),
  ];

  test('ranks open work: overdue first, a quick win due soon, pinned ahead of merely big, undated last', () => {
    const plan = buildPlan(tasks, now);
    // late: overdue. form: 10 minutes and due in 5h. pinned: +300 lifts it over the essay
    // (due in 20h, 90 minutes of work). someday: no deadline.
    expect(plan.items.map((i) => i.taskId)).toEqual(['late', 'form', 'pinned', 'essay', 'someday']);
    expect(plan.items.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.source).toBe('local');
    expect(plan.generatedAt).toBe(now);
  });

  test('every item says why, how, how long, and offers tutor prompts', () => {
    const plan = buildPlan(tasks, now);
    for (const item of plan.items) {
      expect(item.why.length).toBeGreaterThan(10);
      expect(item.approach.length).toBeGreaterThanOrEqual(2);
      expect(item.estMin % 5).toBe(0);
      expect(item.estMin).toBeGreaterThanOrEqual(5);
      expect(item.prompts.length).toBeGreaterThanOrEqual(2);
    }
    const byId = Object.fromEntries(plan.items.map((i) => [i.taskId, i]));
    expect(byId.late.why).toMatch(/^Overdue/);
    expect(byId.pinned.why).toMatch(/pinned/);
    expect(byId.form.estMin).toBe(10);
    expect(byId.essay.estMin).toBe(90);
    expect(byId.essay.prompts[0]).toContain('"Essay on rivers"');
    expect(byId.essay.prompts[0]).toContain("Don't write the essay for me");
  });

  test('the summary counts what needs doing today and names where to start', () => {
    expect(buildPlan(tasks, now).summary).toBe('3 things need you today, about 2h 20m in total. Start with "Map worksheet".');
    expect(buildPlan([tasks[3]], now).summary).toBe('Nothing urgent. A head start on "Read chapter 4" would make this week easier.');
    expect(buildPlan([], now)).toMatchObject({ items: [], summary: 'Nothing due. The forest is yours today.' });
    expect(buildPlan([tasks[1]], now).summary).toMatch(/^1 thing needs you today/);
  });

  test('the list is capped, and a student\'s own checklist and estimate are respected', () => {
    const many = Array.from({ length: 25 }, (_, i) => makeTask({ id: `t${i}`, title: `Task ${i}`, due: now + (i + 1) * HOUR }));
    expect(buildPlan(many, now).items).toHaveLength(10);
    expect(buildPlan(many, now, 3).items.map((i) => i.taskId)).toEqual(['t0', 't1', 't2']);

    const own = makeTask({ id: 'own', title: 'Science project', estMin: 45, steps: [{ text: 'pick topic', done: true }, { text: 'gather sources', done: false }, { text: 'build model', done: false }] });
    const [item] = buildPlan([own], now).items;
    expect(item.estMin).toBe(45);
    expect(item.approach).toEqual(['gather sources', 'build model']);
  });

  test('supporting pieces: kind guessing, estimates, labels, ranking and dates', () => {
    expect(guessKind({ title: 'Unit 3 Quiz' })).toBe('quiz');
    expect(guessKind({ title: 'Final exam review' })).toBe('exam');
    expect(guessKind({ title: 'Lab report' })).toBe('essay');
    expect(guessKind({ title: 'อ่านบทที่ 4' })).toBe('reading');
    expect(guessKind({ title: 'Something', kind: 'project' })).toBe('project');
    expect(guessKind({ title: 'Something' })).toBe('assignment');
    expect(estimateMinutes(makeTask({ id: 'x', title: 'Big essay', points: 100 }))).toBe(125);
    expect(dueLabel(makeTask({ id: 'x', title: 'x', due: now + 45 * MIN }), now)).toBe('due in 45 min');
    expect(dueLabel(makeTask({ id: 'x', title: 'x', due: now - 3 * DAY }), now)).toBe('overdue by 3 days');
    expect(dueLabel(makeTask({ id: 'x', title: 'x' }), now)).toBe('no deadline');
    expect(rankTasks(tasks, now).map((x) => x.id)).toEqual(['late', 'form', 'pinned', 'essay', 'someday']);
    expect(localDate(Date.UTC(2026, 10, 10, 18, 30), 'Asia/Bangkok')).toBe('2026-11-11');
    expect(localDate(Date.UTC(2026, 10, 10, 18, 30), 'America/Los_Angeles')).toBe('2026-11-10');
    expect(isoWeek('2026-11-10')).toBe('2026-W46');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
  });
});
