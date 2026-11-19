/* ===========================================================
   acts/finale.js — the brain returns

   Closes the loop the hero opened. It reuses the geometry the hero already
   built and uploaded, so a second brain costs a draw call and nothing else —
   no extra download, no second pass of welding and smoothing.

   Where the hero drives the brain hard, this one barely moves: far off, dim,
   slowly turning, synapses at a low idle. The section's text sits above it.
   =========================================================== */

import * as THREE from "three";
import {
  camera,
  scene,
  registerAct,
  unregisterAct,
  renderer,
  PAGE_BG,
} from "../stage.js";
import { clamp01, damp, lerp, deg } from "../../lib/motion.js";
import { brainGeometryReady, synapseMat, tissueMat } from "./hero.js";

const PAGE_COLOR = new THREE.Color(PAGE_BG);

export const finaleGroup = new THREE.Group();
finaleGroup.position.set(0, -0.1, 0);

let mesh = null;
let glow = null;

/** Called once from <Contact>'s mount effect. Returns a cleanup. */
export function initFinale() {
  const section = document.getElementById("contato");
  if (!section) return () => {};

  brainGeometryReady
    ?.then((geometry) => {
      // Guards against a StrictMode double-invoke re-running this whole
      // chain: brainGeometryReady only resolves once, but if initFinale()
      // itself were called a second time, a second .then() would otherwise
      // build and add a duplicate mesh/glow pair to finaleGroup.
      if (mesh) return;

      // The hero's brain is the lit one. This is its echo: an almost-black
      // silhouette where the only bright thing left is the signal still
      // running across it. It also has to sit behind a headline, and a pale
      // surface there would simply eat the type.
      const darkMat = tissueMat.clone();
      darkMat.color = new THREE.Color(0x1a1a1a);
      darkMat.roughness = 0.95;
      darkMat.clearcoat = 0;
      darkMat.sheen = 0;
      darkMat.envMapIntensity = 0.1;
      // Opacity itself rides `entered` (set in update()) — the mesh is opaque
      // by default and group.visible is a hard on/off, so without this the
      // silhouette snaps to full brightness the instant the section counts as
      // near, ahead of whatever the shared canvas's own CSS fade is doing.
      darkMat.transparent = true;
      darkMat.opacity = 0;

      mesh = new THREE.Mesh(geometry, darkMat);
      finaleGroup.add(mesh);

      // its own material instance so the idle activation here is independent
      // of whatever the hero's sequence left set on the shared one
      glow = new THREE.Mesh(geometry, synapseMat.clone());
      glow.scale.setScalar(1.006);
      finaleGroup.add(glow);

      // darkMat and the cloned synapse material are new programs the hero's
      // own warm-up (three/stage.js) never compiled. By the time a visitor
      // scrolls this far the stage is long since visible, so this isn't
      // gating anything — just gets the compile out of the way before the
      // section is actually near instead of on its first real frame.
      if (typeof renderer.compileAsync === "function") {
        renderer.compileAsync(scene, camera).catch(() => {});
      }
    })
    .catch(() => {
      /* the hero already reported the load failure */
    });

  let spin = 0;
  let entered = 0;

  const act = registerAct({
    id: "finale",
    el: section,
    group: finaleGroup,
    // this act exists only while its own section is on screen — with the
    // default 1.5-viewport lead the brain would surface behind the stack and
    // about sections long before the page gets here. Wide enough to give
    // `entered` (below) room to ramp across roughly half a viewport of
    // scroll before Contact itself is on screen, so the fade-in reads as
    // gradual instead of arriving already at full brightness.
    nearMargin: 0.45,
    update(t, dt) {
      // how centred the section is in the viewport, 0..1 — act.rect comes
      // from the shared director's single getBoundingClientRect() per act
      // per frame (three/stage.js), instead of a second read of the same
      // element here.
      const rect = act.rect;
      const vh = window.innerHeight;
      const centred = clamp01(
        1 - Math.abs(rect.top + rect.height / 2 - vh / 2) / vh,
      );
      entered = damp(entered, centred, dt, 1.4);
      // fully faded out means nothing to draw
      act.wantsRender = entered > 0.015;

      // Continuously eases toward the page's own tone rather than assuming
      // scene.background already sits there. Normally it does — the hero
      // resets it on its own deactivate (acts/hero.js) long before the finale
      // ever comes near — so most of the time this is a no-op that confirms
      // the colour rather than visibly changing it. It's what makes a fast
      // scroll or an out-of-order activation self-correct instead of leaving
      // a stale tint for the finale to reveal as a jump.
      const bgEase = 1 - Math.exp(-dt * 3);
      scene.background.lerp(PAGE_COLOR, bgEase);
      scene.fog.color.lerp(PAGE_COLOR, bgEase);

      if (!act.wantsRender) return;

      spin += dt * 0.06;
      finaleGroup.rotation.y = spin;
      finaleGroup.rotation.x = deg(22);
      finaleGroup.rotation.z = deg(-5);
      finaleGroup.scale.setScalar(lerp(0.62, 0.78, entered));

      // sits well back and drifts a touch closer as the section centres
      camera.position.set(0, 0.35, lerp(13.5, 11.8, entered));
      camera.lookAt(0, -0.1, 0);

      if (mesh) mesh.material.opacity = entered;
      if (glow) {
        glow.material.uniforms.uTime.value = t;
        // a low idle — present, but nothing like the hero's full activation
        glow.material.uniforms.uActivation.value = 0.72 * entered;
      }
    },
  });

  return () => {
    unregisterAct(act);
    // <Contact> unmounting (route change, hot reload) — PAGE_BG is the
    // correct neutral default here, not a hero-specific tone; the hero
    // reclaims scene.background itself if and when it goes active again.
    scene.background.setHex(PAGE_BG);
    scene.fog.color.setHex(PAGE_BG);
  };
}
