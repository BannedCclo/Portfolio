/* ===========================================================
   portraitLight — a ponte entre o feixe do cérebro (three/acts/hero.js) e o
   retrato (three/depthPortrait.js), que vivem em canvases diferentes.

   `level` é a fração das partículas que já entrou na cabeça (0..1). Ela
   multiplica o ganho da luz de trás do retrato: apagada até o feixe chegar,
   acesa depois. Começa em 1 — se o hero nunca rodar (reduced motion, página
   aberta já lá embaixo), o retrato fica aceso como sempre.

   O brilho de dentro da cabeça cresce com o quanto já entrou e se apaga
   logo depois da última partícula entrar. É função só da rolagem (o
   progresso `beam`): parando de rolar, ele para; rolando para trás, volta.
   Não mexe na luz de trás.
   =========================================================== */

import { ARRIVE } from "../three/brainBeam.js";

export const portraitLight = {
  level: 1,
  // progresso da corrente (o `b` de three/brainBeam.js): o retrato usa para
  // desenhar o trecho final das partículas por cima da foto. 1 = já entrou.
  beam: 1,
  // de onde o feixe chega ao ponto de entrada, em px da tela (unitário, y
  // para baixo) — o hero calcula, o retrato continua o feixe nessa direção
  dir: null,
  // ponto de entrada na caixa do .depth-portrait (fração) — o retrato
  // calcula, o hero mira a corrente nele
  entry: null,
};

/** multiplicador do ganho da luz de trás do retrato */
export function portraitLightGain() {
  return portraitLight.level;
}

const ARRIVE_END = ARRIVE.start + ARRIVE.span;
const GLOW_MAX = 0.45;
const GLOW_FADE = 0.045; // trecho de `beam` em que ele se apaga

/** brilho de dentro da cabeça (0..1), pela rolagem */
export function portraitHeadGlow() {
  const b = portraitLight.beam;
  const t = Math.min(1, Math.max(0, (b - ARRIVE_END) / GLOW_FADE));
  const fade = 1 - t * t * (3 - 2 * t);
  return GLOW_MAX * portraitLight.level * fade;
}
