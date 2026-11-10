import { afterEach, describe, expect, test } from 'vitest';
import { boot, closeAll, makeState, makeTask, T0 } from './helpers.ts';

afterEach(closeAll);

describe('WebSocket presence and teleport', () => {
  test('the first device to connect becomes host; presence goes out on every connect and disconnect', async () => {
    const h = await boot();
    const a = await h.register('Phone', 'mobile');
    const b = await h.link(a.token, 'Desktop', 'desktop');

    const wsA = await h.ws(a.token);
    const first = await wsA.take('presence');
    expect(first.host).toBe(a.deviceId);
    expect(first.devices).toEqual([
      { id: a.deviceId, name: 'Phone', kind: 'mobile', online: true },
      { id: b.deviceId, name: 'Desktop', kind: 'desktop', online: false },
    ]);
    // there was no previous host to leave, so nothing teleports
    expect(await wsA.quiet('teleport')).toBe(true);

    const wsB = await h.ws(b.token);
    for (const ws of [wsA, wsB]) {
      const p = await ws.take('presence');
      expect(p.host).toBe(a.deviceId);
      expect(p.devices.map((d) => d.online)).toEqual([true, true]);
    }
    expect(await wsB.quiet('teleport')).toBe(true);

    await wsB.close();
    const after = await wsA.take('presence');
    expect(after.host).toBe(a.deviceId);
    expect(after.devices.map((d) => d.online)).toEqual([true, false]);
  });

  test('summon moves the sidekick to the sender: teleport, then presence', async () => {
    const h = await boot();
    const a = await h.register('Phone', 'mobile');
    const b = await h.link(a.token, 'Desktop', 'desktop');
    const wsA = await h.ws(a.token);
    const wsB = await h.ws(b.token);
    await wsA.take('presence');
    await wsA.take('presence');
    await wsB.take('presence');

    h.clock.now = T0 + 1234;
    wsB.send({ t: 'summon' });
    for (const ws of [wsA, wsB]) {
      const teleport = await ws.take('teleport');
      expect(teleport).toEqual({ t: 'teleport', from: a.deviceId, to: b.deviceId, at: T0 + 1234 });
      // nothing else was queued ahead of the presence that follows it
      expect(ws.unread.filter((m) => m.t === 'teleport')).toEqual([]);
      expect((await ws.take('presence')).host).toBe(b.deviceId);
    }
    expect(h.server.ctx.db.host(a.accountId)).toBe(b.deviceId);

    // summoning when you already have it changes nothing and teleports nothing
    wsB.send({ t: 'summon' });
    expect((await wsB.take('presence')).host).toBe(b.deviceId);
    expect(await wsB.quiet('teleport')).toBe(true);
  });

  test('release sends the sidekick to the most recently active other online device', async () => {
    const h = await boot();
    const a = await h.register('Phone', 'mobile');
    const b = await h.link(a.token, 'Desktop', 'desktop');
    const c = await h.link(a.token, 'Tablet', 'tablet');
    const wsA = await h.ws(a.token);
    h.clock.now += 1000;
    const wsB = await h.ws(b.token);
    h.clock.now += 1000;
    const wsC = await h.ws(c.token);
    await wsC.take('presence');

    // B does something later than C did, so B is the most recently active of the others
    h.clock.now += 1000;
    wsB.send({ t: 'ping' });
    await new Promise((r) => setTimeout(r, 50));

    // only the host can release: from C this is ignored
    wsC.send({ t: 'release' });
    expect(await wsA.quiet('teleport')).toBe(true);

    h.clock.now += 1000;
    wsA.send({ t: 'release' });
    const teleport = await wsB.take('teleport');
    expect(teleport).toMatchObject({ from: a.deviceId, to: b.deviceId });
    expect(h.server.ctx.db.host(a.accountId)).toBe(b.deviceId);
    expect(await wsA.take('teleport')).toMatchObject({ from: a.deviceId, to: b.deviceId });
  });

  test('release with nobody else online leaves the sidekick where it is', async () => {
    const h = await boot();
    const a = await h.register();
    const wsA = await h.ws(a.token);
    await wsA.take('presence');
    wsA.send({ t: 'release' });
    expect(await wsA.quiet('teleport')).toBe(true);
    expect(h.server.ctx.db.host(a.accountId)).toBe(a.deviceId);
  });

  test('the host is remembered while offline; the next device to connect takes over with a teleport from null', async () => {
    const h = await boot();
    const a = await h.register('Phone', 'mobile');
    const b = await h.link(a.token, 'Desktop', 'desktop');

    const wsA = await h.ws(a.token);
    await wsA.take('presence');
    await wsA.close();
    expect(h.server.ctx.db.host(a.accountId)).toBe(a.deviceId);

    h.clock.now = T0 + 5000;
    const wsB = await h.ws(b.token);
    const presence = await wsB.take('presence');
    expect(presence.host).toBe(b.deviceId);
    expect(presence.devices.find((d) => d.id === a.deviceId)?.online).toBe(false);
    expect(await wsB.take('teleport')).toEqual({ t: 'teleport', from: null, to: b.deviceId, at: T0 + 5000 });

    // the old host coming back does not steal it: the current host is online
    const wsA2 = await h.ws(a.token);
    expect((await wsA2.take('presence')).host).toBe(b.deviceId);
    expect(await wsA2.quiet('teleport')).toBe(true);
  });

  test('a host reconnecting keeps the sidekick without a teleport', async () => {
    const h = await boot();
    const a = await h.register();
    const first = await h.ws(a.token);
    await first.take('presence');
    await first.close();
    const again = await h.ws(a.token);
    expect((await again.take('presence')).host).toBe(a.deviceId);
    expect(await again.quiet('teleport')).toBe(true);
  });

  test('summon while the previous host is offline reports from: null', async () => {
    const h = await boot();
    const a = await h.register('Phone', 'mobile');
    const b = await h.link(a.token, 'Desktop', 'desktop');
    const wsA = await h.ws(a.token);
    const wsB = await h.ws(b.token);
    await wsB.take('presence');
    wsB.send({ t: 'summon' });
    expect(await wsA.take('teleport')).toMatchObject({ from: a.deviceId, to: b.deviceId });
    await wsB.close();

    // B still has the sidekick but is offline, so it cannot play the dissolve
    wsA.send({ t: 'summon' });
    expect(await wsA.take('teleport')).toMatchObject({ from: null, to: a.deviceId });
    expect(h.server.ctx.db.host(a.accountId)).toBe(a.deviceId);
  });

  test('a missing or wrong token is closed with code 4401', async () => {
    const h = await boot();
    const ws = await h.ws('not-a-real-token-not-a-real-token-xx');
    expect(await ws.closed()).toBe(4401);
  });

  test('junk messages are ignored and the connection stays up', async () => {
    const h = await boot();
    const a = await h.register();
    const ws = await h.ws(a.token);
    await ws.take('presence');
    ws.send('not json');
    ws.send({ t: 'explode' });
    ws.send({ t: 'ping' });
    ws.send({ t: 'summon' });
    expect((await ws.take('presence')).host).toBe(a.deviceId);
  });
});

describe('state broadcast', () => {
  test('a PUT reaches the other devices of the account, not the sender and not other accounts', async () => {
    const h = await boot();
    const a = await h.register('Phone', 'mobile');
    const b = await h.link(a.token, 'Desktop', 'desktop');
    const stranger = await h.register('Someone else', 'web');
    const wsA = await h.ws(a.token);
    const wsB = await h.ws(b.token);
    const wsX = await h.ws(stranger.token);

    const state = makeState({ tasks: [makeTask({ id: 't1', title: 'Flashcards' })] });
    await h.putState(a.token, state);

    const pushed = await wsB.take('state');
    expect(pushed.state.tasks[0].title).toBe('Flashcards');
    expect(await wsA.quiet('state')).toBe(true);
    expect(await wsX.quiet('state', 50)).toBe(true);

    // sending the same save again changes nothing, so nobody is told
    await h.putState(a.token, state);
    expect(await wsB.quiet('state')).toBe(true);
  });
});
