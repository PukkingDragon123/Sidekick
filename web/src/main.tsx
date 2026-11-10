// Temporary scene test harness (replaced by the real app shell).
import { SPECIES_INFO } from '@shared/species.ts';
import type { Sidekick, SpeciesId } from '@shared/types.ts';
import { World } from './world/world.ts';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('world') as HTMLCanvasElement;
Object.assign(document.body.style, { margin: '0', overflow: 'hidden', background: '#1b2a1b' });
Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', display: 'block' });
const t0 = performance.now();
const world = new World({ canvas, quality: (q.get('q') as 'low' | 'high') ?? 'high' });
if (q.get('sky')) { world.skyMode = q.get('sky') as never; world.applySky(); }
const sk = (s: SpeciesId, outfit = {}): Sidekick => ({ id: s, name: SPECIES_INFO[s].defaultName, look: { species: s, ...SPECIES_INFO[s].look }, outfit });
world.setSidekicks([sk('fox', { body: 'hoodie_red', neck: 'scarf_teal' }), sk('bunny', { head: 'flowercrown' }), sk('raccoon', { body: 'varsity_red', head: 'cap_back' }), sk('capybara', { head: 'yuzu' })], 'fox');
world.setGarden([
  { id: 'a', item: 'bench', x: -2, z: -2.5, rot: 0 }, { id: 'b', item: 'lanternpost', x: -4.2, z: -2.6, rot: 0 }, { id: 'c', item: 'picnic', x: 1.5, z: 1.5, rot: 0 },
  { id: 'd', item: 'campfire', x: -2.5, z: 2, rot: 0 }, { id: 'e', item: 'desk', x: 3.2, z: -2.6, rot: 0 }, { id: 'f', item: 'potflowers', x: 0.3, z: -3, rot: 0 },
  { id: 'g', item: 'mailbox', x: 4.4, z: 2.8, rot: 0 }, { id: 'h', item: 'paperlantern', x: 1, z: -3.4, rot: 0 }, { id: 'i', item: 'ball', x: -0.6, z: 0.4, rot: 0 },
], true);
world.snapCamera({ yaw: Number(q.get('yaw') ?? -0.3), pitch: Number(q.get('pitch') ?? 0.5), dist: Number(q.get('dist') ?? 25) });
console.log('world built in', Math.round(performance.now() - t0), 'ms');
addEventListener('resize', () => world.resize());
// advance the simulation deterministically before the first screenshot so particles and poses are settled
const pre = Number(q.get('pre') ?? 0);
for (let i = 0; i < pre * 30; i++) world.step(1 / 30, false);
world.start();
const w = window as unknown as { __ready: boolean; world: World };
w.world = world;
const wait = () => (world.frames > 2 ? (w.__ready = true) : requestAnimationFrame(wait));
wait();
