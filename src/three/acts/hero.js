/* ===========================================================
   acts/hero.js — the brain sequence

   A real MRI-derived brain mesh (Nevit Dilmen, Wikimedia Commons,
   CC BY-SA 3.0 / GFDL — attribution lives in the page footer and is a
   condition of the licence, so it must not be dropped).

   Choreography, as fractions of the pinned section's 0..1 progress:
   the brain drifts in blurred and distant behind the title card, tilts and
   zooms into its settled top-down pose during "approach", then holds while
   three text pages take turns recomposing it into distinct side views, and
   finally it comes apart into a current of light: the surface burns away
   with a gold edge, every burnt-away piece becomes a particle, and the
   particles swirl into a stream that travels — as the About section scrolls
   up — to the back of the portrait's head, where they switch on the
   portrait's own backlight (three/brainBeam.js, lib/portraitLight.js).

   Under prefers-reduced-motion the pin never exists (see initHero()'s
   `else` branch) and update() takes an entirely separate path, updateStatic()
   — the brain holds the exact settled top-down pose the approach ends at
   (also, incidentally, the angle with the most margin against the mesh's one
   small hole — see tissueMat's FrontSide comment), title card and the first
   text page shown together instead of staged, pages two and three dropped
   entirely, and a fade continuously tied to how far #brain has scrolled past.
   The synapse shimmer keeps animating even though the brain itself never
   moves or responds to clicks — it's surface-local, not the kind of motion
   prefers-reduced-motion is about, and it's what stands in for the sequence
   the reduced path otherwise skips.

   DOM lookups and listeners live inside initHero() rather than at module
   scope: this module is imported (and evaluated) the moment React starts
   building the bundle, well before <Hero>'s JSX has actually rendered
   #brain and friends into the document. Three.js objects that don't need
   the DOM — geometry, materials, the GLB fetch — stay at module scope so a
   React StrictMode double-invoke of the effect doesn't re-fetch or rebuild
   them; initHero() itself returns a cleanup that reverses everything that
   *does* touch the DOM or the shared stage.
   =========================================================== */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  camera,
  scene,
  registerAct,
  unregisterAct,
  quality,
  PAGE_BG,
  warmUpStage,
  markStageReady,
  stars,
} from "../stage.js";
import { ScrollTrigger } from "../../lib/gsap.js";
import {
  clamp01,
  smoothstep,
  lerp,
  deg,
  sampleCurve,
  damp,
} from "../../lib/motion.js";
import {
  addDissolve,
  beamUniforms,
  createBeamPoints,
  dissolveGLSL,
  dissolveThresholdGLSL,
  RELEASE,
  ARRIVE,
} from "../brainBeam.js";
import { portraitLight } from "../../lib/portraitLight.js";
import { BEAM_LAYER, createBeamOverlay } from "../beamOverlay.js";

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

// The brain is modelled at a size tuned for desktop framing; at phone widths
// it reads as oversized and crowds the text pages as it swings side to side.
// Shrunk uniformly via brainGroup.scale, and (below, in update()) kept from
// stepping sideways into a corner the way it does on desktop — a phone's
// width doesn't have the room. Same 819/820 breakpoint as the rest of the
// page (see sections/work.js).
const mobileQuery = window.matchMedia("(max-width: 819px)");
let isMobile = mobileQuery.matches;
mobileQuery.addEventListener("change", (e) => {
  isMobile = e.matches;
});
const MOBILE_BRAIN_SCALE = 0.74;

// The scene's warm resting tone while the hero owns the canvas — exported so
// the finale (acts/finale.js) can restore it if the user scrolls back up past
// Contact into the hero, since finale is the only other act that ever tints
// scene.background/fog.
export const HERO_BG = 0x121212;
// scene.fog.near's resting value (matches the Fog() constructor in stage.js)
// — restored on deactivate so a mid-approach scroll-away doesn't leave the
// fog dense for whatever act looks at the scene next.
const FOG_NEAR_REST = 8;

export const brainGroup = new THREE.Group();

// clearcoat/sheen add USE_CLEARCOAT/USE_SHEEN branches to the compiled
// fragment shader — real instructions, not just a runtime multiply-by-zero —
// and this material covers most of the screen for most of the hero's scroll
// range. finale.js already proves they're droppable without harm (it zeroes
// both for its own dim echo of this same mesh); on tier "low" the fps cost
// showed up even with mesh/dpr/bloom already at their floor (see stage.js's
// quality tiers), so it's cut at the source here rather than left for the
// watchdog to chase.
const isLowTier = quality.tier === "low";
export const tissueMat = new THREE.MeshPhysicalMaterial({
  color: 0xbdbdbd,
  roughness: 0.72,
  metalness: 0,
  clearcoat: isLowTier ? 0 : 0.08,
  clearcoatRoughness: 0.55,
  sheen: isLowTier ? 0 : 0.15,
  sheenColor: new THREE.Color(0xd4af37),
  envMapIntensity: isLowTier ? 0.35 : 0.55,
  // The bake clips the mesh below y=79 (see tools/bake-brain.mjs), leaving a
  // small closed hole at the back of the base. DoubleSide used to paper over
  // that; it's a well-hidden, one-loop hole (verified against the whole
  // choreography, including the finale's spin) that never faces the camera,
  // and FrontSide halves the fragments actually rasterised on a fully closed
  // mesh — every back-face was wasted work. The bake also fans a cap over
  // the hole now, so this is safe even at the choreography's tightest
  // moment (~8° of margin at the very start of the approach).
  side: THREE.FrontSide,
});

let brainMesh = null;
let synapseMesh = null;
/** resolved once the mesh is ready, so the finale act can reuse the geometry */
export let brainGeometryReady = null;

/* ---------------------------------------------------------------
   synapse / electricity overlay
--------------------------------------------------------------- */
const noiseGLSL = `
  vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
`;

// The shader itself always compiles the same 12-slot loop regardless of
// tier — see uFlashCount below, a uniform rather than a template-literal
// constant, so the watchdog (three/stage.js) can turn flashes down at
// runtime without recompiling the program (and so only one program variant
// ever needs to compile in the first place).
const FLASH_COUNT = 12;

// click-triggered pulses — a small ring buffer so a quick double-click (or
// two clicks in different spots) can have more than one wave travelling at
// once instead of the newer one cutting the older off mid-spread
const PULSE_COUNT = 8;
const PULSE_LIFE = 2.2; // seconds a ring stays alive end to end
const PULSE_SPEED = 2.6; // radians/sec the ring expands across the surface
const PULSE_NEVER = -1000; // sentinel start time: far enough in the past to never render

export const synapseMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uActivation: { value: 0 },
    uColorA: { value: new THREE.Color(0xffc23d) },
    uColorB: { value: new THREE.Color(0xb8860b) },
    // how many of the 12 flash slots actually draw — quality.flashes at
    // start (6/9/12 by tier), and the watchdog can cut it to 3 at its last
    // degrade step
    uFlashCount: { value: quality.flashes },
    uFlashA: {
      value: Array.from(
        { length: FLASH_COUNT },
        () => new THREE.Vector3(0, 1, 0),
      ),
    },
    uFlashB: {
      value: Array.from(
        { length: FLASH_COUNT },
        () => new THREE.Vector3(0, 1, 0),
      ),
    },
    uFlashSeed: { value: new Array(FLASH_COUNT).fill(0) },
    // whether any click-pulse is currently alive — gates the entire pulse
    // block (including its own extra noise sample) off when nothing is
    // playing, which is true almost all the time
    uPulseAny: { value: 0 },
    uPulseOrigin: {
      value: Array.from(
        { length: PULSE_COUNT },
        () => new THREE.Vector3(0, 1, 0),
      ),
    },
    uPulseStart: { value: new Array(PULSE_COUNT).fill(PULSE_NEVER) },
    // compartilhados com o tecido e as partículas (three/brainBeam.js)
    uDissolve: beamUniforms.uDissolve,
    uDisDir: beamUniforms.uDisDir,
  },
  vertexShader: `
    uniform float uTime;
    varying vec3 vDir;
    varying float vDis;
    // n1/n2 are smooth functions of direction (feature scale ~1/7.31 units);
    // only the threshold applied to them in the fragment shader is fine, so
    // evaluating the noise per-vertex and interpolating linearly costs one
    // snoise() per vertex instead of per fragment — on a phone that's the
    // difference between ~15k evaluations and ~380k.
    varying vec2 vNoise;
    ${noiseGLSL}
    ${dissolveGLSL}
    void main(){
      vDir = normalize(position);
      vDis = dissolveField(position);
      vec3 p = vDir * 3.4;
      vNoise = vec2(
        snoise(p + vec3(0.0, 0.0, uTime * 0.06)),
        snoise(p * 2.15 + vec3(50.0, 12.0, 4.0))
      );
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform float uActivation;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform float uFlashCount;
    uniform vec3 uFlashA[${FLASH_COUNT}];
    uniform vec3 uFlashB[${FLASH_COUNT}];
    uniform float uFlashSeed[${FLASH_COUNT}];
    uniform float uPulseAny;
    uniform vec3 uPulseOrigin[${PULSE_COUNT}];
    uniform float uPulseStart[${PULSE_COUNT}];
    varying vec3 vDir;
    varying vec2 vNoise;
    varying float vDis;
    uniform float uDissolve;
    ${noiseGLSL}
    ${dissolveThresholdGLSL}

    // a single quick pulse of light travelling a short arc between two nearby
    // surface points, firing on its own random repeating schedule — reads as a
    // signal darting across a short stretch rather than an ambient glow
    float synapseFlash(vec3 dir, vec3 a, vec3 b, float seed){
      float period = 2.6 + fract(seed * 12.9898) * 3.4;
      float duration = 0.42;
      float localT = mod(uTime + seed * 7.13, period);
      if(localT > duration) return 0.0;
      float travel = smoothstep(0.0, 1.0, localT / duration);
      vec3 ab = b - a;
      float abLenSq = max(dot(ab, ab), 1e-5);
      float s = clamp(dot(dir - a, ab) / abLenSq, 0.0, 1.0);
      vec3 closest = a + ab * s;
      float band = smoothstep(0.05, 0.0, distance(dir, closest));
      float behind = travel - s;
      float trail = behind >= 0.0 ? smoothstep(0.3, 0.0, behind) : 0.0;
      return band * trail;
    }

    // a wavefront that expands outward from a clicked point across the whole
    // surface and fades as it goes — angle-from-origin stands in for surface
    // distance, which is cheap and, on a roughly ball-shaped mesh like this
    // one, close enough to read as travel rather than a flat expanding disc.
    // \`vein\` and \`jitter\` come from the same noise field the resting veins
    // use (computed once per fragment in main(), not per pulse) so the front
    // reads as current finding its way along the brain's own vessels — bright
    // where a vessel runs under it, ragged at the edge — rather than a flat,
    // uniformly bright ring.
    float synapsePulse(vec3 dir, vec3 origin, float start, float vein, float jitter){
      float age = uTime - start;
      if(age < 0.0 || age > ${PULSE_LIFE.toFixed(2)}) return 0.0;
      float radius = age * ${PULSE_SPEED.toFixed(2)};
      float angle = acos(clamp(dot(dir, origin), -1.0, 1.0));
      float ring = smoothstep(0.2, 0.0, abs(angle - radius - jitter));
      // a faint base keeps the wavefront legible off-vein; brighter where a
      // vessel actually runs under it, so the ring's brightness ripples
      // instead of reading as a flat band
      float texture = 0.3 + 0.9 * vein;
      // per-fragment flicker, phased by angle so it reads as sparking along
      // the front rather than a uniform strobe
      float flicker = 0.55 + 0.45 * sin(uTime * 13.0 + angle * 30.0 + jitter * 40.0);
      float fade = smoothstep(${PULSE_LIFE.toFixed(2)}, ${(PULSE_LIFE * 0.5).toFixed(2)}, age);
      return ring * texture * flicker * fade;
    }

    void main(){
      // dissolução (three/brainBeam.js): some junto com o tecido
      float disT = dissolveThreshold(uDissolve);
      if (uDissolve > 0.0005 && vDis < disT) discard;
      vec3 vDirN = normalize(vDir);
      float n1 = vNoise.x;
      float n2 = vNoise.y;
      float veinsA = smoothstep(0.055, 0.0, abs(n1));
      float veinsB = smoothstep(0.038, 0.0, abs(n2));
      float veins = clamp(veinsA + veinsB*0.6, 0.0, 1.0);

      float flicker = 0.5 + 0.5*sin(uTime*3.4 + n1*18.0 + n2*9.0);
      float colorMix = smoothstep(-0.2, 0.2, n2);
      vec3 col = mix(uColorA, uColorB, colorMix);

      float intensity = veins * (0.4 + 0.6*flicker) * uActivation * 1.9;

      float flash = 0.0;
      for(int i = 0; i < ${FLASH_COUNT}; i++){
        if(float(i) >= uFlashCount) break;
        flash += synapseFlash(vDirN, uFlashA[i], uFlashB[i], uFlashSeed[i]);
      }
      flash = clamp(flash, 0.0, 1.0);
      // núcleo do flash puxa para um ouro pálido, não para o branco — com
      // blending aditivo sobre o cérebro prata, branco puro apagava o dourado
      col = mix(col, vec3(1.0, 0.85, 0.42), flash * 0.45);
      intensity += flash * uActivation * 2.4;

      // click pulses follow the same uActivation as the resting veins: while
      // the synapses are still dark (start of the hero), a click shows
      // nothing, and the pulse fades in together with the rest of the
      // network as the scroll wakes it up — so it never reads as a separate
      // effect appearing on its own.
      // Whole block is skipped (uPulseAny) when nothing is playing, which is
      // true almost all the time — reuses this fragment's own vein value
      // (already computed above) as the pulse's texture.
      float pulse = 0.0;
      if(uPulseAny > 0.5){
        float pulseJitter = snoise(vDirN * 5.0 + vec3(7.0, 3.0, 0.0)) * 0.08;
        for(int i = 0; i < ${PULSE_COUNT}; i++){
          pulse += synapsePulse(vDirN, uPulseOrigin[i], uPulseStart[i], veins, pulseJitter);
        }
        pulse = clamp(pulse, 0.0, 1.0);
        pulse *= uActivation;
        col = mix(col, vec3(1.0, 0.85, 0.42), pulse * 0.5);
        intensity += pulse * 3.1;
      }

      // na dissolução a rede inteira acende (o cérebro vira luz) e a borda
      // que está se desfazendo brilha mais
      if (uDissolve > 0.0005) {
        float edge = 1.0 - smoothstep(0.0, 0.06, vDis - disT);
        float wake = smoothstep(0.0, 0.2, uDissolve);
        intensity = max(intensity, veins * wake * 1.2) + edge * edge * 0.6;
        col = mix(col, vec3(1.0, 0.85, 0.42), edge * 0.5);
      }

      gl_FragColor = vec4(col * intensity, intensity);
    }
  `,
});

// a saída do hero: o tecido se desfaz (three/brainBeam.js). Sob reduced
// motion uDissolve nunca sai de 0 e o shader injetado não faz nada.
addDissolve(tissueMat, noiseGLSL);

// a corrente de partículas, criada quando a malha chega (ver abaixo)
let beamPoints = null;
let beamOverlay = null;
const BEAM_COUNT = { high: 42000, mid: 22000, low: 11000 };

/* ---------------------------------------------------------------
   mesh loading

   The geometry arrives already oriented, clipped, welded, smoothed, centred
   and scaled — all of it baked offline by tools/bake-brain.mjs. That work used
   to run here, in the browser, on the main thread, on every load: 4 MB of raw
   STL, a weld of ~242k loose vertices and fourteen Taubin smoothing passes.
   It is entirely deterministic, so the browser has no business repeating it.
   Re-run `npm run bake-brain` if the source mesh or its cleanup ever changes.

   Two baked variants exist: brain.glb (full) and brain-low.glb (decimated,
   for coarse-pointer devices — see quality.mesh in stage.js). The choice has
   to be synchronous, at module evaluation, because brainGeometryReady is a
   module-scope Promise that acts/finale.js also awaits — no branch here ever
   awaits anything before creating it.
--------------------------------------------------------------- */
const BRAIN_URL =
  quality.mesh === "low" ? "/assets/brain-low.glb" : "/assets/brain.glb";

brainGeometryReady = new Promise((resolve, reject) => {
  new GLTFLoader().load(
    BRAIN_URL,
    (gltf) => {
      let geometry = null;
      gltf.scene.traverse((o) => {
        if (!geometry && o.isMesh) geometry = o.geometry;
      });
      if (!geometry) {
        reject(new Error(`${BRAIN_URL} nao contem nenhuma malha`));
        return;
      }

      brainMesh = new THREE.Mesh(geometry, tissueMat);
      brainGroup.add(brainMesh);

      synapseMesh = new THREE.Mesh(geometry, synapseMat);
      synapseMesh.scale.setScalar(1.006);
      synapseMesh.visible = false;
      brainGroup.add(synapseMesh);

      // seed the transmission flashes with real surface points: each is a
      // short arc from a random vertex to a nearby jittered direction, in the
      // same normalize(position) domain the shader works in. All 12 slots are
      // always seeded — uFlashCount (not the array length) decides how many
      // actually draw.
      const posAttr = geometry.attributes.position;
      const flashA = [];
      const flashB = [];
      const flashSeed = [];
      const FLASH_ARC_ANGLE = 0.22; // radians — keeps each flash short
      for (let i = 0; i < FLASH_COUNT; i++) {
        const idx = Math.floor(Math.random() * posAttr.count);
        const a = new THREE.Vector3()
          .fromBufferAttribute(posAttr, idx)
          .normalize();
        const axis = new THREE.Vector3(
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5,
        )
          .cross(a)
          .normalize();
        const angle = (0.5 + Math.random() * 0.5) * FLASH_ARC_ANGLE;
        const b = a.clone().applyAxisAngle(axis, angle).normalize();
        flashA.push(a);
        flashB.push(b);
        flashSeed.push(Math.random() * 100);
      }
      synapseMat.uniforms.uFlashA.value = flashA;
      synapseMat.uniforms.uFlashB.value = flashB;
      synapseMat.uniforms.uFlashSeed.value = flashSeed;

      if (!reduceMotion) {
        beamPoints = createBeamPoints(geometry, BEAM_COUNT[quality.tier], noiseGLSL);
        // desenhada por cima do conteúdo, num canvas próprio (beamOverlay.js):
        // a câmera do palco não enxerga a camada dela
        beamPoints.layers.set(BEAM_LAYER);
        brainGroup.add(beamPoints);
        beamOverlay = createBeamOverlay(quality);
        // compila o programa agora: compilar no meio da rolagem engasgaria
        // a saída
        {
          const saved = camera.layers.mask;
          camera.layers.set(BEAM_LAYER);
          beamOverlay.renderer.compile(beamPoints, camera);
          camera.layers.mask = saved;
        }
      }

      resolve(geometry);
    },
    undefined,
    (err) => {
      console.error(`Falha ao carregar ${BRAIN_URL}:`, err);
      reject(err);
    },
  );
});

// Compiles the brain's shader programs (and uploads its geometry with one
// throwaway render) while the canvas is still hidden behind #stage's
// opacity:0 — see warmUpStage()'s own comment in stage.js for what this
// does and doesn't cover. A load failure still has to reveal the canvas
// (there may be nothing to show, but the rest of the page must not stay
// dark), hence the catch.
brainGeometryReady.then(() => warmUpStage()).catch(() => markStageReady());

/* ---------------------------------------------------------------
   scroll phases
--------------------------------------------------------------- */
export const PHASE = {
  approachEnd: 0.22,
  pages: [
    [0.24, 0.42],
    [0.45, 0.63],
    [0.66, 0.84],
  ],
  exitStart: 0.88,
};

let progress = 0;

// High tier keeps the CSS blur for the opening beat (tuned down from the
// original 3px); low/mid tiers use scene.fog instead — see useFogApproach
// below, a full-viewport gaussian filter every frame is one of the more
// expensive things this scene does, and fog is already compiled into every
// material for free.
const BRAIN_BLUR_MAX = 2; // px
const useFogApproach = quality.tier !== "high";
let lastFilter = "none";

// populated by initHero() once #brain and friends exist in the DOM
let section,
  stageEl,
  titleScreenEl,
  hintEl,
  progressEl,
  exitFadeEl,
  vignetteEl,
  fadeBottomEl,
  pageEls;

function onProgress(p) {
  // Only records the value now — this used to also write hint/progress-bar/
  // page-visibility/blur/title-opacity straight to the DOM from inside
  // GSAP's own scroll callback, on top of the RAF loop's own per-frame
  // writes below reading the same `progress`. Two write sources interleaved
  // with the RAF loop's getBoundingClientRect() reads forced layout on
  // every scroll tick; update() below is the only writer now.
  progress = p;
}

/* ---------------------------------------------------------------
   per-page staging

   Page 0 (the intro) holds the exact centred pose the approach settles into.
   Page 1 pitches down to an upright 3/4 lean showing its right side; page 2
   turns the other way with slightly more pitch for a left profile. The camera
   also drops toward the brain's own height on those pages — without that, a
   camera sitting high and looking down turns any yaw into a turntable spin
   and you never actually see the side.
--------------------------------------------------------------- */
const TILT_TARGET_DEG = 68;
const YAW_TARGET_DEG = 0;

const KF = {
  yaw: [
    [PHASE.approachEnd, YAW_TARGET_DEG],
    [PHASE.pages[0][0], YAW_TARGET_DEG],
    [PHASE.pages[0][1], YAW_TARGET_DEG],
    [PHASE.pages[1][0], 62],
    [PHASE.pages[1][1], 62],
    [PHASE.pages[2][0], -76],
    [PHASE.pages[2][1], -76],
    [PHASE.exitStart, YAW_TARGET_DEG],
  ],
  tilt: [
    [PHASE.approachEnd, TILT_TARGET_DEG],
    [PHASE.pages[0][0], TILT_TARGET_DEG],
    [PHASE.pages[0][1], TILT_TARGET_DEG],
    [PHASE.pages[1][0], 9],
    [PHASE.pages[1][1], 9],
    [PHASE.pages[2][0], 15],
    [PHASE.pages[2][1], 15],
    [PHASE.exitStart, TILT_TARGET_DEG],
  ],
  roll: [
    [PHASE.approachEnd, 0],
    [PHASE.pages[0][0], 0],
    [PHASE.pages[0][1], 0],
    [PHASE.pages[1][0], 6],
    [PHASE.pages[1][1], 6],
    [PHASE.pages[2][0], -8],
    [PHASE.pages[2][1], -8],
    [PHASE.exitStart, 0],
  ],
  offsetX: [
    [PHASE.approachEnd, 0],
    [PHASE.pages[0][0], 0],
    [PHASE.pages[0][1], 0],
    [PHASE.pages[1][0], 1.35],
    [PHASE.pages[1][1], 1.35],
    [PHASE.pages[2][0], -1.3],
    [PHASE.pages[2][1], -1.3],
    [PHASE.exitStart, 0],
  ],
  scale: [
    [PHASE.approachEnd, 1],
    [PHASE.pages[0][0], 1],
    [PHASE.pages[0][1], 1],
    [PHASE.pages[1][0], 1.06],
    [PHASE.pages[1][1], 1.06],
    [PHASE.pages[2][0], 0.93],
    [PHASE.pages[2][1], 0.93],
    [PHASE.exitStart, 1],
  ],
  camY: [
    [PHASE.approachEnd, 0],
    [PHASE.pages[0][0], 0],
    [PHASE.pages[0][1], 0],
    [PHASE.pages[1][0], -1.6],
    [PHASE.pages[1][1], -1.6],
    [PHASE.pages[2][0], -1.35],
    [PHASE.pages[2][1], -1.35],
    [PHASE.exitStart, 0],
  ],
};

const pose = {
  yaw: YAW_TARGET_DEG,
  tilt: TILT_TARGET_DEG,
  roll: 0,
  offsetX: 0,
  scale: 1,
  camY: 0,
  exit: 0,
};

// The fixed pose used under prefers-reduced-motion: exactly the settled
// top-down pose the approach ends at (ease=1, before page1/page2 ever pull
// tilt/yaw away from it) — ties this to TILT_TARGET_DEG/YAW_TARGET_DEG
// rather than duplicating the numbers, so the two stay in sync if the
// settled pose is ever retuned. It's also the single safest angle in the
// whole choreography against the mesh's one small hole (see tissueMat's
// FrontSide comment) — top-down points the hole almost straight away from
// the camera.
const STATIC_POSE = {
  tilt: TILT_TARGET_DEG,
  yaw: YAW_TARGET_DEG,
  roll: 0,
  posY: 0,
  posZ: 0.4,
  scale: 1,
  camY: 0,
};

// A small permanent softness rather than none at all — the brain now sits
// behind readable text for as long as the hero is on screen (not just the
// opening beat), so it stays a backdrop rather than competing for focus.
const STATIC_BLUR_PX = 1.5;

const camStart = new THREE.Vector3(0, 0.25, 8.1);
const camEnd = new THREE.Vector3(0, 2.0, 6.7);

let mouseX = 0;
let mouseY = 0;

// ring buffer of click-triggered pulses — see spawnPulse() in initHero()
let pulseCursor = 0;
let lastPulseTime = PULSE_NEVER;

let idleYaw = 0;
const IDLE_YAW_MAX = Math.PI * 2; // at most one full turn before the approach takes over

const camPos = new THREE.Vector3();

/** set on the registered act so the director can drop the canvas — see below */
let act = null;

function update(t, dt) {
  if (reduceMotion) {
    updateStatic(t, dt);
    return;
  }

  // A saída: o cérebro vira uma corrente de luz que viaja até a cabeça do
  // retrato (three/brainBeam.js). `beamB` é uma função CONTÍNUA e
  // estritamente crescente da posição de rolagem, em três pontos:
  //   - fim do pin (progress BEAM_PIN_START) → 0: o cérebro começa a se desfazer;
  //   - cabeça a ~80% da altura da tela → ARRIVE.start: as primeiras chegam
  //     (a corrente nunca viaja para um ponto fora da tela);
  //   - cabeça a ~35% → 1.
  // Linear entre eles, medida na rolagem de verdade (não no progress do pin,
  // que acaba antes da seção Sobre aparecer e deixava um trecho em que rolar
  // não mexia a corrente). Suavizado no tempo.
  const head = headScreenPoint();
  const vh = window.innerHeight;
  let beamTarget = 0;
  if (head && pinTrigger) {
    const sy = window.scrollY;
    const s0 = pinTrigger.start + BEAM_PIN_START * (pinTrigger.end - pinTrigger.start);
    // a cabeça sobe 1px por px rolado: em que rolagem ela fica em f·vh
    const sA = Math.max(s0 + 1, sy + head.y - vh * BEAM_ARRIVE_AT);
    const s1 = Math.max(sA + 1, sy + head.y - vh * BEAM_END_AT);
    beamTarget =
      sy <= sA
        ? ARRIVE.start * clamp01((sy - s0) / (sA - s0))
        : ARRIVE.start + (1 - ARRIVE.start) * clamp01((sy - sA) / (s1 - sA));
  }
  // ao ativar (carregar a página já no meio, voltar de longe) salta direto:
  // senão o cérebro "se desfaria" sozinho na frente de quem só chegou
  if (beamSnap) {
    beamB = beamTarget;
    beamSnap = false;
  }
  beamB = damp(beamB, beamTarget, dt, 7);
  if (beamB > 0.9995) beamB = 1;
  exitFadeEl.style.opacity = 0;

  // Scroll-driven chrome, written every frame from `progress` rather than
  // from GSAP's own onUpdate callback (see onProgress above) — unconditional,
  // same as before, since none of this depends on wantsRender.
  const approachRaw = clamp01(progress / PHASE.approachEnd);
  const ease = smoothstep(approachRaw);

  hintEl.style.opacity = progress < 0.04 ? 1 : 0;
  progressEl.style.setProperty("--p", progress);
  pageEls.forEach((el, i) => {
    const [start, end] = PHASE.pages[i];
    el.classList.toggle("is-visible", progress >= start && progress <= end);
  });

  if (useFogApproach) {
    scene.fog.near = lerp(1.2, FOG_NEAR_REST, ease);
  } else {
    // the brain starts discreetly blurred and sharpens in step with the same
    // ease driving the approach, finishing exactly as it settles. Quality
    // level 1+ (the watchdog's first degrade step) turns this off outright —
    // a full-viewport filter every frame is expensive, and it only exists for
    // the first 22% of the scroll anyway.
    const blurPx = quality.level >= 1 ? 0 : BRAIN_BLUR_MAX * (1 - ease);
    const nextFilter = blurPx > 0.02 ? `blur(${blurPx.toFixed(2)}px)` : "none";
    if (nextFilter !== lastFilter) {
      stageEl.style.filter = nextFilter;
      lastFilter = nextFilter;
    }
  }
  titleScreenEl.style.opacity = 1 - ease;

  // fração das partículas que já entrou na cabeça (janela ARRIVE): acende a
  // luz de trás do retrato e, pelo que entra a cada quadro, o brilho de
  // dentro da cabeça (lib/portraitLight.js)
  portraitLight.level = smoothstep(
    clamp01((beamB - ARRIVE.start) / (ARRIVE.span + 0.02)),
  );
  // o próprio progresso da corrente: o retrato desenha, por cima da foto, as
  // partículas que de fato entram na cabeça (three/headInflow.js)
  portraitLight.beam = beamB;

  // O canvas continua enquanto houver cérebro ou corrente para desenhar —
  // inclusive com o hero já fora da tela, sobre a seção Sobre (as seções não
  // têm fundo próprio). Termina quando a corrente já sumiu dentro da cabeça.
  if (act) {
    const rect = act.rect;
    const onScreen = rect.bottom > 0 && rect.top < vh;
    act.wantsRender = beamB < 0.995 && (onScreen || beamB > 0.001);

    // vinheta e degradê de baixo escurecem o cérebro atrás do texto do hero;
    // somem durante a saída, para não escurecer a seção Sobre
    const vignetteOpacity = act.wantsRender
      ? 1 - smoothstep(clamp01(beamB / 0.45))
      : 0;
    vignetteEl.style.opacity = vignetteOpacity;
    fadeBottomEl.style.opacity = vignetteOpacity;

    if (!act.wantsRender) return;
  }

  // o fundo quente do hero vira o fundo da página (a corrente passa por cima
  // da seção Sobre), e as estrelas saem junto
  const bgMix = smoothstep(clamp01((beamB - 0.1) / 0.4));
  scene.background.lerpColors(heroBgColor, pageBgColor, bgMix);
  scene.fog.color.copy(scene.background);
  stars.material.opacity = STARS_OPACITY * (1 - smoothstep(clamp01((beamB - 0.4) / 0.5)));

  if (!reduceMotion) {
    idleYaw = Math.min(
      idleYaw + dt * (0.045 + (1 - ease) * 0.03),
      IDLE_YAW_MAX,
    );
  }

  for (const key in KF) {
    pose[key] = damp(pose[key], sampleCurve(progress, KF[key]), dt);
  }

  // narrower frames get a smaller lateral step so the brain stays on screen;
  // on mobile it's zeroed outright rather than just dampened — the rotation
  // choreography (yaw/tilt/roll, all set below regardless) stays identical,
  // only the sideways travel is dropped, since a phone's width leaves no
  // room to step the brain into a corner without crowding the text further.
  const aspectFactor = isMobile ? 0 : clamp01(camera.aspect / 1.4);

  brainGroup.rotation.x = ease * deg(pose.tilt);
  brainGroup.rotation.y = idleYaw * (1 - ease) + ease * deg(pose.yaw);
  brainGroup.rotation.z = ease * deg(pose.roll);
  brainGroup.position.x = pose.offsetX * aspectFactor;
  brainGroup.position.z = lerp(-0.35, 0.4, ease);
  brainGroup.scale.setScalar(
    lerp(0.86, 1.0, ease) *
      lerp(1, pose.scale, ease) *
      (isMobile ? MOBILE_BRAIN_SCALE : 1),
  );

  camPos.lerpVectors(camStart, camEnd, ease);
  camPos.y += pose.camY * ease;
  if (!reduceMotion) {
    camPos.x += mouseX * 0.16 + Math.sin(t * 0.15) * 0.04;
    camPos.y += -mouseY * 0.1 + Math.cos(t * 0.12) * 0.03;
  }
  camera.position.copy(camPos);
  camera.lookAt(0, -0.18, 0);

  const activation = smoothstep((approachRaw - 0.55) / (0.94 - 0.55));
  synapseMat.uniforms.uTime.value = t;
  synapseMat.uniforms.uActivation.value = activation;
  synapseMat.uniforms.uFlashCount.value =
    quality.level >= 5 ? Math.min(quality.flashes, 3) : quality.flashes;
  // click pulses are scaled by uActivation in the shader (same opacity as
  // the resting veins), so while the synapses are dormant a pulse would draw
  // nothing — the mesh only needs to be visible once activation is up, and
  // the pulse branch only runs while one is alive on an awake network
  const pulseAlive = t - lastPulseTime < PULSE_LIFE;
  const awake = activation > 0.001;
  synapseMat.uniforms.uPulseAny.value = pulseAlive && awake ? 1 : 0;
  if (synapseMesh) synapseMesh.visible = awake;

  updateBeam(t, head);
}

/* ---------------------------------------------------------------
   a corrente de luz — ver three/brainBeam.js
--------------------------------------------------------------- */
const BEAM_PIN_START = 0.86; // progress do pin em que o cérebro começa a se desfazer
const BEAM_ARRIVE_AT = 0.8; // altura da cabeça na tela (fração) quando as primeiras chegam
const BEAM_END_AT = 0.35; // e quando a última entra
let pinTrigger = null;
const STARS_OPACITY = 0.35; // o valor de stage.js, restaurado ao sair
// ponto de entrada (no cabelo), em fração da caixa do .depth-portrait — só
// até o retrato publicar o seu (portraitLight.entry)
const HEAD_IN_PORTRAIT = { x: 0.49, y: 0.2 };
let beamB = 0;
let beamSnap = true;
const heroBgColor = new THREE.Color(HERO_BG);
const pageBgColor = new THREE.Color(PAGE_BG);
let portraitEl = null;

/** centro (de trás) da cabeça do retrato, em px da janela; null sem retrato */
function headScreenPoint() {
  if (!portraitEl?.isConnected) portraitEl = document.querySelector(".depth-portrait");
  if (!portraitEl) return null;
  const r = portraitEl.getBoundingClientRect();
  // o ponto de entrada que o próprio retrato publica (no cabelo); antes de
  // ele montar, uma estimativa fixa
  const f = portraitLight.entry ?? HEAD_IN_PORTRAIT;
  return {
    x: r.left + r.width * f.x,
    y: r.top + r.height * f.y,
  };
}

const beamRay = new THREE.Raycaster();
const beamNdc = new THREE.Vector2();
const beamPlane = new THREE.Plane();
const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const centerW = new THREE.Vector3();
const targetW = new THREE.Vector3();
const BEND_WORLD = new THREE.Vector3(0.3, 1.1, 0.9); // a curva sobe e passa na frente

function updateBeam(t, head) {
  const d = clamp01((beamB - RELEASE.start) / RELEASE.span);
  beamUniforms.uB.value = beamB;
  beamUniforms.uDissolve.value = beamB > 0.0005 ? Math.max(d, 0.001) : 0;
  if (!beamPoints) return;
  beamPoints.visible = beamB > RELEASE.start * 0.5 && beamB < 0.999;
  if (!beamPoints.visible || !head) {
    beamOverlay?.clear();
    return;
  }

  // destino: o raio da câmera pela cabeça, cortando o plano que passa pelo
  // centro do cérebro de frente para a câmera
  camera.updateMatrixWorld();
  brainGroup.updateMatrixWorld();
  brainGroup.getWorldPosition(centerW);
  // o destino nunca sai da tela: enquanto a cabeça ainda não apareceu (ou
  // já passou), a corrente espera na borda, onde dá para acompanhá-la — e
  // como as chegadas só começam com a cabeça visível (beamTarget em update()), ela
  // já está mirando a cabeça de verdade quando as partículas entram
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sx = Math.min(vw * 0.92, Math.max(vw * 0.08, head.x));
  const sy = Math.min(vh * 0.86, Math.max(vh * 0.1, head.y));
  beamNdc.set((sx / vw) * 2 - 1, -(sy / vh) * 2 + 1);
  beamRay.setFromCamera(beamNdc, camera);
  camera.getWorldDirection(tmpN);
  beamPlane.setFromNormalAndCoplanarPoint(tmpN, centerW);
  if (!beamRay.ray.intersectPlane(beamPlane, targetW)) {
    beamOverlay.clear();
    return;
  }

  const u = beamPoints.material.uniforms;
  brainGroup.worldToLocal(u.uTarget.value.copy(targetW));
  brainGroup.worldToLocal(u.uBend.value.copy(centerW).add(BEND_WORLD));
  u.uDisDir.value.copy(u.uTarget.value).normalize();

  // direção em que o feixe chega (na tela): do ponto a 80% da curva até o
  // destino. O ponto de contato no retrato se alonga nela (headInflow.js)
  const tgt = u.uTarget.value;
  tmpV.copy(tgt).multiplyScalar(0.5).add(u.uBend.value).multiplyScalar(2 * 0.2 * 0.8)
    .addScaledVector(tgt, 0.64);
  brainGroup.localToWorld(tmpV).project(camera);
  const px = ((tmpV.x + 1) / 2) * vw;
  const py = ((1 - tmpV.y) / 2) * vh;
  const len = Math.hypot(px - sx, py - sy);
  if (len > 1) portraitLight.dir = { x: (px - sx) / len, y: (py - sy) / len };
  u.uTime.value = t;
  u.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, quality.maxDpr);
  beamOverlay.render(beamPoints, camera);
}

/** Reduced-motion path: a fixed top-down pose, the title card and first text
 *  page shown together, and a fade continuously tied to how far #brain has
 *  scrolled past rather than the binary "is any part of the section on
 *  screen" test the dynamic path can rely on (there, that test is only ever
 *  the exit-fade's last resort — here it is the only signal there is, since
 *  progress itself never advances). The pose and camera never change once
 *  set, but the render still has to run every frame: the synapse shimmer
 *  (uTime-driven) keeps animating, so unlike a genuinely static act this one
 *  never opts into stage.js's dirty-flag skip. */
function updateStatic(t, dt) {
  const rect = act.rect;
  const vh = window.innerHeight;
  // 1 while the section still dominates the screen, easing down as its
  // bottom edge rises through the last 75% of a viewport of scroll
  const visible = smoothstep(
    clamp01((rect.bottom - vh * 0.15) / (vh * 0.75)),
  );

  exitFadeEl.style.opacity = 1 - visible;
  if (act) {
    act.wantsRender = visible > 0.01;
    const vignetteOpacity = act.wantsRender ? 1 : 0;
    vignetteEl.style.opacity = vignetteOpacity;
    fadeBottomEl.style.opacity = vignetteOpacity;
    if (!act.wantsRender) return;
  }

  brainGroup.rotation.set(
    deg(STATIC_POSE.tilt),
    deg(STATIC_POSE.yaw),
    deg(STATIC_POSE.roll),
  );
  brainGroup.position.set(0, STATIC_POSE.posY, STATIC_POSE.posZ);
  brainGroup.scale.setScalar(
    STATIC_POSE.scale * (isMobile ? MOBILE_BRAIN_SCALE : 1),
  );

  camera.position.set(camEnd.x, camEnd.y + STATIC_POSE.camY, camEnd.z);
  camera.lookAt(0, -0.18, 0);

  // The waves keep playing at the same strength the settled dynamic pose
  // would show (uActivation 1, the full flash count) — click pulses stay
  // off since there's no click listener under reduceMotion (see initHero()).
  synapseMat.uniforms.uTime.value = t;
  synapseMat.uniforms.uActivation.value = 1;
  synapseMat.uniforms.uFlashCount.value = quality.flashes;
  synapseMat.uniforms.uPulseAny.value = 0;
  if (synapseMesh) synapseMesh.visible = true;
}

/** Registers a new expanding pulse centred on `originLocal` (a unit vector in
 *  the brain mesh's local space — see onClick() below) and overwrites the
 *  oldest slot in the ring buffer once all are in use. */
function spawnPulse(originLocal) {
  const t = synapseMat.uniforms.uTime.value;
  synapseMat.uniforms.uPulseOrigin.value[pulseCursor].copy(originLocal);
  synapseMat.uniforms.uPulseStart.value[pulseCursor] = t;
  pulseCursor = (pulseCursor + 1) % PULSE_COUNT;
  lastPulseTime = t;
}

/** Called once from <Hero>'s mount effect. Returns a cleanup that undoes
 *  every DOM listener, the ScrollTrigger pin, and the act registration —
 *  everything that would otherwise double up under StrictMode's dev-only
 *  double-invoke. */
export function initHero() {
  section = document.getElementById("brain");
  stageEl = document.getElementById("stage");
  titleScreenEl = document.getElementById("brainTitleScreen");
  hintEl = document.getElementById("brainHint");
  progressEl = document.getElementById("brainProgress");
  exitFadeEl = document.getElementById("brainExitFade");
  vignetteEl = document.getElementById("brainVignette");
  fadeBottomEl = document.getElementById("brainFadeBottom");
  pageEls = [
    document.getElementById("brainPage0"),
    document.getElementById("brainPage1"),
    document.getElementById("brainPage2"),
  ];

  act = registerAct({
    id: "hero",
    el: section,
    group: brainGroup,
    update,
    setActive(active) {
      // the blur belongs to the hero alone — leave the shared canvas clean
      // for every other act
      if (!active) {
        stageEl.style.filter = "none";
        lastFilter = "none";
        scene.fog.near = FOG_NEAR_REST;
      } else if (reduceMotion) {
        // Under reduced motion the blur is a fixed, permanent softness (see
        // STATIC_BLUR_PX) rather than something update()/updateStatic() ever
        // sets frame to frame — so unlike the dynamic path, it has to be
        // reapplied explicitly here every time the hero goes active again,
        // or scrolling away and back would leave it sharp for good.
        stageEl.style.filter = `blur(${STATIC_BLUR_PX}px)`;
        lastFilter = `blur(${STATIC_BLUR_PX}px)`;
      }

      // Vignette/fade-bottom/exit-fade are only ever turned OFF from inside
      // update() (mirroring wantsRender), and update() only runs while
      // `near`. A big enough jump — a user flinging the scrollbar itself, or
      // any instant scrollTo — can cross the entire near-margin buffer in
      // one step, going near:true straight to near:false with no frame in
      // between to catch wantsRender turning false and zero them out. Left
      // at whatever opacity they last had (1, their normal state any time
      // the hero is actually on screen), they'd sit there forever, dimming
      // every section for the rest of the page. This is the one place a
      // near→false transition is guaranteed to run regardless of how it
      // happened, so it's the reset of last resort.
      if (!active) {
        vignetteEl.style.opacity = 0;
        fadeBottomEl.style.opacity = 0;
        exitFadeEl.style.opacity = 0;
        // estado compartilhado que a saída mexe: devolve ao normal
        stars.material.opacity = STARS_OPACITY;
        portraitLight.level = 1;
        portraitLight.beam = 1;
        beamOverlay?.clear();
      }
      beamSnap = true;

      // scene.background/fog is shared state, not owned by any one act. Set
      // it back to the warm hero tone on the way in (in case the user
      // scrolled back up from the finale, which leaves it at PAGE_BG) and
      // release it to the neutral page tone on the way out — otherwise it
      // would sit at HERO_BG, invisible while nothing wants the canvas, for
      // the entire stretch between the hero and the finale, and the finale
      // would then reveal that stale warm tone as a sudden jump the instant
      // its own canvas content appears.
      const hex = active ? HERO_BG : PAGE_BG;
      scene.background.setHex(hex);
      scene.fog.color.setHex(hex);
    },
  });

  const onPointerMove = (e) => {
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseY = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener("pointermove", onPointerMove);

  // click-to-pulse: raycast against the real mesh so the ring starts exactly
  // where the cursor lands on the brain, not just its projected centre.
  // #stage (the canvas) is pointer-events:none — see base.css — so this has
  // to live on the section itself rather than the canvas, using plain
  // viewport coordinates for the NDC conversion since the camera always
  // renders at the full window size (see stage.js's resize()).
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  const onClick = (e) => {
    if (!brainMesh) return;
    pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);
    const hit = raycaster.intersectObject(brainMesh, false)[0];
    if (!hit) return;
    const origin = brainMesh.worldToLocal(hit.point.clone()).normalize();
    spawnPulse(origin);
  };
  if (!reduceMotion) section.addEventListener("click", onClick);

  let trigger = null;
  if (!reduceMotion) {
    trigger = ScrollTrigger.create({
      trigger: "#brain",
      start: "top top",
      end: "+=380%",
      scrub: 0.6,
      pin: true,
      onUpdate: (self) => onProgress(self.progress),
      // the hero has its own progress rail (.brain-progress) at the exact
      // same screen position as the page-wide reading spine — both visible
      // at once reads as two conflicting scrollbars, so the spine steps
      // aside while the hero owns that spot
      onToggle: (self) =>
        document.body.classList.toggle("is-hero", self.isActive),
    });
    pinTrigger = trigger;
  } else {
    // No pin, no scroll-driven progress — #brain stays the same 100svh
    // frame it always is, updateStatic() above drives the 3D, and the title
    // card plus the first text page are shown together up front. Pages two
    // and three (#brainPage1/#brainPage2) are hidden entirely in
    // Hero.css's reduced-motion block, not just left unstaged.
    titleScreenEl.style.opacity = 1;
    pageEls[0].classList.add("is-visible");
    stageEl.style.filter = `blur(${STATIC_BLUR_PX}px)`;
  }

  return () => {
    window.removeEventListener("pointermove", onPointerMove);
    if (!reduceMotion) section.removeEventListener("click", onClick);
    trigger?.kill();
    pinTrigger = null;
    document.body.classList.remove("is-hero");
    unregisterAct(act);
    act = null;
  };
}
