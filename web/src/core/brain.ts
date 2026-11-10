// The sidekick's built-in voice. These lines give every species its own personality with no
// network at all; when the server has an AI key the same moments are answered by the real model.
import type { Emote } from '@shared/api.ts';
import { dueLabel, estimateMinutes, fmtMinutes, rankTasks } from '@shared/planner.ts';
import type { SpeciesId, Task } from '@shared/types.ts';
import { addTask, ensurePlan, openTasks, S, sidekick } from './store.ts';

interface Voice { greet: string[]; nudge: string[]; done: string[]; joke: string[]; idle: string[]; yum: string; pat: string; clear: string }

const V: Record<SpeciesId, Voice> = {
  fox: {
    greet: ["Morning, {name}. I've already scouted today's loot.", 'There you are. I have a plan and it is a good one, heh.'],
    nudge: ["Here's the play: {task} first. About {mins}, in and out.", '{task} is the weak point in the pile. Hit it first, {mins} tops.'],
    done: ['Clean getaway! "{task}" never saw it coming.', 'Heist complete. Coins secured, heh.'],
    joke: ["Why did the fox bring a ladder to class? To reach the high marks. I'll see myself out.", "I'd tell you a procrastination joke, but I'll do it later."],
    idle: ['I timed the butterflies. Very inefficient flight paths.', 'Fun fact: 25 focused minutes beats two hours of sort-of working.'],
    yum: 'Tactical snack acquired.', pat: 'Heh. Okay, one more.', clear: 'Nothing left to steal today. The forest is ours.',
  },
  cat: {
    greet: ["Oh. You're back. Good.", 'Mrrp. I kept your spot warm.'],
    nudge: ['{task}. {mins}. Then we nap.', 'Do {task} first. It is the least annoying path.'],
    done: ['Not bad.', '"{task}" is done. I am mildly impressed.'],
    joke: ['I knocked your to-do list off the table. Fastest way to clear it.', 'Deadlines are like vacuum cleaners. Best dealt with before they get loud.'],
    idle: ['I am not asleep. I am reviewing the plan with my eyes closed.', 'The sunny patch moved. Unacceptable.'],
    yum: 'Acceptable.', pat: 'Mrrp. Fine. Continue.', clear: 'Nothing due. Finally, a civilised day.',
  },
  bunny: {
    greet: ['{name}! Hi hi hi! Today is going to be so good!', "You're here! Okay okay okay, I have ideas!"],
    nudge: ["Let's start with {task}! Only {mins} and then it's done-done!", "Ooh, {task} first? It's {mins} and I'll cheer the whole time!"],
    done: ['Yes! "{task}" is finished! I\'m so proud of you!', 'You did it, you did it, you did it!'],
    joke: ["What's a bunny's favourite subject? Hop-timal algebra! Okay, that one needs work.", 'I tried to eat my homework once. It was a salad worksheet. Honest mistake.'],
    idle: ['I counted 14 daisies. Then I lost count. Then I started again!', 'Tiny steps still count. I should know, look at these feet.'],
    yum: 'Crunchy! Thank you thank you!', pat: 'Eee! Again, again!', clear: 'Everything is done! Victory hop!',
  },
  raccoon: {
    greet: ['Yo {name}, bestie! The snack situation is under control.', 'Chief! Good timing, I just found a shortcut.'],
    nudge: ['Real talk: {task} first. {mins}, then snacks.', "{task} is basically a small bag of chips. {mins} and it's gone."],
    done: ['Let\'s go! "{task}" is toast. Delicious toast.', 'Chief, you cooked. Absolutely cooked.'],
    joke: ['I organise my notes like my snacks: by how fast I can get to them.', 'Homework is just leftovers from class. Still gotta finish it.'],
    idle: ["If the pond was soup, what kind? I'm thinking miso.", 'I rated every bench in this forest. Yours is top tier.'],
    yum: 'Ohhh that hits. Ten out of ten.', pat: 'Okay okay, the fluff is premium, I know.', clear: 'Zero tasks. Certified snack hours.',
  },
  frog: {
    greet: ['Ah. {name}. The pond says hello.', 'You have arrived. That is the first step. Ribbit.'],
    nudge: ['One lily pad at a time. {task} is the nearest. {mins}.', 'Begin with {task}. {mins}. The rest can wait its turn.'],
    done: ['"{task}" is done. The pond is one ripple calmer.', 'Finished. Ribbit.'],
    joke: ['A fly asked me about deadlines. I ate it. Problem solved.', 'Time flies. I find that delicious.'],
    idle: ['I have been sitting very still. It is going extremely well.', 'The work does not get smaller by staring. I have tried.'],
    yum: 'Mm. A fine morsel.', pat: 'Ribbit. That is pleasant.', clear: 'Nothing remains. Sit. Listen to the water.',
  },
  owl: {
    greet: ['Good day, {name}. I have prepared an agenda. Naturally.', 'Ah, a fellow scholar arrives. Indeed.'],
    nudge: ['Observe: {task} is the logical first move. {mins} by my estimate.', 'I propose {task} first. {mins}, and momentum is ours.'],
    done: ['"{task}" concluded. A most satisfying tick.', 'Splendid work. Indeed, exemplary.'],
    joke: ["Why do owls excel at exams? We always ask who set the paper.", 'I would make a pun about feathers, but it would be down-right silly.'],
    idle: ['An hour of sleep can beat an hour of cramming. I, of course, nap strategically.', 'I alphabetised the mushrooms. Bolete before chanterelle.'],
    yum: 'A fine specimen. Thank you.', pat: 'Ahem. Most agreeable.', clear: 'The ledger is clear. A scholar may rest.',
  },
  bear: {
    greet: ["Hello, {name}. No rush today. We'll take it one bite at a time.", 'There you are. I saved you the comfy spot.'],
    nudge: ["Let's start with {task}. About {mins}, like one cup of tea.", '{task} first, nice and steady. {mins}, then a snack.'],
    done: ['"{task}" is all done. That\'s a warm-honey kind of feeling.', 'Well done. Proper job, no rush.'],
    joke: ['I tried to hibernate through homework once. It was still there in spring.', 'My study method is like porridge. Not too fast, not too slow.'],
    idle: ['Breaks are part of the recipe, you know.', 'The bees and I have an understanding.'],
    yum: 'Oh, lovely. That hit the spot.', pat: 'Mmm. That\'s nice.', clear: 'All done. Time for something warm.',
  },
  redpanda: {
    greet: ["Oh! {name}! You're here. I... I colour-coded your day.", 'H-hi {name}. I made the plan pretty for you.'],
    nudge: ["Um, maybe {task} first? It's only {mins}. I gave it a nice colour.", '{task} looks like the gentlest start. {mins}!'],
    done: ['*gasp* You finished "{task}"! And so neatly, too.', "Done! I'm adding a little star next to it."],
    joke: ["I get startled by my own tail. So deadlines? Terrifying. Let's get ahead of them.", 'I drew a cover for your homework. Now it has to be finished. It is art.'],
    idle: ['The light through the leaves is doing something lovely right now.', 'I organised the pencils by warmth of colour.'],
    yum: 'Oh! It\'s so pretty I almost couldn\'t eat it. Almost.', pat: 'Eep! Oh. That\'s nice, actually.', clear: 'Everything is ticked. The page looks so tidy.',
  },
  capybara: {
    greet: ["oh. hi {name}. it's fine. everything's fine.", "you're here. nice."],
    nudge: ['{task}. {mins}. we do one.', 'start with {task}. no stress. {mins}.'],
    done: ['"{task}" done. nice.', 'ok. good. one less.'],
    joke: ['deadline came. deadline went. i stayed calm. then we did it anyway.', 'they said hurry. i said no. we finished on time.'],
    idle: ['the pond is warm. the plan is fine.', "it's all getting done. slowly. that's allowed."],
    yum: 'mm. good.', pat: 'yes. that.', clear: 'nothing due. as expected.',
  },
  axolotl: {
    greet: ['Ooh, {name}! I was just wondering about you!', "Hi hi! Did you know today has never happened before?"],
    nudge: ["Ooh, what if we do {task} first? It's {mins}, and I bet there's something cool in it.", "{task}! {mins}! Let's find the interesting part."],
    done: ['"{task}" is done! Ooh, what did you learn? Tell me later!', 'Finished! Bubbles of joy!'],
    joke: ["I can regrow my limbs, but not your Sunday evening. Let's not waste it.", 'Why did the axolotl ace biology? Extra gills. I mean skills.'],
    idle: ["Do clouds know they're clouds? Anyway, your plan is ready.", 'I found a pebble shaped like a triangle. Geometry is everywhere!'],
    yum: 'Ooh! Tastes like a tiny adventure!', pat: 'Hee! Bubbles!', clear: 'No tasks! What shall we wonder about instead?',
  },
};

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const short = (s: string) => (s.length > 34 ? s.slice(0, 32).trimEnd() + '…' : s);
const fill = (s: string, t?: Task) =>
  s.replace('{name}', S.owner.name || 'friend').replace('{task}', t ? short(t.title) : 'the first thing').replace('{mins}', t ? fmtMinutes(estimateMinutes(t)) : 'a few minutes');
const voice = () => V[sidekick()?.look.species ?? 'fox'];

export const topTask = (): Task | undefined => rankTasks(S.tasks, Date.now())[0];

export interface Line { text: string; emote?: Emote }

export function greeting(): Line {
  const t = topTask(), v = voice();
  const hello = fill(pick(v.greet));
  if (!t) return { text: `${hello} ${v.clear}`, emote: 'wave' };
  return { text: `${hello} ${fill(pick(v.nudge), t)}`, emote: 'wave' };
}
export function nudge(): Line {
  const t = topTask();
  if (!t) return { text: voice().clear, emote: 'happy' };
  const due = dueLabel(t, Date.now());
  return { text: `${fill(pick(voice().nudge), t)}${due.startsWith('overdue') || due.includes('min') || due.endsWith('h') ? ` It's ${due}.` : ''}`, emote: 'think' };
}
export const celebrate = (t: Task): Line => ({ text: fill(pick(voice().done), t), emote: 'cheer' });
export const joke = (): Line => ({ text: pick(voice().joke), emote: 'laugh' });
export const idle = (): Line => ({ text: pick(voice().idle) });
export const yum = (loved: boolean): Line => ({ text: loved ? `${voice().yum} My favourite!` : voice().yum, emote: loved ? 'love' : 'happy' });
export const pat = (): Line => ({ text: voice().pat, emote: 'happy' });
export const focusStart = (m: number): Line => ({ text: `${m} minutes, just this one thing. I'll sit with you.`, emote: 'nod' });
export const focusEnd = (m: number): Line => ({ text: `${m} minutes done. Stretch, drink some water, then decide what's next.`, emote: 'cheer' });

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** Pull "tomorrow", "today", "friday", "in 3 days" out of a quick-add phrase. */
export function parseDue(text: string, now = Date.now()): { title: string; due?: number } {
  let due: number | undefined, title = text;
  const end = (d: Date) => { d.setHours(23, 59, 0, 0); return d.getTime(); };
  const m = /\b(?:due\s+|by\s+|on\s+)?(today|tonight|tomorrow|in (\d+) days?|(?:next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/i.exec(text);
  if (m) {
    const d = new Date(now), w = m[1].toLowerCase();
    if (w === 'tomorrow') d.setDate(d.getDate() + 1);
    else if (m[2]) d.setDate(d.getDate() + Number(m[2]));
    else if (m[3]) { const want = DAYS.indexOf(m[3].toLowerCase()); let add = (want - d.getDay() + 7) % 7; if (add === 0) add = 7; d.setDate(d.getDate() + add); }
    due = end(d);
    title = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').replace(/[\s,.-]+$/, '').trim();
  }
  return { title: title || text, due };
}

/** Offline stand-in for the AI chat: handles the common asks and is upfront about its limits. */
export function localReply(text: string): Line {
  const q = text.toLowerCase().trim();
  if (/\bjoke|funny|make me laugh\b/.test(q)) return joke();
  const add = /^(?:add|new task|remind me to|i (?:have|need) to)\s+(.+)/i.exec(text.trim());
  if (add) {
    const { title, due } = parseDue(add[1]);
    const t = addTask({ title: title[0].toUpperCase() + title.slice(1), due });
    return { text: `Added "${short(t.title)}"${due ? `, ${dueLabel(t, Date.now())}` : ''}. It's on the board.`, emote: 'nod' };
  }
  if (/\b(plan|schedule|what (should|do) i|where do i start|first|next|priorit)/.test(q)) {
    const p = ensurePlan(true), n = openTasks().length;
    if (!n) return { text: voice().clear, emote: 'happy' };
    return { text: `${nudge().text} I've laid out all ${n} in the Plan tab, quickest route for each.`, emote: 'think' };
  }
  if (/^(hi|hey|hello|yo|sup|good (morning|evening|afternoon))\b/.test(q)) return greeting();
  if (/\bthank/.test(q)) return { text: pick(['Any time.', 'That is what I am here for.']), emote: 'happy' };
  if (/\bhow are you|how('s| is) it going\b/.test(q)) return { text: S.pet.hunger > 65 ? "A bit peckish, honestly. Otherwise great." : pick(voice().idle), emote: 'happy' };
  if (/\b(tired|stressed|overwhelm|too much|can't|cant)\b/.test(q)) {
    const t = topTask();
    return { text: t ? `That's a lot to carry. Let's shrink it: just the first step of "${short(t.title)}", five minutes, then we look again.` : 'Then today is for resting. Nothing is due.', emote: 'nod' };
  }
  return { text: `I'm in offline mode, so I can plan, add tasks, set a focus timer and tell bad jokes. For real back-and-forth I need the server's AI switched on. Meanwhile: ${nudge().text}`, emote: 'think' };
}
