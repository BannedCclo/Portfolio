/* ===========================================================
   stage.js — one WebGL canvas for the whole page

   Every 3D moment on the page draws into this single fixed canvas. Sections
   register "acts"; the director decides which act is close enough to matter,
   updates only those, and skips rendering entirely when none of them is on
   screen. A full-viewport canvas with bloom running behind every section
   would otherwise burn battery for the ~80% of the page that has no 3D.

   The active act owns the camera. Acts live far apart in the document, so at
   most one is ever near the viewport, which keeps that ownership unambiguous.

   Scene/camera/renderer/composer are module-level singletons, created once
   on import — same as the static version, and deliberately not tied to any
   one component's mount/unmount. Only the two things that actually need the
   DOM (attaching the canvas, toggling its opacity) wait for initStage(),
   called from <Stage>'s effect once the mount div exists. That split keeps
   registerAct() safe to call regardless of which component's effect fires
   first, and keeps a StrictMode double-invoke of <Stage>'s effect cheap
   (guarded, not a real teardown+rebuild of the renderer).
   =========================================================== */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { isNearRect } from "../lib/motion.js";
import { guardContextLoss } from "./contextGuard.js";

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

/* ---------------------------------------------------------------
   quality tiers — bloom is by far the most expensive thing here
   (several downsample passes every frame), so it is the first thing
   dropped on constrained devices.

   `mesh` picks between the full-detail brain.glb and a decimated
   brain-low.glb (see acts/hero.js) — keyed off pointer type rather than
   viewport width, so a phone in landscape (which crosses the 820px
   breakpoint the rest of the page uses) still gets the lighter mesh.

   navigator.deviceMemory doesn't exist in Safari, so `mem` used to default
   to 8 regardless of device — putting every iPhone in the "mid" tier with
   bloom on. A coarse pointer with no reported memory is assumed constrained
   instead.
   --------------------------------------------------------------- */
function detectQuality() {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const mem = navigator.deviceMemory ?? (coarse ? 4 : 8);
  const small = window.innerWidth < 820;
  // navigator.deviceMemory is capped at 8 by spec (anti-fingerprinting) — it
  // never reports higher, and the unsupported-browser fallback above also
  // lands exactly on 8. A `mem <= 8` check for the "high" cutoff is therefore
  // never false: no desktop, however capable, could ever clear it, which
  // silently collapsed every non-coarse device into "mid" (fog approximation
  // instead of real CSS blur, 9 flashes instead of 12). `mem` stays useful
  // for catching a genuinely constrained *coarse* (phone/tablet) device, but
  // it can't distinguish tiers on non-coarse hardware — there, pointer type
  // alone decides high vs mid.
  const tier = mem <= 4 || (coarse && small) ? "low" : coarse ? "mid" : "high";
  return {
    tier,
    bloom: tier !== "low",
    // Low tier starts at native-resolution-1 rather than 1.25 — a phone weak
    // enough to land in this bucket can't afford to wait for the watchdog
    // (which needs a warm-up window plus a full sample window before its
    // first degrade) to claw back the ~36% fewer fragments this buys
    // immediately. See applyStageDegradation()'s comment for the rest of the
    // ladder this feeds into.
    maxDpr: tier === "low" ? 1 : 1.5,
    flashes: tier === "low" ? 6 : tier === "mid" ? 9 : 12,
    mesh: coarse ? "low" : "full",
  };
}

/* `level` is the watchdog's degrade counter (see recordWatchdogSample below) —
   0 at start, only ever climbs during a session. Acts read it directly each
   frame for their own concerns (acts/hero.js gates its CSS blur and synapse
   flash count on it); stage-owned effects (dpr, bloom, grain) are applied
   here in degradeQuality(). */
export const quality = { ...detectQuality(), level: 0 };

const QUALITY_LEVELS = 5;

/** Only ever moves the quality level down. Idempotent per level: every
 *  threshold check uses `quality.level >= n`, so re-running after a further
 *  degrade re-applies (harmlessly) everything already in effect. */
function degradeQuality() {
  if (quality.level >= QUALITY_LEVELS) return;
  quality.level++;
  applyStageDegradation();
  markDirty();
}

// Ordered so every degrade step actually costs something back — it used to
// start checking at level >= 2, leaving the watchdog's first step (level 0
// -> 1) a no-op that bought nothing while a struggling phone kept dropping
// frames for a whole extra cooldown window before the next check.
function applyStageDegradation() {
  if (quality.level >= 1) {
    document.getElementById("grain")?.style.setProperty("display", "none");
  }
  if (quality.level >= 2) {
    const dpr = 1;
    if (renderer.getPixelRatio() !== dpr) {
      renderer.setPixelRatio(dpr);
      composer.setPixelRatio(dpr);
    }
  }
  if (quality.level >= 3 && bloomPass) {
    bloomPass.enabled = false;
  }
}

/* ---------------------------------------------------------------
   renderer / scene / camera
--------------------------------------------------------------- */
export const renderer = new THREE.WebGLRenderer({
  // Every frame goes through EffectComposer (RenderPass → bloom → OutputPass);
  // the only thing ever drawn to the renderer's own default framebuffer is
  // the OutputPass's fullscreen quad, so the canvas's own MSAA never resolves
  // an edge. Pure cost with no visual return.
  antialias: false,
  powerPreference: "high-performance",
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.maxDpr));
// contexto derrubado pelo navegador: esconde o canvas em vez de deixar a
// página branca (three/contextGuard.js)
guardContextLoss(renderer.domElement);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// The neutral resting tone for scene.background/fog — matches --bg, so
// whenever no act cares to tint the scene (the long stretch between the hero
// and the finale) it already agrees with the flat CSS background sitting
// under the canvas. Acts that want a different tone (the hero's warmer
// HERO_BG) are responsible for restoring PAGE_BG themselves on deactivate —
// see acts/hero.js — otherwise a stale tint lingers, invisible while the
// canvas is hidden, until the next act reveals it as a sudden colour jump.
export const PAGE_BG = 0x070707;

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x121212);
scene.fog = new THREE.Fog(0x121212, 8, 20);

export const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;

const hemi = new THREE.HemisphereLight(0xffffff, 0x141414, 0.5);
scene.add(hemi);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
keyLight.position.set(4, 6, 5);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xd4af37, 1.0);
rimLight.position.set(-5, 1, -4);
scene.add(rimLight);

const fillLight = new THREE.DirectionalLight(0x8c8c8c, 0.6);
fillLight.position.set(-3, -4, 3);
scene.add(fillLight);

/* ---------------------------------------------------------------
   post-processing
--------------------------------------------------------------- */
export const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
let bloomPass = null;
if (quality.bloom) {
  bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.5, 0.85);
  composer.addPass(bloomPass);
}
composer.addPass(new OutputPass());

/* Resize is debounced: on Android Chrome and iOS Safari, scrolling
   collapses/expands the URL bar and fires "resize" repeatedly mid-gesture.
   composer.setSize() disposes and reallocates every render target it owns —
   with bloom that's the bright-pass target plus five horizontal and five
   vertical blur targets, all half-float — which is almost certainly what
   stalls the frame on constrained devices mid-scroll (see the A54 debugging
   note on the acts array below). The trailing debounce plus the
   no-op-if-unchanged guard below cut that to at most one reallocation per
   settled resize. setPixelRatio was also never reapplied here before, so a
   dpr change (rotating the device, dragging the window to a different
   monitor) silently stuck with whatever ratio the page loaded at. */
let lastW = 0;
let lastH = 0;
let resizeTimer = null;

function applyResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w === lastW && h === lastH) return;
  lastW = w;
  lastH = h;

  const dpr = Math.min(window.devicePixelRatio, quality.maxDpr);
  if (renderer.getPixelRatio() !== dpr) {
    renderer.setPixelRatio(dpr);
    composer.setPixelRatio(dpr);
  }
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  markDirty();
  resetWatchdog();
}
// The initial call is deferred to the bottom of the module (see
// applyResize() there) — this function references `dirty` and the watchdog
// state below, both declared later in module-evaluation order; calling it
// here would read them before their `let` initialisation runs.

function scheduleResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(applyResize, 180);
}
window.addEventListener("resize", scheduleResize);

/* ---------------------------------------------------------------
   ambient star field — shared backdrop. It belongs to the stage rather
   than to any one act so it can carry continuity across sections: the
   same drifting particles that sat behind the brain stay behind the
   manifesto text, which quietly ties the two together.
--------------------------------------------------------------- */
const STAR_COUNT = 200;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(STAR_COUNT * 3);
for (let i = 0; i < STAR_COUNT; i++) {
  const r = 7 + Math.random() * 10;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
  starPos[i * 3 + 2] = r * Math.cos(phi) - 3;
}
starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
export const stars = new THREE.Points(
  starGeo,
  new THREE.PointsMaterial({
    color: 0x8a8a8a,
    size: 0.018,
    transparent: true,
    opacity: 0.35,
  }),
);
scene.add(stars);

/* ---------------------------------------------------------------
   mount — the only part of this module that waits for React
--------------------------------------------------------------- */
let mount = null;
let stageInitialized = false;

/** Attaches the renderer's canvas to the DOM. Idempotent — safe to call twice
 *  under StrictMode's dev-only double-invoke of effects. */
export function initStage(mountEl) {
  if (stageInitialized) return;
  stageInitialized = true;
  mount = mountEl;
  mount.appendChild(renderer.domElement);
}

/* ---------------------------------------------------------------
   warm-up

   #stage starts at opacity:0 (base.css) and stageReady starts false, so the
   very first real frame doesn't fade the canvas in until this has run —
   otherwise the canvas would already be fading in on frame 1, before the
   brain's geometry has even finished loading, defeating the point. Called
   from acts/hero.js once brainGeometryReady resolves.

   compileAsync (added in three r160, backed by KHR_parallel_shader_compile
   where available) only compiles programs for objects still in scene.traverse
   — invisible objects included — so brainGroup/synapseMesh being hidden
   before the hero's approach doesn't skip them. It does NOT cover the
   post-processing passes' own internal materials, or the geometry's first
   GPU upload, so a single throwaway composer.render() follows it. Wrapped in
   try/finally: whatever happens (unsupported browser, load failure), the
   canvas must still be revealed. */
let stageReady = false;
const readyListeners = [];
export function markStageReady() {
  if (stageReady) return;
  stageReady = true;
  for (const cb of readyListeners.splice(0)) cb();
}

/** Subscribes to the stage becoming ready (see markStageReady above) — calls
 *  back immediately if it already is. <LoadingScreen> uses this to know
 *  when to dismiss itself instead of guessing at a fixed delay. */
export function onStageReady(cb) {
  if (stageReady) cb();
  else readyListeners.push(cb);
}

export async function warmUpStage() {
  if (stageReady) return;
  try {
    if (typeof renderer.compileAsync === "function") {
      await Promise.race([
        renderer.compileAsync(scene, camera),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    }
    composer.render();
  } catch {
    /* unsupported or failed — reveal the canvas anyway */
  } finally {
    markStageReady();
  }
}

/* ---------------------------------------------------------------
   act director
--------------------------------------------------------------- */
const acts = [];

// TEMP DEBUG — investigando o bug do cérebro preso no A54, remover depois.
if (import.meta.env.DEV) {
  window.__stageDebug = () =>
    acts.map((a) => ({
      id: a.id,
      near: a.active,
      active: a.active,
      wantsRender: a.wantsRender,
      rect: a.rect,
    }));
  // Força um nível de degradação (0 = qualidade total) sem precisar de um
  // device lento de verdade — reaplica o baseline e desce `n` degraus.
  window.__stageQuality = (n) => {
    quality.level = 0;
    const dpr = Math.min(window.devicePixelRatio, quality.maxDpr);
    renderer.setPixelRatio(dpr);
    composer.setPixelRatio(dpr);
    if (bloomPass) bloomPass.enabled = quality.bloom;
    document.getElementById("grain")?.style.removeProperty("display");
    for (let i = 0; i < (n ?? 0); i++) degradeQuality();
  };
}

/** Always available (not DEV-gated): src/lib/debugPanel.js reads this from a
 *  production build via ?debug, which is how the A54 is actually tested. */
window.__stageStats = () => ({
  tier: quality.tier,
  level: quality.level,
  mesh: quality.mesh,
  dpr: renderer.getPixelRatio(),
  fpsMedian: medianFps(),
  drawCalls: renderer.info.render.calls,
  triangles: renderer.info.render.triangles,
});

/**
 * @param {object} act
 * @param {string} act.id
 * @param {HTMLElement} act.el       element whose proximity gates the act
 * @param {THREE.Object3D} [act.group]
 * @param {(t:number, dt:number)=>void} act.update
 * @param {(active:boolean)=>void} [act.setActive]
 * @param {boolean} [act.static]     see the reduced-motion dirty-skip below
 *
 * An act may set `act.wantsRender = false` from inside update() to say it is
 * near the viewport but has nothing to draw right now. The hero needs this:
 * its section stays within a viewport of the manifesto long after its own
 * sequence has finished and dissolved, and without it the brain reappears
 * behind the next section's text.
 *
 * `act.nearMargin` (in viewports) sets how early the act wakes up. The
 * default of 1.5 buys warm-up time for an act that has to animate in from
 * off-screen; an act that should only exist while its own section is on
 * screen wants a much smaller value.
 */
export function registerAct(act) {
  act.active = false;
  act.wantsRender = true;
  act.nearMargin ??= 1.5;
  act.rect = null;
  acts.push(act);
  if (act.group) scene.add(act.group);
  return act;
}

/** The React-lifecycle counterpart to registerAct — every act's effect
 *  cleanup calls this so StrictMode's mount→cleanup→mount cycle in dev (and
 *  any real unmount) leaves no stale entry driving the shared render loop. */
export function unregisterAct(act) {
  const i = acts.indexOf(act);
  if (i !== -1) acts.splice(i, 1);
  if (act.group) scene.remove(act.group);
}

/* ---------------------------------------------------------------
   dirty flag — under prefers-reduced-motion nothing in the scene animates on
   its own (pose is fixed, uTime is frozen), so re-rendering the identical
   frame 60x/s is pure waste. An act that never changes on its own sets
   act.static = true (acts/hero.js does, only under reduceMotion); such an
   act must call markDirty() itself whenever something it owns actually did
   change (its fade fraction, on resize). Acts that keep animating regardless
   of reduceMotion (none currently do) simply don't set .static, and the
   scene renders every frame as before.
--------------------------------------------------------------- */
let dirty = true;
export function markDirty() {
  dirty = true;
}

/* ---------------------------------------------------------------
   FPS watchdog — degrades quality on its own when the device can't keep up.
   Guarded against false positives four ways: a warm-up window that discards
   the first frames after rendering resumes (shader compile / geometry
   upload stalls), a median over a rolling window instead of a mean (one GC
   pause shouldn't cost a degrade), a minimum-observed-dt floor (a display
   simply capped at 30Hz shouldn't read as "struggling"), and a cooldown so
   one rough patch triggers at most one step down.
--------------------------------------------------------------- */
const DT_WINDOW = 60;
const WARMUP_FRAMES = 20;
const COOLDOWN_FRAMES = 90;
const dtSamples = [];
let warmupRemaining = WARMUP_FRAMES;
let framesSinceDegrade = COOLDOWN_FRAMES;

function resetWatchdog() {
  dtSamples.length = 0;
  warmupRemaining = WARMUP_FRAMES;
}

function medianFps() {
  if (!dtSamples.length) return 0;
  const sorted = [...dtSamples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return median > 0 ? Math.round(1 / median) : 0;
}

function recordWatchdogSample(dt) {
  if (warmupRemaining > 0) {
    warmupRemaining--;
    return;
  }
  dtSamples.push(dt);
  if (dtSamples.length > DT_WINDOW) dtSamples.shift();
  framesSinceDegrade++;
  if (dtSamples.length < DT_WINDOW || framesSinceDegrade < COOLDOWN_FRAMES) return;

  const sorted = [...dtSamples].sort((a, b) => a - b);
  const medianDt = sorted[Math.floor(sorted.length / 2)];
  const minDt = sorted[0];
  if (medianDt > 1 / 45 && minDt < 1 / 50) {
    degradeQuality();
    dtSamples.length = 0;
    framesSinceDegrade = 0;
  }
}

// Now that `dirty` and the watchdog's state are both declared above, it's
// safe to run the first real resize — this is what sets the renderer's
// initial size (module import happens before <Stage>'s effect ever calls
// startStage(), so this always lands before the first frame()).
applyResize();

const clock = new THREE.Clock();
let running = true;
let canvasShown = false;
let wasRendering = false;
let started = false;

document.addEventListener("visibilitychange", () => {
  running = !document.hidden;
  // swallow the delta accumulated while hidden so nothing lurches on return
  if (running) {
    clock.getDelta();
    resetWatchdog();
  }
});

function frame() {
  requestAnimationFrame(frame);
  if (!running || !mount) return;

  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.getElapsedTime();

  let anyWants = false;
  let anyDynamic = false;
  for (const act of acts) {
    // One layout read per act per frame, shared by the near/active check and
    // whatever the act's own update() needs — previously each of those did
    // its own getBoundingClientRect(), interleaved with this same loop's DOM
    // writes (opacity, filter) from frame to frame, forcing synchronous
    // layout every tick.
    const rect = act.el.getBoundingClientRect();
    act.rect = rect;
    const near = isNearRect(rect, act.nearMargin);
    if (near !== act.active) {
      act.active = near;
      act.setActive?.(near);
    }
    if (near) {
      act.update(t, dt);
      if (act.wantsRender !== false) {
        anyWants = true;
        if (!act.static) anyDynamic = true;
      }
    }
    if (act.group) act.group.visible = near && act.wantsRender !== false;
  }

  if (anyWants && !wasRendering) resetWatchdog();
  wasRendering = anyWants;

  const showCanvas = anyWants && stageReady;
  if (showCanvas !== canvasShown) {
    canvasShown = showCanvas;
    // Asymmetric on purpose: appearing fades in gently (see base.css's
    // #stage transition — this is what keeps the finale's brain from
    // popping in behind Contact), but disappearing needs to be near-instant.
    // Sections have no opaque background of their own — they rely on the
    // canvas underneath already being invisible — so on a fast scroll past
    // the hero, a slow fade-out would leave the outgoing brain visibly
    // bleeding through the next section for as long as the fade lasts.
    mount.style.transitionDuration = showCanvas ? "" : "0s";
    mount.style.opacity = showCanvas ? "1" : "0";
  }

  // nothing on screen wants the canvas — don't pay for a frame
  if (!anyWants) return;

  // under reduced motion, an all-static scene re-rendering an unchanged
  // frame is pure waste; see the dirty flag comment above
  if (reduceMotion && !anyDynamic && !dirty) return;
  dirty = false;

  if (!reduceMotion) stars.rotation.y = t * 0.008;
  composer.render();
  if (!reduceMotion) recordWatchdogSample(dt);
}

/** Idempotent for the same StrictMode reason as initStage(). */
export function startStage() {
  if (started) return;
  started = true;
  frame();
}
