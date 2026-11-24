import { useEffect, useRef } from "react";
import { clamp01 } from "../lib/motion.js";

/**
 * O único indicador de rolagem da página: uma linha dourada no topo da tela
 * que enche da esquerda para a direita conforme o documento inteiro rola —
 * inclusive durante o pin do cérebro e o da galeria, que já não têm
 * medidores próprios. A barra nativa fica escondida (styles/base.css).
 */
export default function ScrollProgress() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    // a altura rolável é medida só quando muda (resize, o documento crescer
    // ou encolher — os espaçadores dos pins do GSAP inclusive), não a cada
    // evento de rolagem: ler scrollHeight ali forçava um layout sempre que
    // algo tinha mexido no DOM desde o último quadro
    let max = 0;
    let last = "";
    const measure = () => {
      max = document.documentElement.scrollHeight - window.innerHeight;
    };
    const onScroll = () => {
      const v = String(max > 0 ? clamp01(scrollY / max) : 0);
      if (v === last) return;
      last = v;
      el.style.setProperty("--read", v);
    };
    const onResize = () => {
      measure();
      onScroll();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(document.body);
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onResize);
    onResize();
    return () => {
      ro.disconnect();
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div className="scroll-progress" ref={ref} aria-hidden="true">
      <i />
    </div>
  );
}
