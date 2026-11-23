import { useEffect } from "react";
import { initHero } from "../three/acts/hero.js";
import { useLanguage } from "../lib/i18n/LanguageContext.jsx";
import "./Hero.css";

/**
 * The pinned brain sequence. Almost all of the actual behaviour — scroll
 * phases, camera choreography, the synapse shader — lives in
 * src/three/acts/hero.js; this component just renders the overlay chrome
 * that takes turns in front of the shared 3D canvas and wires that module up
 * on mount.
 */
export default function Hero() {
  useEffect(() => initHero(), []);
  const { s } = useLanguage();
  const { hero } = s;

  return (
    <section id="brain" className="layer">
      <div className="brain-title-screen" id="brainTitleScreen">
        <p className="brain-title-screen__eyebrow">{hero.eyebrow}</p>
        <h1 className="brain-title-screen__name">Marcelo Guimarães</h1>
      </div>

      <div className="brain-hint" id="brainHint">
        <span>{hero.hint}</span>
        <span className="brain-hint__bar" />
      </div>

      <div className="brain-page" id="brainPage0">
        <p className="brain-eyebrow">{hero.page0.eyebrow}</p>
        <h2 className="brain-title">
          {hero.page0.titleBefore}
          <em>{hero.page0.em1}</em>
          {hero.page0.titleMid}
          <em>{hero.page0.em2}</em>
          {hero.page0.titleAfter}
        </h2>
        <div className="brain-row">
          <p className="brain-sub">{hero.page0.sub}</p>
          <a className="brain-cta" href="#trabalho">
            {hero.page0.cta}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3 3L11 11M11 11V4M11 11H4"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          </a>
        </div>
      </div>

      <div className="brain-page" id="brainPage1">
        <p className="brain-eyebrow">{hero.page1.eyebrow}</p>
        <h2 className="brain-page-title">{hero.page1.title}</h2>
      </div>

      <div className="brain-page brain-page--right" id="brainPage2">
        <p className="brain-eyebrow">{hero.page2.eyebrow}</p>
        <h2 className="brain-page-title">{hero.page2.title}</h2>
      </div>
    </section>
  );
}
