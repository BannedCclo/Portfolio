/* ===========================================================
   stackLogos.js — no hover de uma ferramenta, 0s e 1s formam o logo dela

   Ao passar o ponteiro sobre um item da seção Ferramentas, uma nuvem de
   dígitos dourados sai do próprio nome, sobe e se junta no logo da
   ferramenta, ao lado dele; ali os dígitos ficam trocando de leve.
   Saindo, a nuvem volta para o nome e some. É o mesmo truque dos cards de
   projeto (lib/binaryFlow.js), em pequena escala.

   Regras de lib/motion.js: o hover define o ALVO (0 ou 1) e damp()
   persegue, então entrar e sair no meio do caminho só inverte o movimento,
   sem salto.

   Os logos vêm do simple-icons (CC0): o caminho SVG de cada um é amostrado
   numa grade (isPointInPath) — cada célula preenchida vira um dígito. Só
   roda sem reduced motion; quem carrega este módulo é lib/sections/stack.js,
   quando a seção chega perto. Sem hover (telas de toque), tocar num item
   abre o logo dele (fechando o que estiver aberto), tocar de novo nele ou
   em qualquer outro lugar fecha.
   =========================================================== */

import {
  siCplusplus,
  siDjango,
  siExpress,
  siFigma,
  siGithub,
  siJavascript,
  siMysql,
  siPostgresql,
  siPython,
  siReact,
  siSpring,
  siSqlite,
  siTypescript,
  siVercel,
} from "simple-icons";
import { clamp01, damp, smoothstep } from "./motion.js";
import { onTick } from "./ticker.js";

// A xícara do Java saiu do simple-icons (marca da Oracle; o que sobrou lá
// é o mascote do OpenJDK). Esta é a versão "plain" do devicon (MIT),
// num quadro de 128×128.
const JAVA = {
  path: "M47.617 98.12c-19.192 5.362 11.677 16.439 36.115 5.969-4.003-1.556-6.874-3.351-6.874-3.351-10.897 2.06-15.952 2.222-25.844 1.092-8.164-.935-3.397-3.71-3.397-3.71zm33.189-10.46c-14.444 2.779-22.787 2.69-33.354 1.6-8.171-.845-2.822-4.805-2.822-4.805-21.137 7.016 11.767 14.977 41.309 6.336-3.14-1.106-5.133-3.131-5.133-3.131zm11.319-60.575c.001 0-42.731 10.669-22.323 34.187 6.024 6.935-1.58 13.17-1.58 13.17s15.289-7.891 8.269-17.777c-6.559-9.215-11.587-13.793 15.634-29.58zm9.998 81.144s3.529 2.91-3.888 5.159c-14.102 4.272-58.706 5.56-71.095.171-4.45-1.938 3.899-4.625 6.526-5.192 2.739-.593 4.303-.485 4.303-.485-4.952-3.487-32.013 6.85-13.742 9.815 49.821 8.076 90.817-3.637 77.896-9.468zM85 77.896c2.395-1.634 5.703-3.053 5.703-3.053s-9.424 1.685-18.813 2.474c-11.494.964-23.823 1.154-30.012.326-14.652-1.959 8.033-7.348 8.033-7.348s-8.812-.596-19.644 4.644C17.455 81.134 61.958 83.958 85 77.896zm5.609 15.145c-.108.29-.468.616-.468.616 31.273-8.221 19.775-28.979 4.822-23.725-1.312.464-2 1.543-2 1.543s.829-.334 2.678-.72c7.559-1.575 18.389 10.119-5.032 22.286zM64.181 70.069c-4.614-10.429-20.26-19.553.007-35.559C89.459 14.563 76.492 1.587 76.492 1.587c5.23 20.608-18.451 26.833-26.999 39.667-5.821 8.745 2.857 18.142 14.688 28.815zm27.274 51.748c-19.187 3.612-42.854 3.191-56.887.874 0 0 2.874 2.38 17.646 3.331 22.476 1.437 57-.8 57.816-11.436.001 0-1.57 4.032-18.575 7.231z",
  vb: [128, 128],
};

// Clawd, o mascote do Claude Code, a partir do pixel art que ele mostra ao
// abrir no terminal, feito com meios-blocos:
//    ▐▛███▜▌
//   ▝▜█████▛▘
//     ▘▘ ▝▝
// Cada caractere é 2×2 "pixels", e uma célula de terminal tem o dobro da
// altura da largura — então cada pixel aqui é 1 de largura por 2 de altura.
const CLAWD_ROWS = [
  "...############...", // topo do corpo
  "...##.######.##...", // os olhos (os vãos)
  ".################.", // os braços
  "...############...",
  "....#.#....#.#....", // as pernas
];
const CLAWD = {
  path: CLAWD_ROWS.flatMap((row, y) =>
    [...row].map((ch, x) => (ch === "#" ? `M${x} ${y * 2}h1v2h-1z` : "")),
  ).join(""),
  vb: [18, 10],
};

// nome exibido na lista (sections/Stack.jsx) → ícone; os do simple-icons
// são caminhos num quadro de 24×24
const ICONS = {
  "C/C++": siCplusplus,
  Java: JAVA,
  Python: siPython,
  JavaScript: siJavascript,
  TypeScript: siTypescript,
  React: siReact,
  Express: siExpress,
  Django: siDjango,
  Spring: siSpring,
  PostgreSQL: siPostgresql,
  MySQL: siMysql,
  SQLite: siSqlite,
  GitHub: siGithub,
  Figma: siFigma,
  "Claude Code": CLAWD,
  Vercel: siVercel,
};

const LOGO_PX = 64; // lado do logo, em px CSS
const STEP = 2.5; // espaçamento da grade de dígitos dentro do logo
const COVER = 0.3; // cobertura mínima de uma célula junto a partes cheias
const THIN_COVER = 0.12; // e de uma célula num traço fino
const GLYPH_PX = 4.2; // tamanho de cada dígito
const GLYPH_STROKE = 0.5; // contorno que encorpa o dígito (ver makeSprites)
// faixa estreita de dourados: o bastante para o contorno interno aparecer,
// sem os extremos (quase branco / quase marrom) chamarem atenção
const TONES = ["#e8cf98", "#dcc187", "#c9ad72", "#b09760", "#98814f"];
const GAP = 22; // distância entre o fim do nome e o logo, ao lado dele
const MAX_DELAY = 0.35; // atraso máximo de cada dígito (fração do caminho)

function makeSprites(dpr) {
  // do mais claro ao mais escuro: o tom de cada dígito desenha o relevo do
  // logo (ver sampleIcon)
  const tones = TONES;
  const size = Math.ceil(GLYPH_PX * 1.6 * dpr);
  const sprites = [];
  for (const tone of tones) {
    for (const ch of ["0", "1"]) {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const x = c.getContext("2d");
      x.font = `600 ${GLYPH_PX * dpr}px ui-monospace, Consolas, 'Courier New', monospace`;
      x.textAlign = "center";
      x.textBaseline = "middle";
      // sem halo (shadowBlur): com centenas de dígitos colados, o brilho
      // de cada um se somava numa névoa em volta do logo
      x.fillStyle = x.strokeStyle = tone;
      x.fillText(ch, size / 2, size / 2);
      // um contorno do mesmo tom engrossa o dígito: em ~4 px o Chrome
      // rasteriza a fonte bem fina (metade da tinta do Firefox) e o logo
      // ficava ralo; com o traço fica igual nos dois
      x.lineWidth = GLYPH_STROKE * dpr;
      x.lineJoin = "round";
      x.strokeText(ch, size / 2, size / 2);
      sprites.push(c);
    }
  }
  return { sprites, size: size / dpr };
}

/** pontos preenchidos do logo, em px a partir do canto de cima à esquerda */
function sampleIcon(icon) {
  // A cobertura é medida com isPointInPath, não lendo os pixels de um
  // canvas (getImageData): o Chrome com proteção contra "canvas
  // fingerprinting" (extensões, modos de privacidade) devolve os pixels com
  // ruído, e o logo saía picotado. isPointInPath é geometria pura — dá o
  // mesmo resultado em qualquer navegador.
  const res = 2; // amostras por px CSS, em cada eixo
  const px = LOGO_PX * res;
  const x = document.createElement("canvas").getContext("2d");
  const path = new Path2D(icon.path);
  // o quadro do ícone, encaixado e centrado no quadrado do logo
  const [vw, vh] = icon.vb ?? [24, 24];
  const k = px / Math.max(vw, vh);
  const offX = (px - vw * k) / 2;
  const offY = (px - vh * k) / 2;
  // cada célula da grade vira um dígito se o logo cobre parte dela — pela
  // cobertura, não pelo centro, senão os traços finos (o React, o elefante
  // do Postgres) caem entre os pontos da grade e somem
  const cell = STEP * res;
  const cols = Math.floor(px / cell);
  const cov = new Float32Array(cols * cols);
  for (let gy = 0; gy < cols; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      let sum = 0;
      for (let yy = gy * cell; yy < (gy + 1) * cell; yy++) {
        for (let xx = gx * cell; xx < (gx + 1) * cell; xx++) {
          // centro da amostra, levado para o quadro do ícone
          if (x.isPointInPath(path, (xx + 0.5 - offX) / k, (yy + 0.5 - offY) / k)) sum++;
        }
      }
      cov[gy * cols + gx] = sum / (cell * cell);
    }
  }
  const at = (gx, gy) => (gx < 0 || gy < 0 || gx >= cols || gy >= cols ? 0 : cov[gy * cols + gx]);
  // O tom de cada dígito sai da cobertura dele e da dos vizinhos:
  // - logos maciços (Python, SQLite) têm o desenho só nos vãos estreitos do
  //   recorte, mais finos que a grade: uma célula meio coberta AO LADO de
  //   células cheias é a beira de um vão — fica escura (ou vazia, se quase
  //   nada a cobre), e o contorno interno reaparece;
  // - logos só de traço (MySQL, a xícara do Java) não têm célula cheia por
  //   perto: ali meia cobertura é o próprio traço, que fica claro e entra
  //   mesmo com pouca cobertura, senão o logo some de tão fraco.
  const pts = [];
  for (let gy = 0; gy < cols; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const c = at(gx, gy);
      if (c <= THIN_COVER) continue;
      let near = 1;
      let far = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const v = at(gx + dx, gy + dy);
          near = Math.min(near, v);
          far = Math.max(far, v);
        }
      }
      let tone;
      if (c >= 0.85) tone = near < 0.35 ? 2 : near < 0.8 ? 1 : 0; // miolo
      else if (far >= 0.85) {
        if (c <= COVER) continue; // vão de verdade: vazio
        tone = c < 0.6 ? 4 : 3; // beira de vão
      } else tone = 1; // traço fino
      pts.push({ x: (gx + 0.5) * STEP, y: (gy + 0.5) * STEP, tone });
    }
  }
  return pts;
}

/**
 * @param {HTMLElement} section #stack
 * @param {{ hover?: boolean }} [opts] hover: false → abre no toque, não no hover
 */
export function initStackLogos(section, { hover = true } = {}) {
  const items = [...section.querySelectorAll(".stack__group li")].filter(
    (li) => ICONS[li.textContent.trim()],
  );
  if (!items.length) return () => {};

  const canvas = document.createElement("canvas");
  canvas.className = "stack-logos";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  let dpr = 1;
  let sprites = null;
  let w = 0;
  let h = 0;
  function fit() {
    const nd = Math.min(window.devicePixelRatio || 1, 2);
    const nw = canvas.clientWidth;
    const nh = canvas.clientHeight;
    if (nd !== dpr || !sprites) {
      dpr = nd;
      sprites = makeSprites(dpr);
    }
    if (nw === w && nh === h && canvas.width === Math.round(nw * dpr)) return;
    w = nw;
    h = nh;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }

  const shapes = new Map(); // ícone → pontos (amostrados na 1ª vez)
  const states = items.map((li) => ({ li, a: 0, target: 0, parts: null }));

  // amostra os logos de antemão, um por vez nos intervalos ociosos — assim
  // o primeiro hover não espera a medição (dezenas de ms por logo)
  const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 50));
  const cancelIdle = window.cancelIdleCallback ?? clearTimeout;
  const queue = [...new Set(items.map((li) => ICONS[li.textContent.trim()]))];
  let idleId = 0;
  const warm = () => {
    const icon = queue.shift();
    if (!icon) return;
    if (!shapes.has(icon)) shapes.set(icon, sampleIcon(icon));
    idleId = idle(warm);
  };
  idleId = idle(warm);

  function build(st) {
    const icon = ICONS[st.li.textContent.trim()];
    if (!shapes.has(icon)) shapes.set(icon, sampleIcon(icon));
    st.parts = shapes.get(icon).map((p) => ({
      tx: p.x,
      ty: p.y,
      // saída: um ponto qualquer do nome (0..1 da largura do texto)
      sx: Math.random(),
      sy: Math.random(),
      delay: Math.random() * MAX_DELAY,
      swing: (Math.random() - 0.5) * 2,
      bit: Math.random() < 0.5 ? 0 : 1,
      tone: p.tone,
      flipAt: Math.random() * 2.5,
    }));
  }

  // largura do texto do nome (o item ocupa a coluna inteira; o logo fica
  // centrado sobre o nome, não sobre a coluna)
  const range = document.createRange();
  function nameRect(li) {
    range.selectNodeContents(li);
    return range.getBoundingClientRect();
  }

  const onEnter = (st) => () => {
    if (!st.parts) build(st);
    st.target = 1;
  };
  const onLeave = (st) => () => {
    st.target = 0;
  };
  const handlers = hover
    ? states.map((st) => {
        const enter = onEnter(st);
        const leave = onLeave(st);
        st.li.addEventListener("pointerenter", enter);
        st.li.addEventListener("pointerleave", leave);
        return () => {
          st.li.removeEventListener("pointerenter", enter);
          st.li.removeEventListener("pointerleave", leave);
        };
      })
    : [];

  // toque: um clique só no documento decide tudo — no item, abre ele (ou
  // fecha, se já estava aberto) e fecha os outros; fora, fecha todos
  if (!hover) {
    const onTap = (e) => {
      const li = e.target instanceof Element ? e.target.closest(".stack__group li") : null;
      for (const st of states) {
        if (st.li === li && st.target === 0) onEnter(st)();
        else st.target = 0;
      }
    };
    document.addEventListener("click", onTap);
    handlers.push(() => document.removeEventListener("click", onTap));
  }

  // vazio, o canvas de tela cheia sai da composição (no celular cada camada
  // transparente do tamanho da tela ainda custa a mistura a cada quadro)
  canvas.style.visibility = "hidden";
  let drawn = false;
  let time = 0;
  const unsubscribe = onTick((dt) => {
    time += dt;
    const active = states.filter((st) => st.target > 0 || st.a > 0.002);
    if (!active.length) {
      if (drawn) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.visibility = "hidden";
        drawn = false;
      }
      return;
    }
    if (!drawn) canvas.style.visibility = "";
    fit();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // "source-over": somar ("lighter") estourava em manchas claras onde os
    // dígitos se encostam
    ctx.globalCompositeOperation = "source-over";
    const half = sprites.size / 2;

    for (const st of active) {
      // entra mais devagar do que sai: dá tempo de ver o logo se formar
      st.a = damp(st.a, st.target, dt, st.target ? 3.2 : 5);
      if (st.a < 0.002 && !st.target) {
        st.a = 0;
        continue;
      }
      const name = nameRect(st.li);
      // ao lado do nome, centrado na altura do item
      const ox = name.right + GAP;
      const oy = name.top + name.height / 2 - LOGO_PX / 2;

      for (const p of st.parts) {
        const t = clamp01((st.a - p.delay) / (1 - MAX_DELAY));
        if (t <= 0) continue;
        // sai devagar, acelera, pousa devagar
        const e = t * t * (3 - 2 * t);
        const sx = name.left + p.sx * name.width;
        const sy = name.top + p.sy * name.height;
        const tx = ox + p.tx;
        const ty = oy + p.ty;
        // um arco de lado no meio do caminho, cada dígito para um lado
        const arc = Math.sin(Math.PI * e) * p.swing * 18;
        const x = sx + (tx - sx) * e + arc;
        const y = sy + (ty - sy) * e;
        const alpha = smoothstep(t / 0.3) * (0.55 + 0.45 * e);
        // pousados, os dígitos trocam de vez em quando
        const bit = e > 0.98 ? (p.bit + Math.floor((time + p.flipAt) / 1.6)) & 1 : p.bit;
        const scale = 0.6 + 0.4 * e;
        const s = sprites.size * scale;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprites.sprites[p.tone * 2 + bit], x - half * scale, y - half * scale, s, s);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    drawn = true;
  });

  return () => {
    unsubscribe();
    cancelIdle(idleId);
    handlers.forEach((off) => off());
    range.detach?.();
    canvas.remove();
  };
}
