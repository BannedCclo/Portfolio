/* ===========================================================
   bioDecode.js — a bio se decodifica de 0s e 1s em texto, pela rolagem

   O feixe do cérebro entra na cabeça do retrato; logo abaixo, o que ele
   "pensa" aparece: o texto começa todo em dígitos dourados apagados e, conforme
   a rolagem desce, uma frente percorre o texto na ordem de leitura. Na frente,
   os dígitos acendem e trocam rápido (decodificando); atrás dela, viram as
   letras. Rolando para cima, o texto volta a ser dígito.

   Regras de lib/motion.js: a rolagem define o ALVO, damp() persegue — não
   tem duração própria, para quando a rolagem para.

   Estados por caractere (.bio__ch, About.css):
     sem classe → dígito apagado    .is-hot → dígito aceso, trocando
     .is-on     → a letra
   =========================================================== */

import { clamp01, damp, isNear } from "./motion.js";
import { onTick } from "./ticker.js";

// largura da frente de decodificação, em caracteres
const FRONT = 16;
// a cada quantos ms os dígitos acesos trocam
const FLIP_MS = 70;
// a decodificação começa assim que o topo do texto entra na tela e termina
// com o pé dele a 82% da altura — o texto já está pronto quando chega à
// área de leitura, bem antes da linha do tempo e dos cards
const START_AT = 1;
const END_AT = 0.82;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** @param {HTMLElement} root o .about__text */
export function initBioDecode(root) {
  const chars = [...root.querySelectorAll(".bio__ch")];
  if (!chars.length) return () => {};

  if (reduceMotion) {
    chars.forEach((c) => c.classList.add("is-on"));
    return () => {};
  }

  // dígitos iniciais sorteados (o React põe um padrão alternado só para o
  // primeiro quadro não ficar vazio)
  chars.forEach((c) => (c.dataset.d = Math.random() < 0.5 ? "0" : "1"));

  const n = chars.length;
  const state = new Uint8Array(n); // 0 apagado, 1 aceso, 2 letra
  let cur = 0;
  let snapped = false;
  let flipAcc = 0;

  function target() {
    const r = root.getBoundingClientRect();
    const h = window.innerHeight;
    // 0 com o topo em START_AT·h; 1 com o pé em END_AT·h
    return clamp01((h * START_AT - r.top) / (h * (START_AT - END_AT) + r.height));
  }

  const unsubscribe = onTick((dt) => {
    if (!isNear(root, 0.5)) return;
    const t = target();
    // primeiro quadro: já no lugar (página aberta no meio, recarga)
    cur = snapped ? damp(cur, t, dt, 7) : t;
    snapped = true;

    const front = cur * (n + FRONT);
    flipAcc += dt * 1000;
    const flip = flipAcc >= FLIP_MS;
    if (flip) flipAcc = 0;

    for (let i = 0; i < n; i++) {
      const s = i < front - FRONT ? 2 : i < front ? 1 : 0;
      if (s !== state[i]) {
        const c = chars[i];
        c.classList.toggle("is-on", s === 2);
        c.classList.toggle("is-hot", s === 1);
        state[i] = s;
      }
      if (s === 1 && flip && Math.random() < 0.6) {
        chars[i].dataset.d = Math.random() < 0.5 ? "0" : "1";
      }
    }
  });

  return () => {
    unsubscribe();
    chars.forEach((c) => c.classList.remove("is-on", "is-hot"));
  };
}
