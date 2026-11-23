import { useEffect, useState } from "react";
import { onStageReady } from "../three/stage.js";
import { onGateOpen } from "../lib/loadGate.js";
import { useLanguage } from "../lib/i18n/LanguageContext.jsx";
import logoIcon from "../assets/logo/dark/icon-bold.svg";
import "./LoadingScreen.css";

/**
 * Covers the page from first paint until the brain's model has loaded and
 * warmed up (see onStageReady in three/stage.js) — otherwise the hero sits
 * empty/incomplete for the few seconds that takes — and until whatever else
 * asked to hold it is ready too (lib/loadGate.js: o retrato com volume, onde
 * o feixe do cérebro chega; sem ele pronto, rolar rápido logo ao abrir faz o
 * feixe chegar a um retrato que ainda não existe). Fades out once the stage
 * reports ready, then unmounts; identical in both motion modes, since the
 * few-second load happens either way and reduced motion only governs the
 * page's own choreography, not the asset fetch.
 */
export default function LoadingScreen() {
  const [ready, setReady] = useState(false);
  const [mounted, setMounted] = useState(true);
  const { s } = useLanguage();

  useEffect(() => {
    let closeGate = null;
    let disposed = false;
    onStageReady(() => {
      if (!disposed) closeGate = onGateOpen(() => setReady(true));
    });
    return () => {
      disposed = true;
      closeGate?.();
    };
  }, []);

  if (!mounted) return null;

  return (
    <div
      className={`loading-screen${ready ? " is-ready" : ""}`}
      aria-hidden="true"
      onTransitionEnd={(e) => {
        if (ready && e.propertyName === "opacity") setMounted(false);
      }}
    >
      <img
        className="loading-screen__mark"
        src={logoIcon}
        alt=""
        width="200"
        height="200"
      />
      <p className="loading-screen__label">{s.loading.label}</p>
      <div className="loading-screen__bar">
        <i />
      </div>
    </div>
  );
}
