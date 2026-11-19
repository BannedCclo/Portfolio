/* ===========================================================
   xrayLens.js — raio X na cabeça do retrato

   Com o mouse sobre a cabeça, um borrão suave (sem borda) segue o
   ponteiro: dentro dele a foto vira um negativo escuro e translúcido (o shader das camadas lê
   uXray/uLensQ/uLensR, ver depthPortrait.js) e aparece o cérebro — o mesmo
   modelo do hero — dentro do crânio, desenhado como numa chapa: bordas
   (fresnel) claras, miolo quase transparente, as dobras somando luz.

   O cérebro é um objeto 3D na cena do retrato, então gira junto com a órbita
   da paralaxe. Ele só é desenhado dentro da lente e da silhueta da cabeça.

   Só em telas com mouse (hover). Carrega o modelo depois do retrato, sem
   atrasar o primeiro quadro (o navegador já o tem em cache, do hero).

   Coordenadas: as do retrato (q: unidades do quadro, altura 1, origem no
   centro, y para cima).
   =========================================================== */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { damp } from "../lib/motion.js";

// cérebro dentro do crânio, em fração da caixa da camada "head" do bake.
// Medido na foto (head.webp, 387×534): o crânio vai de logo atrás da testa
// (x ≈ 85) até a nuca (x ≈ 345), e do topo sob o cabelo (y ≈ 45) até a altura
// da orelha, onde fica a base (y ≈ 235)
const BRAIN = {
  cx: 0.49,
  cy: 0.295,
  // comprimento (frente–trás) em larguras da caixa da cabeça; em 3/4 ele
  // aparece ~8% mais curto
  length: 0.72,
  // o modelo tem a frente–trás no eixo z e o alto no y. −90° em y o põe de
  // perfil (frente para a esquerda); o rosto está em 3/4, virado ~40° para a
  // câmera, então a frente também vira para ela
  rotY: -Math.PI / 2 + 0.7,
  rotX: 0.08,
};
const LENS_R = 0.09; // raio do borrão (≈ onde ele some), em alturas de quadro

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {object} o.shared uniforms do retrato (uXray, uLensQ, uLensR, uSil, uAspect)
 * @param {{x:number,y:number,w:number,h:number}} o.head caixa da camada head (px da foto)
 * @param {number} o.W largura da foto
 * @param {number} o.H altura da foto
 * @param {Float32Array} o.sil silhueta nítida (0..1), 1/silScale da foto, y para baixo
 * @param {number} o.sw
 * @param {number} o.sh
 * @param {number} o.silScale
 * @param {string} o.url modelo do cérebro (.glb)
 */
export function createXrayLens({ scene, shared, head, W, H, sil, sw, sh, silScale, url }) {
  shared.uLensR.value = LENS_R;

  const toQ = (px, py) => new THREE.Vector2((px / W - 0.5) * (W / H), 0.5 - py / H);

  // --- o cérebro ---
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // cor pré-multiplicada somada (canvas pré-multiplicado)
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
    uniforms: {
      uXray: shared.uXray,
      uLensQ: shared.uLensQ,
      uLensR: shared.uLensR,
      uSil: shared.uSil,
      uAspect: shared.uAspect,
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec2 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xy;
        vec4 mv = viewMatrix * w;
        vN = normalize(normalMatrix * normal);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uXray;
      uniform vec2 uLensQ;
      uniform float uLensR;
      uniform sampler2D uSil;
      uniform float uAspect;
      varying vec3 vN;
      varying vec3 vV;
      varying vec2 vW;
      void main() {
        // o mesmo borrão da foto (depthPortrait.js): gaussiana sem borda
        vec2 le = (vW - uLensQ) / vec2(uLensR, uLensR * 1.15);
        float m = uXray * exp(-2.2 * dot(le, le));
        // só dentro da cabeça
        vec2 fuv = vec2(vW.x / uAspect + 0.5, vW.y + 0.5);
        m *= smoothstep(0.3, 0.8, texture2D(uSil, fuv).r);
        if (m < 0.003) discard;
        // chapa de raio X: o que está de lado (borda, paredes dos sulcos)
        // acumula mais tecido no caminho e fica mais claro
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float glow = 0.05 + 0.9 * pow(f, 2.2);
        vec3 gold = vec3(250.0, 209.0, 128.0) / 255.0;
        vec3 col = mix(gold, vec3(1.0, 0.97, 0.9), pow(f, 5.0));
        float a = glow * m * 0.55;
        gl_FragColor = vec4(col * a, a);
      }
    `,
  });

  let mesh = null;
  let disposed = false;
  new GLTFLoader().load(
    url,
    (gltf) => {
      if (disposed) return;
      let geometry = null;
      gltf.scene.traverse((o) => {
        if (!geometry && o.isMesh) geometry = o.geometry;
      });
      if (!geometry) return;
      geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      geometry.boundingBox.getSize(size);
      mesh = new THREE.Mesh(geometry, material);
      const c = toQ(head.x + head.w * BRAIN.cx, head.y + head.h * BRAIN.cy);
      mesh.position.set(c.x, c.y, 0.02);
      mesh.scale.setScalar(((head.w / H) * BRAIN.length) / size.z);
      mesh.rotation.set(BRAIN.rotX, BRAIN.rotY, 0, "YXZ");
      mesh.renderOrder = 50; // depois das camadas da foto
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
    },
    undefined,
    () => {}, // sem o modelo, a lente segue só com o negativo
  );

  // --- o ponteiro ---
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();
  const lens = new THREE.Vector2();
  let strength = 0;

  /** o ponteiro está sobre a cabeça? (caixa da camada, sem o pescoço, e silhueta) */
  function overHead(q) {
    const px = (q.x / (W / H) + 0.5) * W;
    const py = (0.5 - q.y) * H;
    if (px < head.x || px > head.x + head.w) return false;
    if (py < head.y || py > head.y + head.h * 0.72) return false;
    const ix = Math.floor(px / silScale);
    const iy = Math.floor(py / silScale);
    if (ix < 0 || iy < 0 || ix >= sw || iy >= sh) return false;
    return sil[iy * sw + ix] > 0.5;
  }

  return {
    /**
     * @param {number} dt
     * @param {THREE.Camera} camera na pose deste quadro
     * @param {HTMLCanvasElement} canvas
     * @param {{x:number,y:number}|null} pointer clientX/Y, ou null fora da área
     */
    update(dt, camera, canvas, pointer) {
      let target = 0;
      if (pointer) {
        const r = canvas.getBoundingClientRect();
        ndc.set(((pointer.x - r.left) / r.width) * 2 - 1, -((pointer.y - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        if (ray.ray.intersectPlane(plane, hit)) {
          const q = new THREE.Vector2(hit.x, hit.y);
          if (overHead(q)) {
            target = 1;
            // aparecendo do nada, nasce sob o ponteiro (não desliza até ele)
            if (strength < 0.01) lens.copy(q);
            lens.x = damp(lens.x, q.x, dt, 18);
            lens.y = damp(lens.y, q.y, dt, 18);
          }
        }
      }
      strength = damp(strength, target, dt, 8);
      if (strength < 0.002 && target === 0) strength = 0;
      shared.uXray.value = strength;
      shared.uLensQ.value.copy(lens);
      if (mesh) mesh.visible = strength > 0.002;
    },
    dispose() {
      disposed = true;
      material.dispose();
      mesh?.geometry.dispose();
    },
  };
}
