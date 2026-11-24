/* ===========================================================
   binaryFlow.js — a linha do tempo (Sobre) desagua nos projetos (Trabalho)

   Quando o preenchimento dourado da trajetória chega ao fim, o sinal não
   para: sai pela ponta de baixo do trilho como uma corrente de 0s e 1s — os
   mesmos dígitos do feixe do cérebro — que desce até a seção de projetos e
   "imprime" os cards, de cima para baixo, conforme os dígitos pousam.

   Segue as regras de lib/motion.js: a rolagem define o ALVO do progresso e o
   valor desenhado persegue esse alvo via damp(); nada anda sozinho no tempo
   — parando de rolar, a corrente para. Subindo a página, os cards se
   desfazem de volta em dígitos.

   Desenho num canvas 2D fixo, por cima das seções (mesma camada do feixe),
   com os glifos pré-renderizados em sprites — drawImage é bem mais barato
   que fillText por partícula.

   Cada card recebe `--form` (0..1): quanto dele já foi impresso. O CSS
   (Work.css) recorta o card até essa altura e desenha a linha de impressão.
   =========================================================== */

import { clamp01, damp, isNearRect, smoothstep } from "./motion.js";
import { onTick } from "./ticker.js";

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

// mesma condição do pin da galeria (lib/sections/work.js): a partir de
// 820px. No celular não há pin nem pouso — a rolagem nunca é travada
const DESKTOP_QUERY = "(min-width: 820px)";

const PER_CARD = 340; // dígitos por card impresso
const TRAVEL = 0.3; // fração do progresso que cada dígito leva no caminho
// escalonamento da saída: cada card começa CARD_STAGGER depois do anterior,
// e dentro de um card os dígitos saem ao longo de V_SPAN (de cima p/ baixo)
const CARD_STAGGER = 0.1;
const V_SPAN = 0.34;
const GLYPH_PX = 13; // tamanho do glifo em px CSS
// a coluna em que o fio se descompacta, na ponta do trilho
const UNZIP_UP = 70; // trecho do fio que se desfaz acima da ponta (px)
const UNZIP_DOWN = 0.14; // quanto a coluna desce abaixo da ponta (× vh)
const UNZIP_COUNT = 46; // dígitos na coluna
const UNZIP_FLOW = 60; // quantos dígitos escorrem ao longo do sinal inteiro
// duração mínima da corrente inteira (da linha até os cards prontos), em s
const FLOW_MIN_S = 3;

/** Sprites "0" e "1" em três tons de dourado (sólido, claro, escuro). */
function makeSprites(dpr) {
  // tons quentes e claros: somados com "lighter" (como o blending aditivo do
  // feixe do cérebro), onde os dígitos se acumulam a luz estoura para o claro
  const tones = ["#e6c98a", "#fff3d6", "#c9ad72"];
  const size = Math.ceil(GLYPH_PX * 2 * dpr);
  const sprites = [];
  for (const tone of tones) {
    for (const ch of ["0", "1"]) {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const x = c.getContext("2d");
      x.font = `600 ${GLYPH_PX * dpr}px ui-monospace, Consolas, 'Courier New', monospace`;
      x.textAlign = "center";
      x.textBaseline = "middle";
      x.shadowColor = "rgba(236, 200, 120, 0.95)";
      x.shadowBlur = 6 * dpr;
      x.fillStyle = tone;
      x.fillText(ch, size / 2, size / 2);
      x.shadowBlur = 0;
      x.fillText(ch, size / 2, size / 2); // segunda passada: miolo nítido
      sprites.push(c);
    }
  }
  return { sprites, size: size / dpr };
}

// pseudo-aleatório determinístico: as mesmas partículas a cada montagem
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Chamado uma vez pelo <App>, depois que Sobre e Trabalho montaram. */
export function initBinaryFlow() {
  const about = document.getElementById("sobre");
  const work = document.getElementById("trabalho");
  const timeline = about?.querySelector(".timeline");
  const wrap = about?.querySelector(".timeline-wrap");
  const pin = work?.querySelector(".work__pin");
  const track = work?.querySelector(".work__track");
  const cards = work ? [...work.querySelectorAll(".proj")] : [];
  // os marcos da linha do tempo: cada ponto acende quando o preenchimento
  // chega nele (About.css, .tl.is-lit)
  const marks = timeline ? [...timeline.querySelectorAll(".tl")] : [];
  if (!timeline || !wrap || !pin || !track || !cards.length) return () => {};

  const setForm = (card, v) => card.style.setProperty("--form", v.toFixed(4));

  if (reduceMotion) {
    cards.forEach((c) => setForm(c, 1));
    return () => cards.forEach((c) => c.style.removeProperty("--form"));
  }

  work.classList.add("is-printed");

  const canvas = document.createElement("canvas");
  canvas.className = "binary-flow";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  let dpr = 1;
  let sprites = null;
  let w = 0;
  let h = 0;
  function fit() {
    const nd = Math.min(window.devicePixelRatio || 1, 1.5);
    // o tamanho real do canvas na tela, não innerWidth: innerWidth inclui a
    // barra de rolagem, que o canvas (fixed, 100%) não cobre — medir por ele
    // comprimia o desenho na horizontal e os dígitos saíam deslocados da
    // linha, mais quanto mais à direita
    const nw = canvas.clientWidth || document.documentElement.clientWidth;
    const nh = canvas.clientHeight || window.innerHeight;
    if (nw === w && nh === h && nd === dpr && sprites) return;
    w = nw;
    h = nh;
    dpr = nd;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    sprites = makeSprites(dpr);
  }
  fit();

  /* Partículas: cada uma tem um card alvo (índice entre os visíveis), um
     ponto dentro dele (u, v) e um atraso que cresce com v — o card se
     imprime de cima para baixo, e cada dígito pousa bem na linha de
     impressão. A semente de cada uma também dá a curvatura do caminho. */
  const rand = rng(1337);
  const particles = [];
  const MAX_TARGETS = 4;
  for (let c = 0; c < MAX_TARGETS; c++) {
    for (let i = 0; i < PER_CARD; i++) {
      const v = rand();
      particles.push({
        card: c,
        u: 0.04 + rand() * 0.92,
        v,
        // atraso: escalonado por card (da esquerda p/ direita) e pela altura.
        // Máximo ≈ 3 × 0.1 + 0.34 + 0.02 + TRAVEL = 0.96: o último dígito
        // pousa antes de o pin da galeria começar
        delay: c * CARD_STAGGER + v * V_SPAN + (rand() - 0.5) * 0.04,
        drop: 0.18 + rand() * 0.2, // quanto cai reto antes de curvar (× vh)
        swing: (rand() - 0.5) * 0.5, // desvio lateral do meio do caminho (× vw)
        flips: 3 + Math.floor(rand() * 6), // quantas vezes troca 0↔1 no trajeto
        bit: rand() < 0.5 ? 0 : 1,
        tone: rand() < 0.7 ? 0 : rand() < 0.5 ? 1 : 2,
      });
    }
  }
  particles.forEach((p) => (p.delay = Math.max(0, p.delay)));

  /* Um sinal só, em 0..2, que a rolagem define e damp() suaviza:
       0..1 → o preenchimento correndo pelo trilho da trajetória
       1..2 → a mesma luz seguindo como corrente de 0s e 1s até os cards
     Por ser um valor único, a corrente nunca sai antes de a linha chegar ao
     fim e nunca fica para trás esperando: rolando rápido, o sinal percorre o
     resto do caminho de uma vez, mas na velocidade do damp, sem pular etapa. */
  let signal = 0;
  let progress = 0;
  let drawnEmpty = true;
  let emPx = 16;
  // centro de cada marco ao longo do trilho (offsetTop + 0.5em + metade dos
  // 7px do ponto). Medido só quando o layout muda (resize, fontes): lido a
  // cada quadro, logo depois de escrever --fill, offsetTop forçava o
  // navegador a refazer o layout inteiro
  let markY = [];
  const measure = () => {
    emPx = parseFloat(getComputedStyle(timeline).fontSize) || 16;
    markY = marks.map((m) => m.offsetTop + 0.5 * emPx + 3.5);
  };
  measure();
  window.addEventListener("resize", measure);
  const ro = new ResizeObserver(measure);
  ro.observe(timeline);
  const desktopMql = window.matchMedia(DESKTOP_QUERY);
  const forms = new Array(cards.length).fill(-1);
  // últimos valores escritos nas variáveis do trilho: só reescreve o que
  // mudou, para não invalidar o estilo à toa a cada quadro
  const wrapVars = { "--fill": "", "--drain": "", "--unzip": "", "--pulse-alpha": "" };
  const setWrapVar = (k, v) => {
    if (wrapVars[k] === v) return;
    wrapVars[k] = v;
    wrap.style.setProperty(k, v);
  };
  // assinatura do último quadro desenhado: igual → o canvas já está certo
  let lastKey = "";

  /** Avança o sinal um quadro. O damp() de sempre, com um teto de
   *  velocidade só na parte da corrente (1..2): rolando rápido, a formação
   *  dos cards leva no mínimo FLOW_MIN_S para ir de ponta a ponta, em vez
   *  de acontecer num piscar. Só na ida: de volta (rolando para cima) não há
   *  teto, para a linha do tempo não demorar a responder. Rolando devagar, o
   *  teto nem é alcançado e o sinal segue a rolagem normalmente. */
  function stepSignal(cur, target, dt) {
    let next = damp(cur, target, dt, 4.5);
    if (Math.abs(next - target) < 1e-4) next = target;
    // voltando (rolando para cima) ou só no preenchimento: sem teto — a linha
    // do tempo responde na hora, com o mesmo damp() do resto da página
    if (next <= cur || next <= 1) return next;
    // avançando na corrente: o que passa de 1 anda no máximo dt / FLOW_MIN_S
    const flowCur = Math.max(0, cur - 1);
    return 1 + Math.min(next - 1, flowCur + dt / FLOW_MIN_S);
  }

  /** Alvo do sinal (0..2) a partir da rolagem:
   *  0 → o topo do trilho passa de 60% da tela (o preenchimento começa)
   *  1 → o pé do trilho passa de 60% da tela (a linha chegou ao fim)
   *  2 → os cards estão na posição final (pin começando, no desktop) */
  function targetSignal(tlRect, pinRect, trackRect) {
    const fill = clamp01((h * 0.6 - tlRect.top) / tlRect.height);
    if (fill < 1) return fill;
    return 1 + flowTarget(tlRect, pinRect, trackRect);
  }

  function flowTarget(tlRect, pinRect, trackRect) {
    const start = h * 0.6 - tlRect.bottom; // > 0 depois que a linha completa
    if (start <= 0) return 0;
    const gap = desktopMql.matches
      ? pinRect.top
      : trackRect.top - h * 0.3;
    if (gap <= 0) return 1;
    return clamp01(start / (start + gap));
  }

  /* ---- pouso suave enquanto os cards se formam ----
     Chegando de cima, alguns pixels antes do ponto em que os cards ficam na
     posição final (o começo do pin, no desktop), a rolagem do usuário para
     de empurrar a página e ela desce sozinha, desacelerando, até parar
     nesse ponto — e espera ali até todos os cards ficarem prontos. Prontos,
     a rolagem volta (e, no desktop, vira a rolagem lateral da galeria).
     Rolar para cima sempre funciona e cancela o pouso. Só a entrada do
     usuário é barrada (roda, toque, teclado, barra de rolagem): rolagens
     programáticas, como os links da navegação, passam livres, e quem já
     está abaixo do ponto não é puxado de volta. */
  let lockY = Infinity; // posição de rolagem do pouso, atualizada no tick
  let landing = false; // descendo sozinho até lockY / segurando ali
  let lastInput = -Infinity; // último gesto do usuário (ms)
  let prevY = window.scrollY;
  let touchY = 0;
  // só no desktop: no celular a galeria não tem pin e a página nunca é
  // segurada — os cards se imprimem enquanto ela passa
  const forming = () =>
    desktopMql.matches && work.dataset.cardsReady === "0" && lockY !== Infinity;
  // a zona de captura: quanto antes do ponto a rolagem deixa de empurrar
  const captureFrom = () => lockY - Math.min(260, h * 0.28);
  const markInput = () => (lastInput = performance.now());
  const cancelLanding = () => (landing = false);
  // entra no pouso se a página está na zona (e não abaixo do ponto)
  const shouldCapture = (y) => forming() && y >= captureFrom() && y <= lockY + 2;

  const onWheel = (e) => {
    markInput();
    if (e.deltaY < 0) return cancelLanding();
    if (e.deltaY === 0 || !forming()) return;
    const y = window.scrollY;
    const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? h : 1);
    if (landing || shouldCapture(y) || (y < captureFrom() && y + px >= captureFrom())) {
      e.preventDefault();
      landing = true;
    }
  };
  const onTouchStart = (e) => {
    markInput();
    touchY = e.touches[0]?.clientY ?? 0;
  };
  const onTouchMove = (e) => {
    markInput();
    const ny = e.touches[0]?.clientY ?? touchY;
    const dy = touchY - ny; // > 0: dedo subindo = página descendo
    touchY = ny;
    if (dy < 0) return cancelLanding();
    if (dy > 0 && (landing || shouldCapture(window.scrollY))) {
      e.preventDefault();
      landing = true;
    }
  };
  const DOWN_KEYS = new Set(["ArrowDown", "PageDown", "End", " ", "Spacebar"]);
  const UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);
  const onKey = (e) => {
    const el = e.target;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    markInput();
    if (UP_KEYS.has(e.key)) return cancelLanding();
    if (DOWN_KEYS.has(e.key) && (landing || shouldCapture(window.scrollY))) {
      e.preventDefault();
      landing = true;
    }
  };
  // rede de segurança para o que escapa dos gestos acima (inércia do toque,
  // tecla que passa do ponto, arrastar a barra de rolagem): passou do ponto
  // vindo de cima por gesto do usuário → volta para o ponto e segura ali
  const onScroll = () => {
    const y = window.scrollY;
    const byUser = performance.now() - lastInput < 700;
    if (forming() && byUser && y > lockY + 1 && prevY <= lockY + 2) {
      window.scrollTo(0, Math.ceil(lockY));
      landing = true;
      prevY = Math.ceil(lockY);
      return;
    }
    // descendo pela barra de rolagem ou pela inércia até a zona: pousa
    if (forming() && byUser && y > prevY && shouldCapture(y)) landing = true;
    prevY = y;
  };
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("keydown", onKey);
  window.addEventListener("pointerdown", markInput, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });

  /** Um quadro do pouso: desce até lockY desacelerando (damp) e segura ali
   *  enquanto os cards se formam. Ceil: parar uma fração de pixel antes do
   *  começo do pin deixaria a galeria sem fixar. */
  function stepLanding(dt) {
    if (!landing) return;
    if (!forming()) {
      landing = false;
      return;
    }
    const y = window.scrollY;
    const goal = Math.ceil(lockY);
    if (Math.abs(goal - y) < 0.5) return;
    let next = damp(y, goal, dt, 5);
    // velocidade mínima no finalzinho, para não "rastejar" os últimos pixels
    const minStep = 40 * dt;
    if (Math.abs(goal - next) < minStep || Math.abs(next - y) < minStep) {
      next = y + Math.sign(goal - y) * Math.min(minStep, Math.abs(goal - y));
    }
    window.scrollTo(0, next);
    prevY = window.scrollY;
  }

  const unsubscribeTick = onTick((dt) => {
    /* Todas as leituras de layout primeiro, todas as escritas depois: ler
       um rect logo após escrever uma variável CSS obriga o navegador a
       recalcular o layout no meio do quadro. */
    const workRect = work.getBoundingClientRect();
    const tlRect = timeline.getBoundingClientRect();
    if (!isNearRect(workRect, 0.6) && !isNearRect(tlRect, 0.4)) {
      if (!drawnEmpty) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawnEmpty = true;
      }
      lastKey = "";
      return;
    }
    const pinRect = pin.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const rects = cards.map((c) => c.getBoundingClientRect());
    const scrollY = window.scrollY;
    fit();

    // onde a trava segura a página: o mesmo ponto em que o alvo do sinal
    // chega a 2 (targetSignal) — começo do pin no desktop (topo da seção,
    // que o pin não move) ou a faixa de cards a 30% da tela no celular
    lockY = desktopMql.matches
      ? workRect.top + scrollY
      : trackRect.top - h * 0.3 + scrollY;
    const target = targetSignal(tlRect, pinRect, trackRect);
    signal = stepSignal(signal, target, dt);
    progress = clamp01(signal - 1);

    // cards alvo: os que aparecem na tela com a galeria no início (x = 0)
    const targets = [];
    rects.forEach((r, i) => {
      const local = r.left - trackRect.left;
      if (local < w && targets.length < MAX_TARGETS) targets.push(i);
    });

    // nada mudou desde o último quadro (sinal parado, nada se mexeu na
    // tela): o canvas, as variáveis e os cards já estão certos
    let key = `${signal.toFixed(5)}|${tlRect.top}|${tlRect.left}|${tlRect.height}|${w}|${h}|${dpr}`;
    for (const i of targets) {
      const r = rects[i];
      key += `|${r.left}|${r.top}|${r.width}|${r.height}`;
    }
    if (key === lastKey) {
      stepLanding(dt);
      return;
    }
    lastKey = key;

    // o trilho e a ponta brilhante (About.css): a ponta corre com o
    // preenchimento e, no fim, dá lugar à coluna de dígitos (--unzip)
    const fill = Math.min(signal, 1);
    // O fio vira os dígitos: conforme eles saem pela ponta, a linha se
    // esvazia de cima para baixo (--drain) e acaba junto com o último dígito
    // que sai: o atraso máximo das partículas com os cards alvo desta tela.
    // A coluna em que o fio se descompacta acende logo no começo e se apaga
    // quando o fio termina — nenhum dígito fica preso à ponta depois que a
    // linha secou.
    const emitEnd = (Math.max(1, targets.length) - 1) * CARD_STAGGER + V_SPAN + 0.02;
    const drain = clamp01(progress / emitEnd);
    const unzip = smoothstep(progress / 0.05) * (1 - smoothstep((drain - 0.8) / 0.2));
    setWrapVar("--fill", fill.toFixed(4));
    // ponta do preenchimento, a partir do topo do trilho (About.css:
    // top 0.6em, altura fill × (100% − 1.2em)); o centro de cada ponto vem
    // de markY (offsetTop, sem o translateY do reveal, medido em measure())
    const tipY = 0.6 * emPx + fill * (tlRect.height - 1.2 * emPx);
    marks.forEach((m, i) => {
      const lit = fill > 0 && tipY >= markY[i] - 0.5;
      if (lit !== m.classList.contains("is-lit")) m.classList.toggle("is-lit", lit);
    });
    setWrapVar("--drain", drain.toFixed(4));
    setWrapVar("--unzip", unzip.toFixed(3));
    // a ponta brilhante só corre pela linha; ao fim, quem brilha são os dígitos
    setWrapVar("--pulse-alpha", signal > 0.004 && progress < 0.02 ? "1" : "0");

    // contagem de dígitos pousados por card alvo
    const landed = new Array(MAX_TARGETS).fill(0);
    const total = new Array(MAX_TARGETS).fill(0);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    drawnEmpty = true;

    // saída: a ponta de baixo do trilho (left: 3px, bottom: 0.6em — About.css)
    const sx = tlRect.left + 3.5;
    const sy = tlRect.bottom - 0.6 * emPx;
    const half = sprites.size / 2;

    /* A linha se descompactando. Enquanto a corrente sai (--unzip), os
       últimos ~70px do fio se desfazem num degradê (About.css) e, no lugar,
       uma coluna de dígitos continua o fio: no alto eles são minúsculos e
       colados uns aos outros — ainda leem como a própria linha —, e para
       baixo vão ficando maiores, mais espaçados e soltos para os lados, até
       virarem a corrente que se abre. A coluna anda com o sinal: rolando, o
       fio escorre para dentro dela; parando, para. */
    const railLen = tlRect.height - 1.2 * emPx;
    const tip = tlRect.top + 0.6 * emPx + fill * railLen;
    if (unzip > 0.002 && tip > -100 && tip < h + 40) {
      // onde o fio começa a se desfazer — nunca acima do que resta dele
      const lineTop = tlRect.top + 0.6 * emPx + drain * railLen;
      const yA = Math.max(tip - UNZIP_UP * unzip, lineTop);
      const yB = tip + UNZIP_DOWN * h * unzip; // fim da coluna, já solta
      const flow = signal * UNZIP_FLOW;
      const phase = flow - Math.floor(flow);
      const shift = Math.floor(flow);
      for (let k = -1; k < UNZIP_COUNT; k++) {
        const u = (k + phase) / UNZIP_COUNT;
        if (u < 0 || u > 1) continue;
        // u^1.7: espaçamento mínimo no alto (os dígitos se sobrepõem, como
        // um traço), crescendo para baixo
        const y = yA + (yB - yA) * Math.pow(u, 1.7);
        if (y < -20 || y > h + 20) continue;
        const seed = k - shift; // o mesmo dígito enquanto ele desce
        const hsh = Math.sin(seed * 12.9898) * 43758.5453;
        const r1 = hsh - Math.floor(hsh);
        const sc = 0.12 + 0.3 * u;
        const sz = sprites.size * sc;
        const jx = (r1 - 0.5) * u * u * 10;
        // acende ao sair do fio (o brilho da ponta passa para os dígitos)
        const a = (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, u * 1.6))) * unzip;
        const bit = (Math.floor(r1 * 7) + seed) & 1;
        const tone = u < 0.45 ? 1 : 0;
        ctx.globalAlpha = a;
        ctx.drawImage(sprites.sprites[tone * 2 + bit], sx + jx - half * sc, y - half * sc, sz, sz);
        drawnEmpty = false;
      }
    }

    for (const p of particles) {
      const cardIndex = targets[p.card];
      if (cardIndex === undefined) continue;
      total[p.card]++;
      const t = clamp01((progress - p.delay) / TRAVEL);
      if (t >= 1) {
        landed[p.card]++;
        continue;
      }
      if (t <= 0) continue;

      const r = rects[cardIndex];
      const tx = r.left + p.u * r.width;
      const ty = r.top + p.v * r.height;
      const x0 = sx;
      const y0 = sy;
      // cúbica: desce reto do trilho, abre para o lado e mergulha no ponto
      const x1 = x0;
      const y1 = y0 + p.drop * h;
      const x2 = tx + p.swing * w * 0.4;
      const y2 = ty - (0.15 + p.drop) * h;
      // velocidade quase constante: o começo do caminho, ainda colado ao
      // fio, concentra dígitos pequenos — é o feixe denso saindo da ponta
      const e = t * (1.35 - 0.35 * t);
      const k = 1 - e;
      const x = k * k * k * x0 + 3 * k * k * e * x1 + 3 * k * e * e * x2 + e * e * e * tx;
      const y = k * k * k * y0 + 3 * k * k * e * y1 + 3 * k * e * e * y2 + e * e * e * ty;
      if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;

      // surge na saída, apaga ao pousar (o card impresso toma o lugar)
      const alpha = Math.min(1, t / 0.05) * (1 - smoothstep((t - 0.82) / 0.18));
      if (alpha <= 0.01) continue;
      const bit = (p.bit + Math.floor(t * p.flips)) & 1;
      // nasce pequeno, do tamanho do fio, e cresce ao abrir o leque — a
      // corrente sai de um ponto só em vez de já nascer larga
      // nasce do tamanho dos dígitos da coluna e cresce ao abrir o leque
      const scale = 0.18 + 0.82 * smoothstep(t / 0.35) - 0.15 * smoothstep((t - 0.7) / 0.3);
      ctx.globalAlpha = alpha;
      const s = sprites.size * scale;
      ctx.drawImage(sprites.sprites[p.tone * 2 + bit], x - half * scale, y - half * scale, s, s);
      drawnEmpty = false;
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // --form por card: alvos seguem os dígitos pousados; o resto fica pronto
    let allReady = true;
    cards.forEach((card, i) => {
      const slot = targets.indexOf(i);
      const f = slot === -1 ? 1 : total[slot] ? landed[slot] / total[slot] : 1;
      if (Math.abs(f - forms[i]) > 1e-4) {
        // acabou de ficar pronto (e não já estava pronto ao carregar a
        // página): brilho + reflexo dourado, uma vez (Work.css). Desfazendo
        // o card, a marca sai, para o efeito poder voltar na próxima vez.
        if (f >= 1 && forms[i] >= 0 && forms[i] < 1) card.classList.add("is-forged");
        else if (f < 1) card.classList.remove("is-forged");
        forms[i] = f;
        setForm(card, f);
      }
      if (f < 1) allReady = false;
    });
    // a galeria só anda na horizontal depois que os cards estão prontos
    // (lib/sections/work.js lê esta marca)
    const ready = allReady ? "1" : "0";
    if (work.dataset.cardsReady !== ready) work.dataset.cardsReady = ready;

    stepLanding(dt);
  });

  return () => {
    unsubscribeTick();
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("touchstart", onTouchStart);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("pointerdown", markInput);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", measure);
    ro.disconnect();
    ["--fill", "--drain", "--unzip", "--pulse-alpha"].forEach((k) => wrap.style.removeProperty(k));
    marks.forEach((m) => m.classList.remove("is-lit"));
    canvas.remove();
    work.classList.remove("is-printed");
    delete work.dataset.cardsReady;
    cards.forEach((c) => {
      c.style.removeProperty("--form");
      c.classList.remove("is-forged");
    });
  };
}
