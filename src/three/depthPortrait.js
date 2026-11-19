/* ===========================================================
   depthPortrait.js — a foto com volume (paralaxe em camadas)

   A foto é desmontada offline (tools/bake-portrait-depth.py) em três
   recortes — cabeça, corpo e mão — e cada um vira um plano próprio, empilhado
   de trás para frente. Numa órbita curta de câmera eles deslizam entre si
   conforme a distância de cada um: a mão passa na frente do casaco, o casaco
   na frente do pescoço. Cada plano tem só uma curvatura leve (a forma geral
   da parte, muito suavizada), nunca o relevo de pixel do nariz ou da boca.

   Por que é fiel: a textura são os próprios pixels da foto, e dentro de cada
   parte eles não se mexem uns em relação aos outros — nada é esticado nem
   re-iluminado. O que cada camada esconde da de trás (o casaco sob a mão, o
   pescoço sob a gola) foi preenchido no bake, então o deslize não abre buraco.

   É um relevo frontal, não um objeto 360°: a órbita é curta de propósito.

   Ciclo de vida: o componente cria o motor, liga/desliga o loop conforme a
   seção aparece na tela (start/stop) e chama dispose() ao desmontar. O loop
   nunca roda fora da tela.
   =========================================================== */

import * as THREE from "three";
import { quality } from "./stage.js";
import { damp, deg } from "../lib/motion.js";
import { portraitHeadGlow, portraitLight, portraitLightGain } from "../lib/portraitLight.js";
import { createHeadInflow } from "./headInflow.js";
import { createXrayLens } from "./xrayLens.js";

// escala da profundidade, em alturas-de-quadro por unidade do mapa: um ponto
// com z maior em 1.0 fica RELIEF à frente. O bake não estica o mapa, então a
// proporção entre as camadas (a mão ~4 cm sobre o casaco) é a dele.
const RELIEF = 0.42;
// lente longa: menos distorção de perspectiva do que um grande-angular
const FOV = 18;
// zoom extra para a borda do quadro (corte de baixo do casaco) nunca aparecer
// (o mesmo valor está no scale() da imagem plana em DepthPortrait.css)
const OVERSCAN = 1.045;

// o giro máximo é atingido nas bordas da área do ponteiro (a coluna da bio,
// bem menor que a janela), então fica mais contido que os ±12°/±7° de quando
// a janela inteira contava
const MAX_YAW = deg(8.5);
const MAX_PITCH = deg(5);
// vai-e-vem lento que mantém vivo em telas sem mouse
const IDLE_YAW = deg(4.5);
const IDLE_PITCH = deg(2.4);

// Luz quente vindo de baixo, por trás da figura: um plano atrás das camadas
// (LIGHT.depth), então ganha paralaxe na órbita e atravessa os fios
// translúcidos do cabelo de verdade. O foco fica abaixo do quadro (o
// mask-image do .about__portrait--depth some com a base); dele sai um leque
// de feixes que oscila devagar, atravessando uma névoa que sobe. A mesma
// função acende a contraluz nas bordas da silhueta. Sem WebGL, fica o halo
// estático do DepthPortrait.css.
const LIGHT = {
  depth: 0.35, // distância atrás do plano focal
  scale: 1.45, // o plano sobra além do quadro para a órbita não mostrar borda
  // foco abaixo do quadro e à esquerda da figura, onde o fundo está livre
  // (atrás do casaco o leque ficaria escondido); inclinado para o rosto
  src: [-0.12, -0.62],
  tilt: 0.16,
  gain: 1.15,
  rim: 0.9, // fios translúcidos (cabelo)
  edgeRim: 2.8, // faixa no contorno da silhueta (ombros, cabeça)
  edgeWidth: 9, // raio da faixa em texels da silhueta (1/4 da foto)
};
const SIL_SCALE = 4; // a silhueta é montada a 1/SIL_SCALE da foto

// coordenadas q: unidades do quadro, origem no centro, y para cima (±0.5)
const LIGHT_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uLightGain;
  uniform vec2 uLightSrc;
  uniform float uLightTilt;
  // brilho de dentro da cabeça quando o feixe do cérebro entra nela
  // (lib/portraitLight.js): centro e raio em coordenadas q
  uniform float uHeadGlow;
  uniform vec2 uHeadQ;
  uniform float uHeadR;
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int k = 0; k < 4; k++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }
  // núcleo de luz dentro da cabeça: gaussiana em volta do centro dela, com
  // um ruído fixo que a deixa irregular (sem tremeluzir: o brilho é guiado
  // só pela rolagem)
  float headGlow(vec2 q, float r) {
    if (uHeadGlow < 0.001) return 0.0;
    vec2 d = q - uHeadQ;
    float k = exp(-dot(d, d) / (r * r));
    float n = 0.75 + 0.5 * vnoise(q * 16.0);
    return uHeadGlow * k * n;
  }
  // intensidade (a) e cor (rgb) da luz no ponto q
  vec4 uplight(vec2 q) {
    float t = uTime;
    // a lâmpada passeia um pouco, como se balançasse
    vec2 src = uLightSrc + vec2(0.03 * sin(t * 0.21) + 0.015 * sin(t * 0.53), 0.0);
    vec2 v = q - src;
    float r = length(v);
    // 0 = para cima; uLightTilt inclina o leque (rad, + = para a direita)
    float ang = atan(v.x, v.y) - uLightTilt - 0.06 * sin(t * 0.17);
    // leque: abre com a altura, bordas macias
    float cone = exp(-pow(ang / 0.4, 2.0));
    // feixes: ruído ao longo do ângulo, mudando devagar
    float rays = fbm(vec2(ang * 9.0, t * 0.14));
    rays = 0.3 + 1.4 * smoothstep(0.3, 0.75, rays);
    // névoa subindo: a luz só aparece onde há "ar" para espalhar
    float haze = fbm(q * vec2(3.0, 2.2) + vec2(0.0, -t * 0.08));
    haze = 0.45 + 0.9 * haze;
    float fall = 1.0 / (1.0 + pow(r * 2.1, 2.4));
    float scatter = 0.5 * exp(-r * 3.4); // brilho difuso em volta do foco
    float flicker = 0.93 + 0.05 * sin(t * 1.7) * sin(t * 0.63) + 0.02 * sin(t * 4.1);
    float i = (cone * rays * fall * 1.6 + scatter) * haze * flicker * uLightGain;
    // um tom só: o mesmo matiz do --gold do site, mais luminoso (bate com
    // --portrait-glow no DepthPortrait.css)
    return vec4(vec3(250.0, 209.0, 128.0) / 255.0, i);
  }
`;

const LIGHT_VERT = /* glsl */ `
  uniform float uLightScale;
  varying vec2 vQ;
  void main() {
    // o plano está mais longe: na pose de repouso ele cobre o quadro com a
    // mesma escala da figura
    vQ = position.xy / uLightScale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LIGHT_FRAG = /* glsl */ `
  precision highp float;
  ${LIGHT_GLSL}
  uniform vec2 uResolution;
  varying vec2 vQ;
  void main() {
    vec4 l = uplight(vQ);
    // some antes das bordas do canvas (a de baixo é do mask-image da página)
    vec2 s = gl_FragCoord.xy / uResolution;
    // arredondado (sem cantos de caixa); abaixo de 35% da altura só pesa o x
    vec2 d = (s - vec2(0.5, 0.35)) * vec2(1.0, 0.8);
    d.y = max(d.y, 0.0);
    float edge = 1.0 - smoothstep(0.2, 0.5, length(d));
    gl_FragColor = vec4(l.rgb, clamp(l.a * edge, 0.0, 1.0));
  }
`;

// um vértice a cada N px da foto: a curvatura é lisa, não precisa de mais
const VERTEX_SPACING = { high: 10, low: 18 };

const VERT = /* glsl */ `
  uniform sampler2D uDepth;
  uniform vec3 uChannel;   // qual canal do mapa é desta camada
  uniform float uAspect;   // largura/altura do quadro inteiro
  uniform float uRelief;
  uniform float uFocus;
  varying vec2 vUv;
  varying vec2 vFrameUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    // o mapa cobre o quadro inteiro; a camada é só uma caixa dentro dele
    vec2 frameUv = vec2(p.x / uAspect + 0.5, p.y + 0.5);
    vFrameUv = frameUv;
    float z = dot(texture2D(uDepth, frameUv).rgb, uChannel);
    p.z += (z - uFocus) * uRelief;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

// sem iluminação: a luz já está nos pixels da foto. Só a contraluz soma
// alguma coisa, e só perto do contorno — o miolo da figura fica exatamente
// como na foto. Dois termos:
//  - fios: onde o alfa da camada é parcial (cabelo), a luz passa por eles;
//  - borda: uma faixa por dentro do contorno da silhueta INTEIRA (uSil, a
//    união das camadas), como a luz de trás "comendo" ombros e cabeça. A
//    intensidade é a da luz logo do lado de fora daquele trecho da borda, então
//    acende onde há luz atrás e fica escuro onde não há. Atenuada em pixels
//    claros (pele, camisa).
const FRAG = /* glsl */ `
  precision highp float;
  ${LIGHT_GLSL}
  uniform sampler2D uColor;
  uniform sampler2D uSil;
  uniform vec2 uSilTexel;
  uniform float uAspect;
  uniform float uRim;
  uniform float uEdgeRim;
  uniform float uEdgeWidth;   // raio da faixa, em texels de uSil
  uniform float uRimLayer;    // 0 na mão: ela está na frente do casaco
  uniform float uStrands;     // 1 só na cabeça (fios de cabelo)
  uniform float uXray;        // força da lente de raio X (xrayLens.js)
  uniform vec2 uLensQ;        // centro da lente, em q
  uniform float uLensR;       // raio da lente
  varying vec2 vUv;
  varying vec2 vFrameUv;

  void main() {
    vec4 c = texture2D(uColor, vUv);
    if (c.a < 0.004) discard;
    vec2 q = (vFrameUv - 0.5) * vec2(uAspect, 1.0);
    vec4 l = uplight(q);
    // só no cabelo: no casaco o alfa parcial é o contorno irregular do
    // recorte, e acendê-lo desenha uma linha serrilhada
    float strands = 4.0 * c.a * (1.0 - c.a) * uRim * l.a * uStrands;

    // faixa por dentro do contorno, só da silhueta desfocada (a nítida, a
    // 1/4 da resolução, fazia degraus): máxima na borda (G ≈ 0,5), some para
    // dentro. O alfa da própria camada, em resolução cheia, faz o
    // antisserrilhado — e zera a faixa nas emendas entre camadas.
    float g0 = texture2D(uSil, vFrameUv).g;
    float band = 1.0 - smoothstep(0.42, 0.95, g0);
    band *= band * smoothstep(0.15, 1.0, c.a);
    // normal para fora: o desfocado cai na direção de fora da figura
    vec2 dx = vec2(uSilTexel.x * 2.0, 0.0), dy = vec2(0.0, uSilTexel.y * 2.0);
    vec2 grad = vec2(texture2D(uSil, vFrameUv + dx).g - texture2D(uSil, vFrameUv - dx).g,
                     texture2D(uSil, vFrameUv + dy).g - texture2D(uSil, vFrameUv - dy).g);
    float glen = length(grad);
    vec2 outward = glen > 1e-4 ? -grad / glen : vec2(0.0);
    // a luz que está logo atrás deste trecho da borda
    vec2 qOut = q + outward * uEdgeWidth * 1.6 * uSilTexel * vec2(uAspect, 1.0);
    float behind = uplight(qOut).a;
    // a luz de trás só "come" a borda do que é escuro (casaco, cabelo); em
    // pele e camisa, que já são claras, ela vira um brilho estranho
    float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    float darkness = mix(0.12, 1.0, 1.0 - smoothstep(0.22, 0.6, lum));
    float edgeRim = band * behind * darkness * uEdgeRim * uRimLayer;

    vec3 add = l.rgb * (strands * mix(0.4, 1.0, darkness) + edgeRim);
    // luz saindo de dentro da cabeça: atravessa pele e cabelo
    add += l.rgb * headGlow(q, uHeadR) * 0.85;
    // "screen": clareia sem estourar os brancos da foto
    c.rgb = 1.0 - (1.0 - c.rgb) * (1.0 - clamp(add, 0.0, 1.0));

    // raio X (só na camada da cabeça): um borrão suave em volta do ponteiro
    // (gaussiana, um pouco mais alta que larga — sem borda nem aro) onde a
    // foto vira um negativo escuro e translúcido; o cérebro (xrayLens.js)
    // aparece por cima
    if (uXray > 0.002 && uStrands > 0.5) {
      vec2 le = (q - uLensQ) / vec2(uLensR, uLensR * 1.15);
      float lens = uXray * exp(-2.2 * dot(le, le));
      float lumX = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      vec3 neg = mix(vec3(0.02, 0.022, 0.026), vec3(0.6, 0.62, 0.66), pow(1.0 - lumX, 2.4) * 0.6);
      c.rgb = mix(c.rgb, neg, lens);
    }
    gl_FragColor = c;
  }
`;

const HEAD_GLOW_R = 0.105;

/** centro da camada "head" em coordenadas q (ver LIGHT_GLSL) */
function headQ(manifest, W, H) {
  const h = manifest.layers.find((l) => l.name === "head");
  if (!h) return new THREE.Vector2(0, 0.2);
  // um pouco acima do centro da caixa (ela desce até o pescoço) e para trás
  // da cabeça (o rosto olha para a esquerda): é por ali que o feixe entra
  const cx = (h.x + h.w * 0.6) / W;
  const cy = (h.y + h.h * 0.42) / H;
  return new THREE.Vector2((cx - 0.5) * (W / H), 0.5 - cy);
}

// direção (na foto, y para baixo) de onde o feixe vem: de cima e de trás da
// cabeça. Só serve para achar o ponto de contato na borda
const ENTRY_FROM = { x: 0.5, y: -0.87 };

/**
 * ponto onde o feixe do cérebro toca a cabeça, em q: exatamente na borda da
 * silhueta, do lado de onde ele vem. Sai de dentro da cabeça e anda na
 * direção do feixe até a silhueta suavizada (`soft`, sem os fios soltos do
 * cabelo) acabar.
 */
function entryQ(manifest, W, H, soft, sw, sh) {
  const h = manifest.layers.find((l) => l.name === "head");
  if (!h) return new THREE.Vector2(0.05, 0.3);
  let x = (h.x + h.w * 0.55) / SIL_SCALE;
  let y = (h.y + h.h * 0.32) / SIL_SCALE;
  const at = (px, py) => {
    const ix = Math.round(px);
    const iy = Math.round(py);
    if (ix < 0 || iy < 0 || ix >= sw || iy >= sh) return 0;
    return soft[iy * sw + ix];
  };
  const step = 0.5;
  for (let i = 0; i < 4 * Math.max(sw, sh) && at(x, y) >= 0.5; i++) {
    x += ENTRY_FROM.x * step;
    y += ENTRY_FROM.y * step;
  }
  const cx = (x * SIL_SCALE) / W;
  const cy = (y * SIL_SCALE) / H;
  return new THREE.Vector2((cx - 0.5) * (W / H), 0.5 - cy);
}

/** desfoque de caixa separável, `passes` vezes (3 já é quase gaussiano) */
function boxBlur(src, w, h, r, passes) {
  let a = Float32Array.from(src);
  let b = new Float32Array(a.length);
  const n = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[y * w + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        b[y * w + x] = acc / n;
        acc += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
      }
    }
    [a, b] = [b, a];
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        b[y * w + x] = acc / n;
        acc += a[Math.min(h - 1, y + r + 1) * w + x] - a[Math.max(0, y - r) * w + x];
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

function loadTexture(url, { mipmaps }) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        // dados crus: o shader não converte espaço de cor, então os valores
        // da foto saem exatamente como entraram
        tex.colorSpace = THREE.NoColorSpace;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = mipmaps;
        // a profundidade é lida no vertex shader, onde mipmap não tem LOD
        tex.minFilter = mipmaps
          ? THREE.LinearMipmapLinearFilter
          : THREE.LinearFilter;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

/**
 * @param {{ canvas: HTMLCanvasElement, host: HTMLElement,
 *           manifest: { width: number, height: number,
 *                       depthChannels: string[], focus: number,
 *                       layers: { name: string, x: number, y: number,
 *                                 w: number, h: number }[] },
 *           urls: Record<string, string>, animate?: boolean,
 *           region?: HTMLElement }} opts
 *   `urls` tem uma entrada por camada (`head`, `body`, `hand`) e `depth`.
 *   `region`: área onde o ponteiro move a órbita (padrão: o próprio host).
 *   `animate: false` desenha um único quadro em repouso.
 */
export async function createDepthPortrait({
  canvas,
  host,
  manifest,
  urls,
  animate = true,
  region = host,
}) {
  const { width: W, height: H } = manifest;
  const [depthTex, ...colorTex] = await Promise.all([
    loadTexture(urls.depth, { mipmaps: false }),
    ...manifest.layers.map((l) => loadTexture(urls[l.name], { mipmaps: true })),
  ]);

  // Cada camada só se encaixa com a caixa que o bake gravou para ela. Se a
  // imagem e o manifesto vierem de bakes diferentes (refazer o bake com a
  // página aberta: o hot reload troca um e não o outro), o recorte sai
  // esticado — o casaco cobre a cabeça. Nesse caso não monta: fica a imagem
  // plana.
  manifest.layers.forEach((l, i) => {
    const { width, height } = colorTex[i].image;
    if (width !== l.w || height !== l.h) {
      [depthTex, ...colorTex].forEach((t) => t.dispose());
      throw new Error(
        `camada "${l.name}" tem ${width}x${height}, o manifesto diz ${l.w}x${l.h}`,
      );
    }
  });

  // silhueta inteira (união das camadas) em baixa resolução: é dela que sai o
  // contorno da contraluz, para as emendas entre camadas não acenderem
  const silCanvas = document.createElement("canvas");
  silCanvas.width = Math.ceil(W / SIL_SCALE);
  silCanvas.height = Math.ceil(H / SIL_SCALE);
  const sctx = silCanvas.getContext("2d");
  manifest.layers.forEach((l, i) => {
    sctx.drawImage(
      colorTex[i].image,
      l.x / SIL_SCALE,
      l.y / SIL_SCALE,
      l.w / SIL_SCALE,
      l.h / SIL_SCALE,
    );
  });
  // R = silhueta nítida, G = a mesma desfocada (3 passadas de caixa ≈
  // gaussiana). A faixa da contraluz é R − G: uma queda contínua para dentro,
  // sem os degraus que amostrar anéis no shader criava. Linhas invertidas: a
  // textura tem v = 0 embaixo, como o quadro.
  const sw = silCanvas.width;
  const sh = silCanvas.height;
  const px = sctx.getImageData(0, 0, sw, sh).data;
  const sharp = new Float32Array(sw * sh);
  for (let i = 0; i < sharp.length; i++) sharp[i] = px[i * 4 + 3] / 255;
  const soft = boxBlur(sharp, sw, sh, Math.max(1, Math.round(LIGHT.edgeWidth / 1.7)), 3);
  const silData = new Uint8Array(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const src = y * sw + x;
      const dst = ((sh - 1 - y) * sw + x) * 4;
      silData[dst] = sharp[src] * 255;
      silData[dst + 1] = soft[src] * 255;
      silData[dst + 3] = 255;
    }
  }
  const silTex = new THREE.DataTexture(silData, sw, sh, THREE.RGBAFormat);
  silTex.needsUpdate = true;
  silTex.colorSpace = THREE.NoColorSpace;
  silTex.wrapS = silTex.wrapT = THREE.ClampToEdgeWrapping;
  silTex.minFilter = silTex.magFilter = THREE.LinearFilter;
  silTex.generateMipmaps = false;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const low = quality.tier === "low";
  const spacing = low ? VERTEX_SPACING.low : VERTEX_SPACING.high;
  const aspect = W / H;

  // uniforms compartilhados: um ajuste vale para as três camadas
  const shared = {
    uDepth: { value: depthTex },
    uAspect: { value: aspect },
    uRelief: { value: RELIEF },
    // z que fica parado na órbita (o do rosto), medido no bake
    uFocus: { value: manifest.focus ?? 0.3 },
    uTime: { value: 0 },
    uLightGain: { value: LIGHT.gain },
    uLightSrc: { value: new THREE.Vector2(...LIGHT.src) },
    uLightTilt: { value: LIGHT.tilt },
    uRim: { value: LIGHT.rim },
    uSil: { value: silTex },
    uSilTexel: { value: new THREE.Vector2(1 / silCanvas.width, 1 / silCanvas.height) },
    uEdgeRim: { value: LIGHT.edgeRim },
    uEdgeWidth: { value: LIGHT.edgeWidth },
    // centro da cabeça = centro da caixa da camada "head" do bake, em q
    // (unidades do quadro, origem no centro, y para cima); raio ~ meia
    // largura da cabeça
    uHeadGlow: { value: 0 },
    uHeadQ: { value: headQ(manifest, W, H) },
    uHeadR: { value: HEAD_GLOW_R },
    // raio X na cabeça (xrayLens.js)
    uXray: { value: 0 },
    uLensQ: { value: new THREE.Vector2() },
    uLensR: { value: 0.09 },
  };

  const scene = new THREE.Scene();
  const disposables = [depthTex, silTex];

  // a luz: primeiro a ser desenhada, atrás de tudo
  const resolution = new THREE.Vector2(1, 1);
  {
    const geometry = new THREE.PlaneGeometry(aspect * LIGHT.scale, LIGHT.scale);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: shared.uTime,
        uLightGain: shared.uLightGain,
        uLightSrc: shared.uLightSrc,
        uLightTilt: shared.uLightTilt,
        uHeadGlow: shared.uHeadGlow,
        uHeadQ: shared.uHeadQ,
        uHeadR: shared.uHeadR,
        // fator de perspectiva do plano recuado (câmera na distância típica
        // do "cover"; varia pouco com o tamanho do host)
        uLightScale: { value: 1 + LIGHT.depth / (0.5 / OVERSCAN / Math.tan(deg(FOV) / 2)) },
        uResolution: { value: resolution },
      },
      vertexShader: LIGHT_VERT,
      fragmentShader: LIGHT_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = -LIGHT.depth;
    mesh.renderOrder = -1;
    scene.add(mesh);
    disposables.push(geometry, material);
  }
  manifest.layers.forEach((l, i) => {
    const tex = colorTex[i];
    tex.anisotropy = anisotropy;
    // caixa da camada em unidades do quadro (altura = 1, origem no centro)
    const geometry = new THREE.PlaneGeometry(
      l.w / H,
      l.h / H,
      Math.max(2, Math.ceil(l.w / spacing)),
      Math.max(2, Math.ceil(l.h / spacing)),
    );
    geometry.translate((l.x + l.w / 2) / H - aspect / 2, 0.5 - (l.y + l.h / 2) / H, 0);
    const channel = new THREE.Vector3(
      ...["r", "g", "b"].map((_, c) => (manifest.depthChannels[c] === l.name ? 1 : 0)),
    );
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        uColor: { value: tex },
        uChannel: { value: channel },
        uRimLayer: { value: l.name === "hand" ? 0 : 1 },
        uStrands: { value: l.name === "head" ? 1 : 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      // a oclusão é a ordem das camadas (de trás para frente), não o z-buffer
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = i;
    scene.add(mesh);
    disposables.push(geometry, material, tex);
  });

  // o fim da corrente do cérebro, entrando na cabeça por cima da foto
  // (headInflow.js); só existe com animação
  const entry = entryQ(manifest, W, H, soft, sw, sh);
  const inflow = animate ? createHeadInflow(shared, entry) : null;
  if (inflow) {
    scene.add(inflow.group);
    disposables.push(...inflow.disposables);
  }

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 20);
  let camDist = 3;

  /** "cover": o quadro preenche o host como object-fit: cover faria */
  function fit() {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, low ? 1.5 : 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    renderer.getDrawingBufferSize(resolution);
    camera.aspect = w / h;
    const visH = Math.max(1, aspect / camera.aspect) / OVERSCAN;
    camDist = visH / 2 / Math.tan(deg(FOV) / 2);
    camera.updateProjectionMatrix();
    // onde fica o ponto de entrada na caixa do host (fração), na pose de
    // repouso: o hero mira a corrente do palco nele
    portraitLight.entry = {
      x: 0.5 + entry.x / (visH * camera.aspect),
      y: 0.5 - entry.y / visH,
    };
  }
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(host);

  // alvo (ponteiro) e valor suavizado (damp: nunca salta direto ao alvo)
  let tx = 0;
  let ty = 0;
  let yaw = 0;
  let pitch = 0;
  // vai-e-vem só em telas sem mouse (toque): com mouse, fora da área o
  // retrato fica parado na pose padrão, e dentro só segue o ponteiro
  const hasHover = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false;
  let sway = hasHover ? 0 : 1; // some quando o ponteiro está em uso
  let lastMove = -1e9;

  // o ponteiro só conta dentro de `region`, medido em relação a ela (bordas
  // = giro máximo); ao sair, volta ao centro e o vai-e-vem retoma
  const clamp1 = (v) => Math.max(-1, Math.min(1, v));
  let pointerXY = null; // para a lente de raio X
  const onPointerMove = (e) => {
    pointerXY = { x: e.clientX, y: e.clientY };
    const r = region.getBoundingClientRect();
    tx = clamp1(((e.clientX - r.left) / r.width) * 2 - 1);
    ty = clamp1(((e.clientY - r.top) / r.height) * 2 - 1);
    lastMove = performance.now();
  };
  const onPointerLeave = () => {
    pointerXY = null;
    tx = 0;
    ty = 0;
    lastMove = -1e9;
  };
  if (animate) {
    region.addEventListener("pointermove", onPointerMove);
    region.addEventListener("pointerleave", onPointerLeave);
  }

  // raio X ao passar o mouse na cabeça: só com mouse e com animação
  const headLayer = manifest.layers.find((l) => l.name === "head");
  const xray =
    animate && hasHover && headLayer
      ? createXrayLens({
          scene,
          shared,
          head: headLayer,
          W,
          H,
          sil: sharp,
          sw,
          sh,
          silScale: SIL_SCALE,
          url: quality.mesh === "low" ? "/assets/brain-low.glb" : "/assets/brain.glb",
        })
      : null;

  function place() {
    camera.position.set(
      Math.sin(yaw) * Math.cos(pitch) * camDist,
      Math.sin(pitch) * camDist,
      Math.cos(yaw) * Math.cos(pitch) * camDist,
    );
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }

  function draw(t, dt) {
    const pointerActive = performance.now() - lastMove < 2500;
    sway = damp(sway, hasHover ? 0 : pointerActive ? 0.25 : 1, dt, 1.2);
    const tYaw = tx * MAX_YAW + Math.sin(t * 0.5) * IDLE_YAW * sway;
    const tPitch = -ty * MAX_PITCH + Math.cos(t * 0.37) * IDLE_PITCH * sway;
    yaw = damp(yaw, tYaw, dt, 3.2);
    pitch = damp(pitch, tPitch, dt, 3.2);
    shared.uTime.value = t;
    // apagada até o feixe do cérebro chegar (lib/portraitLight.js)
    shared.uLightGain.value = LIGHT.gain * portraitLightGain();
    shared.uHeadGlow.value = portraitHeadGlow();
    inflow?.update(portraitLight.beam, portraitLight.level, portraitLight.dir);
    if (xray) {
      // a lente mira com a câmera deste quadro (a órbita já andou)
      camera.position.set(
        Math.sin(yaw) * Math.cos(pitch) * camDist,
        Math.sin(pitch) * camDist,
        Math.cos(yaw) * Math.cos(pitch) * camDist,
      );
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      xray.update(dt, camera, canvas, pointerXY);
    }
    place();
  }

  let raf = 0;
  let last = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const t = now / 1000;
    const dt = Math.min(0.05, last ? t - last : 0.016);
    last = t;
    draw(t, dt);
  };

  // primeiro quadro em repouso, para a troca <img> → <canvas> não piscar
  place();

  return {
    /** uniforms compartilhados (relevo, foco) — para ajuste fino no console */
    uniforms: shared,
    render: place,
    /** pose atual em graus (debug/teste) */
    get pose() {
      return { yaw: (yaw * 180) / Math.PI, pitch: (pitch * 180) / Math.PI };
    },
    /** pose fixa (debug/teste): congela a órbita no ângulo dado */
    setPose(yawRad, pitchRad) {
      yaw = yawRad;
      pitch = pitchRad;
      tx = yawRad / MAX_YAW;
      ty = -pitchRad / MAX_PITCH;
      lastMove = performance.now();
      place();
    },
    start() {
      if (!animate || raf) return;
      last = 0;
      raf = requestAnimationFrame(loop);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
    dispose() {
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      region.removeEventListener("pointermove", onPointerMove);
      region.removeEventListener("pointerleave", onPointerLeave);
      disposables.forEach((d) => d.dispose());
      xray?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
