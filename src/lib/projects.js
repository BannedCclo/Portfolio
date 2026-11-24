import carbonShot from "../assets/projects/carbon.webp";
import f1statsShot from "../assets/projects/f1stats.webp";
import noharmShot from "../assets/projects/noharm.webp";
import physixShot from "../assets/projects/physix.webp";

// Projetos reais, compartilhados entre a seção Experiência (Work.jsx) e o
// botão de projeto aleatório do footer — uma única fonte de verdade para não
// os dois lugares desincronizarem quando um projeto for adicionado.
// name/outcome/stack são objetos {pt, en} — Work.jsx e RandomProjectButton
// escolhem o idioma certo em runtime via useLanguage().
export const PROJECTS = [
  {
    seed: "noharm",
    index: "01",
    year: "2023",
    name: {
      pt: "NoHarm.ai — IA para farmácia clínica",
      en: "NoHarm.ai — AI for clinical pharmacy",
    },
    outcome: {
      pt: "Atuei como dev de testes unitários em Python no sistema de IA que ajuda farmacêuticos clínicos a identificar erros de prescrição em hospitais.",
      en: "I worked as a Python unit test developer on the AI system that helps clinical pharmacists identify prescription errors in hospitals.",
    },
    stack: {
      pt: ["Python", "Testes automatizados"],
      en: ["Python", "Automated testing"],
    },
    href: "https://noharm.ai",
    github: "https://github.com/noharm-ai/backend",
    shot: noharmShot,
  },
  {
    seed: "carbon",
    index: "02",
    year: "2025–2026",
    name: {
      pt: "Carbon — plataforma de concessionária",
      en: "Carbon — dealership platform",
    },
    outcome: {
      pt: "Site completo para uma concessionária: cadastro e busca de veículos com fotos, autenticação de usuários e preenchimento automático de endereço por CEP. Client e API publicados em produção.",
      en: "Full website for a car dealership: vehicle registration and search with photos, user authentication, and automatic address lookup by zip code. Client and API deployed to production.",
    },
    stack: {
      pt: ["React", "TypeScript", "Node.js", "Sequelize", "Postgres"],
      en: ["React", "TypeScript", "Node.js", "Sequelize", "Postgres"],
    },
    href: "https://carbonluxury.vercel.app",
    github: "https://github.com/BannedCclo/Carbon",
    shot: carbonShot,
  },
  {
    seed: "f1stats",
    index: "03",
    year: "2026",
    name: {
      pt: "F1stats — estatísticas de Fórmula 1",
      en: "F1stats — Formula 1 statistics",
    },
    outcome: {
      pt: "Todo o histórico da Fórmula 1 migrado para Postgres, com sincronização diária automatizada via GitHub Actions e API serverless — corridas, pilotos e classificações sempre atualizados sem intervenção manual.",
      en: "The entire Formula 1 history migrated to Postgres, with automated daily syncing via GitHub Actions and a serverless API — races, drivers, and standings always up to date with no manual intervention.",
    },
    stack: {
      pt: ["React", "TypeScript", "Express", "Drizzle ORM", "Postgres"],
      en: ["React", "TypeScript", "Express", "Drizzle ORM", "Postgres"],
    },
    href: "https://f1stats-client.vercel.app",
    github: "https://github.com/BannedCclo/F1stats",
    shot: f1statsShot,
  },
  {
    seed: "physix",
    index: "04",
    year: "2024",
    name: {
      pt: "PhysiX — rede social para aulas de física",
      en: "PhysiX — social network for physics classes",
    },
    outcome: {
      pt: "Projeto final de curso técnico: plataforma social que conecta professores e alunos de física, com compartilhamento de material, curtidas, comentários e agendamento de aulas particulares entre aluno e professor.",
      en: "Final project of a technical course: a social platform connecting physics teachers and students, with material sharing, likes, comments, and private lesson scheduling between student and teacher.",
    },
    stack: {
      pt: ["React", "TypeScript", "Node.js", "Express", "Knex", "SQLite"],
      en: ["React", "TypeScript", "Node.js", "Express", "Knex", "SQLite"],
    },
    href: "https://github.com/ArthurAnicio/PhysiX",
    github: "https://github.com/ArthurAnicio/PhysiX",
    shot: physixShot,
  },
];
