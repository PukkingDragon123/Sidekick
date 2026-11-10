import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/silkscreen/400.css';
import { render } from 'preact';
import { sound } from './core/audio.ts';
import * as net from './core/net.ts';
import { begin, S } from './core/store.ts';
import { App, wire } from './ui/app.tsx';
import { open } from './ui/kit.tsx';
import { savedSky } from './ui/panels2.tsx';
import { installSkin } from './ui/pix.ts';
import { CSS } from './ui/style.ts';
import { World, type Quality } from './world/world.ts';

const q = new URLSearchParams(location.search);
document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
installSkin();

function pickQuality(): Quality {
  const forced = q.get('q') ?? (S.settings.quality !== 'auto' ? S.settings.quality : null);
  if (forced === 'low' || forced === 'high') return forced;
  const phone = /Mobi|Android|iPhone/.test(navigator.userAgent);
  return phone && (navigator.hardwareConcurrency ?? 4) < 6 ? 'low' : 'high';
}

const canvas = document.getElementById('world') as HTMLCanvasElement;
const world = new World({ canvas, quality: pickQuality() });
world.skyMode = (q.get('sky') as typeof world.skyMode) ?? savedSky();
world.applySky();
if (innerWidth < innerHeight) world.snapCamera({ dist: 17, pitch: 0.5 }); else world.snapCamera();
addEventListener('resize', () => world.resize());

// developer conveniences used by the screenshot harness
if (q.has('demo') && !S.owner.onboarded) begin((q.get('demo') || 'fox') as never, '', 'Mali', true);

sound.sfxVol = S.settings.sfx; sound.ambVol = S.settings.ambience; sound.voiceOn = S.settings.voice;
void sound.init();
wire(world);
render(<App />, document.getElementById('ui')!);
if (q.get('panel')) setTimeout(() => open(q.get('panel') as never), 50);

const pre = Number(q.get('pre') ?? 0);
for (let i = 0; i < pre * 30; i++) world.step(1 / 30, false);
world.start();
void net.connect();
if ('serviceWorker' in navigator && import.meta.env.PROD && import.meta.env.VITE_OFFLINE !== '1') void navigator.serviceWorker.register('/sw.js');

document.getElementById('splash')?.remove();
const w = window as unknown as { __ready: boolean; world: World };
w.world = world;
const wait = () => (world.frames > 2 ? (w.__ready = true) : requestAnimationFrame(wait));
wait();
