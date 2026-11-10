import { afterEach, describe, expect, test } from 'vitest';
import { buildPlan, type PlanRes, type SaveState } from '../../shared/src/index.ts';
import { PLAN_RULES } from '../src/ai/prompt.ts';
import { HOUR, T0, boot, closeAll, fakeAnthropic, json, makeState, makeTask, type FakeMessage } from './helpers.ts';

afterEach(closeAll);

const local = (y: number, mo: number, d: number, h: number, mi: number): number => Date.UTC(y, mo - 1, d, h - 7, mi);

function schoolState(): SaveState {
  return makeState({
    tasks: [
      makeTask({ id: 'essay1', title: 'Essay: The Giver', course: 'English 9', due: local(2026, 11, 13, 23, 59), estMin: 90, notes: 'thesis: memory', description: 'Five paragraphs on memory and choice.' }),
      makeTask({ id: 'quiz1', title: 'Unit 3 Quiz', course: 'Algebra 1', due: local(2026, 11, 11, 8, 30), points: 50 }),
      makeTask({ id: 'sheet1', title: 'Worksheet 7.2', course: 'Algebra 1', due: local(2026, 11, 12, 23, 59), steps: [{ text: 'problems 1-10', done: true }, { text: 'problems 11-20', done: false }] }),
      makeTask({ id: 'done1', title: 'Vocabulary list 5', done: true }),
    ],
  });
}

const answer = (payload: unknown): FakeMessage => ({ content: [{ type: 'thinking' }, { type: 'text', text: JSON.stringify(payload) }], stop_reason: 'end_turn' });

const GOOD = {
  summary: 'Quiz first, then the worksheet. The essay gets its outline tonight.',
  items: [
    { task_id: 'quiz1', why: 'Due tomorrow morning.', approach: ['List the three topics.', 'Self-test 10 questions.', 'Redo the misses.'], est_min: 33, prompts: ['Quiz me on Unit 3 of Algebra 1, one question at a time.', 'Explain factoring trinomials two ways.'] },
    { task_id: 'sheet1', why: 'Half done already.', approach: ['Finish 11-20.', 'Spot-check two answers.'], est_min: 20, prompts: ['Here is my working for #14: [paste]. Find the first mistake.', 'Give me one problem like 7.2 #15.'] },
    { task_id: 'essay1', why: 'Biggest piece, due Friday.', approach: ['Five-bullet outline.', 'Draft body paragraphs.', 'Intro last.', 'Read aloud.', 'Rubric check.', 'A sixth step that should be dropped.'], est_min: 90, prompts: ['p1', 'p2', 'p3', 'p4'] },
  ],
};

async function setup(script: Parameters<typeof fakeAnthropic>[0] | null, env: Record<string, string> = {}) {
  const ai = script ? fakeAnthropic(script) : null;
  const h = await boot({ anthropic: ai?.client ?? null, env });
  const a = await h.register();
  await h.putState(a.token, schoolState());
  const plan = async (): Promise<PlanRes> => {
    const res = await h.api('POST', '/api/ai/plan', { token: a.token, body: { now: h.clock.now, tz: 'Asia/Bangkok' } });
    expect(res.status).toBe(200);
    return res.body as PlanRes;
  };
  return { h, ai, token: a.token, accountId: a.accountId, plan };
}

describe('POST /api/ai/plan', () => {
  test('without AI the offline planner answers, and says so', async () => {
    const { h, token, plan } = await setup(null);
    const b = await h.link(token);
    const wsB = await h.ws(b.token);

    const res = await plan();
    expect(res.plan).toEqual(buildPlan(schoolState().tasks, T0));
    expect(res.plan.source).toBe('local');
    expect(res.plan.items.map((i) => i.taskId).sort()).toEqual(['essay1', 'quiz1', 'sheet1']);
    expect(res.state.plan).toEqual(res.plan);
    expect(res.state.stamps.plan).toBeGreaterThan(0);
    expect(((await h.getState(token)) as SaveState).plan).toEqual(res.plan);
    expect((await wsB.take('state')).state.plan?.source).toBe('local');
  });

  test('with AI the structured answer becomes the plan', async () => {
    const { ai, plan } = await setup([answer(GOOD)]);
    const res = await plan();
    expect(res.plan).toEqual({
      generatedAt: T0,
      source: 'ai',
      summary: GOOD.summary,
      items: [
        { taskId: 'quiz1', rank: 1, why: 'Due tomorrow morning.', approach: GOOD.items[0].approach, estMin: 35, prompts: GOOD.items[0].prompts },
        { taskId: 'sheet1', rank: 2, why: 'Half done already.', approach: GOOD.items[1].approach, estMin: 20, prompts: GOOD.items[1].prompts },
        { taskId: 'essay1', rank: 3, why: 'Biggest piece, due Friday.', approach: GOOD.items[2].approach.slice(0, 5), estMin: 90, prompts: ['p1', 'p2', 'p3'] },
      ],
    });
    expect(res.state.plan).toEqual(res.plan);
    expect(ai?.requests).toHaveLength(1);
  });

  test('the request: medium effort, a JSON schema output format, fallbacks, cached rules, tasks in the user turn', async () => {
    const { ai, plan } = await setup([answer(GOOD)]);
    await plan();
    const { body, headers } = ai!.requests[0];

    expect(body.model).toBe('claude-opus-5-5');
    expect(body.stream).toBe(true);
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config.effort).toBe('medium');
    expect(body.output_config.format.type).toBe('json_schema');
    const schema = body.output_config.format.schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['summary', 'items']);
    expect(schema.properties.items.items.required).toEqual(['task_id', 'why', 'approach', 'est_min', 'prompts']);
    expect(schema.properties.items.items.additionalProperties).toBe(false);
    expect(body.fallbacks).toBe('default');
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
    expect(body).not.toHaveProperty('output_format');

    expect(body.system).toEqual([
      { type: 'text', text: PLAN_RULES, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: expect.stringContaining('Your name is Ember'), cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.messages).toHaveLength(1);
    const ask: string = body.messages[0].content;
    expect(ask).toContain('Local time: Tue 10 Nov 2026, 16:00 (Asia/Bangkok)');
    expect(ask).toContain('Plan these 3 open tasks:');
    expect(ask).toContain('id: quiz1\ntitle: Unit 3 Quiz\ncourse: Algebra 1\ndue: Wed 11 Nov 2026, 08:30 (due in 17h)\npoints: 50');
    expect(ask).toContain("student's estimate: 1h 30m");
    expect(ask).toContain("student's checklist: (done) problems 1-10; (open) problems 11-20");
    expect(ask).toContain("student's notes: thesis: memory");
    expect(ask).toContain('description: Five paragraphs on memory and choice.');
    expect(ask).not.toContain('Vocabulary list 5');
  });

  test('ids the model made up are dropped, tasks it skipped are appended, empty fields are filled in', async () => {
    const { plan } = await setup([
      answer({
        summary: '   ',
        items: [
          { task_id: 'invented', why: 'x', approach: ['y'], est_min: 10, prompts: ['z'] },
          { task_id: ' essay1 ', why: 'Start the big one.', approach: [], est_min: 3, prompts: [] },
          { task_id: 'essay1', why: 'duplicate', approach: ['dup'], est_min: 10, prompts: ['dup'] },
        ],
      }),
    ]);
    const res = await plan();
    const offline = buildPlan(schoolState().tasks, T0);
    expect(res.plan.source).toBe('ai');
    expect(res.plan.summary).toBe(offline.summary);
    expect(res.plan.items.map((i) => [i.taskId, i.rank])).toEqual([['essay1', 1], ['quiz1', 2], ['sheet1', 3]]);
    const essay = res.plan.items[0];
    expect(essay.why).toBe('Start the big one.');
    expect(essay.estMin).toBe(5);
    expect(essay.approach.length).toBeGreaterThanOrEqual(2);
    expect(essay.prompts.length).toBeGreaterThanOrEqual(2);
    // the appended ones carry the offline planner's advice
    expect(res.plan.items[1]).toEqual({ ...offline.items.find((i) => i.taskId === 'quiz1'), rank: 2 });
  });

  test.each<[string, FakeMessage | Response]>([
    ['an API error', json({ type: 'error', error: { type: 'api_error', message: 'boom' } }, 500)],
    ['a refusal', { content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'bio', explanation: null } }],
    ['a cut-off answer', { content: [{ type: 'text', text: '{"summary": "Quiz first", "items": [{"task_id": "quiz1"' }], stop_reason: 'max_tokens' }],
    ['an answer that is not JSON', { content: [{ type: 'text', text: 'Sure! Here is your plan: quiz first.' }], stop_reason: 'end_turn' }],
    ['an answer of the wrong shape', answer({ summary: 'x', items: [{ task_id: 'quiz1' }] })],
    ['an answer about none of the tasks', answer({ summary: 'x', items: [{ task_id: 'other', why: '', approach: [], est_min: 5, prompts: [] }] })],
  ])('%s falls back to the offline planner and does not use up the allowance', async (_name, reply) => {
    const { h, accountId, plan } = await setup([reply]);
    const res = await plan();
    expect(res.plan).toEqual(buildPlan(schoolState().tasks, T0));
    expect(res.plan.source).toBe('local');
    expect(res.state.plan).toEqual(res.plan);
    expect(h.server.ctx.db.aiUsage(accountId, '2026-11-10')).toBe(0);
  });

  test('a successful AI plan counts as one message; over the cap the offline planner takes over', async () => {
    const { h, ai, accountId, plan } = await setup([answer(GOOD), answer(GOOD)], { AI_FREE_PER_DAY: '1' });
    expect((await plan()).plan.source).toBe('ai');
    expect(h.server.ctx.db.aiUsage(accountId, '2026-11-10')).toBe(1);
    expect((await plan()).plan.source).toBe('local');
    expect(ai?.requests).toHaveLength(1);
  });

  test('nothing to plan: no model call, the offline summary', async () => {
    const ai = fakeAnthropic([answer(GOOD)]);
    const h = await boot({ anthropic: ai.client });
    const a = await h.register();
    await h.putState(a.token, makeState({ tasks: [makeTask({ id: 'd', title: 'Done already', done: true })] }));
    const res = await h.api('POST', '/api/ai/plan', { token: a.token, body: { now: T0, tz: 'Asia/Bangkok' } });
    expect(res.body.plan).toMatchObject({ source: 'local', items: [], summary: 'Nothing due. The forest is yours today.' });
    expect(ai.requests).toHaveLength(0);
  });

  test('an answer split by a mid-stream fallback is still read', async () => {
    const text = JSON.stringify(GOOD);
    const { plan } = await setup([
      {
        content: [
          { type: 'text', text: text.slice(0, 60) },
          { type: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-5', category: 'bio' },
          { type: 'text', text: text.slice(60) },
        ],
        stop_reason: 'end_turn',
      },
    ]);
    expect((await plan()).plan).toMatchObject({ source: 'ai', summary: GOOD.summary });
  });

  test('only the most pressing fifteen tasks are sent', async () => {
    const ai = fakeAnthropic([answer({ summary: 's', items: [{ task_id: 't0', why: 'w', approach: ['a', 'b'], est_min: 10, prompts: ['p', 'q'] }] })]);
    const h = await boot({ anthropic: ai.client });
    const a = await h.register();
    const tasks = Array.from({ length: 40 }, (_, i) => makeTask({ id: `t${i}`, title: `Task ${i}`, due: T0 + (i + 1) * HOUR }));
    await h.putState(a.token, makeState({ tasks }));
    const res = await h.api('POST', '/api/ai/plan', { token: a.token, body: { now: T0, tz: 'Asia/Bangkok' } });
    expect((ai.requests[0].body.messages[0].content as string).match(/^id: /gm)).toHaveLength(15);
    expect(res.body.plan.items).toHaveLength(15);
    expect(res.body.plan.items[0].taskId).toBe('t0');
  });

  test('needs a save and a valid body', async () => {
    const h = await boot();
    const a = await h.register();
    expect((await h.api('POST', '/api/ai/plan', { token: a.token, body: { now: T0, tz: 'UTC' } })).body.code).toBe('no_state');
    expect((await h.api('POST', '/api/ai/plan', { token: a.token, body: { now: 'soon' } })).status).toBe(400);
  });
});
