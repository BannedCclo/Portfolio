/* ===========================================================
   headInflow.js — o ponto onde o feixe do cérebro entra na cabeça, desenhado
   pelo próprio retrato, POR CIMA da foto

   O feixe em si é desenhado por cima de todo o conteúdo, num canvas próprio
   (beamOverlay.js), e chega até a borda da cabeça (portraitLight.entry). Aqui
   fica só o que acontece na cabeça.

   No ponto de contato: um núcleo de luz e um halo que se espalha para
   dentro da cabeça (só dentro da silhueta — a luz "entra", não fica no ar),
   crescendo conforme mais partículas já entraram, e um único pulso que sai
   da borda e atravessa a cabeça uma vez, ao longo da chegada.

   Tudo aqui é função da rolagem (b): nada pulsa nem anda sozinho no tempo —
   parando de rolar, a cena para.

   Coordenadas: as do retrato (unidades do quadro, altura 1, origem no
   centro, y para cima), um pouco à frente das camadas — mesma paralaxe da
   órbita.
   =========================================================== */

import * as THREE from "three";
import { ARRIVE } from "./brainBeam.js";

// soma luz por cima da foto com cor pré-multiplicada (o canvas é
// pré-multiplicado): fora da foto aparece sobre a página sem borda escura
const ADD = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneFactor,
};

/**
 * @param {object} shared uniforms do retrato (uSil, uAspect)
 * @param {THREE.Vector2} entryQ ponto de entrada, em q
 */
export function createHeadInflow(shared, entryQ) {
  const uniforms = {
    uB: { value: 1 },
    uEntry: { value: entryQ },
    // de onde o feixe vem, a partir do ponto de entrada (unitário, em q)
    uDir: { value: new THREE.Vector2(0.6, 0.8).normalize() },
    uEntryI: { value: 0 },
    uFill: { value: 0 }, // fração já entrada: o halo cresce com ela
    uWave: { value: 0 }, // fase (0..1) do pulso que atravessa a cabeça
    uSil: shared.uSil,
    uAspect: shared.uAspect,
  };

  // --- o ponto de entrada ---
  const SPOT = 0.5; // cabe a onda inteira (raio ~0.22)
  const spotGeo = new THREE.PlaneGeometry(SPOT, SPOT);
  spotGeo.translate(entryQ.x, entryQ.y, 0.02);
  const spotMat = new THREE.ShaderMaterial({
    ...ADD,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vQ;
      void main() {
        vQ = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec2 uEntry;
      uniform vec2 uDir;
      uniform float uEntryI;
      uniform float uFill;
      uniform float uWave;
      uniform sampler2D uSil;
      uniform float uAspect;
      varying vec2 vQ;

      void main() {
        if (uEntryI < 0.002 && (uWave <= 0.0 || uWave >= 1.0)) discard;
        vec2 d = vQ - uEntry;
        float r = length(d);
        // dentro da cabeça? (silhueta suavizada: borda macia)
        vec2 suv = vec2(vQ.x / uAspect + 0.5, vQ.y + 0.5);
        float inside = smoothstep(0.25, 0.75, texture2D(uSil, suv).g);

        // núcleo: alongado na direção do feixe que chega
        vec2 dl = vec2(dot(d, uDir), dot(d, vec2(-uDir.y, uDir.x)));
        float core = exp(-(dl.x * dl.x) / (0.018 * 0.018) - (dl.y * dl.y) / (0.008 * 0.008));
        core += exp(-r * r / (0.006 * 0.006)) * 0.8;
        // halo pelo cabelo: começa colado ao ponto e se espalha conforme
        // mais partículas já entraram
        float rh = mix(0.025, 0.06, uFill);
        float halo = exp(-r * r / (rh * rh)) * 0.45
                   + exp(-r * r / (0.11 * 0.11)) * 0.06 * uFill;

        // o pulso: um único arco que sai do ponto de contato (na borda) e se
        // espalha para dentro da cabeça. O raio é a fase — dada pela
        // rolagem: passa uma vez só e anda para trás junto. Borda irregular
        // fixa (não anima sozinha)
        float ang = atan(d.y, d.x);
        float wob = 1.0 + 0.08 * sin(ang * 5.0 + 1.3) + 0.04 * sin(ang * 11.0 + 0.4);
        float rad = uWave * 0.2 * wob;
        float wid = 0.005 + 0.014 * uWave;
        float wave = exp(-pow((r - rad) / wid, 2.0))
                   * (1.0 - uWave) * (1.0 - uWave) * smoothstep(0.0, 0.05, uWave);

        float light = (core + halo * inside) * uEntryI + wave * inside * 0.5;
        vec3 gold = vec3(250.0, 209.0, 128.0) / 255.0;
        vec3 col = mix(gold, vec3(1.0, 0.97, 0.9), clamp(core, 0.0, 1.0) * 0.7);
        float a = clamp(light, 0.0, 1.5);
        gl_FragColor = vec4(col * a, min(a, 1.0));
      }
    `,
  });
  const spot = new THREE.Mesh(spotGeo, spotMat);
  spot.frustumCulled = false;
  spot.renderOrder = 100;

  const group = new THREE.Group();
  group.add(spot);
  group.visible = false;

  return {
    group,
    uniforms,
    disposables: [spotGeo, spotMat],
    /**
     * @param {number} b progresso da corrente (portraitLight.beam)
     * @param {number} level fração já entrada (portraitLight.level)
     * @param {{x:number,y:number}|null} dirScreen direção de onde o feixe
     *   vem, em px da tela (y para baixo)
     */
    update(b, level, dirScreen) {
      uniforms.uB.value = b;
      if (dirScreen) uniforms.uDir.value.set(dirScreen.x, -dirScreen.y).normalize();
      // aceso enquanto há partículas entrando (janela de chegada)
      const lo = ARRIVE.start - 0.02;
      const hi = ARRIVE.start + ARRIVE.span + 0.02;
      const win =
        THREE.MathUtils.smoothstep(b, lo, lo + 0.05) *
        (1 - THREE.MathUtils.smoothstep(b, hi - 0.04, hi));
      uniforms.uEntryI.value = win;
      uniforms.uFill.value = level;
      // a onda atravessa a cabeça do meio da chegada até um pouco depois do fim
      uniforms.uWave.value = THREE.MathUtils.clamp(
        (b - (ARRIVE.start + 0.08)) / (ARRIVE.span - 0.02),
        0,
        1,
      );
      group.visible = b > lo - 0.06 && b < hi + 0.01;
    },
  };
}
