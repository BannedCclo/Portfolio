/* ===========================================================
   sections/manifesto.js
   Line-staggered text reveals plus the rail — o mesmo da trajetória
   (lib/binaryFlow.js + About.css): liga o primeiro ponto ao último, o
   preenchimento persegue a rolagem via damp() (mesma taxa) e cada ponto
   acende quando a ponta chega nele.
   =========================================================== */

import { clamp01, damp, isNear } from "../motion.js";
import { onTick } from "../ticker.js";
import { splitWords, relineWords } from "../split.js";

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

/** Called once from <Manifesto>'s mount effect. Returns a cleanup. */
export function initManifesto() {
  const section = document.getElementById("manifesto");
  if (!section) return () => {};

  const track = section.querySelector(".manifesto__track");
  const rail = section.querySelector(".manifesto__rail");
  const nums = [...section.querySelectorAll(".tenet__num")];
  const texts = [...section.querySelectorAll("[data-split-words]")];
  const tenets = [...section.querySelectorAll(".tenet")];

  // offsetTop grouping is only meaningful once the real fonts are in place
  document.fonts.ready.then(() => {
    texts.forEach(splitWords);
  });

  /* Onde o fio começa e termina: do centro do primeiro ponto ao do último.
     O ponto (Manifesto.css, .tenet__num::before) fica a 1.1em do topo do
     número, com 7px de lado. O .tenet é posicionado (fica acima do fio),
     então o offsetTop do número é relativo a ele, e o do .tenet ao
     .manifesto__track — somando os dois, a posição no trilho. */
  let centers = [];
  const measure = () => {
    centers = nums.map(
      (n) =>
        n.parentElement.offsetTop +
        n.offsetTop +
        parseFloat(getComputedStyle(n).fontSize) * 1.1 +
        3.5,
    );
    if (centers.length < 2) return;
    track.style.setProperty("--rail-top", `${centers[0]}px`);
    track.style.setProperty("--rail-h", `${centers.at(-1) - centers[0]}px`);
  };
  measure();
  document.fonts.ready.then(measure);

  let resizeTimer;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      texts.forEach(relineWords);
      measure();
    }, 180);
  };
  addEventListener("resize", onResize);

  // each tenet reveals on its own as it comes up
  const revealer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        // o texto é escrito assim que o item entra na tela, sem esperar o
        // ponto do trilho acender (que persegue a rolagem com atraso)
        entry.target.classList.add("is-revealed", "is-written");
        revealer.unobserve(entry.target);
      }
    },
    { threshold: 0.35, rootMargin: "0px 0px -8% 0px" },
  );
  tenets.forEach((el) => revealer.observe(el));

  if (reduceMotion) {
    tenets.forEach((el) => el.classList.add("is-revealed"));
    rail?.style.setProperty("--fill", 1);
    tenets.forEach((el) => el.classList.add("is-lit", "is-written"));
    return () => {
      clearTimeout(resizeTimer);
      removeEventListener("resize", onResize);
      revealer.disconnect();
    };
  }

  /* o trilho, com as mesmas regras do da trajetória (binaryFlow.js):
     0 quando o topo do fio passa de 60% da tela, 1 quando o pé passa (ou
     quando a página acaba, o que vier antes); o
     valor desenhado persegue esse alvo com damp(…, 4.5). A ponta brilha
     enquanto corre e se apaga ao chegar ao fim. */
  let fill = 0;
  const unsubscribeTick = onTick((dt) => {
    if (!isNear(section, 0.4)) return;
    const r = rail.getBoundingClientRect();
    if (!r.height) return;
    // Metas é a penúltima seção: a página pode acabar antes de o pé do fio
    // chegar aos 60% da tela. Nesse caso o fim do fio passa a ser o fim da
    // rolagem — o percurso encurta para caber no que ainda dá para rolar.
    const line = window.innerHeight * 0.6;
    const maxY = document.documentElement.scrollHeight - window.innerHeight;
    const topAtEnd = r.top - (maxY - window.scrollY);
    const span = Math.max(1, Math.min(r.height, line - topAtEnd));
    const target = clamp01((line - r.top) / span);
    fill = damp(fill, target, dt, 4.5);
    if (Math.abs(fill - target) < 1e-4) fill = target;
    rail.style.setProperty("--fill", fill.toFixed(4));
    rail.style.setProperty("--pulse-alpha", fill > 0.004 && fill < 0.999 ? 1 : 0);
    // cada ponto acende quando a ponta do preenchimento chega no centro dele
    const tipY = centers[0] + fill * r.height;
    tenets.forEach((el, i) => {
      const lit = fill > 0 && tipY >= centers[i] - 0.5;
      if (lit !== el.classList.contains("is-lit")) el.classList.toggle("is-lit", lit);
    });
  });

  return () => {
    clearTimeout(resizeTimer);
    removeEventListener("resize", onResize);
    revealer.disconnect();
    unsubscribeTick();
  };
}
