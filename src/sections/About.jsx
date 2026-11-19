import { useEffect } from "react";
import { initAbout } from "../lib/sections/about.js";
import { useLanguage } from "../lib/i18n/LanguageContext.jsx";
import DepthPortrait from "../components/depthPortrait/DepthPortrait.jsx";
import "./About.css";

// Link institucional de cada marco — usado por renderWhere para destacar o
// nome da instituição em dourado (--gold) e linkar para o site oficial.
// Chaveado por id estável (não pelo texto exibido), já que o texto muda
// conforme o idioma mas o link, não.
const INSTITUTION_LINKS = {
  buddys: "https://buddys-programadores-do-futuro.webflow.io/",
  uspOnline: "https://www.coursera.org/learn/ciencia-computacao-python-conceitos/",
  cotemig: "https://www.cotemig.com.br/",
  noharm: "https://noharm.ai/",
  pucmg: "https://www.pucminas.br/",
};

// CONTEÚDO PLACEHOLDER — substituir a trajetória por dados reais.
// `where` mistura texto simples com `{ id, text }` (id aponta pra
// INSTITUTION_LINKS, text é o nome exibido nesse idioma).
const TIMELINE = [
  {
    when: "2015",
    what: { pt: "Introdução", en: "Introduction" },
    where: {
      pt: [
        "Aos 8 anos, desenvolvi meu primeiro interesse pela área e comecei a aprender na escola ",
        { id: "buddys", text: "Buddys" },
        ".",
      ],
      en: [
        "At age 8, I developed my first interest in the field and started learning at ",
        { id: "buddys", text: "Buddys" },
        " school.",
      ],
    },
  },
  {
    when: "2021",
    what: { pt: "Estudos autônomos", en: "Autonomous studies" },
    where: {
      pt: [
        "Na quarentena, retomei meus estudos na área com um ",
        { id: "uspOnline", text: "curso online" },
        " da USP, de Python.",
      ],
      en: [
        "During quarantine, I resumed my studies in the field with an ",
        { id: "uspOnline", text: "online course" },
        " from USP, in Python.",
      ],
    },
  },
  {
    when: "2023",
    what: { pt: "Curso técnico", en: "Technical course" },
    where: {
      pt: [
        "Tomei um passo maior e concluí meu ensino médio no curso técnico em informática ",
        { id: "cotemig", text: "COTEMIG" },
        ".",
      ],
      en: [
        "I took a bigger step and finished high school in the technical IT program at ",
        { id: "cotemig", text: "COTEMIG" },
        ".",
      ],
    },
  },
  {
    when: "2023",
    what: { pt: "Estágio", en: "Internship" },
    where: {
      pt: [
        "Na ",
        { id: "noharm", text: "NoHarm" },
        ", estagiei como desenvolvedor de testes unitários Python.",
      ],
      en: [
        "At ",
        { id: "noharm", text: "NoHarm" },
        ", I interned as a Python unit test developer.",
      ],
    },
  },
  {
    when: "2025",
    what: { pt: "Universidade", en: "University" },
    where: {
      pt: [
        "Buscando ampliar minhas capacidades, ingressei na ",
        { id: "pucmg", text: "PUC-MG" },
        ", para Engenharia de Software.",
      ],
      en: [
        "Looking to expand my skills, I enrolled at ",
        { id: "pucmg", text: "PUC-MG" },
        " for Software Engineering.",
      ],
    },
  },
  {
    when: "2026",
    what: { pt: "Trabalho", en: "Work" },
    where: {
      // sem URL confirmada da ADPM ainda — renderWhere cai no <span>
      // destacado em vez de link; acrescentar `adpm` em INSTITUTION_LINKS
      // quando houver o endereço oficial
      pt: [
        "Entrei para trabalhar na ",
        { id: "adpm", text: "ADPM" },
        " (Administração Pública para Municípios).",
      ],
      en: [
        "I started working at ",
        { id: "adpm", text: "ADPM" },
        " (Public Administration for Municipalities).",
      ],
    },
  },
];

// Marcos com trecho institucional destacam a instituição em `<mark>` — link
// quando há URL confirmada, span quando ainda não há. Partes simples (string)
// passam direto.
function renderWhere(parts) {
  return parts.map((part, i) => {
    if (typeof part === "string") return <span key={i}>{part}</span>;
    const href = INSTITUTION_LINKS[part.id];
    return href ? (
      <a
        key={i}
        className="tl__institution"
        href={href}
        target="_blank"
        rel="noreferrer"
      >
        {part.text}
      </a>
    ) : (
      <span key={i} className="tl__institution">
        {part.text}
      </span>
    );
  });
}

export default function About() {
  useEffect(() => initAbout(), []);
  const { lang, s } = useLanguage();

  return (
    <section id="sobre" className="block layer">
      <div className="block__head fade-in">
        <span className="block__label" data-index="01">
          {s.about.label}
        </span>
        <div>
          <h2 className="block__title">{s.about.title}</h2>
        </div>
      </div>

      <div className="about__grid">
        {/* CONTEÚDO PLACEHOLDER — bio em primeira pessoa. */}
        <div className="about__bio fade-in">
          <div className="about__portrait about__portrait--depth">
            <DepthPortrait alt={s.about.portraitAlt} />
          </div>
          <div className="about__text">
            {s.about.bio.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>

        <ol className="timeline">
          {TIMELINE.map((t, i) => (
            <li className="tl" key={i}>
              <p className="tl__when">{t.when}</p>
              <h3 className="tl__what">{t.what[lang]}</h3>
              <p className="tl__where">{renderWhere(t.where[lang])}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
