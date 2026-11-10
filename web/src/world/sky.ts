// Light and atmosphere: a day/night cycle with a pixel sky, warm key light with soft shadows,
// coloured ambient, depth fog and sun shafts falling through the canopy.
import * as THREE from 'three';

interface Key { h: number; sun: number; sunI: number; top: number; hor: number; sky: number; ground: number; fog: number; hemiI: number; night: number; rays: number }
const KEYS: Key[] = [
  { h: 0, sun: 0x8fb0ff, sunI: 0.75, top: 0x070b24, hor: 0x1c2c5c, sky: 0x5f7ed6, ground: 0x1c2a44, fog: 0x18244c, hemiI: 0.95, night: 1, rays: 0 },
  { h: 4.6, sun: 0x8fb0ff, sunI: 0.75, top: 0x0a1030, hor: 0x24356a, sky: 0x6a86d6, ground: 0x1c2a44, fog: 0x1c2a55, hemiI: 0.95, night: 1, rays: 0 },
  { h: 6.2, sun: 0xffb48a, sunI: 1.3, top: 0x4a5aa6, hor: 0xf9b08e, sky: 0xcdb6e0, ground: 0x5a4a52, fog: 0xd8a9a6, hemiI: 1.05, night: 0.25, rays: 0.9 },
  { h: 8.5, sun: 0xfff0cf, sunI: 2.5, top: 0x58aaf0, hor: 0xcdeeff, sky: 0xd6ebff, ground: 0x7d9a62, fog: 0xcfe9f1, hemiI: 0.92, night: 0, rays: 0.75 },
  { h: 13, sun: 0xfff7e6, sunI: 2.7, top: 0x4a9fee, hor: 0xc6ebff, sky: 0xe2f1ff, ground: 0x86a468, fog: 0xd3eef4, hemiI: 0.95, night: 0, rays: 0.55 },
  { h: 16.8, sun: 0xffc983, sunI: 2.6, top: 0x5b8fd8, hor: 0xffdca6, sky: 0xffe6c6, ground: 0x857c52, fog: 0xf3d6aa, hemiI: 0.85, night: 0, rays: 1 },
  { h: 18.8, sun: 0xff8f68, sunI: 1.4, top: 0x3c3f8c, hor: 0xf58d6c, sky: 0xc9a0cc, ground: 0x4d3c56, fog: 0xc08c9c, hemiI: 1.0, night: 0.3, rays: 0.8 },
  { h: 20.4, sun: 0x8fb0ff, sunI: 0.75, top: 0x0c1234, hor: 0x2a3a74, sky: 0x6a86d6, ground: 0x1c2a44, fog: 0x1d2b58, hemiI: 0.95, night: 1, rays: 0 },
  { h: 24, sun: 0x8fb0ff, sunI: 0.75, top: 0x070b24, hor: 0x1c2c5c, sky: 0x5f7ed6, ground: 0x1c2a44, fog: 0x18244c, hemiI: 0.95, night: 1, rays: 0 },
];

const SKY_VS = /* glsl */ `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FS = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uNight; uniform float uTime;
varying vec3 vDir;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec3 d = normalize(vDir);
  // banded gradient: a few flat steps instead of a smooth ramp keeps the sky feeling like pixel art
  float t = clamp(d.y * 1.6 + 0.12, 0.0, 1.0);
  t = floor(t * 14.0) / 14.0;
  vec3 col = mix(uHor, uTop, t);
  vec2 g = floor(vec2(atan(d.z, d.x) * 90.0, d.y * 140.0));
  float star = step(0.9965, h21(g)) * uNight * step(0.05, d.y);
  col += star * (0.6 + 0.4 * sin(uTime * 2.0 + h21(g + 3.0) * 6.28));
  // a square sun or moon
  vec3 s = normalize(uSunDir);
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), s)), u = cross(s, r);
  vec2 p = vec2(dot(d, r), dot(d, u));
  float disc = step(max(abs(p.x), abs(p.y)), 0.045) * step(0.0, dot(d, s));
  float halo = (1.0 - smoothstep(0.0, 0.32, length(p))) * step(0.0, dot(d, s));
  col = mix(col, uSunCol, disc) + uSunCol * halo * 0.22;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const RAY_FS = /* glsl */ `
uniform vec3 uCol; uniform float uAlpha; uniform float uTime; uniform float uSeed;
varying vec2 vUv;
void main() {
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  // soft stripes drifting sideways, quantised into bands
  float st = 0.6 + 0.4 * sin(vUv.x * 9.0 + uSeed * 6.0 + uTime * 0.25);
  float a = floor(min(1.0, across * along * st * 1.7) * 5.0) / 5.0;
  gl_FragColor = vec4(uCol * a * uAlpha, 1.0);
}`;
const RAY_VS = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export type SkyMode = 'clock' | 'day' | 'golden' | 'night';

export class Sky {
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
  readonly fog = new THREE.Fog(0xcfe9f1, 24, 62);
  readonly dome: THREE.Mesh;
  private rays: { mesh: THREE.Mesh; base: THREE.Vector3; mat: THREE.ShaderMaterial }[] = [];
  private domeMat: THREE.ShaderMaterial;
  /** 0 by day, 1 at night */
  night = 0;
  rayPower = 0;
  hour = 13;
  readonly sunDir = new THREE.Vector3(0.4, 0.8, 0.45);
  readonly ambient = new THREE.Color(1, 1, 1);

  constructor(scene: THREE.Scene, shadowSize: number) {
    scene.fog = this.fog;
    scene.add(this.sun, this.sun.target, this.hemi);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    Object.assign(sc, { left: -19, right: 19, top: 19, bottom: -19, near: 4, far: 90 });
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.2;

    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunDir: { value: this.sunDir }, uSunCol: { value: new THREE.Color() }, uNight: { value: 0 }, uTime: { value: 0 } },
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 12), this.domeMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // shafts of light landing at fixed spots around the clearing
    const spots: [number, number, number][] = [[-5.5, -3.5, 2.6], [1.5, -5.5, 2.0], [-7.5, 3.5, 2.2], [5.5, -1.5, 1.8], [-1.5, 3.2, 3.0], [8.5, 7.0, 2.2], [-3, -7.5, 1.7]];
    spots.forEach(([x, z, w], i) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: RAY_VS, fragmentShader: RAY_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
        uniforms: { uCol: { value: new THREE.Color() }, uAlpha: { value: 0 }, uTime: { value: 0 }, uSeed: { value: i * 1.7 } },
      });
      const geo = new THREE.PlaneGeometry(w, 15);
      geo.translate(0, 7.5, 0);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.rays.push({ mesh, base: new THREE.Vector3(x, 0, z), mat });
    });
    this.setHour(13);
  }

  setHour(h: number) {
    this.hour = ((h % 24) + 24) % 24;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].h <= this.hour) i++;
    const a = KEYS[i], b = KEYS[i + 1], t = (this.hour - a.h) / (b.h - a.h);
    const mix = (x: number, y: number) => new THREE.Color(x).lerp(new THREE.Color(y), t);
    const num = (x: number, y: number) => x + (y - x) * t;
    this.night = num(a.night, b.night);
    this.rayPower = num(a.rays, b.rays);
    this.sun.color.copy(mix(a.sun, b.sun));
    this.sun.intensity = num(a.sunI, b.sunI);
    this.hemi.color.copy(mix(a.sky, b.sky));
    this.hemi.groundColor.copy(mix(a.ground, b.ground));
    this.hemi.intensity = num(a.hemiI, b.hemiI);
    this.fog.color.copy(mix(a.fog, b.fog));
    this.domeMat.uniforms.uTop.value.copy(mix(a.top, b.top));
    this.domeMat.uniforms.uHor.value.copy(mix(a.hor, b.hor));
    this.domeMat.uniforms.uSunCol.value.copy(this.night > 0.6 ? new THREE.Color(0xe8f0ff) : this.sun.color.clone().lerp(new THREE.Color(0xffffff), 0.5));
    this.domeMat.uniforms.uNight.value = this.night;
    // the sun arcs from one side of the clearing to the other; at night the moon holds a fixed angle
    const day = this.hour > 5.6 && this.hour < 19.6;
    const k = day ? (this.hour - 5.6) / 14 : 0.35;
    const az = -1.25 + k * 2.5, el = day ? 0.5 + Math.sin(k * Math.PI) * 0.55 : 0.95;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el) * 0.8 + 0.25).normalize();
    this.sun.position.copy(this.sunDir).multiplyScalar(42);
    this.sun.target.position.set(0, 0, 0);
    this.ambient.copy(this.hemi.color).multiplyScalar(0.45 * this.hemi.intensity).add(this.sun.color.clone().multiplyScalar(0.22 * this.sun.intensity));
  }

  update(time: number, camera: THREE.Camera) {
    this.domeMat.uniforms.uTime.value = time;
    this.dome.position.copy(camera.position);
    const axis = this.sunDir, toCam = new THREE.Vector3(), x = new THREE.Vector3(), zv = new THREE.Vector3(), m = new THREE.Matrix4();
    this.rays.forEach((r, i) => {
      const flick = 0.75 + 0.25 * Math.sin(time * 0.35 + i * 2.1);
      r.mat.uniforms.uAlpha.value = this.rayPower * 0.5 * flick;
      r.mat.uniforms.uTime.value = time;
      r.mat.uniforms.uCol.value.copy(this.sun.color);
      r.mesh.visible = this.rayPower > 0.02;
      // stand the plane along the sun direction and swivel it to face the camera
      toCam.copy(camera.position).sub(r.base);
      x.crossVectors(axis, toCam).normalize();
      zv.crossVectors(x, axis).normalize();
      m.makeBasis(x, axis, zv);
      r.mesh.quaternion.setFromRotationMatrix(m);
      r.mesh.position.copy(r.base).addScaledVector(axis, -1.5);
    });
  }
}

/** Hour of the local day for a sky mode. */
export function hourFor(mode: SkyMode, now = new Date()): number {
  if (mode === 'day') return 11;
  if (mode === 'golden') return 17.2;
  if (mode === 'night') return 22;
  return now.getHours() + now.getMinutes() / 60;
}
