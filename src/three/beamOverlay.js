/* ===========================================================
   beamOverlay.js — a corrente de partículas do cérebro desenhada POR CIMA do
   conteúdo

   O palco (stage.js) fica atrás das seções: dali a corrente só conseguia
   passar por trás da cabeça do retrato. Antes, o retrato redesenhava o trecho
   final no canvas dele, mas os dois trechos nunca casavam: aquele nascia num
   ponto fixo, era cortado na borda do canvas do retrato e tinha outro
   brilho, então se via um corte seco no meio do caminho.

   Agora a corrente inteira, do cérebro até a borda da cabeça, é desenhada
   neste canvas transparente de tela cheia, acima das seções (e abaixo da
   nav). Ele usa a mesma câmera, o mesmo objeto e o mesmo material do palco:
   as partículas ficam na camada LAYER, que a câmera do palco não enxerga, e
   este renderer só desenha essa camada.

   Sem bloom aqui, porque o pós-processamento é do palco. O brilho vem da
   soma das próprias partículas.
   =========================================================== */

import * as THREE from "three";

/** camada (THREE.Layers) das partículas: fora da do palco (0) */
export const BEAM_LAYER = 1;

/**
 * @param {{ maxDpr: number }} quality
 */
export function createBeamOverlay(quality) {
  const canvas = document.createElement("canvas");
  canvas.className = "beam-overlay";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;

  let w = 0;
  let h = 0;
  function fit() {
    const nw = window.innerWidth;
    const nh = window.innerHeight;
    if (nw === w && nh === h) return;
    w = nw;
    h = nh;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.maxDpr));
    renderer.setSize(w, h, false);
  }
  fit();

  let drawn = false;

  return {
    renderer,
    /**
     * Desenha só as partículas, com a câmera do palco neste quadro.
     * @param {THREE.Object3D} points (já com o matrixWorld do quadro)
     * @param {THREE.Camera} camera
     */
    render(points, camera) {
      fit();
      const saved = camera.layers.mask;
      camera.layers.set(BEAM_LAYER);
      renderer.render(points, camera);
      camera.layers.mask = saved;
      drawn = true;
    },
    /** apaga o que ficou desenhado (uma vez) */
    clear() {
      if (!drawn) return;
      renderer.clear();
      drawn = false;
    },
    dispose() {
      renderer.dispose();
      canvas.remove();
    },
  };
}
