import { useEffect } from "react";
import { initManifesto } from "../lib/sections/manifesto.js";
import { useLanguage } from "../lib/i18n/LanguageContext.jsx";
import "./Manifesto.css";

export default function Manifesto() {
  useEffect(() => initManifesto(), []);
  const { s } = useLanguage();

  return (
    <section id="manifesto" className="manifesto layer">
      <header className="manifesto__head fade-in">
        <span className="block__label" data-index="04">
          {s.manifesto.label}
        </span>
        <h2 className="manifesto__title">{s.manifesto.title}</h2>
      </header>

      {/* O mesmo trilho da trajetória (Sobre): liga o primeiro ponto ao
          último, enche com a rolagem com uma ponta brilhante à frente, e
          cada ponto acende quando o preenchimento chega nele. */}
      <div className="manifesto__track">
        <div className="manifesto__rail" aria-hidden="true">
          <span className="manifesto__pulse" />
        </div>
        <ol className="manifesto__list">
          {s.manifesto.tenets.map((tenet, i) => (
            <li className="tenet" key={i}>
              <span className="tenet__num">{String(i + 1).padStart(2, "0")}</span>
              <p className="tenet__text" data-split-words="">
                {tenet.before}
                <em>{tenet.em}</em>
                {tenet.after}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
