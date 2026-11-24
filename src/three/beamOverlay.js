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
import { guardContextLoss } from "./contextGuard.js";

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
  // contexto derrubado pelo navegador: esconde o canvas (three/contextGuard.js)
  guardContextLoss(canvas);

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
  // apagado, o canvas de tela cheia sai da composição: fora da saída do
  // hero ele está sempre vazio, e no celular cada camada transparente do
  // tamanho da tela ainda custa a mistura a cada quadro. Por classe, não por
  // style.visibility: esse é do contextGuard (contexto perdido) e vence
  canvas.classList.add("is-empty");

  /* Ancorado no documento ou fixo na tela.
     Fixo (o normal), o canvas fica parado enquanto a página rola, e o desenho
     só acompanha no próximo quadro do JS. No celular a rolagem roda no
     compositor, bem à frente do JS: rolando rápido, o retrato andava dezenas
     de px antes de o feixe ser redesenhado, e a ponta descolava da cabeça.
     Ancorado, o canvas é posto no documento exatamente onde estava a tela
     quando o quadro foi desenhado (translateY = scrollY daquele quadro):
     entre um quadro e outro o compositor rola o canvas junto com o retrato,
     e a ponta continua colada na cabeça. */
  let anchored = null;
  function anchor(docY) {
    if (docY == null) {
      if (anchored === null) return;
      anchored = null;
      Object.assign(canvas.style, { position: "", inset: "", height: "", transform: "" });
      return;
    }
    if (anchored === null) {
      Object.assign(canvas.style, { position: "absolute", inset: "0 auto auto 0" });
    }
    canvas.style.height = `${h}px`;
    if (docY !== anchored) canvas.style.transform = `translate3d(0, ${docY}px, 0)`;
    anchored = docY;
  }

  return {
    renderer,
    /**
     * Desenha só as partículas, com a câmera do palco neste quadro.
     * @param {THREE.Object3D} points (já com o matrixWorld do quadro)
     * @param {THREE.Camera} camera
     * @param {number | null} [docY] scrollY deste quadro para ancorar o
     *   canvas no documento; null/omitido = fixo na tela
     */
    render(points, camera, docY = null) {
      fit();
      anchor(docY);
      const saved = camera.layers.mask;
      camera.layers.set(BEAM_LAYER);
      renderer.render(points, camera);
      camera.layers.mask = saved;
      if (!drawn) canvas.classList.remove("is-empty");
      drawn = true;
    },
    /** apaga o que ficou desenhado (uma vez) */
    clear() {
      if (!drawn) return;
      renderer.clear();
      canvas.classList.add("is-empty");
      drawn = false;
    },
    dispose() {
      renderer.dispose();
      canvas.remove();
    },
  };
}
