// Sound: plays the licensed samples listed in /sfx/manifest.json (see docs/AUDIO-CREDITS.md).
// Nothing here synthesises audio; if a sample is missing the call is simply silent.
import { SPECIES_INFO } from '@shared/species.ts';
import type { SpeciesId } from '@shared/types.ts';

interface Entry { files: string[]; gain?: number; loop?: boolean; category?: string }
interface Manifest { version: number; sounds: Record<string, Entry> }

class Looper {
  private timer = 0;
  private gain: GainNode;
  private on = false;
  constructor(private ctx: AudioContext, private buf: AudioBuffer, out: AudioNode, private level: number) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(out);
  }
  /** Loops by overlapping copies with a crossfade, so MP3 padding never clicks. */
  private spawn(when: number) {
    const fade = Math.min(1.5, this.buf.duration / 4), src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = this.buf;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(1, when + fade);
    g.gain.setValueAtTime(1, when + this.buf.duration - fade);
    g.gain.linearRampToValueAtTime(0, when + this.buf.duration);
    src.connect(g).connect(this.gain);
    src.start(when);
    const next = when + this.buf.duration - fade;
    this.timer = window.setTimeout(() => { if (this.on) this.spawn(next); }, Math.max(0, (next - this.ctx.currentTime - 0.3) * 1000));
  }
  set(on: boolean, level = this.level) {
    this.level = level;
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(on ? level : 0, t, 0.8);
    if (on && !this.on) { this.on = true; this.spawn(t + 0.05); }
    else if (!on && this.on) { this.on = false; clearTimeout(this.timer); }
  }
}

export class Sound {
  private ctx: AudioContext | null = null;
  private man: Manifest | null = null;
  private bufs = new Map<string, Promise<AudioBuffer | null>>();
  private loops = new Map<string, Looper>();
  private sfx!: GainNode; private amb!: GainNode;
  private want = new Map<string, number>();
  private lastPlay = new Map<string, number>();
  sfxVol = 0.8; ambVol = 0.6; voiceOn = true;
  ready = false;

  async init() {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}sfx/manifest.json`);
      if (r.ok) this.man = (await r.json()) as Manifest;
    } catch { /* no sounds bundled */ }
    // browsers only allow audio after a gesture
    const unlock = () => {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
        this.sfx = this.ctx.createGain(); this.amb = this.ctx.createGain();
        this.sfx.connect(this.ctx.destination); this.amb.connect(this.ctx.destination);
        this.volumes(this.sfxVol, this.ambVol);
        this.ready = true;
        for (const [id, lv] of this.want) void this.loop(id, true, lv);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    };
    addEventListener('pointerdown', unlock, { passive: true });
    addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => { if (this.ctx) void (document.hidden ? this.ctx.suspend() : this.ctx.resume()); });
  }

  has(id: string) { return !!this.man?.sounds[id]; }

  volumes(sfx: number, amb: number) {
    this.sfxVol = sfx; this.ambVol = amb;
    if (this.ctx) { this.sfx.gain.value = sfx; this.amb.gain.value = amb; }
  }

  private buffer(file: string): Promise<AudioBuffer | null> {
    let p = this.bufs.get(file);
    if (!p) {
      p = fetch(`${import.meta.env.BASE_URL}sfx/${file}`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())).then((a) => this.ctx!.decodeAudioData(a)).catch(() => null);
      this.bufs.set(file, p);
    }
    return p;
  }

  /** Play a one-shot. `gap` (ms) throttles sounds that can fire in bursts. */
  play(id: string, o: { volume?: number; rate?: number; gap?: number } = {}) {
    const e = this.man?.sounds[id];
    if (!e || !this.ctx || this.sfxVol <= 0) return;
    const now = performance.now();
    if (o.gap && now - (this.lastPlay.get(id) ?? 0) < o.gap) return;
    this.lastPlay.set(id, now);
    const file = e.files[Math.floor(Math.random() * e.files.length)];
    void this.buffer(file).then((buf) => {
      if (!buf || !this.ctx) return;
      const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
      src.buffer = buf; src.playbackRate.value = o.rate ?? 1;
      g.gain.value = (e.gain ?? 1) * (o.volume ?? 1);
      src.connect(g).connect(this.sfx);
      src.start();
    });
  }

  async loop(id: string, on: boolean, level = 1) {
    if (on) this.want.set(id, level); else this.want.delete(id);
    const e = this.man?.sounds[id];
    if (!e || !this.ctx) return;
    let l = this.loops.get(id);
    if (!l) {
      if (!on) return;
      const buf = await this.buffer(e.files[0]);
      if (!buf || !this.ctx) return;
      l = this.loops.get(id) ?? new Looper(this.ctx, buf, this.amb, (e.gain ?? 1) * level);
      this.loops.set(id, l);
    }
    l.set(this.want.has(id), (e.gain ?? 1) * (this.want.get(id) ?? level));
  }

  /** One syllable of the sidekick's babble: a real sample, pitched per species and per letter. */
  blip(species: SpeciesId, ch: string) {
    if (!this.voiceOn) return;
    const v = SPECIES_INFO[species].voice, code = ch.toLowerCase().charCodeAt(0) || 97;
    const vowel = 'aeiou'.includes(ch.toLowerCase());
    this.play('voice_' + v.blip, { rate: v.pitch * (0.92 + ((code * 7) % 13) / 60) * (vowel ? 1.06 : 1), volume: 0.7, gap: 45 });
  }
}

export const sound = new Sound();
