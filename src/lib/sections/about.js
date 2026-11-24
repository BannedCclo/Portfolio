/* ===========================================================
   sections/about.js
   Timeline entries reveal as they arrive. The rail's fill (and its bright
   tip) is driven from lib/binaryFlow.js, which carries the same signal on
   past the end of the line into the projects section.
   =========================================================== */


import { decodeOnce } from "../bioDecode.js";

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

/** Called once from <About>'s mount effect. Returns a cleanup. */
export function initAbout() {
  const section = document.getElementById("sobre");
  if (!section) return () => {};

  const timeline = section.querySelector(".timeline");
  const entries = [...section.querySelectorAll(".tl")];

  // o texto dos itens aparece decodificado de 0s e 1s (lib/bioDecode.js)
  const cancels = [];
  const text = (el) => el.querySelectorAll(".tl__what, .tl__where");
  // já revelados antes (troca de idioma refaz os caracteres): direto em letra
  entries.forEach((el) => {
    if (el.classList.contains("is-revealed")) {
      el.querySelectorAll(".bio__ch").forEach((c) => c.classList.add("is-on"));
    }
  });

  const io = new IntersectionObserver(
    (obs) => {
      for (const entry of obs) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-revealed");
        const t = text(entry.target);
        if (t.length) {
          t.forEach((node) => cancels.push(decodeOnce(node)));
        }
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.4, rootMargin: "0px 0px -6% 0px" },
  );
  entries.forEach((el) => io.observe(el));

  const stop = () => {
    io.disconnect();
    cancels.forEach((c) => c());
  };
  if (!timeline) return stop;

  if (reduceMotion) {
    entries.forEach((el) => el.classList.add("is-revealed"));
    timeline.style.setProperty("--fill", 1);
    entries.forEach((el) => el.querySelectorAll(".bio__ch").forEach((c) => c.classList.add("is-on")));
    return stop;
  }

  /* O preenchimento do trilho e a ponta brilhante são movidos por
     lib/binaryFlow.js: é um sinal só, que corre pela linha e, ao chegar ao
     fim, continua como a corrente de 0s e 1s até os projetos. */
  return stop;
}
