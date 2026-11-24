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

  /* Um contexto WebGL só, numa tela fora do DOM; as três telas da página são
     2D e recebem uma cópia (drawImage) logo depois de cada desenho. Antes
     eram três contextos por envelope — seis durante o envio, com dois
     envelopes montados — e, somados ao palco, ao feixe e ao retrato, o
     celular (iOS sobretudo) estourava a memória e descartava o contexto
     mais antigo: o do palco, que ficava branco com o ícone de erro. */
  let renderer;
  let ctxBack;
  let ctxFront;
  let ctxFx;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: document.createElement("canvas"),
      alpha: true,
      antialias: true,
    });
    ctxBack = back.getContext("2d");
    ctxFront = front.getContext("2d");
    ctxFx = fx.getContext("2d");
    if (!ctxBack || !ctxFront || !ctxFx) throw new Error("sem canvas 2D");
  } catch {
    // sem WebGL: fica o envelope de CSS
    renderer?.dispose();
    renderer?.forceContextLoss();
    onFail?.();
    return () => {};
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // segura os brancos do papel (sem isso o relevo estoura) e o brilho do ouro
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  // sombras de verdade: a aba e o lacre sobre o bolso, as abas do bolso
  // sobre o fundo — é o que tira o envelope do "recorte chapado"
  renderer.shadowMap.enabled = quality.tier !== "low";
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setScissorTest(true);

  // tamanho de cada tela da página, em px CSS, e a razão de pixels
  const size = { w: 0, h: 0, fw: 0, fh: 0, dpr: 1 };
  /** Desenha a cena num canto do buffer (do tamanho da tela de destino) e
   *  copia esse canto para a tela 2D. O buffer tem o tamanho da maior tela;
   *  o canto é o de baixo à esquerda (a origem do viewport do WebGL). */
  const drawBuf = new THREE.Vector2();
  const renderInto = (ctx, cam, w, h) => {
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.render(scene, cam);
    renderer.getDrawingBufferSize(drawBuf);
    const pw = Math.round(w * size.dpr);
    const ph = Math.round(h * size.dpr);
    const c = ctx.canvas;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(renderer.domElement, 0, drawBuf.y - ph, pw, ph, 0, 0, c.width, c.height);
  };
  const clearFx = () => ctxFx.clearRect(0, 0, fx.width, fx.height);
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
  // com um contexto só, um PMREM serve às três telas
  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  scene.environment = envMap;
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
    // resolução própria, não a do palco (quality.maxDpr, que no celular é
    // 1×): o envelope é pequeno e só redesenha quando algo muda, e em 1× numa
    // tela de 3× o desenho do lacre — poucas dezenas de px — virava borrão
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const fw = fx.clientWidth;
    const fh = fx.clientHeight;
    Object.assign(size, { w, h, fw, fh, dpr });
    // as telas 2D, na resolução de pixels de verdade
    for (const c of [back, front]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    fx.width = Math.round(fw * dpr);
    fx.height = Math.round(fh * dpr);
    // o buffer do WebGL cobre a maior das telas
    renderer.setPixelRatio(dpr);
    renderer.setSize(Math.max(w, fw), Math.max(h, fh), false);
    if (fw && fh) burst?.setUnitPx((fh * dpr * dist) / (FX.y1 - FX.y0));
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
      // a sombra é a mesma nas três passadas: calcula uma vez por quadro
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      camera.layers.set(LAYER_BACK);
      renderInto(ctxBack, camera, size.w, size.h);
      camera.layers.set(LAYER_FRONT);
      renderInto(ctxFront, camera, size.w, size.h);
      if (fxOn && size.fw && size.fh) {
        renderInto(ctxFx, fxCamera, size.fw, size.fh);
        fxDrawn = true;
      } else if (fxDrawn) {
        clearFx();
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
            renderer.capabilities.getMaxAnisotropy(),
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
    envMap.dispose();
    key.shadow.dispose();
    ownMats.forEach((m) => m.dispose());
    renderer.dispose();
    // dispose() não devolve o contexto ao navegador: sem isto, cada envio
    // deixava um contexto WebGL pendurado até o coletor de lixo passar
    renderer.forceContextLoss();
  };
}
