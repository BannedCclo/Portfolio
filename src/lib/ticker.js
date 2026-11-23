/* ===========================================================
   ticker.js — one RAF loop for all DOM-side damped animation

   Kept separate from the WebGL stage loop on purpose: the stage skips frames
   whenever no 3D act is on screen, but CSS-driven sections still need to
   damp their values on those very frames. Every subscriber gets the same
   clamped dt, so the whole page shares one clock.

   Module-level and framework-agnostic on purpose: components subscribe with
   onTick() inside useEffect and unsubscribe with the returned function on
   cleanup, but the RAF loop itself is a page-wide singleton, not tied to any
   one component's lifecycle.
   =========================================================== */

const tasks = new Set();
let last = performance.now();
let running = true;

export function onTick(fn) {
  tasks.add(fn);
  return () => tasks.delete(fn);
}

document.addEventListener("visibilitychange", () => {
  running = !document.hidden;
  last = performance.now(); // drop the gap so nothing lurches on return
});

function loop(now) {
  requestAnimationFrame(loop);
  if (!running) return;
  // o timestamp do rAF pode ser anterior ao performance.now() lido no
  // visibilitychange (o quadro foi agendado antes de a aba voltar): sem o
  // piso em 0, o dt sai negativo e todo damp() anda para trás
  const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
  last = now;
  const t = now / 1000;
  for (const fn of tasks) fn(dt, t);
}

requestAnimationFrame(loop);
