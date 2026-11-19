import { useEffect, useLayoutEffect, useRef } from "react";
import styles from "./animatedLogo.module.css";

/*
 * Logo da marca, desenhado traço a traço. Cópia do componente que vive em
 * Assets/Logo/preview/src/animatedLogo/ — a coreografia (ordem, sentido, ritmo
 * e easing de cada traço) é a mesma; o que muda aqui é só a origem do markup:
 * lá o preview importa as 8 variantes, este site carrega apenas a que usa.
 *
 * O SVG é lido como texto (`?raw`) do próprio asset em vez de inline no
 * componente: os textos são um path só cada um, com milhares de comandos, e
 * inline virariam uma segunda cópia para esquecer de atualizar quando o Figma
 * for reexportado.
 */
import horizontalDark from "../../assets/logo/dark/horizontal.svg?raw";
import horizontalDarkEn from "../../assets/logo/dark/horizontal-en.svg?raw";

/*
 * Só a variante que este site usa. O footer fica sobre --bg (quase preto), daí
 * `dark/` — que na convenção do asset é a cor do *traço*, não do fundo. Para
 * usar outra, copie o SVG de Assets/Logo/ para src/assets/logo/ e acrescente a
 * entrada aqui; o resto do componente não sabe qual variante está animando.
 * `en` existe porque o cargo ("Engenheiro de Software") muda com o idioma do
 * site — o nome não muda, então não há versão `-en` do `icon` sozinho.
 */
const MARKUP = {
  dark: {
    horizontal: { pt: horizontalDark, en: horizontalDarkEn },
  },
};

export type LogoVariant = keyof typeof MARKUP;
export type LogoShape = keyof (typeof MARKUP)["dark"];
export type LogoLang = keyof (typeof MARKUP)["dark"]["horizontal"];

// Laranja do cursor. É a única cor fora do traço principal, e é por ela que o
// cursor é reconhecido dentro do SVG.
const CURSOR_COLOR = "#C9AD72";

/*
 * O contorno do ícone leva sempre isto, seja qual for a variante. Nos logos
 * compostos o ícone vem menor, e se a velocidade da caneta fosse fixa ele seria
 * desenhado mais rápido no `horizontal` do que no `icon` — a marca não pode
 * mudar de ritmo conforme o tamanho. A duração de cada traço é rateada dentro
 * desse total, proporcional ao comprimento medido.
 */
const OUTLINE_DURATION = 1.28;

const CURSOR_PAUSE = 0.08;
const CURSOR_IN_DURATION = 0.26;
const CURSOR_BLINK_PERIOD = 1.06;

// Nos logos compostos a linha entra junto com o fecho do ícone: o cursor
// aparece enquanto ela cresce, cada um num canto diferente do desenho.
const LINE_OVERLAP = 0.08;
const LINE_DURATION = 0.55;
const TEXT_PAUSE = 0.06;
const TEXT_DURATION = 0.5;

type OutlineRole = "letter" | "diagonal" | "arc" | "bar";

/*
 * Ordem, sentido e ritmo dos quatro traços do contorno.
 *
 * A sequência evita que a caneta salte de um canto a outro: o M passa pelo
 * vértice central de onde a diagonal sobe, a diagonal chega ao topo onde o arco
 * começa, e o arco fecha exatamente de onde parte a barra do G.
 *
 * `speed` e `ease` são o que tira a uniformidade do desenho: em vez de uma
 * caneta que corre sempre igual, cada traço tem o ritmo que uma mão daria a
 * ele, e dentro do traço a velocidade também varia.
 *
 * `reverse` inverte o sentido em relação ao `d`: o arco é declarado da direita
 * para o topo, mas precisa ser desenhado ao contrário para emendar na diagonal.
 */
const CHOREOGRAPHY: {
  role: OutlineRole;
  reverse: boolean;
  speed: number;
  ease: string;
  gapAfter: number;
}[] = [
  {
    role: "letter",
    reverse: false,
    // A letra tem quatro mudanças de direção: sai um pouco mais devagar que o
    // resto, com arranque e chegada macios.
    speed: 0.92,
    ease: "cubic-bezier(0.35, 0.05, 0.25, 1)",
    // Única emenda em que a caneta sai mesmo do papel — do pé direito do M ela
    // precisa voltar ao vértice central.
    gapAfter: 0.07,
  },
  {
    role: "diagonal",
    reverse: false,
    // Reta curta: gesto rápido, quase um flick, sem frear muito no fim.
    speed: 1.35,
    ease: "cubic-bezier(0.5, 0, 0.75, 0.9)",
    gapAfter: -0.04,
  },
  {
    role: "arc",
    reverse: true,
    // Curva longa e contínua: a mão corre nela e só freia ao fechar embaixo.
    speed: 1.15,
    ease: "cubic-bezier(0.25, 0.45, 0.3, 1)",
    gapAfter: -0.03,
  },
  {
    role: "bar",
    reverse: false,
    // Traço final, curto e decidido.
    speed: 1.3,
    ease: "cubic-bezier(0.45, 0, 0.6, 1)",
    gapAfter: 0,
  },
];

/** Quantos segmentos de reta o path tem — o M é o único do contorno com vários. */
function lineSegments(path: SVGPathElement) {
  return (path.getAttribute("d")?.match(/[lhv]/gi) ?? []).length;
}

/** Reta horizontal: a geometria não tem altura nenhuma. */
function isHorizontal(path: SVGPathElement) {
  return path.getBBox().height < 0.5;
}

/*
 * Separa os paths do SVG por papel.
 *
 * Nada aqui olha para os ids: eles saem do Figma com o nome da camada dentro (o
 * do nome vem inclusive com o acento quebrado) e mudam a cada reexportação.
 * Cada papel é reconhecido pelo que ele é — cor, preenchido vs. traçado, forma.
 */
function classify(svg: SVGSVGElement) {
  const paths = [...svg.querySelectorAll("path")];

  // Os dois textos são preenchidos; todo o resto é traçado.
  const texts = paths.filter((path) => path.hasAttribute("fill"));
  const strokes = paths.filter((path) => !path.hasAttribute("fill"));

  const cursor = strokes.filter(
    (path) => path.getAttribute("stroke")?.toUpperCase() === CURSOR_COLOR,
  );
  const drawn = strokes.filter((path) => !cursor.includes(path));

  // A linha do texto só existe onde há texto. Ela e a barra do G são as duas
  // horizontais do desenho, e a linha é de longe a mais larga.
  const line = texts.length
    ? drawn
        .filter(isHorizontal)
        .sort((a, b) => b.getBBox().width - a.getBBox().width)[0]
    : undefined;

  const outlinePaths = drawn.filter((path) => path !== line);

  // O arco é o único traço curvo; a barra do G, a única reta horizontal que
  // sobra; o M, o único com mais de um segmento. A diagonal é o que resta.
  const arc = outlinePaths.find((path) =>
    /[csqta]/i.test(path.getAttribute("d") ?? ""),
  );
  const remaining = outlinePaths.filter((path) => path !== arc);
  const bar = remaining.find(isHorizontal);
  const letter = remaining.find((path) => path !== bar && lineSegments(path) > 1);
  const diagonal = remaining.find((path) => path !== bar && path !== letter);

  const outline: Partial<Record<OutlineRole, SVGPathElement>> = {
    arc,
    bar,
    letter,
    diagonal,
  };

  // Nome e cargo se distinguem pelo lado da linha em que estão.
  const sortedTexts = [...texts].sort((a, b) => a.getBBox().y - b.getBBox().y);

  return {
    outline,
    cursor,
    line,
    name: sortedTexts[0],
    role: sortedTexts[1],
  };
}

type AnimatedLogoProps = {
  shape?: LogoShape;
  variant?: LogoVariant;
  /** Idioma do cargo exibido — "pt" (Engenheiro de Software) ou "en" (Software Engineer). */
  lang?: LogoLang;
  /** Texto alternativo do logo. */
  label?: string;
};

function AnimatedLogo({
  shape = "horizontal",
  variant = "dark",
  lang = "pt",
  label = "Marcelo Guimarães",
}: AnimatedLogoProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const markup = MARKUP[variant][shape][lang];

  // Antes da pintura: sem as classes e variáveis o logo apareceria montado por
  // um frame.
  useLayoutEffect(() => {
    const svg = rootRef.current?.querySelector("svg");
    if (!svg) return;

    svg.classList.add(styles.svg);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);

    const { outline, cursor, line, name, role } = classify(svg);

    // Onde o contorno termina — é dele que pendem o cursor e, nos compostos, a
    // entrada do texto.
    let outlineEnd = 0;

    const steps = CHOREOGRAPHY.map((step) => ({ step, path: outline[step.role] }));
    const hasOutline = steps.every(({ path }) => path);

    if (hasOutline) {
      // Traço longo leva mais que traço curto, corrigido pelo ritmo de cada um.
      // O rateio é o que mantém o total em OUTLINE_DURATION qualquer que seja a
      // escala do ícone nesta variante.
      const measured = steps.map(({ step, path }) => {
        const length = path!.getTotalLength();
        return { step, path: path!, length, weight: length / step.speed };
      });
      const totalWeight = measured.reduce((sum, item) => sum + item.weight, 0);

      let start = 0;
      for (const { step, path, length, weight } of measured) {
        const duration = (OUTLINE_DURATION * weight) / totalWeight;

        // Deslocar o tracejado para trás revela o traço a partir do início do
        // path; para frente, a partir do fim.
        const offset = step.reverse ? -length : length;

        path.classList.add(styles.stroke);
        path.style.setProperty("--length", `${length}`);
        path.style.setProperty("--offset", `${offset}`);
        path.style.setProperty("--duration", `${duration}s`);
        path.style.setProperty("--delay", `${start}s`);
        path.style.setProperty("--ease", step.ease);

        outlineEnd = start + duration;
        start = outlineEnd + step.gapAfter;
      }
    }

    if (cursor.length) {
      // Os três traços escalam em torno do centro do conjunto: com a origem no
      // centro de cada um, eles se separariam durante o zoom.
      const boxes = cursor.map((path) => path.getBBox());
      const left = Math.min(...boxes.map((box) => box.x));
      const right = Math.max(...boxes.map((box) => box.x + box.width));
      const top = Math.min(...boxes.map((box) => box.y));
      const bottom = Math.max(...boxes.map((box) => box.y + box.height));
      const origin = `${(left + right) / 2}px ${(top + bottom) / 2}px`;

      for (const path of cursor) {
        path.classList.add(styles.cursor);
        path.style.setProperty("--cursor-origin", origin);
      }

      svg.style.setProperty("--cursor-delay", `${outlineEnd + CURSOR_PAUSE}s`);
      svg.style.setProperty("--cursor-in-duration", `${CURSOR_IN_DURATION}s`);
      svg.style.setProperty("--cursor-blink-period", `${CURSOR_BLINK_PERIOD}s`);
    }

    if (line) {
      const box = line.getBBox();
      // Sozinho, o bloco de texto abre a animação; junto do ícone, ele emenda no
      // fecho do contorno.
      const lineDelay = hasOutline ? Math.max(0, outlineEnd - LINE_OVERLAP) : 0;

      line.classList.add(styles.line);
      line.style.setProperty("--line-origin", `${box.x + box.width / 2}px ${box.y}px`);

      svg.style.setProperty("--line-duration", `${LINE_DURATION}s`);
      svg.style.setProperty("--line-delay", `${lineDelay}s`);
      svg.style.setProperty("--text-duration", `${TEXT_DURATION}s`);
      svg.style.setProperty(
        "--text-delay",
        `${lineDelay + LINE_DURATION + TEXT_PAUSE}s`,
      );
    }

    name?.classList.add(styles.name);
    role?.classList.add(styles.role);
  }, [markup, label]);

  // A classificação acima (useLayoutEffect) só monta a coreografia; quem decide
  // quando ela toca é este observer. `.play` liga e desliga com a visibilidade
  // — ao sair da viewport a peça volta ao estado base (ver CSS) e replay na
  // próxima entrada, igual à assinatura do Footer.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        root.classList.toggle(styles.play, entry.isIntersecting);
      },
      { threshold: 0.1 },
    );

    observer.observe(root);

    return () => observer.disconnect();
  }, [markup]);

  // O markup vem de um arquivo do próprio repositório, não de entrada externa.
  return (
    <div
      ref={rootRef}
      className={styles.wrapper}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

export default AnimatedLogo;
