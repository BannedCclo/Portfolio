/* ---------------------------------------------------------------
   Envelope 3D da seção de contato (public/assets/envelope.glb).

   O modelo (assets-source/envelope.blend) substitui só o visual do envelope
   de CSS — a coreografia continua toda em Contact.css. A folha (o formulário,
   HTML) precisa ficar ENTRE o fundo e o bolso do envelope, então a cena é
   desenhada em duas telas, uma de cada lado da folha:

     trás   (z 1): o fundo, e a aba de cima quando está aberta (para trás)
     frente (z 4): as abas do bolso, e a aba de cima + o lacre quando fechada

   e uma terceira, maior, acima de tudo (z 6), para o lacre estourando em
   0s e 1s (sealBurst.js) — os dígitos voam para fora do envelope — e para
   o carimbo que molda o lacre no envio (sealStamp.js).

   A aba e o lacre de CSS (.mail__flap, .mail__seal) continuam no DOM, só
   invisíveis: a cada quadro o ângulo da aba e as variáveis --seal (0
   inteiro → 1 estourado), --form (0 sem lacre → 1 formado de dígitos) e
   --stamp (0 gota lisa → 1 carimbado) são lidos do estilo computado deles. Assim os tempos e curvas de
   abertura, lacre, carimbo, voo e chegada seguem valendo sem duplicar nada.

   Geometria (coordenadas do Blender, envelope de 2,2 × 1,1): as telas
   enquadram x ∈ [−1,15; 1,15] e y ∈ [−0,6; 1,35] — a sobra de cima é para a
   aba aberta. As porcentagens de .mail__gl em Contact.css saem daí.
   --------------------------------------------------------------- */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { quality } from "./stage.js";
import { LAYER_FX, createSealBurst } from "./sealBurst.js";
import { createSealStamp } from "./sealStamp.js";

const URL = "/assets/envelope.glb";

// enquadramento, em unidades do modelo (ver o comentário acima e Contact.css)
const VIEW = { x0: -1.15, x1: 1.15, y0: -0.6, y1: 1.35 };
// a tela do estouro: bem mais larga, centrada mais ou menos no lacre
const FX = { x0: -1.75, x1: 1.75, y0: -1.35, y1: 1.07 };
const FOV = 24; // graus (vertical): perspectiva leve, a aba "vem" para a frente ao girar
const FLAP_OPEN = THREE.MathUtils.degToRad(-170); // a aba aberta no Blender

// luz: exposição geral, luz rasante (relevo) e quanto o papel reflete o ambiente
const EXPOSURE = 0.95;
const KEY_LIGHT = 1.1;
const PAPER_ENV = 0.55;
// o papel estufado pelo que vai dentro: só desvia a normal (o contorno não
// muda), num campo de altura que zera nas bordas do envelope
const BULGE = 0.05;

const LAYER_FRONT = 1;
const LAYER_BACK = 2;

let gltfPromise = null;
function loadEnvelope() {
  if (!gltfPromise) {
    gltfPromise = new Promise((resolve, reject) => {
      new GLTFLoader().load(URL, resolve, undefined, reject);
    });
    // falhou: deixa tentar de novo numa próxima montagem
    gltfPromise.catch(() => {
      gltfPromise = null;
    });
  }
  return gltfPromise;
}

/* ângulo de rotateX (graus) do transform computado da aba de CSS.
   perspective() só mexe na 4ª linha da matriz; o bloco 3×3 é a rotação. */
function flapAngleDeg(el) {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  const m = new DOMMatrixReadOnly(t);
  const deg = THREE.MathUtils.radToDeg(Math.atan2(m.m23, m.m22));
  // −180° (aba toda aberta) volta da matriz como +180°: sem isto o clamp
  // em [−180, 0] a trataria como fechada
  return deg > 90 ? deg - 360 : deg;
}

/* --seal (registrada com @property em Contact.css): 0 inteiro → 1 estourado */
function sealProgress(el) {
  const k = parseFloat(getComputedStyle(el).getPropertyValue("--seal"));
  return Number.isFinite(k) ? Math.min(1, Math.max(0, k)) : 0;
}

/* --form: 0 sem lacre → 1 lacre formado (os dígitos chegando, no envio) */
function formProgress(el) {
  const f = parseFloat(getComputedStyle(el).getPropertyValue("--form"));
  return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 1;
}

/* --stamp: 0 lacre ainda liso (gota) → 1 já carimbado (o normal) */
function stampProgress(el) {
  const s = parseFloat(getComputedStyle(el).getPropertyValue("--stamp"));
  return Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : 1;
}

const SEAL_DIGITS = { high: 700, mid: 480, low: 320 };

/* Estufa o papel: h(x, y) = BULGE·(1 − (x/1,1)²)·(1 − (y/0,55)²) sobre o
   retângulo do envelope fechado (coordenadas de mundo), e a normal segue o
   gradiente. Com a luz de cima/esquerda, o alto-esquerdo clareia e o
   baixo-direito escurece — volume sem mexer na silhueta nem nas telas. */
function addPaperBulge(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uBulge = { value: BULGE };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vEnvW;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvEnvW = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vEnvW;\nuniform float uBulge;",
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          vec2 q = vEnvW.xy / vec2(1.1, 0.55);
          if (abs(q.x) < 1.0 && abs(q.y) < 1.0) {
            float ax = 1.0 - q.x * q.x;
            float ay = 1.0 - q.y * q.y;
            vec2 g = uBulge * vec2(-2.0 * q.x / 1.1 * ay, -2.0 * q.y / 0.55 * ax);
            float side = gl_FrontFacing ? 1.0 : -1.0;
            normal = normalize(normal - side * (viewMatrix * vec4(g, 0.0, 0.0)).xyz);
          }
        }`,
      );
  };
  material.customProgramCacheKey = () => "envelope-bulge";
  material.needsUpdate = true;
}

/**
 * Monta o envelope 3D nas duas telas. Devolve a função de desmontagem.
 * @param {{ back: HTMLCanvasElement, front: HTMLCanvasElement, fx: HTMLCanvasElement,
 *           flapEl: HTMLElement, sealEl: HTMLElement, onReady?: () => void,
 *           onFail?: () => void }} opts  onFail: sem WebGL ou sem modelo (fica o de CSS)
 */
export function mountEnvelope3D({ back, front, fx, flapEl, sealEl, onReady, onFail }) {
  let disposed = false;
  let raf = 0;
  let visible = false;
  const cleanups = [];

  const makeRenderer = (canvas) => {
    const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    // segura os brancos do papel (sem isso o relevo estoura) e o brilho do ouro
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = EXPOSURE;
    // sombras de verdade: a aba e o lacre sobre o bolso, as abas do bolso
    // sobre o fundo — é o que tira o envelope do "recorte chapado"
    r.shadowMap.enabled = quality.tier !== "low";
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    return r;
  };
  let rBack;
  let rFront;
  let rFx;
  try {
    rBack = makeRenderer(back);
    rFront = makeRenderer(front);
    rFx = makeRenderer(fx);
  } catch {
    // sem WebGL: fica o envelope de CSS
    rBack?.dispose();
    rFront?.dispose();
    onFail?.();
    return () => {};
  }
  // a tela do estouro, posicionada em relação ao envelope (2,2 × 1,1)
  Object.assign(fx.style, {
    left: `${((FX.x0 + 1.1) / 2.2) * 100}%`,
    width: `${((FX.x1 - FX.x0) / 2.2) * 100}%`,
    top: `${((0.55 - FX.y1) / 1.1) * 100}%`,
    height: `${((FX.y1 - FX.y0) / 1.1) * 100}%`,
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    FOV,
    (VIEW.x1 - VIEW.x0) / (VIEW.y1 - VIEW.y0),
    0.1,
    20,
  );
  const cy = (VIEW.y0 + VIEW.y1) / 2;
  const dist = (VIEW.y1 - VIEW.y0) / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  camera.position.set(0, cy, dist);
  camera.lookAt(0, cy, 0);
  // mesma câmera (mesmo ponto de vista), frustum assimétrico maior: o que
  // ela desenha casa pixel a pixel com as outras duas telas
  const fxCamera = new THREE.PerspectiveCamera();
  fxCamera.position.copy(camera.position);
  fxCamera.quaternion.copy(camera.quaternion);
  {
    const s = 0.1 / dist;
    fxCamera.projectionMatrix.makePerspective(
      FX.x0 * s,
      FX.x1 * s,
      (FX.y1 - cy) * s,
      (FX.y0 - cy) * s,
      0.1,
      20,
    );
    fxCamera.projectionMatrixInverse.copy(fxCamera.projectionMatrix).invert();
  }
  fxCamera.layers.set(LAYER_FX);

  // luz: ambiente de estúdio (o dourado do lacre precisa de reflexo) + uma
  // luz de cima à esquerda, rasante o bastante para o relevo do papel aparecer
  // o PMREM é uma textura de GPU: cada tela (cada contexto WebGL) precisa
  // do seu. Com um só, as telas de trás e do efeito ficavam sem reflexo do
  // ambiente — o fundo e a aba aberta saíam bem mais escuros que o bolso
  const room = new RoomEnvironment();
  const makeEnv = (r) => {
    const pmrem = new THREE.PMREMGenerator(r);
    const tex = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose();
    return tex;
  };
  const envBack = makeEnv(rBack);
  const envFront = makeEnv(rFront);
  const envFx = makeEnv(rFx);
  room.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose?.();
  });
  const key = new THREE.DirectionalLight(0xffffff, KEY_LIGHT);
  key.position.set(-1.4, 1.6, 1.3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  {
    const sc = key.shadow.camera;
    sc.left = -1.8;
    sc.right = 1.8;
    sc.top = 1.8;
    sc.bottom = -1.8;
    sc.near = 0.1;
    sc.far = 6;
    // as peças estão espalhadas pelas camadas das telas; a sombra vê todas
    sc.layers.enableAll();
  }
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.012;
  scene.add(key);
  scene.children.forEach((o) => o.layers.enableAll());

  let flap = null;
  let flapParts = [];
  let burst = null;
  let stamper = null;
  let fxDrawn = false;
  let sealMesh = null;
  const ownMats = [];

  const setLayer = (objs, layer) =>
    objs.forEach((o) => o.traverse((c) => c.layers.set(layer)));

  const resize = () => {
    const w = front.clientWidth;
    const h = front.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, quality.maxDpr ?? 1.5);
    for (const r of [rBack, rFront]) {
      r.setPixelRatio(dpr);
      r.setSize(w, h, false);
    }
    if (fx.clientWidth && fx.clientHeight) {
      rFx.setPixelRatio(dpr);
      rFx.setSize(fx.clientWidth, fx.clientHeight, false);
      burst?.setUnitPx((fx.clientHeight * dpr * dist) / (FX.y1 - FX.y0));
    }
    last.key = ""; // força redesenho
  };

  const last = { key: "" };
  const frame = () => {
    raf = 0;
    if (disposed || !flap) return;
    const deg = flapAngleDeg(flapEl); // 0 fechada → −180 aberta
    const k = sealProgress(sealEl);
    const st = stampProgress(sealEl);
    const fm = formProgress(sealEl);
    const stampOn = st > 0.0001 && st < 0.9999;
    const fxOn = (!!burst && burst.active(k, fm)) || (!!stamper && stampOn);
    // durante o estouro tudo se mexe a cada quadro (tremor, dígitos piscando)
    const stateKey = fxOn
      ? "fx" + performance.now()
      : `${deg.toFixed(2)}|${k.toFixed(4)}|${st.toFixed(4)}|${fm.toFixed(4)}`;
    if (stateKey !== last.key) {
      last.key = stateKey;
      // o shader do estouro dissolve o lacre, a sombra dele não saberia disso
      if (sealMesh) sealMesh.castShadow = !fxOn;
      flap.rotation.x = (Math.max(-180, Math.min(0, deg)) / -180) * FLAP_OPEN;
      // a aba (e o lacre, que vai junto) troca de tela quando passa de perfil
      setLayer(flapParts, deg > -90 ? LAYER_FRONT : LAYER_BACK);
      burst?.update(k, performance.now() / 1000, fm);
      stamper?.update(st);
      camera.layers.set(LAYER_BACK);
      scene.environment = envBack;
      rBack.render(scene, camera);
      camera.layers.set(LAYER_FRONT);
      scene.environment = envFront;
      rFront.render(scene, camera);
      if (fxOn) {
        scene.environment = envFx;
        rFx.render(scene, fxCamera);
        fxDrawn = true;
      } else if (fxDrawn) {
        rFx.clear();
        fxDrawn = false;
      }
    }
    if (visible) raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf && !disposed) raf = requestAnimationFrame(frame);
  };

  loadEnvelope()
    .then((gltf) => {
      if (disposed) return;
      const root = gltf.scene.clone(true);
      // glTF é y-para-cima: volta ao plano do Blender (envelope em XY, frente
      // para +Z, que é onde fica a câmera) e centraliza (no .blend ele está
      // em x = 4)
      root.rotation.x = Math.PI / 2;
      const envelope = root.getObjectByName("Envelope");
      if (envelope) envelope.position.set(0, 0, 0);

      flap = root.getObjectByName("Envelope_Aba_Superior");
      const sealObj = root.getObjectByName("Selo_Cera");
      if (!flap) throw new Error("envelope.glb sem Envelope_Aba_Superior");
      flapParts = [flap];

      // o clone do glTF divide os materiais com as montagens anteriores (a
      // cada envio o envelope é remontado): o papel ganha cópias próprias, se
      // não o shader do estufado seria injetado de novo no mesmo material
      const paperMats = new Map();
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.layers.set(LAYER_FRONT);
        if (o.name.startsWith("Envelope_")) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.material) {
            let m = paperMats.get(o.material);
            if (!m) {
              m = o.material.clone();
              addPaperBulge(m);
              paperMats.set(o.material, m);
              ownMats.push(m);
            }
            o.material = m;
          }
        }
        if (o.material && o.material.metalness < 0.5) {
          o.material.envMapIntensity = PAPER_ENV;
        }
        if (o.material?.normalMap) {
          o.material.normalMap.anisotropy = Math.min(
            8,
            rFront.capabilities.getMaxAnisotropy(),
          );
        }
      });
      const body = root.getObjectByName("Envelope_Corpo");
      if (body) setLayer([body], LAYER_BACK);

      scene.add(root);
      if (sealObj?.isMesh) {
        sealMesh = sealObj;
        sealObj.castShadow = true;
        // o estouro nasce do lacre na posição fechada (a aba em 0°)
        root.updateMatrixWorld(true);
        burst = createSealBurst(sealObj, scene, {
          count: SEAL_DIGITS[quality.tier] ?? SEAL_DIGITS.mid,
        });
        const stampObj = root.getObjectByName("Carimbo");
        if (stampObj) {
          stamper = createSealStamp({
            stamp: stampObj,
            seal: sealObj,
            scene,
            lightDir: key.position.clone().normalize(),
          });
        }
      }

      resize();
      onReady?.();
      kick();
    })
    .catch((err) => {
      // sem modelo: fica o envelope de CSS
      console.warn("[envelope3d]", err);
      if (!disposed) onFail?.();
    });

  const ro = new ResizeObserver(() => {
    resize();
    kick();
  });
  ro.observe(front);
  cleanups.push(() => ro.disconnect());

  // só anima enquanto está na tela
  // vale o aviso mais recente: o envelope que chega voando de fora da tela
  // pode gerar "saiu" e "entrou" na mesma chamada, e ler só o primeiro
  // pararia o desenho com o 3D congelado
  const io = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) kick();
  });
  io.observe(front);
  cleanups.push(() => io.disconnect());

  return () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    cleanups.forEach((fn) => fn());
    burst?.dispose();
    stamper?.dispose();
    envBack.dispose();
    envFront.dispose();
    envFx.dispose();
    key.shadow.dispose();
    ownMats.forEach((m) => m.dispose());
    rBack.dispose();
    rFront.dispose();
    rFx.dispose();
  };
}
