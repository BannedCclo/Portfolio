import { useEffect, useRef, useState } from "react";
import colorUrl from "../../assets/eu/portrait-color.webp";
import manifest from "../../assets/eu/portrait/layers.json";
import headUrl from "../../assets/eu/portrait/head.webp";
import bodyUrl from "../../assets/eu/portrait/body.webp";
import handUrl from "../../assets/eu/portrait/hand.webp";
import depthUrl from "../../assets/eu/portrait/depth.png";
import { hold } from "../../lib/loadGate.js";
import "./DepthPortrait.css";

const urls = { head: headUrl, body: bodyUrl, hand: handUrl, depth: depthUrl };

/**
 * Retrato recortado com volume (camadas cabeça/corpo/mão em paralaxe — ver
 * three/depthPortrait.js). Começa como um <img> comum (o próprio recorte,
 * mesmo enquadramento) e troca para o <canvas> 3D assim que o primeiro quadro
 * existe — sem salto de layout, e com fallback automático: sem WebGL, ou com
 * prefers-reduced-motion, a imagem plana simplesmente fica.
 *
 * O motor (three/depthPortrait.js) é montado logo ao abrir a página, com a
 * tela de loading esperando por ele (lib/loadGate.js): o feixe do cérebro, lá
 * no hero, termina dentro deste retrato, e rolando rápido ele chega aqui em
 * poucos segundos — o retrato precisa já existir. Só anima enquanto está
 * visível.
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
    // segura a tela de loading até o primeiro quadro (ou a desistência)
    const release = hold();

    // o observer só liga e desliga o loop (com folga, antes de aparecer)
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (!engine) return;
        if (visible) engine.start();
        else engine.stop();
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(host);
    // rede de segurança: se o contexto WebGL cair (GPU reiniciada, limite
    // de contextos), volta para a imagem plana em vez de um quadro vazio
    const onLost = (e) => {
      e.preventDefault();
      engine?.stop();
      setIs3d(false);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    boot();

    async function boot() {
      try {
        const { createDepthPortrait } = await import(
          "../../three/depthPortrait.js"
        );
        // desmontado enquanto o import chegava (o StrictMode do React monta,
        // desmonta e monta de novo): não cria nada. Criar e descartar aqui
        // mataria o contexto WebGL do canvas (dispose → forceContextLoss), e
        // a montagem seguinte reusa esse mesmo canvas — o retrato sumia.
        if (disposed) return;
        // o mouse só move a órbita dentro da coluna da bio (retrato + texto)
        const region = host.closest(".about__bio") ?? host;
        const e = await createDepthPortrait({ canvas, host, manifest, urls, region });
        if (disposed) {
          e.dispose();
          return;
        }
        engine = e;
        if (import.meta.env.DEV) window.__depthPortrait = e;
        // um quadro já agora, fora da tela: compila os shaders e publica o
        // ponto de entrada do feixe antes de a página ficar disponível
        e.render();
        setIs3d(true);
        if (visible) e.start();
      } catch (err) {
        // sem WebGL ou falha de carga: a imagem plana já está lá
        console.warn("DepthPortrait: ficando na imagem plana —", err);
      } finally {
        release();
      }
    }

    return () => {
      disposed = true;
      release();
      canvas.removeEventListener("webglcontextlost", onLost);
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
