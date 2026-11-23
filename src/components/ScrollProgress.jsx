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
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      el.style.setProperty("--read", max > 0 ? clamp01(scrollY / max) : 0);
    };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    onScroll();
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className="scroll-progress" ref={ref} aria-hidden="true">
      <i />
    </div>
  );
}
