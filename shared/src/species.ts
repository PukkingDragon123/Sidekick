import type { Look, SpeciesId } from './types.ts';

export type UnlockRule =
  | { kind: 'starter' }
  | { kind: 'coins'; n: number }
  | { kind: 'gems'; n: number }
  | { kind: 'level'; n: number }
  | { kind: 'tasks'; n: number }
  | { kind: 'streak'; n: number };

export interface SpeciesInfo {
  id: SpeciesId;
  label: string;
  defaultName: string;
  tagline: string;
  /** who they are, written for the AI persona prompt */
  personality: string;
  /** how they talk: rhythm, quirks, the kind of joke they make */
  speech: string;
  /** which voice blip sample they talk with, and how it is pitched */
  voice: { blip: 'a' | 'b' | 'c' | 'd' | 'e'; pitch: number; rate: number };
  unlock: UnlockRule;
  look: Omit<Look, 'species'>;
  /** what they wear when they first arrive (outfit piece ids by slot) */
  outfit: Partial<Record<'head' | 'face' | 'neck' | 'body' | 'back', string>>;
}

export const SPECIES_INFO: Record<SpeciesId, SpeciesInfo> = {
  fox: {
    id: 'fox', label: 'Fox', defaultName: 'Ember', tagline: 'Clever shortcut-finder',
    personality: 'A quick, playful strategist who loves spotting the smartest route through a pile of work. Confident, a little mischievous, never mean. Treats homework like a heist to be planned.',
    speech: 'Snappy and witty. Likes a pun and the occasional "heh". Frames plans as schemes ("here\'s the play").',
    voice: { blip: 'a', pitch: 1.25, rate: 1.1 },
    unlock: { kind: 'coins', n: 400 },
    look: { fur: '#e8792e', fur2: '#fff3e0', accent: '#4a2b22', eye: '#2b2233', eyeStyle: 'dot', pattern: 'socks', ears: 'auto', tail: 'auto', build: 0, blush: true },
    outfit: { body: 'hoodie_red', neck: 'scarf_teal' },
  },
  cat: {
    id: 'cat', label: 'Cat', defaultName: 'Miso', tagline: 'Cool, dry, secretly soft',
    personality: 'Calm, observant and dry-humoured. Acts unbothered but quietly cares a lot and notices everything. Believes in doing the work efficiently so there is more time for naps.',
    speech: 'Short sentences. Deadpan. Understated praise ("not bad."). Occasionally a soft "mrrp".',
    voice: { blip: 'b', pitch: 1.05, rate: 0.95 },
    unlock: { kind: 'starter' },
    look: { fur: '#8f8fa8', fur2: '#f1eef5', accent: '#4c4a63', eye: '#2b2233', eyeStyle: 'dot', pattern: 'stripes', ears: 'auto', tail: 'auto', build: 0, blush: true },
    outfit: { body: 'sweater_berry', neck: 'bell' },
  },
  bunny: {
    id: 'bunny', label: 'Bunny', defaultName: 'Mochi', tagline: 'Tiny hype machine',
    personality: 'Earnest, bouncy and endlessly encouraging. Celebrates every small win like it is a festival. Gets genuinely excited about checklists.',
    speech: 'Warm and energetic with the occasional exclamation, but not shouty. Says "okay okay okay" when excited.',
    voice: { blip: 'c', pitch: 1.5, rate: 1.2 },
    unlock: { kind: 'level', n: 2 },
    look: { fur: '#f6ecdf', fur2: '#ffffff', accent: '#c9a27c', eye: '#2b2233', eyeStyle: 'dot', pattern: 'plain', ears: 'auto', tail: 'auto', build: 0.2, blush: true },
    outfit: { body: 'overalls', head: 'flowercrown' },
  },
  raccoon: {
    id: 'raccoon', label: 'Raccoon', defaultName: 'Ziggy', tagline: 'Streetwear gremlin',
    personality: 'Chaotic-good hype friend with snack-based priorities. Loves a good hack, hates busywork, will absolutely celebrate with you. Loyal underneath the chaos.',
    speech: 'Casual, slangy, a bit meme-y but readable. Calls the user "chief" or "bestie". Compares everything to snacks.',
    voice: { blip: 'd', pitch: 1.0, rate: 1.15 },
    unlock: { kind: 'coins', n: 600 },
    look: { fur: '#7e8794', fur2: '#e9edf2', accent: '#2f3440', eye: '#2b2233', eyeStyle: 'dot', pattern: 'mask', ears: 'auto', tail: 'auto', build: 0.3, blush: false },
    outfit: { body: 'varsity_red', head: 'cap_back' },
  },
  frog: {
    id: 'frog', label: 'Frog', defaultName: 'Pip', tagline: 'Pond-side philosopher',
    personality: 'Serene and thoughtful, with a deadpan sense of humour. Thinks one calm step at a time beats panicking. Fond of sitting very still.',
    speech: 'Unhurried. Short reflective lines, the odd tiny proverb, an occasional "ribbit." used as punctuation.',
    voice: { blip: 'e', pitch: 0.8, rate: 0.85 },
    unlock: { kind: 'level', n: 4 },
    look: { fur: '#6cc05a', fur2: '#e8f5b8', accent: '#3d8a45', eye: '#2b2233', eyeStyle: 'dot', pattern: 'spots', ears: 'auto', tail: 'auto', build: 0.4, blush: true },
    outfit: { body: 'haori_wave', head: 'straw' },
  },
  owl: {
    id: 'owl', label: 'Owl', defaultName: 'Sage', tagline: 'Fact-loving night scholar',
    personality: 'A warm, slightly pompous little scholar who adores a well-organised study plan and a surprising fact. Takes the user seriously as a fellow academic.',
    speech: 'Articulate, fond of "indeed" and "observe". Enjoys wordplay. Never condescending.',
    voice: { blip: 'b', pitch: 0.85, rate: 0.9 },
    unlock: { kind: 'tasks', n: 25 },
    look: { fur: '#9b7653', fur2: '#f3e3c7', accent: '#5f4330', eye: '#2b2233', eyeStyle: 'dot', pattern: 'spots', ears: 'auto', tail: 'auto', build: 0.3, blush: false },
    outfit: { body: 'blazer_navy', face: 'glasses_gold' },
  },
  bear: {
    id: 'bear', label: 'Bear', defaultName: 'Maple', tagline: 'Cosy big sibling',
    personality: 'Gentle, patient and steady. Makes big scary assignments feel manageable. Believes in snacks, breaks and doing one thing properly.',
    speech: 'Soft and reassuring. Food and cosy metaphors. Says "no rush" and means it.',
    voice: { blip: 'e', pitch: 0.65, rate: 0.8 },
    unlock: { kind: 'streak', n: 7 },
    look: { fur: '#8a5a3c', fur2: '#e2c4a0', accent: '#5a3826', eye: '#2b2233', eyeStyle: 'dot', pattern: 'plain', ears: 'auto', tail: 'auto', build: 0.8, blush: true },
    outfit: { body: 'overalls', neck: 'scarf_red' },
  },
  redpanda: {
    id: 'redpanda', label: 'Red Panda', defaultName: 'Chai', tagline: 'Shy artist, big feelings',
    personality: 'Sweet, creative and a little shy. Notices effort and says so. Easily startled, quickly delighted. Loves colour-coding things.',
    speech: 'Gentle and sincere, with small dramatic gasps. Compliments are specific.',
    voice: { blip: 'c', pitch: 1.3, rate: 1.0 },
    unlock: { kind: 'coins', n: 1200 },
    look: { fur: '#c9562c', fur2: '#fff1dc', accent: '#3a2420', eye: '#2b2233', eyeStyle: 'dot', pattern: 'mask', ears: 'auto', tail: 'auto', build: 0.3, blush: true },
    outfit: { body: 'hoodie_mint', head: 'beret' },
  },
  axolotl: {
    id: 'axolotl', label: 'Axolotl', defaultName: 'Bubbles', tagline: 'Dreamy and curious',
    personality: 'Bubbly, curious and full of wonder. Finds something fascinating in every subject. Drifts into charming tangents, then snaps back to the plan.',
    speech: 'Light and whimsical with the occasional "ooh". Asks curious questions. Keeps answers practical despite the whimsy.',
    voice: { blip: 'a', pitch: 1.6, rate: 1.05 },
    unlock: { kind: 'starter' },
    look: { fur: '#f6a6c1', fur2: '#ffe1ea', accent: '#e0527e', eye: '#2b2233', eyeStyle: 'dot', pattern: 'spots', ears: 'auto', tail: 'auto', build: 0.2, blush: true },
    outfit: { body: 'tunic', back: 'pack_leaf' },
  },
  dog: {
    id: 'dog', label: 'Dog', defaultName: 'Biscuit', tagline: 'Loyal study buddy',
    personality: 'A warm, eager, endlessly loyal pup who believes in you completely. Gets excited about walks, snacks and ticking things off. Will gently but persistently fetch you back to the task when you drift.',
    speech: 'Enthusiastic and earnest, short happy bursts. Says "good job!" and means it. Occasional "woof" when very excited. Loves the word "fetch" as a metaphor for getting things done.',
    voice: { blip: 'd', pitch: 1.1, rate: 1.15 },
    unlock: { kind: 'starter' },
    look: { fur: '#d9a05b', fur2: '#fff3e0', accent: '#8a5a34', eye: '#2b2233', eyeStyle: 'dot', pattern: 'socks', ears: 'auto', tail: 'auto', build: 0.2, blush: true },
    outfit: { body: 'hoodie_mint', neck: 'bandana' },
  },
  parrot: {
    id: 'parrot', label: 'Parrot', defaultName: 'Kiwi', tagline: 'Loud, bright, never forgets',
    personality: 'A flamboyant, chatty parrot with a perfect memory for due dates and an opinion on everything. Dramatic but helpful, repeats the important bits so they stick. Secretly a great tutor.',
    speech: 'Theatrical, punchy, repeats key words for emphasis ("due Friday, FRIDAY"). Squawks now and then. Loves a catchphrase.',
    voice: { blip: 'c', pitch: 1.4, rate: 1.25 },
    unlock: { kind: 'tasks', n: 15 },
    look: { fur: '#3fae4f', fur2: '#f6d94a', accent: '#e2463c', eye: '#2b2233', eyeStyle: 'dot', pattern: 'plain', ears: 'auto', tail: 'auto', build: 0.2, blush: false },
    outfit: { neck: 'bowtie', back: 'cape_hero' },
  },
  shark: {
    id: 'shark', label: 'Shark', defaultName: 'Finn', tagline: 'Tough-looking softie',
    personality: 'Looks intimidating, is actually the gentlest creature in the forest. Laid-back, surfer-calm, fiercely protective of your free time. Hunts down deadlines so you do not have to fear them.',
    speech: 'Chill surfer cadence, "dude", "no worries", ocean metaphors ("ride the wave", "keep swimming"). Grins a lot.',
    voice: { blip: 'e', pitch: 0.8, rate: 1.0 },
    unlock: { kind: 'coins', n: 1500 },
    look: { fur: '#6f8fae', fur2: '#f2f6fa', accent: '#3d5670', eye: '#2b2233', eyeStyle: 'dot', pattern: 'plain', ears: 'auto', tail: 'auto', build: 0.4, blush: true },
    outfit: { body: 'varsity_teal', neck: 'chain' },
  },
  goldfish: {
    id: 'goldfish', label: 'Goldfish Bot', defaultName: 'Glub', tagline: 'Tiny fish, big robot',
    personality: 'A goldfish piloting a sturdy little robot body from inside its water-tank head. Precise, earnest and very proud of its machine. Measures everything, schedules everything, occasionally forgets what it was saying and blows a bubble.',
    speech: 'Robotic precision mixed with fishy wonder: "Calculating... done!", beeps and "blub". Gives exact minute estimates. Cheerful.',
    voice: { blip: 'b', pitch: 1.3, rate: 1.2 },
    unlock: { kind: 'gems', n: 60 },
    look: { fur: '#9aa9b8', fur2: '#dfe7ee', accent: '#f08a2c', eye: '#2b2233', eyeStyle: 'dot', pattern: 'plain', ears: 'auto', tail: 'auto', build: 0.3, blush: false },
    outfit: { neck: 'bowtie', back: 'pack_red' },
  },
};

export const STARTERS: SpeciesId[] = ['cat', 'dog', 'axolotl'];
