// Tasks (to-do, plan, done), chat with the sidekick, and quests.
import { useEffect, useRef, useState } from 'preact/hooks';
import { approachFor, dueLabel, estimateMinutes, fmtMinutes, hoursLeft, promptsFor } from '@shared/planner.ts';
import type { Task } from '@shared/types.ts';
import { sound } from '../core/audio.ts';
import { localReply, parseDue } from '../core/brain.ts';
import { QUEST, xpFor } from '../core/data.ts';
import * as net from '../core/net.ts';
import { addReminder, addTask, claim, ensurePlan, patchTask, pushChat, removeTask, rev, S, setDone, sidekick, toggleStep, track } from '../core/store.ts';
import { actor, Bar, Btn, focus, Ico, open, Paper, Price, say, Sheet, Tabs, toast } from './kit.tsx';
import { faceIcon } from './icons3d.ts';

const COURSE_COLORS = ['#d8433f', '#3f78c9', '#57a84a', '#8d62d6', '#e2863a', '#2f9f9a', '#c2378f', '#7a6a3a'];
const courseColor = (c: string) => { let h = 0; for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COURSE_COLORS[h % COURSE_COLORS.length]; };
const SRC_ICON: Record<string, string> = { google: 'board', microsoft: 'people', ics: 'calendar', manual: 'pin' };

export function startFocus(minutes: number, taskId?: string) {
  focus.value = { end: Date.now() + minutes * 60000, minutes, taskId };
  sound.play('timer_start');
  const a = actor();
  if (a) { a.busy = true; a.act('study', minutes * 60); }
  say({ text: `${minutes} minutes, just this one thing. I'll sit with you.`, emote: 'nod' });
  open(null);
}

function TaskCard({ t, expanded, toggle }: { t: Task; expanded: boolean; toggle: () => void }) {
  const now = Date.now(), left = hoursLeft(t, now), item = S.plan?.items.find((i) => i.taskId === t.id);
  const steps = t.steps, approach = item?.approach ?? approachFor(t), prompts = item?.prompts ?? promptsFor(t);
  const remind = (at: number, label: string) => { addReminder(at, `Time for "${t.title}"`, t.id); toast(`Reminder set for ${label}`, 'bell'); };
  const at = (h: number, addDays = 0) => { const d = new Date(); d.setDate(d.getDate() + addDays); d.setHours(h, 0, 0, 0); return d.getTime(); };
  return (
    <div class={`task fr paper sm ${t.done ? 'done' : ''}`}>
      <button class="tick fr slot" aria-label={t.done ? 'Mark as not done' : 'Mark as done'} onClick={() => { sound.play('ui_check'); setDone(t.id, !t.done); }}>{t.done && <Ico n="check" s />}</button>
      <div class="grow" onClick={toggle}>
        <div class="ttl">{t.pinned && '★ '}{t.title}</div>
        <div class="meta">
          {t.course && <span class="tag" style={{ background: courseColor(t.course) }}>{t.course}</span>}
          {!t.done && <span class={`due ${left < 0 ? 'late' : left < 24 ? 'hot' : ''}`}>{dueLabel(t, now)}</span>}
          {!t.done && <span class="mute row" style={{ gap: 'var(--u)' }}><Ico n="clock" s />{fmtMinutes(estimateMinutes(t))}</span>}
          <span class="mute" style={{ marginLeft: 'auto' }}><Ico n={SRC_ICON[t.source]} s /></span>
        </div>
        {expanded && (
          <div class="more" onClick={(e) => e.stopPropagation()}>
            {t.description && <p class="small" style={{ userSelect: 'text', whiteSpace: 'pre-wrap' }}>{t.description.slice(0, 600)}</p>}
            {item && <p class="small"><b>Why now:</b> {item.why}</p>}
            <h3>Fastest way through</h3>
            {steps?.length
              ? steps.map((s, i) => <div key={i} class={`step ${s.done ? 'on' : ''}`} onClick={() => { sound.play('ui_check'); toggleStep(t.id, i); }}><i /><span>{s.text}</span></div>)
              : <>
                  {approach.map((s, i) => <div key={i} class="step" style={{ cursor: 'default' }}><span class="num mute">{i + 1}.</span><span>{s}</span></div>)}
                  <div class="gap" /><Btn small k="pap" icon="check" onClick={() => patchTask(t.id, { steps: approach.map((text) => ({ text, done: false })) })}>Make this my checklist</Btn>
                </>}
            <h3>Prompts for an AI tutor</h3>
            {prompts.map((p, i) => (
              <div key={i} class="prompt"><span class="grow">{p}</span>
                <Btn small k="pap" cls="sq" icon="copy" title="Copy prompt" onClick={() => { void navigator.clipboard?.writeText(p); toast('Prompt copied', 'copy'); }} /></div>
            ))}
            <div class="row wrap" style={{ marginTop: 'calc(var(--u) * 2)' }}>
              {!t.done && <Btn small k="leaf" icon="timer" onClick={() => startFocus(25, t.id)}>Focus 25</Btn>}
              {!t.done && <Btn small k="sky" icon="bell" onClick={() => remind(Date.now() + 3600000, 'one hour from now')}>1 hour</Btn>}
              {!t.done && <Btn small k="sky" icon="bell" onClick={() => remind(new Date().getHours() < 18 ? at(19) : at(7, 1), new Date().getHours() < 18 ? 'tonight at 7' : 'tomorrow at 7')}>{new Date().getHours() < 18 ? 'Tonight' : 'Morning'}</Btn>}
              <Btn small k="pap" icon="star" onClick={() => patchTask(t.id, { pinned: !t.pinned })}>{t.pinned ? 'Unpin' : 'Pin'}</Btn>
              {t.url && <Btn small k="pap" icon="arrow" onClick={() => window.open(t.url, '_blank', 'noopener')}>Open</Btn>}
              {t.source === 'manual' && <Btn small k="berry" cls="sq" icon="trash" title="Delete task" onClick={() => removeTask(t.id)} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddTask({ done }: { done: () => void }) {
  const [title, setTitle] = useState(''), [course, setCourse] = useState(''), [due, setDue] = useState(''), [est, setEst] = useState('');
  const add = () => {
    if (!title.trim()) return;
    const p = parseDue(title.trim());
    addTask({ title: p.title, course: course.trim() || undefined, due: due ? new Date(due).getTime() : p.due, estMin: Number(est) || undefined });
    sound.play('ui_confirm'); done();
  };
  return (
    <div class="fr paper sm" style={{ marginBottom: 'calc(var(--u) * 2)' }}>
      <input class="inp fr field" placeholder='What is it? Try "Essay draft friday"' value={title} onInput={(e) => setTitle(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && add()} autofocus />
      <div class="row" style={{ marginTop: 'calc(var(--u) * 1.5)' }}>
        <input class="inp fr field" placeholder="Subject" value={course} onInput={(e) => setCourse(e.currentTarget.value)} />
        <input class="inp fr field" style={{ maxWidth: 'calc(var(--u) * 26)' }} placeholder="Minutes" inputMode="numeric" value={est} onInput={(e) => setEst(e.currentTarget.value)} />
      </div>
      <div class="row" style={{ marginTop: 'calc(var(--u) * 1.5)' }}>
        <input class="inp fr field" type="datetime-local" value={due} onInput={(e) => setDue(e.currentTarget.value)} aria-label="Due date" />
        <Btn k="leaf" icon="plus" onClick={add}>Add</Btn>
      </div>
    </div>
  );
}

export function TasksPanel() {
  rev.value; // eslint-disable-line @typescript-eslint/no-unused-expressions
  const [tab, setTab] = useState<'todo' | 'plan' | 'done'>('todo'), [openId, setOpenId] = useState<string | null>(null), [adding, setAdding] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { if (tab === 'plan') ensurePlan(); }, [tab, rev.value]);
  const now = Date.now(), all = S.tasks.filter((t) => !t.deleted), todo = all.filter((t) => !t.done).sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || (a.due ?? 9e15) - (b.due ?? 9e15));
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const groups: [string, Task[]][] = [
    ['Overdue', todo.filter((t) => t.due != null && t.due < now)],
    ['Today', todo.filter((t) => t.due != null && t.due >= now && t.due <= endToday.getTime())],
    ['This week', todo.filter((t) => t.due != null && t.due > endToday.getTime() && t.due <= now + 7 * 86400000)],
    ['Later', todo.filter((t) => t.due == null || t.due > now + 7 * 86400000)],
  ];
  const card = (t: Task) => <TaskCard key={t.id} t={t} expanded={openId === t.id} toggle={() => { sound.play('ui_page'); setOpenId(openId === t.id ? null : t.id); }} />;
  const replan = async () => {
    setBusy(true);
    const ai = await net.aiPlan();
    if (!ai) ensurePlan(true);
    track('plan'); setBusy(false);
    say({ text: S.plan?.summary ?? 'Plan ready.', emote: 'think' });
  };
  const sync = async () => {
    setBusy(true);
    try { const r = await net.syncNow(); toast(r.errors.length ? r.errors[0].message : `Synced: ${r.added} new, ${r.updated} updated`, 'cloud'); }
    catch (e) { toast((e as { code?: string }).code === 'no_state' ? 'Still saving. Try again in a moment.' : 'Could not reach your school accounts.', 'cloud'); }
    setBusy(false);
  };
  return (
    <Sheet title="Schoolwork" icon="tasks" size="tall" head={<Btn k="leaf" cls="sq" icon="plus" title="Add a task" onClick={() => { setTab('todo'); setAdding(!adding); }} />}>
      <Tabs value={tab} set={setTab} items={[['todo', `To do ${todo.length || ''}`], ['plan', 'Plan'], ['done', 'Done']]} />
      <Paper>
        {tab === 'todo' && <>
          {adding && <AddTask done={() => setAdding(false)} />}
          <div class="row small mute" style={{ marginBottom: 'calc(var(--u) * 2)' }}>
            <span class="grow">{net.link.value === 'online' ? (net.lastSync.value ? 'Saved to your account' : 'Connected') : 'Working offline on this device'}</span>
            {net.link.value === 'online' && <Btn small k="sky" icon="cloud" disabled={busy} onClick={sync}>Sync</Btn>}
            <Btn small k="pap" icon="board" onClick={() => open('settings')}>Connect</Btn>
          </div>
          {!todo.length && !adding && <p class="center mute" style={{ padding: 'calc(var(--u) * 8) 0' }}>Nothing to do. Enjoy the forest,<br />or tap + to add something.</p>}
          {groups.map(([name, list]) => list.length > 0 && <div key={name}><h3>{name}</h3>{list.map(card)}</div>)}
        </>}
        {tab === 'plan' && <>
          <div class="row" style={{ alignItems: 'flex-start', marginBottom: 'calc(var(--u) * 2)' }}>
            {sidekick() && <img class="art" src={faceIcon(sidekick()!)} alt="" />}
            <div class="grow"><p>{S.plan?.summary ?? 'Thinking…'}</p>
              <Btn small k="gold" icon="spark" disabled={busy} onClick={replan}>{net.health.value?.ai ? 'Re-plan with AI' : 'Refresh plan'}</Btn>
              <span class="small mute" style={{ marginLeft: 'calc(var(--u) * 2)' }}>{S.plan?.source === 'ai' ? 'AI plan' : 'Built-in planner'}</span></div>
          </div>
          {S.plan?.items.map((i) => {
            const t = all.find((x) => x.id === i.taskId);
            return t && !t.done ? (
              <div key={i.taskId} class="task fr paper sm" onClick={() => { setTab('todo'); setOpenId(t.id); }}>
                <div class="tick fr slot num" style={{ cursor: 'pointer' }}>{i.rank}</div>
                <div class="grow"><div class="ttl">{t.title}</div><div class="small">{i.why}</div>
                  <div class="meta"><span class={`due ${hoursLeft(t, now) < 24 ? 'hot' : ''}`}>{dueLabel(t, now)}</span><span class="mute row" style={{ gap: 'var(--u)' }}><Ico n="clock" s />{fmtMinutes(i.estMin)}</span></div></div>
              </div>
            ) : null;
          })}
        </>}
        {tab === 'done' && <>
          {!all.some((t) => t.done) && <p class="center mute" style={{ padding: 'calc(var(--u) * 8) 0' }}>Finished work shows up here.</p>}
          {all.filter((t) => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)).slice(0, 40).map(card)}
        </>}
      </Paper>
    </Sheet>
  );
}

// ---------------------------------------------------------------- chat

const SUGGEST = ['What should I do first?', 'Plan my day', 'Quiz me on my next task', 'Tell me a joke', "I'm stressed"];

export function ChatPanel() {
  rev.value; // eslint-disable-line @typescript-eslint/no-unused-expressions
  const [text, setText] = useState(''), [pending, setPending] = useState<{ user: string; reply: string } | null>(null);
  const end = useRef<HTMLDivElement>(null), sk = sidekick();
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [S.chat.length, pending?.reply.length]);
  const send = async (raw: string) => {
    const msg = raw.trim();
    if (!msg || pending) return;
    setText(''); sound.play('ui_confirm');
    let reply = '', final = '';
    setPending({ user: msg, reply: '' });
    const a = actor();
    if (a) a.speaking = true;
    const ok = await net.chat(msg, (e) => {
      if (e.type === 'text') { reply += e.delta; setPending({ user: msg, reply }); if (sk && /[a-z]/i.test(e.delta)) sound.blip(sk.look.species, e.delta.replace(/[^a-z]/gi, '')[0] ?? 'a'); }
      else if (e.type === 'emote') a?.emote(e.emote);
      else if (e.type === 'done') final = e.message.text;
      else if (e.type === 'error') reply = '';
    });
    if (a) a.speaking = false;
    pushChat('user', msg);
    if (ok && (final || reply)) pushChat('sidekick', final || reply);
    else { const r = localReply(msg); pushChat('sidekick', r.text); if (r.emote) a?.emote(r.emote); }
    setPending(null);
  };
  return (
    <Sheet title={sk?.name ?? 'Sidekick'} icon="chat" size="short">
      <Paper>
        <div class="msgs">
          {!S.chat.length && !pending && <p class="mute small center">Ask for a plan, a quiz, a nudge or a bad joke.</p>}
          {S.chat.slice(-30).map((m) => <div key={m.id} class={`msg ${m.role === 'user' ? 'me' : ''}`}>{m.text}</div>)}
          {pending && <><div class="msg me">{pending.user}</div><div class="msg">{pending.reply || <span class="bob" style={{ display: 'inline-block' }}>…</span>}</div></>}
          <div ref={end} />
        </div>
      </Paper>
      {!net.health.value?.ai && <div class="small" style={{ opacity: 0.85, marginTop: 'var(--u)' }}>Offline brain: planning, quick-add and jokes. The server needs an AI key for real conversation.</div>}
      <div class="sugg">{SUGGEST.map((s) => <Btn key={s} small k="pap" onClick={() => send(s)}>{s}</Btn>)}</div>
      <div class="row">
        <input class="inp fr field" style={{ color: 'var(--ink)' }} placeholder={`Say something to ${sk?.name ?? 'your sidekick'}`} value={text} onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && send(text)} enterkeyhint="send" />
        <Btn k="leaf" cls="sq" icon="arrow" title="Send" disabled={!!pending} onClick={() => send(text)} />
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- quests

function QuestRow({ id }: { id: string }) {
  const d = QUEST[id], p = [...S.quests.daily, ...S.quests.weekly].find((x) => x.id === id);
  if (!d || !p) return null;
  const ready = p.n >= d.goal && !p.claimed;
  return (
    <div class="task fr paper sm" style={{ alignItems: 'center', opacity: p.claimed ? 0.6 : 1 }}>
      <div class="grow">
        <div class="ttl">{d.text}</div>
        <div class="row" style={{ marginTop: 'var(--u)' }}><Bar v={p.n} max={d.goal} cls="pap grow" /><span class="num small">{Math.floor(p.n)}/{d.goal}</span></div>
        <div class="meta"><Price coins={d.coins} /><span class="price"><Ico n="bolt" s />{d.xp}</span>{d.gems ? <Price gems={d.gems} /> : null}</div>
      </div>
      {p.claimed ? <Ico n="check" /> : <Btn k={ready ? 'gold' : 'pap'} disabled={!ready} snd="reward_quest" onClick={() => claim(id)}>Claim</Btn>}
    </div>
  );
}

export function QuestsPanel() {
  rev.value; // eslint-disable-line @typescript-eslint/no-unused-expressions
  const p = S.progress;
  return (
    <Sheet title="Quests" icon="quests" size="tall">
      <Paper>
        <div class="row" style={{ marginBottom: 'calc(var(--u) * 2)' }}>
          <Ico n="flame" /><div class="grow"><b>{p.streakDays}-day streak</b><div class="small mute">Finish one thing a day to keep it burning.</div></div>
          <div style={{ textAlign: 'right' }}><b>Level {p.level}</b><Bar v={p.xp} max={xpFor(p.level)} cls="pap gold" /><div class="small mute num">{p.xp}/{xpFor(p.level)} xp</div></div>
        </div>
        <h3>Today</h3>
        {S.quests.daily.map((q) => <QuestRow key={q.id} id={q.id} />)}
        <h3>This week</h3>
        {S.quests.weekly.map((q) => <QuestRow key={q.id} id={q.id} />)}
        <p class="small mute center">{p.tasksDone} tasks finished · {fmtMinutes(p.focusMin)} focused · {p.fed} snacks shared</p>
      </Paper>
    </Sheet>
  );
}
