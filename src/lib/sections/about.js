/* ===========================================================
   sections/about.js
   Timeline entries reveal as they arrive. The rail's fill (and its bright
   tip) is driven from lib/binaryFlow.js, which carries the same signal on
   past the end of the line into the projects section.
   =========================================================== */


const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

/** Called once from <About>'s mount effect. Returns a cleanup. */
export function initAbout() {
  const section = document.getElementById("sobre");
  if (!section) return () => {};

  const timeline = section.querySelector(".timeline");
  const entries = [...section.querySelectorAll(".tl")];

  const io = new IntersectionObserver(
    (obs) => {
      for (const entry of obs) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-revealed");
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.4, rootMargin: "0px 0px -6% 0px" },
  );
  entries.forEach((el) => io.observe(el));

  if (!timeline) return () => io.disconnect();

  if (reduceMotion) {
    entries.forEach((el) => el.classList.add("is-revealed"));
    timeline.style.setProperty("--fill", 1);
    return () => io.disconnect();
  }

  /* O preenchimento do trilho e a ponta brilhante são movidos por
     lib/binaryFlow.js: é um sinal só, que corre pela linha e, ao chegar ao
     fim, continua como a corrente de 0s e 1s até os projetos. */
  return () => io.disconnect();
}
