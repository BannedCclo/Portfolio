import { useEffect } from "react";
import { initStack } from "../lib/sections/stack.js";
import { useLanguage } from "../lib/i18n/LanguageContext.jsx";
import "./Stack.css";

// CONTEÚDO PLACEHOLDER — ajustar para as ferramentas que você realmente usa.
// `groupKey` aponta pra s.stack.groups no dicionário de idiomas — os nomes
// das ferramentas em si (items) não mudam entre pt/en.
const STACK_GROUPS = [
  {
    groupKey: "languages",
    items: ["C/C++", "Java", "Python", "JavaScript", "TypeScript"],
  },
  {
    groupKey: "frameworks",
    items: ["React", "Express", "Django", "Spring"],
  },
  { groupKey: "databases", items: ["PostgreSQL", "MySQL", "SQLite"] },
  { groupKey: "other", items: ["GitHub", "Figma", "Claude Code", "Vercel"] },
];

// Entrada estilo terminal (Stack.css + lib/sections/stack.js): cada coluna
// "digita" o nome da categoria depois de um `$`, e os itens saem uma linha
// por vez, secos, como a saída de um comando. O JSX só informa o tamanho do
// nome (--n, para o passo da digitação) e a linha de cada item (--j); quando
// cada coluna começa (--t0) quem decide é o stack.js, na hora em que ela
// aparece na tela.

export default function Stack() {
  useEffect(() => initStack(), []);
  const { s } = useLanguage();

  return (
    <section id="stack" className="stack block layer">
      <div className="block__head fade-in">
        <span className="block__label" data-index="03">
          {s.stack.label}
        </span>
        <div>
          <h2 className="block__title">{s.stack.title}</h2>
        </div>
      </div>

      <div className="stack__grid">
        {STACK_GROUPS.map((g) => {
          const name = s.stack.groups[g.groupKey];
          return (
            <div
              className="stack__group"
              key={g.groupKey}
              style={{ "--n": name.length, "--rows": g.items.length }}
            >
              <h3>
                <span className="stack__prompt" aria-hidden="true">
                  ${" "}
                </span>
                <span className="stack__cmd">{name}</span>
                <span className="stack__cursor" aria-hidden="true" />
              </h3>
              <ul>
                {g.items.map((item, j) => (
                  <li key={item} style={{ "--j": j, cursor: "default" }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
