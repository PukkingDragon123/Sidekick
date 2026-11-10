// The sidekick chat endpoint, driven end to end over HTTP + SSE. The Anthropic API is a real
// SDK client whose transport is scripted (see fakeAnthropic), so request building, stream
// parsing and the tool loop are all the production code paths.
import { afterEach, describe, expect, test } from 'vitest';
import { SPECIES_INFO, type ChatEvent, type SaveState } from '../../shared/src/index.ts';
import { CHAT_RULES } from '../src/ai/prompt.ts';
import { DAY, HOUR, MIN, T0, boot, closeAll, fakeAnthropic, json, makeState, makeTask, type FakeMessage, type Harness } from './helpers.ts';

afterEach(closeAll);

const say = (text: string): FakeMessage => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });

const textOf = (events: ChatEvent[]): string => events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
const types = (events: ChatEvent[]): string[] => {
  // consecutive text deltas collapse to one entry
  const out: string[] = [];
  for (const e of events) if (e.type !== 'text' || out.at(-1) !== 'text') out.push(e.type);
  return out;
};

/** Bangkok is UTC+7 and has no daylight saving: 16:00 local at T0. */
const local = (y: number, mo: number, d: number, h: number, mi: number): number => Date.UTC(y, mo - 1, d, h - 7, mi);

function schoolState(): SaveState {
  return makeState({
    tasks: [
      makeTask({ id: 'essay1', title: 'Essay: The Giver', course: 'English 9', due: local(2026, 11, 13, 23, 59), estMin: 90, pinned: true }),
      makeTask({ id: 'quiz1', title: 'Unit 3 Quiz', course: 'Algebra 1', due: local(2026, 11, 11, 8, 30) }),
      makeTask({ id: 'late1', title: 'Map worksheet', course: 'Geography', due: local(2026, 11, 9, 15, 0) }),
      makeTask({ id: 'google:600100:700001', source: 'google', externalId: '600100:700001', title: 'Worksheet 7.2', course: 'Algebra 1', due: local(2026, 11, 12, 23, 59) }),
      makeTask({ id: 'nodue', title: 'Tidy binder' }),
      makeTask({ id: 'done1', title: 'Vocabulary list 5', done: true, doneAt: T0 - 2 * HOUR }),
      makeTask({ id: 'gone', title: 'Deleted thing', deleted: true }),
    ],
    chat: [
      { id: 'c1', role: 'sidekick', text: 'Morning, chief.', at: T0 - 3 * HOUR },
      { id: 'c2', role: 'user', text: 'what is due first', at: T0 - 3 * HOUR + 1 },
      { id: 'c3', role: 'sidekick', text: 'The quiz. Tomorrow morning.', at: T0 - 3 * HOUR + 2 },
    ],
  });
}

async function setup(script: Parameters<typeof fakeAnthropic>[0], opts: { state?: SaveState; config?: Parameters<typeof boot>[0] } = {}) {
  const ai = fakeAnthropic(script);
  const h = await boot({ anthropic: ai.client, ...opts.config });
  const a = await h.register('Phone', 'mobile');
  await h.putState(a.token, opts.state ?? schoolState());
  return { h, ai, token: a.token, accountId: a.accountId, deviceId: a.deviceId };
}

describe('without AI', () => {
  test('chat answers with the no_ai error event and stores nothing', async () => {
    const h = await boot();
    const a = await h.register();
    await h.putState(a.token, schoolState());
    const events = await h.chat(a.token, 'hello?');
    expect(events).toEqual([{ type: 'error', code: 'no_ai', message: expect.any(String) }]);
    expect((await h.getState(a.token))?.chat).toHaveLength(3);
  });

  test('the request is still validated and authenticated', async () => {
    const h = await boot();
    const a = await h.register();
    expect((await h.api('POST', '/api/ai/chat', { body: { text: 'hi', now: T0, tz: 'UTC' } })).status).toBe(401);
    const bad = await h.api('POST', '/api/ai/chat', { token: a.token, body: { text: '', now: T0, tz: 'UTC' } });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('invalid_body');
  });
});

describe('a plain reply', () => {
  test('streams text, then done; the exchange is appended to the chat with a fresh stamp', async () => {
    const { h, ai, token } = await setup([say('Quiz first, chief. Twenty minutes on factoring tonight and you are golden.')]);
    const before = Date.now();
    const events = await h.chat(token, 'what should I do tonight?');

    expect(types(events)).toEqual(['text', 'done']);
    expect(events.filter((e) => e.type === 'text').length).toBeGreaterThan(3);
    const done = events.at(-1) as Extract<ChatEvent, { type: 'done' }>;
    expect(done.message).toEqual({ id: expect.any(String), role: 'sidekick', text: textOf(events), at: T0 + 1 });
    expect(done.message.text).toBe('Quiz first, chief. Twenty minutes on factoring tonight and you are golden.');

    const state = (await h.getState(token)) as SaveState;
    expect(state.chat.slice(-2)).toEqual([{ id: expect.any(String), role: 'user', text: 'what should I do tonight?', at: T0 }, done.message]);
    expect(state.stamps.chat).toBeGreaterThanOrEqual(before);
    expect(ai.requests).toHaveLength(1);
  });

  test('the request: model, adaptive thinking, low effort, fallbacks, strict tools, cacheable prefix, volatile notes last', async () => {
    const { h, ai, token } = await setup([say('ok')]);
    await h.chat(token, 'hi');
    const { body, headers, url } = ai.requests[0];

    expect(url.pathname).toBe('/v1/messages');
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.stream).toBe(true);
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.max_tokens).toBe(16000);
    // refusals fall back server-side: the parameter and its beta header travel together
    expect(body.fallbacks).toBe('default');
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    // nothing that newer models reject
    for (const gone of ['temperature', 'top_p', 'top_k', 'tool_choice', 'betas']) expect(body).not.toHaveProperty(gone);
    expect(headers.get('x-api-key') ?? headers.get('authorization')).toContain('sk-test-not-a-real-key');

    expect(body.tools.map((t: { name: string }) => t.name)).toEqual(['add_task', 'update_task', 'complete_task', 'set_reminder', 'save_plan', 'emote']);
    for (const tool of body.tools) {
      expect(tool.strict).toBe(true);
      expect(tool.eager_input_streaming).toBe(true);
      expect(tool.input_schema.additionalProperties).toBe(false);
      expect(tool.description.length).toBeGreaterThan(40);
    }
    // strict mode budgets optional parameters (24 per request) and union types (16)
    const optional = body.tools.reduce((n: number, t: any) => n + Object.keys(t.input_schema.properties).length - t.input_schema.required.length, 0);
    expect(optional).toBeLessThanOrEqual(24);
    expect(JSON.stringify(body.tools)).not.toMatch(/"anyOf"|"minimum"|"maximum"|"minLength"|"maxLength"|"maxItems"/);

    // system: shared rules (cached), persona (cached), then the notes that change every message
    expect(body.system).toHaveLength(3);
    expect(body.system[0]).toEqual({ type: 'text', text: CHAT_RULES, cache_control: { type: 'ephemeral' } });
    expect(body.system[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system[2]).not.toHaveProperty('cache_control');
    const persona: string = body.system[1].text;
    expect(persona).toContain('Your name is Ember. You are a fox.');
    expect(persona).toContain(SPECIES_INFO.fox.personality);
    expect(persona).toContain(SPECIES_INFO.fox.speech);
    expect(persona).toContain("The student's name is Mina.");
    // nothing volatile leaks into the cached part
    expect(body.system[0].text + persona).not.toMatch(/20\d\d|essay1|Local time|Bangkok|Streak:/);

    // history as plain text turns, starting on a student turn, then the new message
    expect(body.messages).toEqual([
      { role: 'user', content: 'what is due first' },
      { role: 'assistant', content: 'The quiz. Tomorrow morning.' },
      { role: 'user', content: 'hi' },
    ]);
  });

  test('the notes: local time, streak, what got done, the pet, and open tasks soonest-first with ids', async () => {
    const { h, ai, token } = await setup([say('ok')]);
    await h.chat(token, 'hi');
    const notes: string = ai.requests[0].body.system[2].text;

    expect(notes).toContain('Local time: Tue 10 Nov 2026, 16:00 (Asia/Bangkok)');
    expect(notes).toContain('Streak: 4 days. Tasks finished so far: 12. Level 2.');
    expect(notes).toContain('Finished today: "Vocabulary list 5"');
    // hunger is stored as 0 (just fed) to 100 (starving), so a hunger of 70 reads as fullness 30
    expect(notes).toContain('fullness 30, joy 80, energy 60');
    expect(notes).toContain('Open tasks: 5, 1 overdue');

    const lines = notes.split('\n').filter((l) => l.startsWith('  ['));
    expect(lines.map((l) => /^ {2}\[([^\]]+)\]/.exec(l)?.[1])).toEqual(['late1', 'quiz1', 'google:600100:700001', 'essay1', 'nodue']);
    expect(lines[0]).toBe('  [late1] Map worksheet | Geography | due Mon 9 Nov 2026, 15:00 (overdue by 1 day) | about 40 min');
    expect(lines[1]).toContain('due Wed 11 Nov 2026, 08:30 (due in 17h)');
    expect(lines[2]).toContain('imported: its title and due time are set by the school');
    expect(lines[3]).toBe('  [essay1] Essay: The Giver | English 9 | due Fri 13 Nov 2026, 23:59 (due in 3 days) | about 1h 30m | pinned');
    expect(lines[4]).toContain('no deadline');
    expect(notes).not.toContain('Deleted thing');
    expect(notes).not.toContain('[done1]');
  });

  test('the persona follows the active sidekick and its species', async () => {
    const state = schoolState();
    state.sidekicks.push({ id: 'sk2', name: 'Yuzu', look: { species: 'capybara', ...SPECIES_INFO.capybara.look }, outfit: {} });
    state.active = 'sk2';
    state.owner.name = '';
    const { h, ai, token } = await setup([say('it is fine. we do one.')], { state });
    await h.chat(token, 'hi');
    const persona: string = ai.requests[0].body.system[1].text;
    expect(persona).toContain('Your name is Yuzu. You are a capybara.');
    expect(persona).toContain(SPECIES_INFO.capybara.speech);
    expect(persona).toContain('has not told you their name');
  });

  test('time zone and clock: the request decides, unless it is unusable', async () => {
    const { h, ai, token } = await setup([say('a'), say('b'), say('c')]);
    await h.chat(token, 'one', { tz: 'America/New_York', now: T0 + 30 * MIN });
    expect(ai.requests[0].body.system[2].text).toContain('Local time: Tue 10 Nov 2026, 04:30 (America/New_York)');
    // a zone that does not exist: the one from the student's settings
    await h.chat(token, 'two', { tz: 'Mars/Phobos' });
    expect(ai.requests[1].body.system[2].text).toContain('(Asia/Bangkok)');
    // a device clock that is a year off: the server's clock
    await h.chat(token, 'three', { now: T0 + 365 * DAY });
    expect(ai.requests[2].body.system[2].text).toContain('Local time: Tue 10 Nov 2026, 16:00');
  });

  test('only the last 24 messages are sent, and the stored chat is capped at 60', async () => {
    const state = schoolState();
    state.chat = Array.from({ length: 59 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'sidekick' : 'user', text: `line ${i}`, at: T0 - DAY + i }) as const);
    const { h, ai, token } = await setup([say('noted')], { state });
    await h.chat(token, 'newest');

    const sent = ai.requests[0].body.messages as { role: string; content: string }[];
    // 24 from history; it would start on a sidekick line (35), which is dropped so a student turn comes first
    expect(sent[0]).toEqual({ role: 'user', content: 'line 36' });
    expect(sent).toHaveLength(24);
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'newest' });

    const stored = ((await h.getState(token)) as SaveState).chat;
    expect(stored).toHaveLength(60);
    expect(stored[0].id).toBe('m1');
    expect(stored.at(-1)?.text).toBe('noted');
  });
});

describe('the tool loop', () => {
  test('tool call => state change => events; the loop continues with the results', async () => {
    const { h, ai, token, accountId } = await setup([
      {
        content: [
          { type: 'thinking', signature: 'sig-turn-1' },
          { type: 'tool_use', id: 'toolu_add', name: 'add_task', input: { title: 'Chem lab report', course: 'Chemistry', due: '2026-11-12T17:00', est_min: 70, steps: ['data table', 'error analysis'] } },
          { type: 'tool_use', id: 'toolu_emote', name: 'emote', input: { emote: 'cheer' } },
        ],
        stop_reason: 'tool_use',
      },
      say('Added the chem lab for Thursday 5pm. Start with the data table, twenty minutes, go.'),
    ]);
    const b = await h.link(token, 'Desktop', 'desktop');
    const wsB = await h.ws(b.token);
    const wsA = await h.ws(token);

    const events = await h.chat(token, 'I also have a chem lab report due thursday 5pm, about 70 min');
    expect(types(events)).toEqual(['emote', 'state', 'text', 'done']);
    expect(events[0]).toEqual({ type: 'emote', emote: 'cheer' });

    const stateEvent = events[1] as Extract<ChatEvent, { type: 'state' }>;
    const added = stateEvent.state.tasks.find((t) => t.title === 'Chem lab report');
    expect(added).toEqual({
      id: expect.any(String), source: 'manual', title: 'Chem lab report', course: 'Chemistry',
      due: local(2026, 11, 12, 17, 0), estMin: 70, kind: 'essay',
      steps: [{ text: 'data table', done: false }, { text: 'error analysis', done: false }],
      done: false, createdAt: T0, updatedAt: T0,
    });
    expect((events.at(-1) as Extract<ChatEvent, { type: 'done' }>).message.text).toBe(
      'Added the chem lab for Thursday 5pm. Start with the data table, twenty minutes, go.',
    );

    // stored, and pushed to the account's other device but not echoed to the one that asked
    const stored = h.server.ctx.states.get(accountId) as SaveState;
    expect(stored.tasks.find((t) => t.id === added?.id)).toEqual(added);
    expect((await wsB.take('state')).state.tasks.some((t) => t.title === 'Chem lab report')).toBe(true);
    expect((await wsB.take('state')).state.chat.at(-1)?.role).toBe('sidekick');
    expect(await wsA.quiet('state')).toBe(true);

    // second request: the assistant turn goes back untouched (thinking block and all), followed
    // by one user message holding a result for every call
    expect(ai.requests).toHaveLength(2);
    const [first, second] = ai.requests.map((r) => r.body);
    expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
    const [assistant, results] = second.messages.slice(first.messages.length);
    expect(assistant.role).toBe('assistant');
    expect(assistant.content.map((c: { type: string }) => c.type)).toEqual(['thinking', 'tool_use', 'tool_use']);
    expect(assistant.content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'sig-turn-1' });
    expect(assistant.content[1]).toMatchObject({ type: 'tool_use', id: 'toolu_add', name: 'add_task', input: { title: 'Chem lab report', est_min: 70 } });
    expect(results.role).toBe('user');
    expect(results.content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_add', content: JSON.stringify({ ok: true, task_id: added?.id, title: 'Chem lab report', due: '2026-11-12T17:00' }) },
      { type: 'tool_result', tool_use_id: 'toolu_emote', content: JSON.stringify({ ok: true }) },
    ]);
    // the prefix both requests share is byte-identical: cacheable, and safe for replayed thinking
    expect(second.system).toEqual(first.system);
    expect(second.tools).toEqual(first.tools);
  });

  test('complete, update, remind and plan act on the save; rewards stay with the game', async () => {
    const { h, token } = await setup([
      {
        content: [
          { type: 'tool_use', id: 't1', name: 'complete_task', input: { task_id: 'late1' } },
          { type: 'tool_use', id: 't2', name: 'update_task', input: { task_id: 'quiz1', est_min: 33, pinned: true, notes: 'factoring', steps: [{ text: 'redo 7.2', done: true }, { text: 'practice set', done: false }], due: '2026-11-11' } },
          { type: 'tool_use', id: 't3', name: 'set_reminder', input: { at: '2026-11-10T19:30', text: 'Quiz practice, 20 minutes.', task_id: 'quiz1' } },
          {
            type: 'tool_use', id: 't4', name: 'save_plan',
            input: {
              summary: 'Quiz tonight, essay tomorrow.',
              items: [
                { task_id: 'quiz1', why: 'Due first.', approach: ['Redo 7.2', 'Self-test', 'Fix misses'], est_min: 31, prompts: ['Quiz me on factoring.', 'Explain FOIL.'] },
                { task_id: 'nope', why: 'x', approach: ['y'], est_min: 10, prompts: ['z'] },
                { task_id: 'essay1', why: 'Biggest.', approach: ['Outline', 'Draft', 'Intro last', 'Read aloud', 'Fix', 'Extra step'], est_min: 2000, prompts: ['a', 'b', 'c', 'd'] },
              ],
            },
          },
        ],
        stop_reason: 'tool_use',
      },
      say('Done, done and done.'),
    ]);
    h.clock.now = T0 + 5000;
    const events = await h.chat(token, 'finished the map thing. plan my night and remind me at 7:30');
    expect(types(events)).toEqual(['state', 'text', 'done']);
    const state = (events[0] as Extract<ChatEvent, { type: 'state' }>).state;

    const late = state.tasks.find((t) => t.id === 'late1');
    expect(late).toMatchObject({ done: true, doneAt: T0 + 5000, updatedAt: T0 + 5000 });
    expect(late).not.toHaveProperty('rewarded');

    expect(state.tasks.find((t) => t.id === 'quiz1')).toMatchObject({
      estMin: 35, pinned: true, notes: 'factoring', due: local(2026, 11, 11, 23, 59),
      steps: [{ text: 'redo 7.2', done: true }, { text: 'practice set', done: false }], updatedAt: T0 + 5000,
    });

    expect(state.reminders).toEqual([{ id: expect.any(String), at: local(2026, 11, 10, 19, 30), text: 'Quiz practice, 20 minutes.', taskId: 'quiz1', createdAt: T0 + 5000 }]);
    expect(state.stamps.reminders).toBeGreaterThan(0);

    expect(state.plan).toEqual({
      generatedAt: T0 + 5000,
      summary: 'Quiz tonight, essay tomorrow.',
      source: 'ai',
      items: [
        { taskId: 'quiz1', rank: 1, why: 'Due first.', approach: ['Redo 7.2', 'Self-test', 'Fix misses'], estMin: 30, prompts: ['Quiz me on factoring.', 'Explain FOIL.'] },
        { taskId: 'essay1', rank: 2, why: 'Biggest.', approach: ['Outline', 'Draft', 'Intro last', 'Read aloud', 'Fix'], estMin: 720, prompts: ['a', 'b', 'c'] },
      ],
    });
    expect(state.stamps.plan).toBeGreaterThan(0);
  });

  test('bad tool input comes back to the model as an error result and it can correct itself', async () => {
    const { h, ai, token } = await setup([
      {
        content: [
          { type: 'tool_use', id: 'bad1', name: 'add_task', input: { title: 'x', priority: 'high' } },
          { type: 'tool_use', id: 'bad2', name: 'complete_task', input: { task_id: 'does-not-exist' } },
          { type: 'tool_use', id: 'bad3', name: 'update_task', input: { task_id: 'google:600100:700001', title: 'My own name for it' } },
          { type: 'tool_use', id: 'bad4', name: 'set_reminder', input: { at: 'tomorrow-ish', text: 'hm' } },
          { type: 'tool_use', id: 'bad5', name: 'set_reminder', input: { at: '2026-11-10T09:00', text: 'in the past' } },
          { type: 'tool_use', id: 'bad6', name: 'launch_rocket', input: {} },
          { type: 'tool_use', id: 'bad7', name: 'emote', input: { emote: 'Cheer' } },
          { type: 'tool_use', id: 'bad8', name: 'add_task', input: {} },
        ],
        stop_reason: 'tool_use',
      },
      { content: [{ type: 'tool_use', id: 'ok1', name: 'update_task', input: { task_id: 'google:600100:700001', notes: 'ask about #14' } }], stop_reason: 'tool_use' },
      say('Fixed it.'),
    ]);
    const before = (await h.getState(token)) as SaveState;
    const events = await h.chat(token, 'do a bunch of things');

    // the only thing that got through in the first batch is the emote (enum casing is forgiven)
    expect(types(events)).toEqual(['emote', 'state', 'text', 'done']);
    const results = ai.requests[1].body.messages.at(-1).content as { tool_use_id: string; is_error?: boolean; content: string }[];
    expect(results.map((r) => [r.tool_use_id, r.is_error === true])).toEqual([
      ['bad1', true], ['bad2', true], ['bad3', true], ['bad4', true], ['bad5', true], ['bad6', true], ['bad7', false], ['bad8', true],
    ]);
    expect(JSON.parse(results[0].content)).toEqual({ INVALID_JSON: JSON.stringify({ title: 'x', priority: 'high' }), problem: expect.any(String) });
    expect(results[1].content).toContain('no task with id "does-not-exist"');
    expect(results[2].content).toContain('imported from the school');
    expect(results[3].content).toContain('YYYY-MM-DDTHH:MM');
    expect(results[4].content).toContain('already in the past');
    expect(results[5].content).toContain('no tool called "launch_rocket"');
    expect(JSON.parse(results[7].content)).toHaveProperty('INVALID_JSON');

    const after = (events[1] as Extract<ChatEvent, { type: 'state' }>).state;
    expect(after.tasks.find((t) => t.id === 'google:600100:700001')).toMatchObject({ title: 'Worksheet 7.2', notes: 'ask about #14' });
    expect(after.tasks).toHaveLength(before.tasks.length);
    expect(after.reminders).toEqual([]);
  });

  test('text before and after a tool call reads as one reply', async () => {
    const { h, token } = await setup([
      { content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 't1', name: 'complete_task', input: { task_id: 'quiz1' } }], stop_reason: 'tool_use' },
      say('Quiz is off the list.'),
    ]);
    const events = await h.chat(token, 'did the quiz');
    expect(types(events)).toEqual(['text', 'state', 'text', 'done']);
    expect(textOf(events)).toBe('On it. Quiz is off the list.');
    expect((events.at(-1) as Extract<ChatEvent, { type: 'done' }>).message.text).toBe('On it. Quiz is off the list.');
  });

  test('a model that only acts and says nothing still produces a reply', async () => {
    const { h, token } = await setup([
      { content: [{ type: 'tool_use', id: 't1', name: 'emote', input: { emote: 'wave' } }], stop_reason: 'tool_use' },
      { content: [], stop_reason: 'end_turn' },
    ]);
    const events = await h.chat(token, 'hey');
    expect(types(events)).toEqual(['emote', 'text', 'done']);
    expect((events.at(-1) as Extract<ChatEvent, { type: 'done' }>).message.text).toBe('Done.');
  });

  test('a turn that never stops calling tools is cut off after six requests', async () => {
    const loop: FakeMessage = { content: [{ type: 'tool_use', id: 't', name: 'emote', input: { emote: 'nod' } }], stop_reason: 'tool_use' };
    const { h, ai, token } = await setup(Array.from({ length: 10 }, () => loop));
    const events = await h.chat(token, 'loop forever');
    expect(ai.requests).toHaveLength(6);
    expect(events.at(-1)?.type).toBe('done');
  });
});

describe('stop reasons', () => {
  test('a refusal is reported as an error and nothing it produced is used', async () => {
    const { h, token } = await setup([
      {
        content: [{ type: 'text', text: 'Partial text that must be dis' }],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber', explanation: 'This request was declined.' },
      },
    ]);
    const events = await h.chat(token, 'something the classifier declines');
    expect(events.at(-1)).toEqual({ type: 'error', code: 'failed', message: expect.stringContaining("can't help") });
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(((await h.getState(token)) as SaveState).chat).toHaveLength(3);
  });

  test('a refusal that arrives with a tool call never runs the tool', async () => {
    const { h, ai, token } = await setup([
      { content: [{ type: 'tool_use', id: 't1', name: 'complete_task', input: { task_id: 'quiz1' } }], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null } },
    ]);
    const events = await h.chat(token, 'x');
    expect(types(events)).toEqual(['error']);
    expect(ai.requests).toHaveLength(1);
    expect(((await h.getState(token)) as SaveState).tasks.find((t) => t.id === 'quiz1')?.done).toBe(false);
  });

  test('a tool call cut off by max_tokens is not executed, even though its input still parses', async () => {
    const { h, token } = await setup([
      // the SDK's tolerant parser turns this into { title: "Chem lab" }: valid-looking, but truncated
      { content: [{ type: 'tool_use_raw', id: 't1', name: 'add_task', json: '{"title": "Chem lab", "est_min": 7' }], stop_reason: 'max_tokens' },
    ]);
    const events = await h.chat(token, 'add chem lab');
    expect(types(events)).toEqual(['error']);
    expect(((await h.getState(token)) as SaveState).tasks.some((t) => t.title === 'Chem lab')).toBe(false);
  });

  test('a text reply cut off by max_tokens is kept as it is', async () => {
    const { h, token } = await setup([{ content: [{ type: 'text', text: 'Step one: outline. Step two' }], stop_reason: 'max_tokens' }]);
    const events = await h.chat(token, 'explain everything');
    expect((events.at(-1) as Extract<ChatEvent, { type: 'done' }>).message.text).toBe('Step one: outline. Step two');
  });

  test('tool input that is not JSON at all: the turn is asked for again', async () => {
    const { h, ai, token } = await setup([
      { content: [{ type: 'tool_use_raw', id: 't1', name: 'add_task', json: '{"title": ]]]' }], stop_reason: 'tool_use' },
      { content: [{ type: 'tool_use', id: 't2', name: 'add_task', input: { title: 'Chem lab' } }], stop_reason: 'tool_use' },
      say('Added.'),
    ]);
    const events = await h.chat(token, 'add chem lab');
    expect(types(events)).toEqual(['state', 'text', 'done']);
    expect(ai.requests).toHaveLength(3);
    // the re-issued request is the same request: the broken turn was never appended
    expect(ai.requests[1].body.messages).toEqual(ai.requests[0].body.messages);
  });

  test('after a mid-turn fallback only the serving model\'s tool calls run, and the turn is echoed by the documented rules', async () => {
    const { h, ai, token } = await setup([
      {
        model: 'claude-opus-5-5',
        content: [
          { type: 'thinking', signature: 'sig-declined' },
          { type: 'text', text: 'Let me' },
          { type: 'tool_use', id: 'toolu_declined', name: 'complete_task', input: { task_id: 'essay1' } },
          { type: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-5', category: 'cyber' },
          { type: 'thinking', signature: 'sig-serving' },
          { type: 'tool_use', id: 'toolu_serving', name: 'complete_task', input: { task_id: 'quiz1' } },
        ],
        stop_reason: 'tool_use',
      },
      say('Quiz ticked off.'),
    ]);
    const events = await h.chat(token, 'I finished the quiz');
    expect(types(events)).toEqual(['text', 'state', 'text', 'done']);

    const state = (await h.getState(token)) as SaveState;
    expect(state.tasks.find((t) => t.id === 'quiz1')?.done).toBe(true);
    expect(state.tasks.find((t) => t.id === 'essay1')?.done).toBe(false);

    const [assistant, results] = ai.requests[1].body.messages.slice(-2);
    // before the boundary: text stays, thinking and the tool call go; the fallback block keeps its place
    expect(assistant.content.map((c: { type: string; id?: string }) => c.id ?? c.type)).toEqual(['text', 'fallback', 'thinking', 'toolu_serving']);
    expect(assistant.content[1]).toMatchObject({ type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } });
    expect(assistant.content[2].signature).toBe('sig-serving');
    expect(results.content.map((r: { tool_use_id: string }) => r.tool_use_id)).toEqual(['toolu_serving']);
  });
});

describe('failures and limits', () => {
  test('an API error becomes a friendly error event; the message is not counted against the day', async () => {
    const { h, token, accountId } = await setup([json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529)]);
    const events = await h.chat(token, 'hi');
    expect(events).toEqual([{ type: 'error', code: 'failed', message: expect.any(String) }]);
    expect((events[0] as { message: string }).message).not.toMatch(/overloaded|529|sk-test/i);
    expect(h.server.ctx.db.aiUsage(accountId, '2026-11-10')).toBe(0);
    expect(((await h.getState(token)) as SaveState).chat).toHaveLength(3);
  });

  test('bad credentials are reported without leaking them', async () => {
    const { h, token } = await setup([json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401)]);
    const events = await h.chat(token, 'hi');
    expect((events[0] as { message: string }).message).toMatch(/set up/);
  });

  test('the daily cap: free accounts stop at AI_FREE_PER_DAY, Plus at AI_PLUS_PER_DAY, and a new day starts fresh', async () => {
    const { h, ai, token, accountId } = await setup(Array.from({ length: 10 }, (_, i) => say(`reply ${i}`)), {
      config: { env: { AI_FREE_PER_DAY: '2', AI_PLUS_PER_DAY: '4' } },
    });
    const last = async (text: string): Promise<ChatEvent> => (await h.chat(token, text)).at(-1) as ChatEvent;

    expect((await last('one')).type).toBe('done');
    expect((await last('two')).type).toBe('done');
    expect(await last('three')).toEqual({ type: 'error', code: 'limit', message: expect.any(String) });
    expect(ai.requests).toHaveLength(2);

    // Plus raises the ceiling
    h.server.ctx.db.setPremium({ accountId, plus: true, until: null, stripeCustomer: null, stripeSubscription: null }, T0);
    expect((await last('three again')).type).toBe('done');
    expect((await last('four')).type).toBe('done');
    expect((await last('five')).type).toBe('error');

    // the allowance is per UTC day
    h.clock.now = T0 + DAY;
    expect((await last('tomorrow')).type).toBe('done');
    expect(h.server.ctx.db.aiUsage(accountId, '2026-11-11')).toBe(1);
  });

  test('chatting before a save exists fails politely', async () => {
    const ai = fakeAnthropic([say('hi')]);
    const h = await boot({ anthropic: ai.client });
    const a = await h.register();
    const events = await h.chat(a.token, 'hello');
    expect(events).toEqual([{ type: 'error', code: 'failed', message: expect.stringContaining('Save your game') }]);
    expect(ai.requests).toHaveLength(0);
  });
});

describe('configuration', () => {
  async function requestWith(env: Record<string, string>): Promise<Harness & { body: Record<string, any>; headers: Headers }> {
    const ai = fakeAnthropic([say('ok')]);
    const h = await boot({ anthropic: ai.client, env });
    const a = await h.register();
    await h.putState(a.token, schoolState());
    await h.chat(a.token, 'hi');
    return Object.assign(h, { body: ai.requests[0].body, headers: ai.requests[0].headers });
  }

  test('model and effort come from the environment', async () => {
    const { body } = await requestWith({ SIDEKICK_MODEL: 'claude-sonnet-5-5', SIDEKICK_CHAT_EFFORT: 'medium' });
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.output_config).toEqual({ effort: 'medium' });
  });

  test('fallbacks can be switched off, which also drops the beta header', async () => {
    const { body, headers } = await requestWith({ SIDEKICK_FALLBACKS: 'off' });
    expect(body).not.toHaveProperty('fallbacks');
    expect(headers.get('anthropic-beta') ?? '').not.toContain('server-side-fallback');
  });

  test('behind a custom base URL eager tool input streaming is left off unless forced', async () => {
    const proxied = await requestWith({ ANTHROPIC_BASE_URL: 'https://gateway.example' });
    for (const tool of proxied.body.tools) expect(tool).not.toHaveProperty('eager_input_streaming');
    expect(proxied.body.tools.every((t: { strict: boolean }) => t.strict)).toBe(true);
    const forced = await requestWith({ ANTHROPIC_BASE_URL: 'https://gateway.example', SIDEKICK_EAGER_TOOL_INPUT: 'true' });
    expect(forced.body.tools.every((t: { eager_input_streaming: boolean }) => t.eager_input_streaming)).toBe(true);
  });
});
