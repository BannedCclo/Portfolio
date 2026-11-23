import { useEffect } from "react";
import { initWork } from "../lib/sections/work.js";
import { PROJECTS } from "../lib/projects.js";
import { useLanguage } from "../lib/i18n/LanguageContext.jsx";
import ProjectArt from "../components/ProjectArt.jsx";
import "./Work.css";

const ArrowIcon = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
    <path
      d="M3 11L11 3M11 3H4M11 3V10"
      stroke="currentColor"
      strokeWidth="1.4"
    />
  </svg>
);

const GithubIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);

export default function Work() {
  useEffect(() => initWork(), []);
  const { lang, s } = useLanguage();

  return (
    <section id="trabalho" className="work layer">
      <div className="work__pin">
        <header className="work__head fade-in">
          <span className="block__label" data-index="02">
            {s.work.label}
          </span>
          <h2 className="work__title">{s.work.title}</h2>
        </header>

        <div className="work__track">
          {PROJECTS.map((p) => (
            <article className="proj" key={p.seed} data-seed={p.seed}>
              <div className="proj__visual">
                {p.shot ? (
                  <img src={p.shot} alt="" loading="lazy" />
                ) : (
                  <ProjectArt seed={p.seed} />
                )}
                {p.github && (
                  <a
                    className="proj__github"
                    href={p.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.work.githubAria(p.name[lang])}
                  >
                    <GithubIcon />
                  </a>
                )}
              </div>
              <div className="proj__body">
                <div className="proj__meta">
                  <span className="proj__index">{p.index}</span>
                  <span>{p.year}</span>
                </div>
                <h3 className="proj__name">
                  <a
                    className="proj__link"
                    href={p.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {p.name[lang]}
                  </a>
                </h3>
                <p className="proj__outcome">{p.outcome[lang]}</p>
                <div className="proj__stack">
                  {p.stack[lang].map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <span className="proj__more" aria-hidden="true">
                  {s.work.viewProject}
                  <ArrowIcon />
                </span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
