// Offline planner: ranks open work and suggests the fastest sensible way through each task.
// The server's AI planner produces the same Plan shape with better judgement; this is the
// fallback that keeps the app useful with no network and no API key.
import type { Plan, PlanItem, Task, TaskKind } from './types.ts';

const KIND_WORDS: [TaskKind, RegExp][] = [
  ['exam', /\b(exam|midterm|final)\b|สอบปลายภาค|สอบกลางภาค/i],
  ['quiz', /\b(quiz|test)\b|ควิซ|สอบย่อย|ทดสอบ/i],
  ['essay', /\b(essay|paper|report|write-?up|reflection|composition|journal)\b|เรียงความ|รายงาน/i],
  ['project', /\b(project|presentation|poster|slides|portfolio|model)\b|โครงงาน|นำเสนอ/i],
  ['reading', /\b(read|reading|chapter|ch\.|pages?)\b|อ่าน/i],
  ['problems', /\b(worksheet|problems?|exercises?|homework|hw|p-?set|practice)\b|แบบฝึกหัด|ใบงาน|การบ้าน/i],
];

export function guessKind(t: Pick<Task, 'title' | 'description' | 'kind'>): TaskKind {
  if (t.kind) return t.kind;
  const text = `${t.title} ${t.description ?? ''}`;
  for (const [kind, re] of KIND_WORDS) if (re.test(text)) return kind;
  return 'assignment';
}

const BASE_MIN: Record<TaskKind, number> = {
  essay: 90, problems: 40, reading: 30, quiz: 35, exam: 120, project: 150, assignment: 40, other: 30,
};

export function estimateMinutes(t: Task): number {
  if (t.estMin && t.estMin > 0) return t.estMin;
  let m = BASE_MIN[guessKind(t)];
  const text = `${t.title} ${t.description ?? ''}`;
  if (/\b(discussion|check-?in|survey|form|sign)\b/i.test(text)) m = 12;
  if (/\blab\b/i.test(text)) m = Math.max(m, 70);
  if (t.points && t.points >= 50) m *= 1.4;
  if (t.points && t.points <= 5) m *= 0.6;
  if (t.steps?.length) {
    const left = t.steps.filter((s) => !s.done).length / t.steps.length;
    m *= Math.max(0.15, left);
  }
  return Math.max(5, Math.round(m / 5) * 5);
}

const HOUR = 3600000;

export function hoursLeft(t: Task, now: number): number {
  return t.due == null ? Infinity : (t.due - now) / HOUR;
}

/** Higher = do sooner. */
export function score(t: Task, now: number): number {
  const est = estimateMinutes(t);
  const left = hoursLeft(t, now);
  let s = 0;
  if (left === Infinity) s = 20;
  else if (left < 0) s = 1000 + Math.min(200, -left);
  else {
    // slack = time left after the work itself with a 50% buffer
    const slack = left - (est / 60) * 1.5;
    s = 600 / (1 + Math.max(0, slack) / 10);
  }
  if (est <= 15 && left < 72) s += 45; // quick wins build momentum
  if (t.pinned) s += 300;
  if (t.points) s += Math.min(t.points, 100) * 0.25;
  return s;
}

export function rankTasks(tasks: Task[], now: number): Task[] {
  return tasks
    .filter((t) => !t.done && !t.deleted)
    .map((t) => ({ t, s: score(t, now) }))
    .sort((a, b) => b.s - a.s || (a.t.due ?? Infinity) - (b.t.due ?? Infinity))
    .map((x) => x.t);
}

export function fmtMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function dueLabel(t: Task, now: number): string {
  if (t.due == null) return 'no deadline';
  const left = hoursLeft(t, now);
  if (left < 0) {
    const d = Math.floor(-left / 24);
    return d >= 1 ? `overdue by ${d} day${d > 1 ? 's' : ''}` : 'overdue';
  }
  if (left < 1) return `due in ${Math.max(1, Math.round(left * 60))} min`;
  if (left < 24) return `due in ${Math.round(left)}h`;
  const d = Math.round(left / 24);
  return d === 1 ? 'due tomorrow' : `due in ${d} days`;
}

function why(t: Task, now: number): string {
  const est = estimateMinutes(t);
  const left = hoursLeft(t, now);
  if (t.pinned) return 'You pinned this one, so it goes first.';
  if (left < 0) return 'Overdue: clearing it stops it hanging over everything else.';
  if (left < 6) return `Due in a few hours and needs about ${fmtMinutes(est)}.`;
  if (est <= 15 && left < 72) return `Only about ${fmtMinutes(est)}: a quick win for momentum.`;
  if (left < 30) return `Due within a day, about ${fmtMinutes(est)} of work.`;
  if (est >= 90 && left < 24 * 5) return `Big one (${fmtMinutes(est)}): a first chunk today keeps it from becoming a cram.`;
  if (left === Infinity) return 'No deadline, so it fits in after the dated work.';
  return `${dueLabel(t, now)[0].toUpperCase()}${dueLabel(t, now).slice(1)}, about ${fmtMinutes(est)}.`;
}

const APPROACH: Record<TaskKind, string[]> = {
  essay: [
    'Write a 5-bullet outline before any full sentences (5 min).',
    "Draft fast and messy. Don't edit while you write.",
    'Write the intro last, once you know what you actually argued.',
    'Read it out loud once to catch the clunky bits.',
  ],
  problems: [
    'Skim every question and star the ones you already know.',
    'Do the starred ones first to bank the easy marks.',
    'Give each hard one 5 minutes, then check a worked example instead of staring.',
    'Spot-check two answers by working backwards.',
  ],
  reading: [
    'Read the headings, bold words and summary first (3 min).',
    'Read with one question in mind and jot one line per section.',
    'Close it and write down three things you remember.',
  ],
  quiz: [
    'List what will be on it.',
    'Test yourself before re-reading: it sticks about twice as well.',
    'Only re-study what you got wrong.',
    'One last quick self-test later today.',
  ],
  exam: [
    'List the topics and mark each green, yellow or red.',
    'Start with the red ones while you are fresh.',
    'Practise with real questions under a timer, not by re-reading notes.',
    'Spread it over several short sessions instead of one long one.',
  ],
  project: [
    "Write one sentence describing what 'done' looks like.",
    'Split it into 3 to 5 chunks and put a date on each.',
    'Do the first 25-minute chunk today.',
    'Save the polish for the last chunk.',
  ],
  assignment: [
    'Read the instructions and rubric fully and note what is graded.',
    'Start with the part you already know how to do.',
    'Work in one 25-minute sprint, then reassess.',
    'Check it against the rubric before handing in.',
  ],
  other: [
    'Decide what finished looks like before starting.',
    'Do one focused 25-minute sprint.',
    'Tick it off as soon as it is good enough.',
  ],
};

export function approachFor(t: Task): string[] {
  if (t.steps?.length) return t.steps.filter((s) => !s.done).map((s) => s.text).slice(0, 5);
  return APPROACH[guessKind(t)];
}

/** Prompts a student can paste into an AI tutor: aimed at understanding and speed, not at outsourcing the work. */
export function promptsFor(t: Task): string[] {
  const name = `"${t.title}"${t.course ? ` for ${t.course}` : ''}`;
  const est = fmtMinutes(estimateMinutes(t));
  switch (guessKind(t)) {
    case 'essay':
      return [
        `I'm writing ${name}. Ask me 5 questions to find my main argument, then turn my answers into an outline. Don't write the essay for me.`,
        'Here is my draft paragraph: [paste]. Tell me which sentence is weakest and why, and how I could fix it.',
        `Give me a 6-item checklist to self-review ${name} before I hand it in.`,
      ];
    case 'problems':
      return [
        'Explain the method for this kind of problem step by step with one worked example, then give me a similar one to try: [paste question]',
        'Here is my working: [paste]. Find the first mistake and give me a hint, not the final answer.',
        `I have ${est} for ${name}. Which question types should I do first to finish fastest?`,
      ];
    case 'reading':
      return [
        'Summarise this in 5 bullets, then quiz me with 5 questions one at a time: [paste text]',
        'Explain this passage like I am new to the topic, then tell me why it matters: [paste]',
      ];
    case 'quiz':
    case 'exam':
      return [
        `Make me a 10-question practice quiz for ${name}, mixing easy and hard. Ask one at a time and explain anything I get wrong.`,
        `Turn these notes into a one-page study sheet with the 10 things most likely to be tested: [paste notes]`,
        'I keep getting [topic] wrong. Explain it two different ways, then test me again.',
      ];
    case 'project':
      return [
        `Help me break ${name} into small tasks with time estimates and an order. Ask me for the requirements first.`,
        'Here is the rubric: [paste]. Tell me exactly what earns full marks in each row.',
      ];
    default:
      return [
        `Here are the instructions for ${name}: [paste]. List exactly what I need to hand in and what will be graded.`,
        `I have ${est} for ${name}. Give me the most efficient step-by-step plan and tell me what to skip.`,
        'Check my finished work against these instructions and tell me what is missing: [paste both]',
      ];
  }
}

export function buildPlan(tasks: Task[], now: number, max = 10): Plan {
  const ranked = rankTasks(tasks, now).slice(0, max);
  const items: PlanItem[] = ranked.map((t, i) => ({
    taskId: t.id,
    rank: i + 1,
    why: why(t, now),
    approach: approachFor(t),
    estMin: estimateMinutes(t),
    prompts: promptsFor(t),
  }));
  const today = ranked.filter((t) => hoursLeft(t, now) < 30);
  const todayMin = today.reduce((n, t) => n + estimateMinutes(t), 0);
  let summary: string;
  if (!ranked.length) summary = 'Nothing due. The forest is yours today.';
  else if (!today.length) summary = `Nothing urgent. A head start on "${ranked[0].title}" would make this week easier.`;
  else summary = `${today.length} thing${today.length > 1 ? 's' : ''} need${today.length > 1 ? '' : 's'} you today, about ${fmtMinutes(todayMin)} in total. Start with "${ranked[0].title}".`;
  return { generatedAt: now, summary, items, source: 'local' };
}
