/* ---------------------------------------------------------------
   O lacre que estoura em 0s e 1s (seção de contato, envelope3d.js).

   Tudo é função de um único valor k (0..1), a variável --seal que
   Contact.css anima no .mail__seal escondido — então o mesmo efeito roda
   ao contrário quando o envelope é lacrado de novo (os dígitos voltam,
   implodem e o lacre esfria).

     0 → BURST   carga: veios de luz se abrem na cera, o lacre esquenta do
                 dourado para o branco, incha e treme cada vez mais rápido
     BURST       estouro: a cera se desfaz do centro para a borda (borda
                 incandescente, como o cérebro em brainBeam.js), um clarão
                 e uma onda de choque saem do lacre
     BURST → 1   os dígitos voam para fora e para a frente, rápidos no
                 começo e freando, depois sobem leves como faíscas, trocando
                 entre 0 e 1, do branco quente ao dourado, e somem

   No envio o lacre se forma por outro caminho (não é o estouro ao
   contrário), dirigido por --form (0..1): dígitos chegam de todas as
   direções por igual, em curvas, e a cera se solidifica da borda para o
   centro, incandescente, e esfria.

   O lacre (malha do glTF) recebe o shader de carga/dissolução; o clarão e
   os dígitos ficam numa camada própria (LAYER_FX), desenhada numa tela
   maior, acima do envelope e da folha, para terem espaço para voar.
   --------------------------------------------------------------- */
import * as THREE from "three";
import { glyphAlphaGLSL, glyphPickGLSL, glyphTexture } from "./brainBeam.js";

/** em k: onde a carga termina e o lacre estoura */
export const BURST = 0.4;
// em k: quanto dura a cera se desfazendo (~70 ms) e o clarão + onda
const DISSOLVE_SPAN = 0.045;
const FLASH_SPAN = 0.2;

export const LAYER_FX = 3;

const GOLD = new THREE.Color(1.0, 0.76, 0.36);
const HOT = new THREE.Color(1.0, 0.97, 0.9);

// ruído de valor 3D barato, igual no lacre inteiro
const noiseGLSL = /* glsl */ `
  float sbHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float sbNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(sbHash(i), sbHash(i + vec3(1, 0, 0)), f.x),
          mix(sbHash(i + vec3(0, 1, 0)), sbHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(sbHash(i + vec3(0, 0, 1)), sbHash(i + vec3(1, 0, 1)), f.x),
          mix(sbHash(i + vec3(0, 1, 1)), sbHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
`;

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * @param {THREE.Mesh} sealObj o lacre (já com o matrixWorld do envelope fechado)
 * @param {THREE.Scene} scene onde entram o clarão e os dígitos (em mundo)
 * @param {{ count: number }} opts
 */
export function createSealBurst(sealObj, scene, { count }) {
  const geo = sealObj.geometry;
  geo.computeBoundingSphere();
  const localCenter = geo.boundingSphere.center.clone();
  const radius = geo.boundingSphere.radius;

  /* ---- o lacre: carga (veios, calor) e dissolução ---- */
  const u = {
    uCharge: { value: 0 },
    uBurst: { value: 0 },
    uTime: { value: 0 },
    uCenter: { value: localCenter },
    uRadius: { value: radius },
    uGold: { value: GOLD },
    uHot: { value: HOT },
  };
  const mat = sealObj.material.clone();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSealPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSealPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uCharge;
        uniform float uBurst;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform float uRadius;
        uniform vec3 uGold;
        uniform vec3 uHot;
        varying vec3 vSealPos;
        ${noiseGLSL}
        // 0 no centro → 1 na borda, com ruído: a cera se rasga de dentro para fora
        float sbField() {
          vec3 q = (vSealPos - uCenter) / uRadius;
          return clamp(0.68 * length(q) + 0.32 * sbNoise(q * 3.0 + 4.1), 0.0, 1.0);
        }`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        float sbF = sbField();
        float sbT = uBurst * 1.12 - 0.06;
        if (uBurst > 0.0 && sbF < sbT) discard;`,
      )
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        {
          vec3 q = (vSealPos - uCenter) / uRadius;
          float c = uCharge;
          // veios: as curvas de nível do ruído, que engrossam com a carga
          float n = sbNoise(q * 4.0 + 1.7) * 0.62 + sbNoise(q * 9.0 - 3.1) * 0.38;
          float vein = 1.0 - smoothstep(0.0, 0.012 + 0.055 * c * c, abs(n - 0.5));
          // pulsa cada vez mais rápido perto do estouro
          float flick = 0.8 + 0.2 * sin(uTime * (18.0 + 60.0 * c) + n * 23.0);
          vec3 heat = mix(uGold, uHot, c * c);
          gl_FragColor.rgb += heat * (vein * smoothstep(0.08, 0.85, c) * 1.7 * flick
                                      + c * c * c * 1.1);
          // borda incandescente enquanto a cera se desfaz
          if (uBurst > 0.0) {
            float edge = 1.0 - smoothstep(0.0, 0.09, sbF - sbT);
            gl_FragColor.rgb += uHot * edge * 2.2;
          }
        }`,
      );
  };
  mat.customProgramCacheKey = () => "seal-burst";
  sealObj.material = mat;

  const basePos = sealObj.position.clone();
  const baseScale = sealObj.scale.clone();

  /* ---- em mundo: centro do lacre e os pontos de onde os dígitos saem ---- */
  const center = localCenter.clone().applyMatrix4(sealObj.matrixWorld);
  const src = geo.attributes.position;
  const n = Math.min(count, src.count);
  const start = new Float32Array(n * 3);
  const dir = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  const delay = new Float32Array(n);
  // formação (o lacre se refazendo no envio): de onde cada dígito vem e
  // quando chega. Origens uniformes em todas as direções — ângulo pelo
  // ângulo áureo (cobre o círculo por igual, sem buracos nem montes),
  // distância numa faixa, e profundidade da frente e de trás
  const from = new Float32Array(n * 3);
  const arrive = new Float32Array(n);
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const v = new THREE.Vector3();
  const stride = src.count / n;
  for (let i = 0; i < n; i++) {
    const j = Math.min(src.count - 1, Math.floor((i + Math.random()) * stride));
    v.fromBufferAttribute(src, j);
    const rLocal = v.distanceTo(localCenter) / radius;
    v.applyMatrix4(sealObj.matrixWorld);
    start.set([v.x, v.y, v.z], i * 3);
    // para fora no plano do envelope (+ um pouco de espalhamento), e para a
    // câmera: a explosão "salta" da página
    let dx = v.x - center.x;
    let dy = v.y - center.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) {
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
    } else {
      dx /= len;
      dy /= len;
    }
    const spread = (Math.random() - 0.5) * 0.9;
    const c = Math.cos(spread);
    const s = Math.sin(spread);
    // quanto vai para os lados: uma parte quase não abre e é lançada para a
    // frente (para a câmera) — é ela que enche o centro, onde estava o lacre
    const side = Math.random() < 0.35 ? 0.08 + Math.random() * 0.3 : 0.55 + Math.random() * 0.45;
    const fwd = 0.2 + Math.random() * 0.9;
    const ox = (dx * c - dy * s) * side;
    let oy = (dx * s + dy * c) * side;
    // leves: o impulso para baixo é fraco (o que sai para baixo logo para e sobe)
    if (oy < 0) oy *= 0.4;
    const d = new THREE.Vector3(ox, oy, fwd);
    d.normalize();
    dir.set([d.x, d.y, d.z], i * 3);
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
    // o centro solta primeiro, como a cera
    delay[i] = Math.min(1, rLocal) * 0.09 + Math.random() * 0.03;

    const ang = i * GOLDEN + (Math.random() - 0.5) * 0.15;
    const far = 0.75 + Math.random() * 0.6;
    from.set([Math.cos(ang) * far, Math.sin(ang) * far, -0.35 + Math.random() * 1.2], i * 3);
    // a borda chega primeiro, o centro por último: a cera se fecha para dentro
    arrive[i] = 0.42 + 0.3 * (1 - Math.min(1, rLocal)) + Math.random() * 0.18;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.BufferAttribute(start, 3));
  pg.setAttribute("aDir", new THREE.BufferAttribute(dir, 3));
  pg.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
  pg.setAttribute("aDelay", new THREE.BufferAttribute(delay, 1));
  pg.setAttribute("aFrom", new THREE.BufferAttribute(from, 3));
  pg.setAttribute("aArrive", new THREE.BufferAttribute(arrive, 1));

  const pu = {
    uP: { value: 0 },
    uForm: { value: 1 },
    uMode: { value: 0 },
    uTime: { value: 0 },
    uUnitPx: { value: 100 },
    uSize: { value: 0.05 },
    uGlyphs: { value: glyphTexture() },
    uGold: { value: GOLD },
    uHot: { value: HOT },
  };
  const pMat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: pu,
    vertexShader: /* glsl */ `
      uniform float uP;
      uniform float uForm;
      uniform float uMode;
      uniform float uTime;
      uniform float uUnitPx;
      uniform float uSize;
      attribute vec3 aDir;
      attribute vec4 aSeed;
      attribute float aDelay;
      attribute vec3 aFrom;
      attribute float aArrive;
      varying float vAlpha;
      varying float vAge;
      varying float vGlyph;
      ${glyphPickGLSL}
      void main() {
        if (uMode > 0.5) {
          // formação: vem de longe, numa curva, freando, e some ao chegar
          // (vira cera). TRAVEL = quanto do tempo cada um passa viajando
          const float TRAVEL = 0.4;
          float u = clamp((uForm - (aArrive - TRAVEL)) / TRAVEL, 0.0, 1.0);
          float e = 1.0 - pow(1.0 - u, 2.4);
          vec3 side = normalize(vec3(-aFrom.y, aFrom.x, 0.0) + 1e-4);
          vec3 curve = side * (aSeed.x - 0.5) * 0.6 * sin(3.14159 * e);
          vec3 p = position + aFrom * (1.0 - e) + curve * (1.0 - e);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float size = uSize * (0.6 + 0.8 * aSeed.w) * (0.75 + 0.45 * (1.0 - u));
          gl_PointSize = size * uUnitPx / max(-mv.z, 0.1);
          float live = step(0.0001, u) * (1.0 - step(0.9999, u));
          vAlpha = live * smoothstep(0.0, 0.2, u) * (1.0 - smoothstep(0.86, 1.0, u))
                   * (0.55 + 0.45 * aSeed.y);
          vAge = 1.0 - u; // dourado longe, branco quente ao chegar
          vGlyph = glyphPick(aSeed.z, uTime);
          return;
        }
        float a = clamp((uP - aDelay) / (1.0 - aDelay), 0.0, 1.0);
        float on = step(aDelay, uP) * step(0.0001, uP);
        // explosivo: quase toda a distância no começo, depois freia
        float ease = (1.0 - exp(-6.5 * a)) / (1.0 - exp(-6.5));
        float dist = 0.22 + 0.9 * aSeed.x * aSeed.x;
        vec3 p = position + aDir * dist * ease;
        // leves: depois do impulso, sobem como faísca, balançando de leve
        p.y += (0.35 + 0.35 * aSeed.y) * pow(a, 1.6);
        p.x += 0.035 * sin(a * 7.0 + aSeed.z * 6.2831) * a;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = uSize * (0.6 + 0.8 * aSeed.w) * (1.3 - 0.5 * a);
        gl_PointSize = size * uUnitPx / max(-mv.z, 0.1);
        vAlpha = on * pow(1.0 - a, 1.4) * (0.55 + 0.45 * aSeed.y);
        vAge = a;
        vGlyph = glyphPick(aSeed.z, uTime);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uGold;
      uniform vec3 uHot;
      varying float vAlpha;
      varying float vAge;
      varying float vGlyph;
      ${glyphAlphaGLSL}
      void main() {
        float g = glyphAlpha(vGlyph);
        vec3 col = mix(uHot, uGold, smoothstep(0.0, 0.45, vAge));
        gl_FragColor = vec4(col, g * vAlpha);
      }
    `,
  });
  const points = new THREE.Points(pg, pMat);
  points.frustumCulled = false;
  points.renderOrder = 2;
  points.layers.set(LAYER_FX);
  scene.add(points);

  /* ---- clarão + onda de choque (e o halo da carga) ---- */
  const FLASH_SIZE = 1.8;
  const fu = { uCharge: { value: 0 }, uF: { value: 0 }, uGold: { value: GOLD }, uHot: { value: HOT } };
  const fMat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: fu,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uCharge;
      uniform float uF;
      uniform vec3 uGold;
      uniform vec3 uHot;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * ${FLASH_SIZE.toFixed(2)}; // em unidades do modelo
        float c = uCharge;
        float halo = c * c * c * 0.6 * exp(-pow(d / (0.11 + 0.08 * c), 2.0));
        float live = step(0.0001, uF) * step(uF, 0.9999);
        float fl = live * pow(1.0 - uF, 4.0);
        float flash = fl * 1.5 * exp(-pow(d / (0.12 + 0.3 * uF), 2.0));
        float r0 = 0.1 + 0.72 * (1.0 - pow(1.0 - uF, 3.0));
        float ring = live * pow(1.0 - uF, 2.0) * 0.55 * exp(-pow((d - r0) / (0.02 + 0.03 * uF), 2.0));
        float I = halo + flash + ring;
        vec3 col = mix(uGold, uHot, clamp(I * 1.2, 0.0, 1.0));
        gl_FragColor = vec4(col, clamp(I, 0.0, 1.0));
      }
    `,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(FLASH_SIZE, FLASH_SIZE), fMat);
  flash.position.copy(center);
  flash.position.z += 0.03;
  flash.renderOrder = 1;
  flash.layers.set(LAYER_FX);
  scene.add(flash);

  return {
    /** aplica o estado k (0..1) neste quadro */
    update(k, timeSec, form = 1) {
      if (form < 0.9999) {
        // formação: os dígitos chegam e a cera se solidifica da borda para
        // o centro, incandescente, e esfria
        const solid = clamp01((form - 0.45) / 0.45);
        u.uBurst.value = 1 - solid; // 1 = nada; 0 = inteiro
        const heat = form <= 0 ? 0 : Math.min(1, form / 0.3) * (1 - clamp01((form - 0.75) / 0.25));
        u.uCharge.value = 0.75 * heat;
        u.uTime.value = timeSec;
        sealObj.visible = form > 0 && solid > 0;
        sealObj.position.copy(basePos);
        sealObj.scale.copy(baseScale);
        pu.uMode.value = 1;
        pu.uForm.value = form;
        pu.uTime.value = timeSec;
        points.visible = form > 0;
        fu.uCharge.value = 0.7 * heat * solid;
        fu.uF.value = 0;
        flash.visible = form > 0;
        return;
      }
      pu.uMode.value = 0;
      const charge = clamp01(k / BURST) ** 2.2;
      const burst = clamp01((k - BURST) / DISSOLVE_SPAN);
      const charging = k > 0 && k < BURST;
      u.uCharge.value = k >= BURST ? 1 : charge;
      u.uBurst.value = burst;
      u.uTime.value = timeSec;
      sealObj.visible = burst < 1;

      // incha e treme cada vez mais, até estourar
      if (charging) {
        const amp = 0.0055 * charge * charge;
        sealObj.position.set(
          basePos.x + (Math.random() - 0.5) * 2 * amp,
          basePos.y + (Math.random() - 0.5) * 2 * amp,
          basePos.z + (Math.random() - 0.5) * 2 * amp,
        );
        sealObj.scale.copy(baseScale).multiplyScalar(1 + 0.08 * charge ** 3);
      } else {
        sealObj.position.copy(basePos);
        sealObj.scale.copy(baseScale);
      }

      fu.uCharge.value = k >= BURST ? 0 : charge;
      fu.uF.value = clamp01((k - BURST) / FLASH_SPAN);
      pu.uP.value = clamp01((k - BURST) / (1 - BURST));
      pu.uTime.value = timeSec;
      points.visible = k > BURST && k < 1;
      flash.visible = k > 0 && k < BURST + FLASH_SPAN;
    },
    /** há algo para desenhar na tela do efeito? */
    active(k, form = 1) {
      return (k > 0.001 && k < 0.999) || (form > 0.001 && form < 0.999);
    },
    /** pixels por unidade do modelo, a 1 unidade da câmera, na tela do efeito */
    setUnitPx(px) {
      pu.uUnitPx.value = px;
    },
    dispose() {
      mat.dispose();
      pMat.dispose();
      pg.dispose();
      fMat.dispose();
      flash.geometry.dispose();
    },
  };
}
