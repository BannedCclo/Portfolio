/* ===========================================================
   brainBeam.js — o cérebro se desfazendo numa corrente de luz que viaja
   até a cabeça do retrato (seção Sobre)

   Tudo é função de um único parâmetro `b` (0..1), dirigido pela rolagem em
   acts/hero.js, então o efeito anda para trás quando se rola para cima:

   - dissolução: a superfície do cérebro some por um campo de ruído (o mesmo
     nos três shaders — tecido, sinapses e partículas), com borda dourada
     incandescente. O lado voltado para o destino se desfaz primeiro.
   - liberação: cada partícula nasce exatamente quando o pedaço de superfície
     onde ela mora some (mesmo campo, mesmo limiar).
   - corrente: as partículas giram num vórtice em volta do eixo cérebro →
     cabeça, apertando enquanto avançam por uma curva, até convergirem num
     feixe fino que entra atrás da cabeça.

   Coordenadas: as partículas são filhas do brainGroup, então vivem no espaço
   local da malha; o destino (calculado em mundo a partir da posição da cabeça
   na tela) é convertido para esse espaço a cada quadro.
   =========================================================== */

import * as THREE from "three";

/** Janela de `b` em que a superfície se desfaz (e as partículas nascem). */
export const RELEASE = { start: 0.03, span: 0.42 };
/** Janela de `b` em que as partículas chegam à cabeça (cada uma num ponto). */
export const ARRIVE = { start: 0.62, span: 0.33 };

// campo de dissolução, 0..1: ruído na direção + viés para o lado do destino
export const dissolveGLSL = /* glsl */ `
  uniform vec3 uDisDir;
  float dissolveField(vec3 localPos) {
    vec3 dir = normalize(localPos);
    float n = snoise(dir * 2.6) * 0.5 + 0.5;
    float facing = 0.5 - 0.5 * dot(dir, uDisDir);
    return clamp(0.55 * n + 0.45 * facing, 0.0, 1.0);
  }
`;

// a fração da dissolução (0..1) → limiar no campo, com folga para os extremos
// do campo (que nunca chega a 0 nem a 1 de verdade) sumirem por inteiro
export const dissolveThresholdGLSL = /* glsl */ `
  float dissolveThreshold(float d) { return d * 1.08 - 0.04; }
`;

/**
 * Teste: partículas como dígitos 0 e 1 que alternam rápido (estilo Matrix),
 * nos dois trechos do feixe (aqui e headInflow.js). false = pontos redondos.
 */
export const BEAM_GLYPHS = true;
// os dígitos precisam de mais pixels que um ponto para serem legíveis; com
// mais área somando (blending aditivo), cada um fica mais fraco
export const GLYPH_SIZE = 6.5;
export const GLYPH_ALPHA = 0.85;
// dezenas de milhares de dígitos sobrepostos viram uma massa branca: só
// esta fração das partículas aparece no modo dígito
export const GLYPH_KEEP = 0.22;

let glyphTex = null;
/** textura com "0" (metade esquerda) e "1" (metade direita), só alfa */
export function glyphTexture() {
  if (glyphTex) return glyphTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const x = c.getContext("2d");
  x.fillStyle = "#fff";
  x.font = "bold 56px ui-monospace, Consolas, 'Courier New', monospace";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText("0", 32, 35);
  x.fillText("1", 96, 35);
  glyphTex = new THREE.CanvasTexture(c);
  glyphTex.minFilter = THREE.LinearMipmapLinearFilter;
  return glyphTex;
}

/** vertex: qual dígito (0 ou 1) este ponto mostra agora — troca ~12×/s */
export const glyphPickGLSL = /* glsl */ `
  float glyphPick(float seed, float t) {
    return mod(floor(t * (9.0 + 8.0 * fract(seed * 13.7)) + seed * 97.0), 2.0);
  }
`;
/** fragment: alfa do dígito `which` neste ponto */
export const glyphAlphaGLSL = /* glsl */ `
  uniform sampler2D uGlyphs;
  float glyphAlpha(float which) {
    vec2 uv = vec2((gl_PointCoord.x + which) * 0.5, 1.0 - gl_PointCoord.y);
    return texture2D(uGlyphs, uv).a;
  }
`;

export const beamUniforms = {
  uB: { value: 0 },
  uDissolve: { value: 0 },
  uDisDir: { value: new THREE.Vector3(1, 0, 0) },
  uTarget: { value: new THREE.Vector3() },
  uBend: { value: new THREE.Vector3(0, 1, 0) },
  uEdgeColor: { value: new THREE.Color(250 / 255, 209 / 255, 128 / 255) },
};

/**
 * Injeta a dissolução num material do three (MeshPhysicalMaterial do
 * tecido). Só no próprio material: o finale clona o tecido, e o clone não
 * herda o onBeforeCompile (é propriedade da instância), então segue inteiro.
 */
export function addDissolve(material, noiseGLSL) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = beamUniforms.uDissolve;
    shader.uniforms.uDisDir = beamUniforms.uDisDir;
    shader.uniforms.uEdgeColor = beamUniforms.uEdgeColor;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        ${noiseGLSL}
        ${dissolveGLSL}
        varying float vDis;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vDis = dissolveField(position);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        ${dissolveThresholdGLSL}
        uniform float uDissolve;
        uniform vec3 uEdgeColor;
        varying float vDis;`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        float disT = dissolveThreshold(uDissolve);
        if (uDissolve > 0.0005 && vDis < disT) discard;`,
      )
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        if (uDissolve > 0.0005) {
          // borda incandescente onde a superfície está se desfazendo, e o
          // tecido inteiro aquecendo um pouco — o cérebro "vira luz" antes
          // de ir embora
          float edge = 1.0 - smoothstep(0.0, 0.05, vDis - disT);
          float warm = smoothstep(0.0, 0.25, uDissolve);
          gl_FragColor.rgb += uEdgeColor * (edge * edge * 1.1 + warm * 0.05);
        }`,
      );
  };
  material.customProgramCacheKey = () => "brain-dissolve";
  material.needsUpdate = true;
}

/**
 * Nuvem de partículas amostrada dos vértices da malha.
 * @param {THREE.BufferGeometry} geometry malha do cérebro (já centrada)
 * @param {number} count quantas partículas
 * @param {string} noiseGLSL a mesma snoise() do hero
 */
export function createBeamPoints(geometry, count, noiseGLSL) {
  const src = geometry.attributes.position;
  const n = Math.min(count, src.count);
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  const stride = src.count / n;
  for (let i = 0; i < n; i++) {
    const j = Math.min(src.count - 1, Math.floor((i + Math.random()) * stride));
    pos[i * 3] = src.getX(j);
    pos[i * 3 + 1] = src.getY(j);
    pos[i * 3 + 2] = src.getZ(j);
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
  // as partículas saem muito da caixa da malha: sem isso o frustum culling
  // as cortaria no meio do caminho
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      ...beamUniforms,
      uTime: { value: 0 },
      uSize: { value: 2.2 * (BEAM_GLYPHS ? GLYPH_SIZE : 1) },
      uPixelRatio: { value: 1 },
      uGlyphs: { value: BEAM_GLYPHS ? glyphTexture() : null },
    },
    vertexShader: /* glsl */ `
      uniform float uB;
      uniform float uTime;
      uniform vec3 uTarget;
      uniform vec3 uBend;
      uniform float uSize;
      uniform float uPixelRatio;
      attribute vec4 aSeed;
      varying float vAlpha;
      varying float vHeat;
      varying float vGlyph;
      ${noiseGLSL}
      ${glyphPickGLSL}
      ${dissolveGLSL}
      ${dissolveThresholdGLSL}

      vec3 rotateAround(vec3 v, vec3 k, float a) {
        float c = cos(a), s = sin(a);
        return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
      }

      void main() {
        // nasce quando o pedaço de superfície dela some (mesmo limiar do
        // tecido): a fração de dissolução em que dissolveThreshold() cruza
        // o campo deste ponto
        float field = dissolveField(position);
        float d = (field + 0.04) / 1.08;
        float rel = ${RELEASE.start.toFixed(3)} + ${RELEASE.span.toFixed(3)} * d;
        float alive = smoothstep(rel, rel + 0.015, uB);
        // cada uma chega num momento diferente (ARRIVE): as primeiras já
        // entram na cabeça enquanto as últimas ainda saem do cérebro — é
        // isso que estica a nuvem numa corrente em vez de um bloco viajando
        float arrive = ${ARRIVE.start.toFixed(3)} + ${ARRIVE.span.toFixed(3)} * mix(d, aSeed.x, 0.6);
        float raw = (uB - rel) / max(arrive - rel, 0.05);
        float age = clamp(raw, 0.0, 1.0);
        // demora a sair do lugar, acelera no meio, assenta no fim
        float u = smoothstep(0.0, 1.0, pow(age, 1.5));
        // some ao chegar. O trecho final, por cima do cabelo, o próprio
        // retrato redesenha (headInflow.js): este canvas fica atrás do
        // conteúdo, então aqui o fim do feixe fica escondido pela cabeça
        alive *= 1.0 - smoothstep(0.94, 1.02, raw);

        vec3 axis = normalize(uTarget);
        vec3 mid = uTarget * 0.5 + uBend;
        float iu = 1.0 - u;
        vec3 spine = 2.0 * iu * u * mid + u * u * uTarget; // começa no centro (0)

        // vórtice: o ponto de origem gira em volta do eixo e aperta
        float turns = 1.6 + 1.6 * aSeed.x;
        float ang = u * turns * 6.2831853 + uTime * 0.5 * iu;
        vec3 swirl = rotateAround(position, axis, ang) * pow(iu, 2.4);

        // espessura da corrente: some no feixe final, mas nunca a zero
        vec3 jitter = (aSeed.yzw - 0.5) * (0.22 * iu * u + 0.03);
        // pequeno estouro para fora logo que solta, como uma faísca
        vec3 burst = normalize(position) * 0.22 * sin(3.14159 * clamp(age * 5.0, 0.0, 1.0)) * iu;

        vec3 p = spine + swirl + jitter + burst;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        float size = uSize * (0.55 + 0.9 * aSeed.w) * (1.0 + 0.6 * u);
        gl_PointSize = size * uPixelRatio * (6.0 / max(-mv.z, 0.5));

        // some no fim: a luz do retrato assume a partir daí
        float fadeOut = 1.0 - smoothstep(0.93, 0.99, uB);
        vAlpha = alive * fadeOut * (0.45 + 0.55 * aSeed.y);
        vHeat = u;
        vGlyph = glyphPick(aSeed.z, uTime);
        ${BEAM_GLYPHS ? `if (fract(aSeed.w * 7.31 + aSeed.y * 3.7) > ${GLYPH_KEEP.toFixed(2)}) { vAlpha = 0.0; gl_PointSize = 0.0; }` : ""}
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uEdgeColor;
      varying float vAlpha;
      varying float vHeat;
      varying float vGlyph;
      ${glyphAlphaGLSL}
      void main() {
        ${
          BEAM_GLYPHS
            ? "float a = glyphAlpha(vGlyph) * " + GLYPH_ALPHA.toFixed(2) + ";"
            : "float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, r); a *= a;"
        }
        // mais intensa quanto mais perto do feixe final
        // somadas (blending aditivo) milhares delas estouram para branco:
        // cada uma é fraca, e o feixe brilha pela densidade
        vec3 col = uEdgeColor * (0.55 + 0.45 * vHeat);
        gl_FragColor = vec4(col, a * vAlpha * 0.55);
      }
    `,
  });

  const points = new THREE.Points(g, material);
  points.frustumCulled = false;
  points.renderOrder = 10;
  points.visible = false;
  return points;
}
