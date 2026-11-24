/* ===========================================================
   sections/stack.js
   Revela cada coluna como a saída de um terminal quando ela entra na tela
   (marca .is-revealed e o --t0 de cada uma), e (com mouse e motion
   permitido) carrega lib/stackLogos.js: no hover, o logo da ferramenta se
   forma em 0s e 1s. --n e --j vêm prontos do JSX (Stack.jsx).
   =========================================================== */

// entrada estilo terminal: pausa antes de digitar, tempo por caractere e
// intervalo entre as linhas da "saída" (ver Stack.css)
const PAUSE = 120;
const TYPE = 34;
const LINE = 85;

/** Called once from <Stack>'s mount effect. Returns a cleanup. */
export function initStack() {
  const section = document.getElementById("stack");
  if (!section) return () => {};

  // ritmo do "terminal" — única fonte desses tempos; o Stack.css lê os vars
  section.style.setProperty("--pause", `${PAUSE}ms`);
  section.style.setProperty("--type", `${TYPE}ms`);
  section.style.setProperty("--line", `${LINE}ms`);

  // Cada coluna é observada sozinha: no desktop as quatro entram juntas e
  // viram uma fila (a próxima começa a digitar quando a anterior termina de
  // digitar, enquanto a saída dela ainda escorre); no celular, de uma coluna
  // só, cada grupo começa do zero quando chega na tela, em vez de ter rodado
  // lá embaixo sem ninguém ver.
  const groups = [...section.querySelectorAll(".stack__group")];
  const io = new IntersectionObserver(
    (entries) => {
      const shown = entries
        .filter((e) => e.isIntersecting)
        .map((e) => e.target)
        .sort((a, b) => groups.indexOf(a) - groups.indexOf(b));
      let t0 = 0;
      for (const group of shown) {
        group.style.setProperty("--t0", `${t0}ms`);
        group.classList.add("is-revealed");
        io.unobserve(group);
        const n = Number(group.style.getPropertyValue("--n")) || 0;
        t0 += PAUSE + n * TYPE;
      }
    },
    { threshold: 0.35 },
  );
  groups.forEach((g) => io.observe(g));

  // logos em dígitos: no hover com mouse, no toque sem ele (stackLogos.js);
  // nunca com reduced motion. O módulo (e os ícones) só carrega quando a
  // seção chega perto
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    return () => {
      io.disconnect();
    };
  }

  let disposed = false;
  let disposeLogos = null;
  const near = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      near.disconnect();
      import("../stackLogos.js")
        .then(({ initStackLogos }) => {
          if (!disposed) disposeLogos = initStackLogos(section, { hover: canHover });
        })
        .catch((err) => console.warn("Logos das ferramentas indisponíveis:", err));
    },
    { rootMargin: "100% 0px" },
  );
  near.observe(section);

  return () => {
    disposed = true;
    io.disconnect();
    near.disconnect();
    disposeLogos?.();
  };
}
