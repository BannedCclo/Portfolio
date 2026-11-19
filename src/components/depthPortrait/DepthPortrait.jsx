import { useEffect, useRef, useState } from "react";
import colorUrl from "../../assets/eu/portrait-color.webp";
import manifest from "../../assets/eu/portrait/layers.json";
import headUrl from "../../assets/eu/portrait/head.webp";
import bodyUrl from "../../assets/eu/portrait/body.webp";
import handUrl from "../../assets/eu/portrait/hand.webp";
import depthUrl from "../../assets/eu/portrait/depth.png";
import "./DepthPortrait.css";

const urls = { head: headUrl, body: bodyUrl, hand: handUrl, depth: depthUrl };

/**
 * Retrato recortado com volume (camadas cabeça/corpo/mão em paralaxe — ver
 * three/depthPortrait.js). Começa como um <img> comum (o próprio recorte,
 * mesmo enquadramento) e troca para o <canvas> 3D assim que o primeiro quadro
 * existe — sem salto de layout, e com fallback automático: sem WebGL, ou com
 * prefers-reduced-motion, a imagem plana simplesmente fica.
 *
 * O motor (three/depthPortrait.js) é importado sob demanda, quando o retrato
 * chega perto da tela, e só anima enquanto ele está visível.
 */
export default function DepthPortrait({ alt }) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const [is3d, setIs3d] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let disposed = false;
    let engine = null;
    let visible = false;

    // um observer para carregar (com folga) e o mesmo para pausar o loop
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !engine) boot();
        if (!engine) return;
        if (visible) engine.start();
        else engine.stop();
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(host);

    let booting = false;
    async function boot() {
      if (booting) return;
      booting = true;
      try {
        const { createDepthPortrait } = await import(
          "../../three/depthPortrait.js"
        );
        // o mouse só move a órbita dentro da coluna da bio (retrato + texto)
        const region = host.closest(".about__bio") ?? host;
        const e = await createDepthPortrait({ canvas, host, manifest, urls, region });
        if (disposed) {
          e.dispose();
          return;
        }
        engine = e;
        if (import.meta.env.DEV) window.__depthPortrait = e;
        setIs3d(true);
        if (visible) e.start();
      } catch (err) {
        // sem WebGL ou falha de carga: a imagem plana já está lá
        console.warn("DepthPortrait: ficando na imagem plana —", err);
      }
    }

    return () => {
      disposed = true;
      io.disconnect();
      engine?.dispose();
      engine = null;
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`depth-portrait${is3d ? " is-3d" : ""}`}
    >
      <img className="depth-portrait__flat" src={colorUrl} alt={alt} />
      <canvas
        ref={canvasRef}
        className="depth-portrait__canvas"
        aria-hidden="true"
      />
    </div>
  );
}
