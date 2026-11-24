/* ---------------------------------------------------------------
   O carimbo que molda o lacre, no envio da mensagem (envelope3d.js).

   Depois que o lacre se refaz de 0s e 1s ele é só uma gota de cera lisa
   (o morph "Sem_Carimbo" do envelope.glb, e sem o normal map do logo). O
   carimbo de latão entra inclinado pelo alto, endireita sobre o lacre,
   desce, prensa — a gota vira o lacre com o logo e a cavidade — segura um
   instante e vai embora.

   Tudo é função de s (0..1), a variável --stamp que Contact.css anima no
   .mail__seal escondido (1 = já carimbado, o estado normal):

     0 → ENTER       surge (fade) em cima/direita, inclinado, e vem girando
     ENTER → PRESS   desce acelerando até encostar
     PRESS → LIFT    segura (um pequeno assentamento)
     LIFT → 1        sobe e sai para onde veio, sumindo no fim

   O carimbo e a sombra dele ficam na camada do estouro (LAYER_FX): a tela
   maior, acima do envelope.
   --------------------------------------------------------------- */
import * as THREE from "three";
import { LAYER_FX } from "./sealBurst.js";

const ENTER = 0.36;
const PRESS = 0.5;
const LIFT = 0.62;
// quanto a gota é mais alta que o lacre prensado (envelope.blend, Sem_Carimbo)
const BLOB_H = 0.021;
const HOVER = 0.16;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t * t;
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * @param {{ stamp: THREE.Object3D, seal: THREE.Mesh, scene: THREE.Scene,
 *           lightDir: THREE.Vector3 }} opts  seal já com o matrixWorld do
 *           envelope fechado; lightDir aponta da cena para a luz
 */
export function createSealStamp({ stamp, seal, scene, lightDir }) {
  // o carimbo passa a viver em coordenadas de mundo
  scene.attach(stamp);
  stamp.traverse((o) => o.layers.set(LAYER_FX));
  stamp.visible = false;
  // materiais próprios: o carimbo surge e some num fade (assim não nasce
  // cortado pela borda da tela do efeito)
  const mats = [];
  stamp.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    mats.push(o.material);
  });
  const baseQ = stamp.quaternion.clone();

  // centro do lacre e a altura do miolo prensado, em mundo
  const pos = seal.geometry.attributes.position;
  const v = new THREE.Vector3();
  const pts = [];
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(seal.matrixWorld);
    pts.push(v.clone());
    c.add(v);
  }
  c.divideScalar(pts.length);
  let zs = 0;
  let nz = 0;
  for (const p of pts) {
    if (Math.hypot(p.x - c.x, p.y - c.y) < 0.05) {
      zs += p.z;
      nz++;
    }
  }
  const contactZ = nz ? zs / nz : c.z;

  // o morph da gota e o normal map do logo (some enquanto é gota)
  const dict = seal.morphTargetDictionary || {};
  const blobIdx = dict.Sem_Carimbo ?? -1;
  const sealMat = seal.material;
  const baseNormal = sealMat.normalScale ? sealMat.normalScale.clone() : null;
  // a gota é cera acetinada: sem o espelho do ouro polido, que numa cúpula
  // afunila o reflexo do ambiente no centro
  const baseRough = sealMat.roughness ?? 0.3;
  const BLOB_ROUGH = 0.46;

  // trajetória
  const hover = new THREE.Vector3(c.x, c.y, contactZ + HOVER);
  const from = new THREE.Vector3(c.x + 1.0, c.y + 0.95, contactZ + 0.85);
  const exit = new THREE.Vector3(c.x + 1.0, c.y + 1.05, contactZ + 0.95);
  // inclinado para o lado de onde vem (o cabo aponta para cima/direita)
  const tiltAxis = new THREE.Vector3(-1, 1, 0).normalize();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const qTilt = new THREE.Quaternion();
  const qSpin = new THREE.Quaternion();

  /* ---- sombra: mancha macia no papel, que aperta e escurece ao descer ---- */
  const shadowMat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { uAlpha: { value: 0 }, uSoft: { value: 0.5 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      uniform float uSoft;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = 1.0 - smoothstep(1.0 - uSoft, 1.0, d);
        gl_FragColor = vec4(0.0, 0.0, 0.0, a * uAlpha);
      }
    `,
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
  shadow.layers.set(LAYER_FX);
  shadow.renderOrder = -1;
  shadow.visible = false;
  scene.add(shadow);
  // para onde a sombra anda, por unidade de altura (luz de cima/esquerda)
  const shadowShift = new THREE.Vector2(-lightDir.x / lightDir.z, -lightDir.y / lightDir.z);

  const p = new THREE.Vector3();

  return {
    /** aplica o estado s (0..1); devolve se o carimbo está na tela */
    update(s) {
      let blob;
      let tilt = 0;
      let spin = 0;
      if (s <= 0.0001 || s >= 0.9999) {
        p.copy(hover);
        blob = s <= 0.0001 ? 1 : 0;
      } else if (s < ENTER) {
        const t = easeOut(s / ENTER);
        p.lerpVectors(from, hover, t);
        tilt = THREE.MathUtils.degToRad(38) * (1 - t);
        spin = 0.7 * (1 - t);
        blob = 1;
      } else if (s < PRESS) {
        const t = easeIn((s - ENTER) / (PRESS - ENTER));
        p.copy(hover);
        p.z = contactZ + HOVER * (1 - t);
        // a cera cede quando a face passa do topo da gota
        blob = clamp01((p.z - contactZ) / BLOB_H);
      } else if (s < LIFT) {
        // assenta: afunda um fio e volta
        const t = (s - PRESS) / (LIFT - PRESS);
        p.copy(hover);
        p.z = contactZ - 0.0025 * Math.sin(Math.PI * Math.min(1, t * 1.6));
        blob = 0;
      } else {
        const t = (s - LIFT) / (1 - LIFT);
        // primeiro sobe reto, depois vai embora inclinando
        const up = smooth(clamp01(t / 0.35));
        const away = easeIn(clamp01((t - 0.2) / 0.8));
        p.set(c.x, c.y, contactZ + 0.22 * up);
        p.lerp(exit, away);
        tilt = THREE.MathUtils.degToRad(32) * away;
        spin = -0.5 * away;
        blob = 0;
      }

      const on = s > 0.0001 && s < 0.9999;
      const fade = smooth(clamp01(s / 0.1)) * (1 - smooth(clamp01((s - 0.86) / 0.12)));
      stamp.visible = on && fade > 0.003;
      for (const m of mats) {
        m.transparent = fade < 0.999;
        m.opacity = fade;
        m.depthWrite = fade >= 0.999;
      }
      stamp.position.copy(p);
      qTilt.setFromAxisAngle(tiltAxis, tilt);
      qSpin.setFromAxisAngle(zAxis, spin);
      stamp.quaternion.copy(qTilt).multiply(qSpin).multiply(baseQ);

      if (blobIdx >= 0) seal.morphTargetInfluences[blobIdx] = blob;
      if (baseNormal) sealMat.normalScale.copy(baseNormal).multiplyScalar(1 - blob);
      sealMat.roughness = baseRough + (BLOB_ROUGH - baseRough) * blob;

      // sombra: no papel (logo abaixo do lacre), deslocada pela luz
      const h = Math.max(0, p.z - contactZ);
      shadow.visible = on;
      shadow.position.set(
        p.x + shadowShift.x * (h + 0.05),
        p.y + shadowShift.y * (h + 0.05),
        contactZ - 0.02,
      );
      const size = 0.24 + 0.5 * h;
      shadow.scale.set(size, size, 1);
      shadowMat.uniforms.uAlpha.value = 0.42 * (1 - clamp01(h / 1.4)) ** 2 * fade;
      shadowMat.uniforms.uSoft.value = 0.35 + 0.5 * clamp01(h / 0.8);
      return on;
    },
    dispose() {
      mats.forEach((m) => m.dispose());
      shadowMat.dispose();
      shadow.geometry.dispose();
    },
  };
}
