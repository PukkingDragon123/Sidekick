// 2D pixel-art food, drawn by Xolotl Kobini's food "chef" (see src/kobini/README.md).
import * as THREE from 'three';
import { foodDefs } from '../kobini/foods.ts';

const canvases = new Map<string, HTMLCanvasElement | null>();
/** The sprite at 1x (null if Kobini has no food with that id). */
export function foodCanvas(id: string): HTMLCanvasElement | null {
  if (!canvases.has(id)) {
    const d = foodDefs().find((f) => f.id === id);
    let c: HTMLCanvasElement | null = null;
    try { c = d ? d.draw() : null; } catch { c = null; }
    canvases.set(id, c);
  }
  return canvases.get(id) ?? null;
}

/** A crisp upscaled data URL for UI icons. */
export function foodSpriteUrl(id: string, scale = 4): string {
  const src = foodCanvas(id);
  if (!src) return '';
  const c = document.createElement('canvas');
  c.width = src.width * scale; c.height = src.height * scale;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL();
}

/** A flat pixel-art card the animal can hold, always turned towards the camera. */
export function foodSpriteMesh(id: string): THREE.Object3D | null {
  const src = foodCanvas(id);
  if (!src) return null;
  const tex = new THREE.CanvasTexture(src);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
  const size = 0.62, aspect = src.width / src.height;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5 }));
  s.scale.set(size * aspect, size, 1);
  return s;
}
