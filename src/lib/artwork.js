/* ===========================================================
   artwork.js — procedural placeholder visuals

   Until real screenshots exist, every project card needs a visual that looks
   deliberate rather than missing. Each one is generated from a seed derived
   from the project's own name, so a card always redraws identically, no two
   cards match, and they still read as one family because they share a
   palette and a construction.

   The motif is the same signal-across-a-surface idea as the brain's synapse
   flashes: soft field, fine grid, one bright path with nodes.
   =========================================================== */

const GOLD = [212, 175, 55];
const GOLD_HI = [246, 226, 122];
const GREY = [90, 90, 90];

/** xmur3 + mulberry32: tiny deterministic PRNG seeded from a string. */
function seededRandom(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

export function paintArtwork(canvas, seedText) {
  const W = (canvas.width = 900);
  const H = (canvas.height = 562);
  const ctx = canvas.getContext("2d");
  const rand = seededRandom(seedText);

  // base
  ctx.fillStyle = "#0f0f14";
  ctx.fillRect(0, 0, W, H);

  // soft colour fields
  const palette = [GOLD, GOLD_HI, GREY];
  const blobCount = 3;
  for (let i = 0; i < blobCount; i++) {
    const col = palette[(i + Math.floor(rand() * 3)) % palette.length];
    const cx = W * (0.15 + rand() * 0.7);
    const cy = H * (0.15 + rand() * 0.7);
    const r = Math.min(W, H) * (0.35 + rand() * 0.45);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgba(col, 0.3));
    g.addColorStop(0.55, rgba(col, 0.08));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // fine grid — reads as measurement, keeps the softness from going mushy
  ctx.strokeStyle = "rgba(236,232,223,0.05)";
  ctx.lineWidth = 1;
  const step = 45;
  ctx.beginPath();
  for (let x = step; x < W; x += step) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
  }
  for (let y = step; y < H; y += step) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
  }
  ctx.stroke();

  // the signal: a path stepping left to right, with lit nodes at each turn
  const points = [];
  const segments = 5 + Math.floor(rand() * 3);
  for (let i = 0; i <= segments; i++) {
    points.push({
      x: (W / segments) * i,
      y: H * (0.25 + rand() * 0.5),
    });
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const midX = (prev.x + cur.x) / 2;
    ctx.bezierCurveTo(midX, prev.y, midX, cur.y, cur.x, cur.y);
  }
  ctx.strokeStyle = rgba(GOLD, 0.85);
  ctx.lineWidth = 1.5;
  ctx.shadowColor = rgba(GOLD, 0.9);
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.shadowBlur = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const lit = rand() > 0.55;
    const col = lit ? GOLD_HI : GOLD;
    ctx.beginPath();
    ctx.arc(p.x, p.y, lit ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = rgba(col, 0.95);
    ctx.shadowColor = rgba(col, 1);
    ctx.shadowBlur = lit ? 22 : 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // vignette so the card edge stays dark and the type on top keeps contrast
  const vg = ctx.createRadialGradient(
    W / 2,
    H / 2,
    Math.min(W, H) * 0.25,
    W / 2,
    H / 2,
    Math.max(W, H) * 0.75,
  );
  vg.addColorStop(0, "rgba(10,10,13,0)");
  vg.addColorStop(1, "rgba(10,10,13,0.75)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}
