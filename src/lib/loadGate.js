/* ===========================================================
   loadGate — o que a tela de loading espera além do palco 3D.

   O palco (three/stage.js, onStageReady) já segura o loading até o cérebro
   carregar. Outras peças que o começo da página usa — o retrato com volume,
   onde o feixe do cérebro chega — pedem para segurar também: `hold()` devolve
   uma função que libera. A tela de loading só sai quando o palco está pronto
   e não sobra nenhuma pendência.

   Teto de segurança (MAX_WAIT_MS): se algo travar, o loading sai mesmo assim
   — melhor um feixe sem destino do que a página presa no loading.
   =========================================================== */

const MAX_WAIT_MS = 12000;

let pending = 0;
let listeners = [];

function flush() {
  if (pending > 0) return;
  const cbs = listeners;
  listeners = [];
  cbs.forEach((cb) => cb());
}

/** segura a tela de loading; chame a função devolvida quando estiver pronto */
export function hold() {
  pending++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pending--;
    flush();
  };
}

/** chama `cb` quando não houver mais nada segurando (ou no teto de tempo) */
export function onGateOpen(cb) {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    cb();
  };
  const timer = setTimeout(once, MAX_WAIT_MS);
  listeners.push(once);
  // um quadro de folga: quem monta junto com a página registra o seu hold()
  // nos efeitos do React, que rodam no mesmo commit
  requestAnimationFrame(flush);
  return () => {
    done = true;
    clearTimeout(timer);
    listeners = listeners.filter((l) => l !== once);
  };
}
